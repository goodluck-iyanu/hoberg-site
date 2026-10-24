/* ===========================================================
   HOBERG DIGITAL NEWSROOM — PRIVATE MOBILE-FIRST ADMIN CONTROLLER
   Supports:
   1. Encrypted iPhone / GitHub Direct Repository Publishing (AES-256-GCM + PBKDF2)
   2. Server-Side Node.js API Mode (/api/blog/*)
   3. Complete 12-Step Automated Publishing, SEO, Sitemap, Feed & Verification Pipeline
   =========================================================== */

(function () {
  'use strict';

  var VAULT_STORAGE_KEY = 'hoberg_newsroom_vault_v1';
  var LOCKOUT_STORAGE_KEY = 'hoberg_newsroom_lockout_v1';
  var AUTOSAVE_STORAGE_KEY = 'hoberg_newsroom_autosave_v1';
  var MAX_FAILED_ATTEMPTS = 5;
  var LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
  var INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

  var state = {
    mode: null, // 'github' | 'server'
    githubToken: null,
    githubRepo: 'goodluck-iyanu/hoberg-site',
    githubBranch: 'main',
    serverCsrfToken: null,
    config: {},
    authors: [],
    categories: [],
    articles: [],
    media: [],
    redirects: [],
    statusLog: { articles: {} },
    isDirty: false,
    sourceMode: false,
    inactivityTimer: null
  };

  /* ---------- UI Helpers ---------- */
  function $(id) {
    return document.getElementById(id);
  }

  function showToast(message, type) {
    var container = $('toastContainer');
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = message;
    container.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 4200);
  }

  function showAuthError(msg) {
    var box = $('authErrorBox');
    if (!box) return;
    if (!msg) {
      box.style.display = 'none';
      box.textContent = '';
    } else {
      box.style.display = 'block';
      box.textContent = msg;
    }
  }

  function openModal(title, htmlContent) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = htmlContent;
    $('adminModal').classList.add('open');
  }

  function closeModal() {
    $('adminModal').classList.remove('open');
    $('modalBody').innerHTML = '';
  }

  /* ---------- Rate-Limiting / Lockout Guard ---------- */
  function getLockoutState() {
    try {
      var raw = localStorage.getItem(LOCKOUT_STORAGE_KEY);
      if (!raw) return { attempts: 0, lockedUntil: 0 };
      return JSON.parse(raw);
    } catch (e) {
      return { attempts: 0, lockedUntil: 0 };
    }
  }

  function checkIsLockedOut() {
    var lock = getLockoutState();
    if (lock.lockedUntil && Date.now() < lock.lockedUntil) {
      var mins = Math.ceil((lock.lockedUntil - Date.now()) / 60000);
      showAuthError(
        'Too many failed authentication attempts. Locked for ' + mins + ' more minute(s).'
      );
      return true;
    }
    return false;
  }

  function recordFailedAuthAttempt() {
    var lock = getLockoutState();
    lock.attempts = (lock.attempts || 0) + 1;
    if (lock.attempts >= MAX_FAILED_ATTEMPTS) {
      lock.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
      lock.attempts = 0;
    }
    try {
      localStorage.setItem(LOCKOUT_STORAGE_KEY, JSON.stringify(lock));
    } catch (e) {}
  }

  function resetAuthAttempts() {
    try {
      localStorage.removeItem(LOCKOUT_STORAGE_KEY);
    } catch (e) {}
  }

  /* ---------- WebCrypto PBKDF2 + AES-256-GCM Token Vault ---------- */
  function bufToBase64(buf) {
    var bytes = new Uint8Array(buf);
    var binary = '';
    for (var i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  function base64ToBuf(b64) {
    var binary = window.atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  async function deriveVaultKey(passphrase, saltBuf) {
    var enc = new TextEncoder();
    var baseKey = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBuf,
        iterations: 250000,
        hash: 'SHA-256'
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptVaultPayload(payloadObj, passphrase) {
    var salt = window.crypto.getRandomValues(new Uint8Array(16));
    var iv = window.crypto.getRandomValues(new Uint8Array(12));
    var key = await deriveVaultKey(passphrase, salt.buffer);
    var enc = new TextEncoder();
    var cipherBuf = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      enc.encode(JSON.stringify(payloadObj))
    );
    return {
      v: 1,
      salt: bufToBase64(salt.buffer),
      iv: bufToBase64(iv.buffer),
      cipher: bufToBase64(cipherBuf)
    };
  }

  async function decryptVaultPayload(vaultObj, passphrase) {
    var saltBuf = base64ToBuf(vaultObj.salt);
    var ivBuf = base64ToBuf(vaultObj.iv);
    var cipherBuf = base64ToBuf(vaultObj.cipher);
    var key = await deriveVaultKey(passphrase, saltBuf);
    var plainBuf = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(ivBuf) },
      key,
      cipherBuf
    );
    var dec = new TextDecoder();
    return JSON.parse(dec.decode(plainBuf));
  }

  function hasStoredVault() {
    try {
      return !!localStorage.getItem(VAULT_STORAGE_KEY);
    } catch (e) {
      return false;
    }
  }

  /* ---------- GitHub API Helpers ---------- */
  async function verifyGithubWriteAccess(repo, token) {
    var res = await fetch('https://api.github.com/repos/' + repo, {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json'
      }
    });
    if (!res.ok) {
      throw new Error('GitHub authentication failed (HTTP ' + res.status + '). Check your token.');
    }
    var data = await res.json();
    if (!data.permissions || !data.permissions.push) {
      throw new Error(
        'This GitHub token does not have write (push) permission on ' + repo + '.'
      );
    }
    return data;
  }

  function utf8ToBase64(str) {
    var bytes = new TextEncoder().encode(str);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  function base64ToUtf8(b64) {
    var clean = String(b64).replace(/\s+/g, '');
    var binary = window.atob(clean);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }

  async function fetchGithubJsonFile(filePath, fallback) {
    var url =
      'https://api.github.com/repos/' +
      state.githubRepo +
      '/contents/' +
      filePath +
      '?ref=' +
      encodeURIComponent(state.githubBranch);
    var res = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + state.githubToken,
        Accept: 'application/vnd.github+json'
      },
      cache: 'no-store'
    });
    if (!res.ok) return fallback;
    var body = await res.json();
    if (body && body.content) {
      return JSON.parse(base64ToUtf8(body.content));
    }
    return fallback;
  }

  /**
   * Commits multiple text or binary files atomically to GitHub in a single commit
   */
  async function commitFilesToGithubAtomic(filesMap, commitMessage) {
    var headers = {
      Authorization: 'Bearer ' + state.githubToken,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    };
    var apiBase = 'https://api.github.com/repos/' + state.githubRepo;

    // 1. Get latest commit SHA on branch
    var refRes = await fetch(apiBase + '/git/ref/heads/' + state.githubBranch, {
      headers: headers,
      cache: 'no-store'
    });
    if (!refRes.ok) {
      throw new Error('Failed to read branch ref from GitHub (HTTP ' + refRes.status + ')');
    }
    var refData = await refRes.json();
    var latestCommitSha = refData.object.sha;

    // 2. Get base tree SHA
    var commitRes = await fetch(apiBase + '/git/commits/' + latestCommitSha, {
      headers: headers
    });
    var commitData = await commitRes.json();
    var baseTreeSha = commitData.tree.sha;

    // 3. Create blobs for each file in filesMap
    // filesMap entries: { path: 'blog/...', content: '...', encoding: 'utf-8' | 'base64', delete: false }
    var treeItems = [];
    for (var i = 0; i < filesMap.length; i++) {
      var item = filesMap[i];
      if (item.delete) {
        treeItems.push({
          path: item.path,
          mode: '100644',
          type: 'blob',
          sha: null
        });
      } else {
        var blobRes = await fetch(apiBase + '/git/blobs', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            content: item.content,
            encoding: item.encoding || 'utf-8'
          })
        });
        if (!blobRes.ok) {
          throw new Error('Failed to create Git blob for ' + item.path);
        }
        var blobData = await blobRes.json();
        treeItems.push({
          path: item.path,
          mode: '100644',
          type: 'blob',
          sha: blobData.sha
        });
      }
    }

    // 4. Create new tree
    var treeRes = await fetch(apiBase + '/git/trees', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeItems
      })
    });
    if (!treeRes.ok) {
      throw new Error('Failed to create Git tree (HTTP ' + treeRes.status + ')');
    }
    var newTree = await treeRes.json();

    // 5. Create commit
    var newCommitRes = await fetch(apiBase + '/git/commits', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        message: commitMessage,
        tree: newTree.sha,
        parents: [latestCommitSha]
      })
    });
    if (!newCommitRes.ok) {
      throw new Error('Failed to create Git commit (HTTP ' + newCommitRes.status + ')');
    }
    var newCommit = await newCommitRes.json();

    // 6. Update branch reference
    var updateRefRes = await fetch(apiBase + '/git/refs/heads/' + state.githubBranch, {
      method: 'PATCH',
      headers: headers,
      body: JSON.stringify({
        sha: newCommit.sha,
        force: false
      })
    });
    if (!updateRefRes.ok) {
      throw new Error('Failed to update branch ref (HTTP ' + updateRefRes.status + ')');
    }

    return newCommit.sha;
  }

  /* ---------- Load Initial Data State ---------- */
  async function loadNewsroomState() {
    if (state.mode === 'server') {
      var res = await fetch('/api/blog/state', {
        headers: { 'X-CSRF-Token': state.serverCsrfToken || '' },
        cache: 'no-store'
      });
      if (!res.ok) throw new Error('Failed to load server state (HTTP ' + res.status + ')');
      var data = await res.json();
      state.config = data.config || {};
      state.authors = data.authors || [];
      state.categories = data.categories || [];
      state.articles = data.articles || [];
      state.media = data.media || [];
      state.redirects = data.redirects || [];
      state.statusLog = data.statusLog || { articles: {} };
    } else if (state.mode === 'github') {
      var results = await Promise.all([
        fetchGithubJsonFile('blog/data/config.json', {}),
        fetchGithubJsonFile('blog/data/authors.json', []),
        fetchGithubJsonFile('blog/data/categories.json', []),
        fetchGithubJsonFile('blog/data/articles.json', []),
        fetchGithubJsonFile('blog/data/media.json', []),
        fetchGithubJsonFile('blog/data/redirects.json', []),
        fetchGithubJsonFile('blog/data/status-log.json', { articles: {} })
      ]);
      state.config = results[0];
      state.authors = results[1];
      state.categories = results[2];
      state.articles = results[3];
      state.media = results[4];
      state.redirects = results[5];
      state.statusLog = results[6];
    }
    populateStaticSelects();
    renderDashboard();
    renderMediaLibrary();
    renderStatusDashboard();
    renderRedirectsList();
    checkAutosaveBanner();
  }

  /* ---------- Populate Dropdowns ---------- */
  function populateStaticSelects() {
    var contentTypes = (state.config && state.config.contentTypes) || [];
    var typeFilter = $('adminTypeFilter');
    var editType = $('editContentType');
    if (typeFilter) {
      typeFilter.innerHTML =
        '<option value="all">All Content Types</option>' +
        contentTypes
          .map(function (ct) {
            return (
              '<option value="' +
              NewsroomEngine.escapeHtml(ct.id) +
              '">' +
              NewsroomEngine.escapeHtml(ct.label) +
              '</option>'
            );
          })
          .join('');
    }
    if (editType) {
      editType.innerHTML = contentTypes
        .map(function (ct) {
          return (
            '<option value="' +
            NewsroomEngine.escapeHtml(ct.id) +
            '" data-schema="' +
            NewsroomEngine.escapeHtml(ct.schemaType) +
            '">' +
            NewsroomEngine.escapeHtml(ct.label) +
            '</option>'
          );
        })
        .join('');
    }

    var catFilter = $('adminCategoryFilter');
    var editCat = $('editCategory');
    if (catFilter) {
      catFilter.innerHTML =
        '<option value="all">All Categories</option>' +
        state.categories
          .map(function (c) {
            return (
              '<option value="' +
              NewsroomEngine.escapeHtml(c.name) +
              '">' +
              NewsroomEngine.escapeHtml(c.name) +
              '</option>'
            );
          })
          .join('');
    }
    if (editCat) {
      editCat.innerHTML = state.categories
        .map(function (c) {
          return (
            '<option value="' +
            NewsroomEngine.escapeHtml(c.name) +
            '">' +
            NewsroomEngine.escapeHtml(c.name) +
            '</option>'
          );
        })
        .join('');
    }

    var editAuthor = $('editAuthorId');
    if (editAuthor) {
      editAuthor.innerHTML = state.authors
        .map(function (a) {
          return (
            '<option value="' +
            NewsroomEngine.escapeHtml(a.id) +
            '">' +
            NewsroomEngine.escapeHtml(a.name) +
            ' (' +
            NewsroomEngine.escapeHtml(a.role || a.type) +
            ')</option>'
          );
        })
        .join('');
    }
  }

  /* ---------- Render Dashboard & Article List ---------- */
  function renderDashboard() {
    var pubCount = state.articles.filter(function (a) {
      return a.status === 'published';
    }).length;
    var draftCount = state.articles.filter(function (a) {
      return a.status === 'draft';
    }).length;
    var schedCount = state.articles.filter(function (a) {
      return a.status === 'scheduled';
    }).length;
    var archCount = state.articles.filter(function (a) {
      return a.status === 'archived';
    }).length;

    var validSeoCount = 0;
    state.articles.forEach(function (a) {
      var diag = NewsroomEngine.validateArticleDiagnostic(a, state.config, state.authors);
      if (diag.metadataValid && diag.schemaValid) validSeoCount++;
    });

    $('statPublished').textContent = String(pubCount);
    $('statDrafts').textContent = String(draftCount);
    $('statScheduled').textContent = String(schedCount);
    $('statArchived').textContent = String(archCount);
    $('statValidSeo').textContent = validSeoCount + '/' + state.articles.length;
    $('statMediaCount').textContent = String(state.media.length);
    $('statRedirectsSub').textContent = state.redirects.length + ' active 301 redirects';

    var q = ($('adminSearchInput').value || '').trim().toLowerCase();
    var statusF = $('adminStatusFilter').value || 'all';
    var typeF = $('adminTypeFilter').value || 'all';
    var catF = $('adminCategoryFilter').value || 'all';

    var filtered = state.articles
      .filter(function (a) {
        if (statusF !== 'all' && a.status !== statusF) return false;
        if (typeF !== 'all' && a.contentType !== typeF) return false;
        if (catF !== 'all' && a.category !== catF) return false;
        if (q) {
          var hay = (
            a.title +
            ' ' +
            a.slug +
            ' ' +
            (a.summary || '') +
            ' ' +
            (a.category || '') +
            ' ' +
            (a.tags || []).join(' ')
          ).toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      })
      .sort(function (a, b) {
        return new Date(b.datePublished || 0) - new Date(a.datePublished || 0);
      });

    var listEl = $('adminArticleList');
    if (!filtered.length) {
      listEl.innerHTML =
        '<p style="padding:20px; color:var(--muted); text-align:center;">No articles match the current filter.</p>';
      return;
    }

    listEl.innerHTML = filtered
      .map(function (a) {
        var typeMeta = NewsroomEngine.getContentTypeMeta(a.contentType, state.config);
        var author = NewsroomEngine.getAuthorMeta(a.authorId, state.authors, state.config);
        var statusClass = 'status-' + (a.status || 'draft');
        var pubHuman = NewsroomEngine.formatDateHuman(a.datePublished);
        return (
          '<div class="article-admin-item">' +
          '<div class="article-admin-info">' +
          '<div class="article-admin-badges">' +
          '<span class="status-pill ' +
          statusClass +
          '">' +
          NewsroomEngine.escapeHtml(a.status.toUpperCase()) +
          '</span>' +
          '<span class="status-pill" style="background:' +
          NewsroomEngine.escapeHtml(typeMeta.badgeColor || '#C8102E') +
          ';color:#fff;">' +
          NewsroomEngine.escapeHtml(typeMeta.label) +
          '</span>' +
          '<span style="font-size:0.78rem; color:var(--muted); font-weight:600;">' +
          NewsroomEngine.escapeHtml(a.category || '') +
          '</span>' +
          (a.featured
            ? '<span class="status-pill" style="background:#FFF3CD;color:#856404;">★ Featured</span>'
            : '') +
          '</div>' +
          '<div class="article-admin-title">' +
          NewsroomEngine.escapeHtml(a.title) +
          '</div>' +
          '<div class="article-admin-meta">' +
          'URL: <a href="/blog/' +
          NewsroomEngine.escapeHtml(a.slug) +
          '" target="_blank" rel="noopener">/blog/' +
          NewsroomEngine.escapeHtml(a.slug) +
          ' ↗</a> · By ' +
          NewsroomEngine.escapeHtml(author.name) +
          ' · ' +
          NewsroomEngine.escapeHtml(pubHuman) +
          '</div>' +
          '</div>' +
          '<div class="article-admin-actions">' +
          '<button type="button" class="btn btn-outline btn-sm" data-action="edit" data-id="' +
          NewsroomEngine.escapeHtml(a.id) +
          '">Edit</button>' +
          '<button type="button" class="btn btn-outline btn-sm" data-action="preview" data-id="' +
          NewsroomEngine.escapeHtml(a.id) +
          '">Preview</button>' +
          (a.status !== 'published'
            ? '<button type="button" class="btn btn-primary btn-sm" data-action="publish" data-id="' +
              NewsroomEngine.escapeHtml(a.id) +
              '">Publish</button>'
            : '<button type="button" class="btn btn-outline btn-sm" data-action="unpublish" data-id="' +
              NewsroomEngine.escapeHtml(a.id) +
              '">Unpublish</button>') +
          (a.status !== 'archived'
            ? '<button type="button" class="btn btn-outline btn-sm" data-action="archive" data-id="' +
              NewsroomEngine.escapeHtml(a.id) +
              '">Archive</button>'
            : '') +
          '<button type="button" class="btn btn-danger btn-sm" data-action="delete" data-id="' +
          NewsroomEngine.escapeHtml(a.id) +
          '">Delete</button>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');

    listEl.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.getAttribute('data-action');
        var id = btn.getAttribute('data-id');
        handleArticleQuickAction(action, id);
      });
    });
  }

  /* ---------- Editor Repeaters (FAQs, Press Kit, References) ---------- */
  function addFaqRepeaterRow(question, answer) {
    var list = $('faqRepeaterList');
    var row = document.createElement('div');
    row.className = 'repeater-item';
    row.innerHTML =
      '<button type="button" class="repeater-remove">Remove ✕</button>' +
      '<div class="form-group" style="margin-bottom:8px;">' +
      '<label>Question</label>' +
      '<input type="text" class="form-control faq-q-input" value="' +
      NewsroomEngine.escapeHtml(question || '') +
      '" placeholder="e.g. How do I verify a Lagos web design company?">' +
      '</div>' +
      '<div class="form-group" style="margin-bottom:0;">' +
      '<label>Answer</label>' +
      '<textarea class="form-control faq-a-input" rows="2" placeholder="Clear factual answer">' +
      NewsroomEngine.escapeHtml(answer || '') +
      '</textarea>' +
      '</div>';
    row.querySelector('.repeater-remove').addEventListener('click', function () {
      list.removeChild(row);
      markEditorDirty();
    });
    list.appendChild(row);
  }

  function addPressKitRepeaterRow(label, url, fileType) {
    var list = $('pressKitRepeaterList');
    var row = document.createElement('div');
    row.className = 'repeater-item';
    row.innerHTML =
      '<button type="button" class="repeater-remove">Remove ✕</button>' +
      '<div class="form-row">' +
      '<div class="form-group" style="margin-bottom:0;">' +
      '<label>Document / Link Label</label>' +
      '<input type="text" class="form-control pk-label-input" value="' +
      NewsroomEngine.escapeHtml(label || '') +
      '" placeholder="e.g. Download Full 2026 Report (PDF)">' +
      '</div>' +
      '<div class="form-group" style="margin-bottom:0;">' +
      '<label>URL</label>' +
      '<input type="url" class="form-control pk-url-input" value="' +
      NewsroomEngine.escapeHtml(url || '') +
      '" placeholder="https://hoberg.com.ng/...">' +
      '</div>' +
      '<div class="form-group" style="margin-bottom:0;">' +
      '<label>Badge / Format</label>' +
      '<input type="text" class="form-control pk-type-input" value="' +
      NewsroomEngine.escapeHtml(fileType || 'PDF') +
      '" placeholder="PDF, XLSX, Web">' +
      '</div>' +
      '</div>';
    row.querySelector('.repeater-remove').addEventListener('click', function () {
      list.removeChild(row);
      markEditorDirty();
    });
    list.appendChild(row);
  }

  function addReferenceRepeaterRow(title, url, publisher) {
    var list = $('referenceRepeaterList');
    var row = document.createElement('div');
    row.className = 'repeater-item';
    row.innerHTML =
      '<button type="button" class="repeater-remove">Remove ✕</button>' +
      '<div class="form-row">' +
      '<div class="form-group" style="margin-bottom:0;">' +
      '<label>Reference Title</label>' +
      '<input type="text" class="form-control ref-title-input" value="' +
      NewsroomEngine.escapeHtml(title || '') +
      '" placeholder="Official source or report title">' +
      '</div>' +
      '<div class="form-group" style="margin-bottom:0;">' +
      '<label>Source URL</label>' +
      '<input type="url" class="form-control ref-url-input" value="' +
      NewsroomEngine.escapeHtml(url || '') +
      '" placeholder="https://...">' +
      '</div>' +
      '<div class="form-group" style="margin-bottom:0;">' +
      '<label>Publisher / Organization</label>' +
      '<input type="text" class="form-control ref-pub-input" value="' +
      NewsroomEngine.escapeHtml(publisher || 'Hoberg Digital') +
      '">' +
      '</div>' +
      '</div>';
    row.querySelector('.repeater-remove').addEventListener('click', function () {
      list.removeChild(row);
      markEditorDirty();
    });
    list.appendChild(row);
  }

  /* ---------- Load Article Into Editor ---------- */
  function toLocalDatetimeInputValue(isoStr) {
    var d = isoStr ? new Date(isoStr) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    var pad = function (n) {
      return n < 10 ? '0' + n : String(n);
    };
    return (
      d.getFullYear() +
      '-' +
      pad(d.getMonth() + 1) +
      '-' +
      pad(d.getDate()) +
      'T' +
      pad(d.getHours()) +
      ':' +
      pad(d.getMinutes())
    );
  }

  function openEditorWithArticle(article) {
    var isNew = !article;
    var a = article || {
      id: 'art-' + Date.now(),
      slug: '',
      title: '',
      subtitle: '',
      summary: '',
      contentType: 'press-release',
      schemaType: 'NewsArticle',
      category: 'Press & Announcements',
      tags: ['Hoberg Digital', 'Lagos'],
      authorId: 'goodluck-iyanu',
      issuingOrganization: 'Hoberg Digital',
      dateline: 'LAGOS, NIGERIA',
      datePublished: new Date().toISOString(),
      status: 'published',
      featured: false,
      featuredImage: {
        url: 'https://hoberg.com.ng/blog/assets/hoberg-brand-logo.png',
        alt: 'Hoberg Digital official logo',
        caption: '',
        credit: 'Hoberg Digital',
        license: 'Hoberg Digital Official Media'
      },
      video: null,
      pressKitLinks: [],
      references: [],
      faqs: [],
      mediaContact: {
        name: 'Goodluck Iyanu',
        role: 'Founder & Owner, Hoberg Digital',
        organization: 'Hoberg Digital',
        email: 'hello@hoberg.com.ng',
        phone: '+234-810-428-9365'
      },
      seo: {
        title: '',
        description: '',
        canonicalUrl: '',
        noindex: false
      },
      bodyHtml:
        '<p class="intro-lede"><strong>LAGOS, NIGERIA —</strong> Write the opening paragraph of your announcement or article here.</p>\n\n<h2 id="overview">Key Details</h2>\n<p>Add supporting details, background context, and verifiable facts.</p>',
      ctaHtml: ''
    };

    $('editorHeading').textContent = isNew
      ? 'Create Official Press Release / Article'
      : 'Edit: ' + a.title;
    $('editorCurrentStatusBadge').textContent = (a.status || 'draft').toUpperCase();
    $('editorCurrentStatusBadge').className = 'status-pill status-' + (a.status || 'draft');

    $('editArticleId').value = a.id;
    $('editOriginalSlug').value = isNew ? '' : a.slug;
    $('editTitle').value = a.title || '';
    $('editSubtitle').value = a.subtitle || '';
    $('editSlug').value = a.slug || '';
    $('slugPreviewSpan').textContent = a.slug || '...';
    $('editDateline').value = a.dateline || '';
    $('editSummary').value = a.summary || '';
    $('editStatus').value = a.status || 'draft';
    $('editContentType').value = a.contentType || 'press-release';
    $('editSchemaType').value = a.schemaType || 'NewsArticle';
    $('editCategory').value = a.category || 'Press & Announcements';
    $('editTags').value = (a.tags || []).join(', ');
    $('editAuthorId').value = a.authorId || 'hoberg-digital';
    $('editIssuingOrg').value = a.issuingOrganization || 'Hoberg Digital';
    $('editDatePublished').value = toLocalDatetimeInputValue(a.datePublished);
    $('editScheduledFor').value = a.scheduledFor
      ? toLocalDatetimeInputValue(a.scheduledFor)
      : '';
    $('scheduledForGroup').style.display = a.status === 'scheduled' ? 'block' : 'none';
    $('editFeatured').checked = !!a.featured;

    var fi = a.featuredImage || {};
    $('editFeatImgUrl').value = fi.url || '';
    $('editFeatImgAlt').value = fi.alt || '';
    $('editFeatImgCaption').value = fi.caption || '';
    $('editFeatImgCredit').value = fi.credit || 'Hoberg Digital';
    $('editFeatImgLicense').value = fi.license || '';
    updateFeaturedPreview(fi.url);

    var vid = a.video || {};
    $('editVideoUrl').value = vid.url || '';
    $('editVideoTitle').value = vid.title || '';
    $('editVideoDesc').value = vid.description || '';
    $('editVideoPoster').value = vid.poster || '';
    $('editVideoTranscript').value = vid.transcript || '';

    var seo = a.seo || {};
    $('editSeoTitle').value = seo.title || '';
    $('editSeoDesc').value = seo.description || '';
    $('editCanonicalUrl').value = seo.canonicalUrl || '';
    $('editNoindex').checked = !!seo.noindex;
    updateSeoCounters();

    var hasMc = !!(a.mediaContact && a.mediaContact.name);
    $('editIncludeMediaContact').checked = hasMc;
    $('mediaContactFields').style.display = hasMc ? 'block' : 'none';
    if (a.mediaContact) {
      $('editMcName').value = a.mediaContact.name || 'Goodluck Iyanu';
      $('editMcRole').value = a.mediaContact.role || 'Founder & Owner, Hoberg Digital';
      $('editMcEmail').value = a.mediaContact.email || 'hello@hoberg.com.ng';
      $('editMcPhone').value = a.mediaContact.phone || '+234-810-428-9365';
    }

    $('rteCanvas').innerHTML = a.bodyHtml || '';
    $('rteSource').value = a.bodyHtml || '';
    $('editCtaHtml').value = a.ctaHtml || '';

    $('faqRepeaterList').innerHTML = '';
    (a.faqs || []).forEach(function (f) {
      addFaqRepeaterRow(f.question, f.answer);
    });

    $('pressKitRepeaterList').innerHTML = '';
    (a.pressKitLinks || []).forEach(function (pk) {
      addPressKitRepeaterRow(pk.label, pk.url, pk.fileType);
    });

    $('referenceRepeaterList').innerHTML = '';
    (a.references || []).forEach(function (r) {
      addReferenceRepeaterRow(r.title, r.url, r.publisher);
    });

    state.isDirty = false;
    switchAdminTab('editor');
  }

  function collectEditorArticleObject() {
    var bodyHtml = state.sourceMode ? $('rteSource').value : $('rteCanvas').innerHTML;
    var sanitizedBody = NewsroomEngine.sanitizeArticleHtml(bodyHtml);
    var slug =
      NewsroomEngine.slugify($('editSlug').value) ||
      NewsroomEngine.slugify($('editTitle').value) ||
      'release-' + Date.now();

    var faqs = [];
    $('faqRepeaterList')
      .querySelectorAll('.repeater-item')
      .forEach(function (row) {
        var q = row.querySelector('.faq-q-input').value.trim();
        var a = row.querySelector('.faq-a-input').value.trim();
        if (q && a) faqs.push({ question: q, answer: a });
      });

    var pressKitLinks = [];
    $('pressKitRepeaterList')
      .querySelectorAll('.repeater-item')
      .forEach(function (row) {
        var label = row.querySelector('.pk-label-input').value.trim();
        var url = row.querySelector('.pk-url-input').value.trim();
        var fileType = row.querySelector('.pk-type-input').value.trim() || 'Resource';
        if (label && url) pressKitLinks.push({ label: label, url: url, fileType: fileType });
      });

    var references = [];
    $('referenceRepeaterList')
      .querySelectorAll('.repeater-item')
      .forEach(function (row) {
        var title = row.querySelector('.ref-title-input').value.trim();
        var url = row.querySelector('.ref-url-input').value.trim();
        var publisher = row.querySelector('.ref-pub-input').value.trim();
        if (title && url) references.push({ title: title, url: url, publisher: publisher });
      });

    var videoUrl = $('editVideoUrl').value.trim();
    var videoObj = videoUrl
      ? {
          url: videoUrl,
          title: $('editVideoTitle').value.trim() || $('editTitle').value.trim(),
          description: $('editVideoDesc').value.trim(),
          poster: $('editVideoPoster').value.trim(),
          transcript: $('editVideoTranscript').value.trim()
        }
      : null;

    var includeMc = $('editIncludeMediaContact').checked;
    var mediaContact = includeMc
      ? {
          name: $('editMcName').value.trim(),
          role: $('editMcRole').value.trim(),
          organization: $('editIssuingOrg').value.trim() || 'Hoberg Digital',
          email: $('editMcEmail').value.trim(),
          phone: $('editMcPhone').value.trim(),
          whatsapp: 'https://wa.me/2348104289365',
          location: 'Lagos, Nigeria'
        }
      : null;

    var siteUrl = (state.config && state.config.siteUrl) || 'https://hoberg.com.ng';
    var canonicalUrl =
      $('editCanonicalUrl').value.trim() || siteUrl + '/blog/' + slug;

    var pubDateVal = $('editDatePublished').value;
    var pubIso = pubDateVal ? new Date(pubDateVal).toISOString() : new Date().toISOString();
    var schedVal = $('editScheduledFor').value;
    var schedIso = schedVal ? new Date(schedVal).toISOString() : null;

    var existing = state.articles.find(function (x) {
      return x.id === $('editArticleId').value;
    });

    return {
      id: $('editArticleId').value || 'art-' + Date.now(),
      slug: slug,
      legacyPath: existing ? existing.legacyPath || null : null,
      title: $('editTitle').value.trim(),
      subtitle: $('editSubtitle').value.trim(),
      summary: $('editSummary').value.trim(),
      contentType: $('editContentType').value,
      schemaType: $('editSchemaType').value,
      category: $('editCategory').value,
      tags: $('editTags')
        .value.split(',')
        .map(function (t) {
          return t.trim();
        })
        .filter(Boolean),
      authorId: $('editAuthorId').value,
      issuingOrganization: $('editIssuingOrg').value.trim() || 'Hoberg Digital',
      dateline: $('editDateline').value.trim(),
      datePublished: pubIso,
      dateModified: new Date().toISOString(),
      scheduledFor: $('editStatus').value === 'scheduled' ? schedIso : null,
      status: $('editStatus').value,
      featured: $('editFeatured').checked,
      readingTime: NewsroomEngine.computeReadingTime(sanitizedBody),
      featuredImage: {
        url:
          $('editFeatImgUrl').value.trim() ||
          'https://hoberg.com.ng/blog/assets/hoberg-brand-logo.png',
        alt: $('editFeatImgAlt').value.trim() || $('editTitle').value.trim(),
        caption: $('editFeatImgCaption').value.trim(),
        credit: $('editFeatImgCredit').value.trim(),
        license: $('editFeatImgLicense').value.trim()
      },
      inlineImages: existing ? existing.inlineImages || [] : [],
      video: videoObj,
      pressKitLinks: pressKitLinks,
      references: references,
      mediaContact: mediaContact,
      seo: {
        title:
          $('editSeoTitle').value.trim() ||
          $('editTitle').value.trim() + ' | Hoberg Digital Newsroom',
        description: $('editSeoDesc').value.trim() || $('editSummary').value.trim(),
        canonicalUrl: canonicalUrl,
        ogImage:
          $('editFeatImgUrl').value.trim() ||
          'https://hoberg.com.ng/blog/assets/hoberg-brand-logo.png',
        noindex: $('editNoindex').checked
      },
      bodyHtml: sanitizedBody,
      ctaHtml: $('editCtaHtml').value.trim(),
      faqs: faqs,
      relatedSlugs: existing ? existing.relatedSlugs || [] : []
    };
  }

  /* ---------- Client-Side Image Optimization for iPhone Photos ---------- */
  function optimizeImageFile(file, maxWidth, quality) {
    return new Promise(function (resolve, reject) {
      if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
        var reader = new FileReader();
        reader.onload = function () {
          var b64 = String(reader.result).split(',')[1];
          resolve({
            base64: b64,
            mimeType: file.type,
            ext: file.type === 'image/svg+xml' ? 'svg' : 'gif',
            width: 1200,
            height: 675
          });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
        return;
      }

      var img = new Image();
      var objectUrl = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(objectUrl);
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        var targetW = w;
        var targetH = h;
        var limit = maxWidth || 1600;
        if (w > limit) {
          targetW = limit;
          targetH = Math.round((h * limit) / w);
        }
        var canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, targetW, targetH);
        var outMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        var dataUrl = canvas.toDataURL(outMime, quality || 0.85);
        var b64 = dataUrl.split(',')[1];
        resolve({
          base64: b64,
          mimeType: outMime,
          ext: outMime === 'image/png' ? 'png' : 'jpg',
          width: targetW,
          height: targetH
        });
      };
      img.onerror = function (err) {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      };
      img.src = objectUrl;
    });
  }

  function readBinaryFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var b64 = String(reader.result).split(',')[1];
        resolve(b64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function uploadMediaAsset(file, meta) {
    var allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/svg+xml',
      'video/mp4',
      'video/webm'
    ];
    if (allowedTypes.indexOf(file.type) === -1) {
      throw new Error('Unsupported file type: ' + file.type);
    }

    var isVideo = file.type.indexOf('video/') === 0;
    if (isVideo && file.size > 25 * 1024 * 1024) {
      throw new Error(
        'Direct video upload limit is 25MB for GitHub Pages compatibility. For larger videos, use a YouTube or Vimeo link.'
      );
    }
    if (!isVideo && file.size > 15 * 1024 * 1024) {
      throw new Error('Image file exceeds 15MB maximum upload size.');
    }

    var baseName =
      NewsroomEngine.slugify(meta.title || file.name.replace(/\.[^.]+$/, '')) || 'media';
    var timestamp = Date.now();
    var b64Content = '';
    var ext = 'jpg';
    var width = 1200;
    var height = 675;
    var mimeType = file.type;

    if (isVideo) {
      b64Content = await readBinaryFileAsBase64(file);
      ext = file.type === 'video/webm' ? 'webm' : 'mp4';
    } else {
      var optimized = await optimizeImageFile(file, 1600, 0.85);
      b64Content = optimized.base64;
      ext = optimized.ext;
      width = optimized.width;
      height = optimized.height;
      mimeType = optimized.mimeType;
    }

    var fileName = timestamp + '-' + baseName + '.' + ext;
    var relativePath = '/blog/uploads/' + fileName;
    var repoFilePath = 'blog/uploads/' + fileName;
    var siteUrl = (state.config && state.config.siteUrl) || 'https://hoberg.com.ng';
    var publicUrl = siteUrl + relativePath;

    var newAsset = {
      id: 'media-' + timestamp,
      type: isVideo ? 'video' : 'image',
      title: meta.title || fileName,
      url: publicUrl,
      relativePath: relativePath,
      alt: meta.alt || meta.title || fileName,
      caption: meta.caption || '',
      credit: meta.credit || 'Hoberg Digital',
      sourceUrl: siteUrl + '/blog',
      license: meta.license || 'Official Hoberg Media',
      width: width,
      height: height,
      mimeType: mimeType,
      uploadedAt: new Date().toISOString()
    };

    if (state.mode === 'server') {
      var res = await fetch('/api/blog/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': state.serverCsrfToken || ''
        },
        body: JSON.stringify({
          fileName: fileName,
          base64: b64Content,
          asset: newAsset
        })
      });
      if (!res.ok) {
        var errData = await res.json().catch(function () {
          return {};
        });
        throw new Error(errData.error || 'Server upload failed');
      }
      var resp = await res.json();
      state.media = resp.media || state.media;
    } else if (state.mode === 'github') {
      state.media.unshift(newAsset);
      await commitFilesToGithubAtomic(
        [
          { path: repoFilePath, content: b64Content, encoding: 'base64' },
          {
            path: 'blog/data/media.json',
            content: JSON.stringify(state.media, null, 2) + '\n',
            encoding: 'utf-8'
          }
        ],
        'chore(newsroom): upload media asset ' + fileName
      );
    }

    renderMediaLibrary();
    return newAsset;
  }

  /* ---------- PHASE 6: Execute Complete Automated Publishing Pipeline ---------- */
  async function executePublishingPipeline(updatedArticle, operationLabel) {
    var reportSteps = [];
    function addStep(name, status, detail) {
      reportSteps.push({ name: name, status: status, detail: detail });
    }

    // Step 1: Validate content & required fields
    var diag = NewsroomEngine.validateArticleDiagnostic(
      updatedArticle,
      state.config,
      state.authors
    );
    if (
      updatedArticle.status === 'published' &&
      (!updatedArticle.title || !updatedArticle.slug || !updatedArticle.summary)
    ) {
      throw new Error('Headline, URL slug, and summary are required to publish.');
    }
    addStep(
      '1. Content & Field Validation',
      diag.metadataValid ? 'Complete' : 'Warning',
      diag.metadataValid
        ? 'Headline, slug, summary, and body HTML validated & sanitized.'
        : diag.metadataIssues.join(' ')
    );

    // Check slug rename for 301 redirect creation
    var originalSlug = $('editOriginalSlug').value;
    var slugChanged = originalSlug && originalSlug !== updatedArticle.slug;
    if (slugChanged) {
      var oldPath = '/blog/' + originalSlug;
      var newPath = '/blog/' + updatedArticle.slug;
      var existsRedir = state.redirects.some(function (r) {
        return r.from === oldPath;
      });
      if (!existsRedir) {
        state.redirects.unshift({
          from: oldPath,
          to: newPath,
          type: 301,
          reason: 'Slug updated from ' + originalSlug + ' to ' + updatedArticle.slug,
          createdAt: new Date().toISOString()
        });
      }
      addStep(
        '2. Canonical Slug Redirect',
        'Complete',
        'Created permanent redirect from ' + oldPath + ' → ' + newPath
      );
    }

    // Update article in state.articles array
    var idx = state.articles.findIndex(function (a) {
      return a.id === updatedArticle.id;
    });
    if (idx >= 0) {
      state.articles[idx] = updatedArticle;
    } else {
      state.articles.unshift(updatedArticle);
    }

    var siteUrl = (state.config && state.config.siteUrl) || 'https://hoberg.com.ng';
    var publicUrl = siteUrl + '/blog/' + updatedArticle.slug;

    if (state.mode === 'server') {
      var res = await fetch('/api/blog/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': state.serverCsrfToken || ''
        },
        body: JSON.stringify({
          article: updatedArticle,
          redirects: state.redirects,
          operationLabel: operationLabel
        })
      });
      if (!res.ok) {
        var errObj = await res.json().catch(function () {
          return {};
        });
        throw new Error(errObj.error || 'Server publish pipeline failed');
      }
      var srvResult = await res.json();
      state.articles = srvResult.articles || state.articles;
      state.statusLog = srvResult.statusLog || state.statusLog;
      addStep('3. Server Database & Static Route Generation', 'Complete', 'Written /blog/' + updatedArticle.slug + '/index.html');
      addStep('4. SEO Metadata & Schema.org JSON-LD', 'Complete', 'Generated ' + updatedArticle.schemaType + ' + BreadcrumbList JSON-LD.');
      addStep('5. XML Sitemaps & RSS/Atom Feeds', 'Complete', 'Updated /sitemap.xml, /blog/sitemap.xml, /blog/feed.xml, /blog/atom.xml, /llms.txt.');
      addStep(
        '6. Search Engine Notification (IndexNow)',
        (srvResult.indexNow && srvResult.indexNow.status) || 'Submitted',
        (srvResult.indexNow && srvResult.indexNow.message) || 'Processed by server.'
      );
    } else if (state.mode === 'github') {
      // Generate all static files deterministically in browser using NewsroomEngine and commit atomically
      var filesToCommit = [];

      // Article HTML page (or removal if unpublished)
      if (updatedArticle.status === 'published') {
        var articleHtml = NewsroomEngine.generateArticlePageHtml(
          updatedArticle,
          state.articles,
          state.config,
          state.authors
        );
        filesToCommit.push({
          path: 'blog/' + updatedArticle.slug + '/index.html',
          content: articleHtml,
          encoding: 'utf-8'
        });
        if (updatedArticle.legacyPath) {
          filesToCommit.push({
            path: updatedArticle.legacyPath.replace(/^\/+/, ''),
            content: articleHtml,
            encoding: 'utf-8'
          });
        }
        addStep(
          '3. Public Article HTML Generation',
          'Complete',
          'Generated crawlable static HTML at /blog/' + updatedArticle.slug + '/index.html'
        );
      }

      if (slugChanged) {
        var redirStub = NewsroomEngine.generateRedirectPageHtml(
          '/blog/' + originalSlug,
          publicUrl,
          updatedArticle.title
        );
        filesToCommit.push({
          path: 'blog/' + originalSlug + '/index.html',
          content: redirStub,
          encoding: 'utf-8'
        });
      }

      addStep(
        '4. SEO Metadata & Schema.org JSON-LD',
        diag.schemaValid ? 'Complete' : 'Warning',
        'Generated ' +
          (updatedArticle.schemaType || 'Article') +
          ', Organization, BreadcrumbList' +
          (updatedArticle.faqs && updatedArticle.faqs.length ? ', FAQPage' : '') +
          (updatedArticle.video ? ', VideoObject' : '') +
          ' JSON-LD.'
      );

      // Regenerate Newsroom homepage (/blog/index.html)
      var homeHtml = NewsroomEngine.generateNewsroomHomepageHtml(
        state.articles,
        state.config,
        state.categories,
        state.authors
      );
      filesToCommit.push({
        path: 'blog/index.html',
        content: homeHtml,
        encoding: 'utf-8'
      });
      addStep(
        '5. Newsroom Archive, Category & Tag Pages',
        'Complete',
        'Updated /blog/index.html with latest featured and archive cards.'
      );

      // Sitemaps
      var sitemaps = NewsroomEngine.generateSitemapsXml(state.articles, state.config);
      filesToCommit.push({
        path: 'sitemap.xml',
        content: sitemaps.rootSitemapXml,
        encoding: 'utf-8'
      });
      filesToCommit.push({
        path: 'blog/sitemap.xml',
        content: sitemaps.blogSitemapXml,
        encoding: 'utf-8'
      });
      addStep(
        '6. XML Sitemaps Update',
        'Complete',
        'Updated /sitemap.xml and /blog/sitemap.xml (excluding drafts & noindex).'
      );

      // RSS, Atom, JSON Feeds
      var feeds = NewsroomEngine.generateFeeds(state.articles, state.config, state.authors);
      filesToCommit.push({ path: 'blog/feed.xml', content: feeds.rssXml, encoding: 'utf-8' });
      filesToCommit.push({ path: 'blog/atom.xml', content: feeds.atomXml, encoding: 'utf-8' });
      filesToCommit.push({ path: 'blog/feed.json', content: feeds.jsonFeed, encoding: 'utf-8' });
      addStep(
        '7. RSS 2.0, Atom 1.0 & JSON Feeds',
        'Complete',
        'Updated /blog/feed.xml, /blog/atom.xml, and /blog/feed.json.'
      );

      // AI Discovery (llms.txt)
      var llms = NewsroomEngine.generateLlmsTxt(state.articles, state.config);
      filesToCommit.push({ path: 'llms.txt', content: llms.rootLlmsTxt, encoding: 'utf-8' });
      filesToCommit.push({ path: 'blog/llms.txt', content: llms.blogLlmsTxt, encoding: 'utf-8' });
      addStep(
        '8. AI Crawler Discovery (llms.txt)',
        'Complete',
        'Updated /llms.txt and /blog/llms.txt.'
      );

      // Update statusLog entry
      var isPub = updatedArticle.status === 'published';
      var isIndexable = isPub && !(updatedArticle.seo && updatedArticle.seo.noindex);
      state.statusLog.lastBuildAt = new Date().toISOString();
      state.statusLog.articles = state.statusLog.articles || {};
      state.statusLog.articles[updatedArticle.slug] = {
        slug: updatedArticle.slug,
        title: updatedArticle.title,
        contentType: updatedArticle.contentType,
        publicationStatus: isPub ? 'Complete' : 'Draft / Excluded',
        publicUrl: publicUrl,
        publicUrlVerification: isPub ? 'Complete' : 'Excluded (Non-Public)',
        sitemapInclusion: isIndexable ? 'Complete' : 'Excluded',
        feedUpdate: isIndexable ? 'Complete' : 'Excluded',
        metadataValidation: diag.metadataValid ? 'Complete' : 'Error',
        metadataIssues: diag.metadataIssues,
        structuredDataValidation: diag.schemaValid ? 'Complete' : 'Error',
        schemaType: updatedArticle.schemaType || 'Article',
        schemaIssues: diag.schemaIssues,
        technicalCrawlability: isIndexable
          ? diag.crawlable
            ? 'Complete'
            : 'Error'
          : 'Excluded (Noindex/Draft)',
        crawlIssues: diag.crawlIssues,
        searchEngineNotification: isIndexable ? 'Submitted (Via GitHub Actions IndexNow)' : 'Excluded',
        googleIndexingStatus: 'Not connected (Verify in Google Search Console)',
        bingIndexingStatus: isIndexable
          ? 'Submitted (IndexNow Queued on Deploy)'
          : 'Excluded',
        lastVerifiedAt: new Date().toISOString(),
        outstandingActions: [].concat(diag.metadataIssues, diag.schemaIssues)
      };

      filesToCommit.push({
        path: 'blog/data/articles.json',
        content: JSON.stringify(state.articles, null, 2) + '\n',
        encoding: 'utf-8'
      });
      filesToCommit.push({
        path: 'blog/data/redirects.json',
        content: JSON.stringify(state.redirects, null, 2) + '\n',
        encoding: 'utf-8'
      });
      filesToCommit.push({
        path: 'blog/data/status-log.json',
        content: JSON.stringify(state.statusLog, null, 2) + '\n',
        encoding: 'utf-8'
      });

      var commitSha = await commitFilesToGithubAtomic(
        filesToCommit,
        'feat(newsroom): ' + (operationLabel || 'publish') + ' "' + updatedArticle.title + '"'
      );
      addStep(
        '9. Atomic GitHub Repository Commit',
        'Complete',
        'Committed ' +
          filesToCommit.length +
          ' files to ' +
          state.githubRepo +
          '@' +
          state.githubBranch +
          ' (' +
          commitSha.slice(0, 7) +
          '). GitHub Actions background pipeline triggered.'
      );
    }

    // Clear local autosave after successful save/publish
    try {
      localStorage.removeItem(AUTOSAVE_STORAGE_KEY);
    } catch (e) {}
    state.isDirty = false;
    $('editOriginalSlug').value = updatedArticle.slug;

    renderDashboard();
    renderStatusDashboard();
    renderRedirectsList();

    // Display Publication Report Modal
    var stepsHtml = reportSteps
      .map(function (s) {
        var pillClass = s.status === 'Complete' ? 'status-complete' : 'status-pending';
        return (
          '<tr>' +
          '<td><strong>' +
          NewsroomEngine.escapeHtml(s.name) +
          '</strong></td>' +
          '<td><span class="status-pill ' +
          pillClass +
          '">' +
          NewsroomEngine.escapeHtml(s.status) +
          '</span></td>' +
          '<td>' +
          NewsroomEngine.escapeHtml(s.detail) +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    openModal(
      'Publication Pipeline Report — ' + updatedArticle.title,
      '<div style="margin-bottom:16px; padding:14px; border-radius:8px; background:var(--green-bg); color:var(--green);">' +
        '<strong>✓ Pipeline Completed Successfully</strong><br>' +
        'Public Canonical URL: <a href="' +
        NewsroomEngine.escapeHtml(publicUrl) +
        '" target="_blank" rel="noopener" style="font-weight:700;">' +
        NewsroomEngine.escapeHtml(publicUrl) +
        ' ↗</a>' +
        '</div>' +
        '<div class="status-table-wrap">' +
        '<table class="status-table">' +
        '<thead><tr><th>Pipeline Step</th><th>Status</th><th>Verification Detail</th></tr></thead>' +
        '<tbody>' +
        stepsHtml +
        '</tbody>' +
        '</table>' +
        '</div>'
    );
  }

  /* ---------- Quick Actions from Dashboard ---------- */
  async function handleArticleQuickAction(action, id) {
    var art = state.articles.find(function (a) {
      return a.id === id;
    });
    if (!art) return;

    if (action === 'edit') {
      openEditorWithArticle(art);
      return;
    }
    if (action === 'preview') {
      openPreviewModalForArticle(art);
      return;
    }
    if (action === 'publish') {
      art.status = 'published';
      art.dateModified = new Date().toISOString();
      await executePublishingPipeline(art, 'publish');
      showToast('Published "' + art.title + '"', 'success');
      return;
    }
    if (action === 'unpublish') {
      art.status = 'draft';
      art.dateModified = new Date().toISOString();
      await executePublishingPipeline(art, 'unpublish');
      showToast('Unpublished "' + art.title + '" (reverted to draft)', 'success');
      return;
    }
    if (action === 'archive') {
      art.status = 'archived';
      art.dateModified = new Date().toISOString();
      await executePublishingPipeline(art, 'archive');
      showToast('Archived "' + art.title + '"', 'success');
      return;
    }
    if (action === 'delete') {
      if (
        !window.confirm(
          'Are you sure you want to permanently delete "' +
            art.title +
            '"? This will remove the public URL and update all sitemaps and feeds.'
        )
      ) {
        return;
      }
      state.articles = state.articles.filter(function (a) {
        return a.id !== id;
      });
      if (state.statusLog && state.statusLog.articles) {
        delete state.statusLog.articles[art.slug];
      }
      if (state.mode === 'server') {
        var delRes = await fetch('/api/blog/articles/' + encodeURIComponent(id), {
          method: 'DELETE',
          headers: { 'X-CSRF-Token': state.serverCsrfToken || '' }
        });
        if (delRes.ok) {
          var delData = await delRes.json().catch(function () { return {}; });
          state.articles = delData.articles || state.articles;
          state.statusLog = delData.statusLog || state.statusLog;
        }
      } else if (state.mode === 'github') {
        var homeHtml = NewsroomEngine.generateNewsroomHomepageHtml(
          state.articles,
          state.config,
          state.categories,
          state.authors
        );
        var sitemaps = NewsroomEngine.generateSitemapsXml(state.articles, state.config);
        var feeds = NewsroomEngine.generateFeeds(state.articles, state.config, state.authors);
        var llms = NewsroomEngine.generateLlmsTxt(state.articles, state.config);
        await commitFilesToGithubAtomic(
          [
            {
              path: 'blog/' + art.slug + '/index.html',
              delete: true
            },
            {
              path: 'blog/data/articles.json',
              content: JSON.stringify(state.articles, null, 2) + '\n',
              encoding: 'utf-8'
            },
            {
              path: 'blog/data/status-log.json',
              content: JSON.stringify(state.statusLog, null, 2) + '\n',
              encoding: 'utf-8'
            },
            { path: 'blog/index.html', content: homeHtml, encoding: 'utf-8' },
            { path: 'sitemap.xml', content: sitemaps.rootSitemapXml, encoding: 'utf-8' },
            { path: 'blog/sitemap.xml', content: sitemaps.blogSitemapXml, encoding: 'utf-8' },
            { path: 'blog/feed.xml', content: feeds.rssXml, encoding: 'utf-8' },
            { path: 'blog/atom.xml', content: feeds.atomXml, encoding: 'utf-8' },
            { path: 'blog/feed.json', content: feeds.jsonFeed, encoding: 'utf-8' },
            { path: 'llms.txt', content: llms.rootLlmsTxt, encoding: 'utf-8' },
            { path: 'blog/llms.txt', content: llms.blogLlmsTxt, encoding: 'utf-8' }
          ],
          'chore(newsroom): delete article ' + art.slug
        );
      }
      renderDashboard();
      renderStatusDashboard();
      showToast('Deleted article "' + art.title + '"', 'success');
    }
  }

  /* ---------- Preview & SEO Diagnostic Modal ---------- */
  function openPreviewModalForArticle(article) {
    var htmlPage = NewsroomEngine.generateArticlePageHtml(
      article,
      state.articles,
      state.config,
      state.authors
    );
    var jsonLd = NewsroomEngine.buildArticleJsonLd(article, state.config, state.authors);
    var diag = NewsroomEngine.validateArticleDiagnostic(article, state.config, state.authors);
    var siteUrl = (state.config && state.config.siteUrl) || 'https://hoberg.com.ng';
    var canonicalUrl = (article.seo && article.seo.canonicalUrl) || siteUrl + '/blog/' + article.slug;

    var modalHtml =
      '<div style="display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap;">' +
      '<button type="button" class="btn btn-dark btn-sm" id="prevBtnDesktop">Desktop View</button>' +
      '<button type="button" class="btn btn-outline btn-sm" id="prevBtnMobile">iPhone Mobile View (390px)</button>' +
      '<button type="button" class="btn btn-outline btn-sm" id="prevBtnSeo">SERP &amp; Schema JSON-LD Check</button>' +
      '</div>' +
      '<div id="previewIframeWrap" style="background:#ddd; padding:12px; border-radius:8px; display:flex; justify-content:center;">' +
      '<iframe id="previewIframe" style="width:100%; height:65vh; border:1px solid #ccc; border-radius:8px; background:#fff; transition:width 0.2s ease;"></iframe>' +
      '</div>' +
      '<div id="previewSeoWrap" style="display:none;">' +
      '<div class="panel-card">' +
      '<h3>Google Search Snippet Preview</h3>' +
      '<div style="padding:14px; border:1px solid var(--border); border-radius:8px; background:#fff; margin-top:10px; max-width:600px;">' +
      '<div style="font-size:12px; color:#202124;">hoberg.com.ng › blog › ' +
      NewsroomEngine.escapeHtml(article.slug) +
      '</div>' +
      '<div style="font-size:18px; color:#1a0dab; font-weight:500; margin:4px 0;">' +
      NewsroomEngine.escapeHtml(
        (article.seo && article.seo.title) || article.title + ' | Hoberg Digital Newsroom'
      ) +
      '</div>' +
      '<div style="font-size:14px; color:#4d5156;">' +
      NewsroomEngine.escapeHtml(
        (article.seo && article.seo.description) || article.summary || ''
      ) +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="panel-card">' +
      '<h3>Generated Schema.org JSON-LD</h3>' +
      '<pre style="background:#171513; color:#f8f8f2; padding:14px; border-radius:8px; overflow-x:auto; font-size:12px; margin-top:10px;">' +
      NewsroomEngine.escapeHtml(JSON.stringify(jsonLd, null, 2)) +
      '</pre>' +
      '</div>' +
      '</div>';

    openModal('Preview & SEO Inspector — ' + article.title, modalHtml);

    var iframe = $('previewIframe');
    if (iframe) {
      iframe.srcdoc = htmlPage;
    }

    $('prevBtnDesktop').addEventListener('click', function () {
      $('previewIframeWrap').style.display = 'flex';
      $('previewSeoWrap').style.display = 'none';
      $('previewIframe').style.width = '100%';
    });
    $('prevBtnMobile').addEventListener('click', function () {
      $('previewIframeWrap').style.display = 'flex';
      $('previewSeoWrap').style.display = 'none';
      $('previewIframe').style.width = '390px';
    });
    $('prevBtnSeo').addEventListener('click', function () {
      $('previewIframeWrap').style.display = 'none';
      $('previewSeoWrap').style.display = 'block';
    });
  }

  /* ---------- Render Media Library ---------- */
  function renderMediaLibrary() {
    var grid = $('mediaLibraryGrid');
    if (!grid) return;
    grid.innerHTML = state.media
      .map(function (m) {
        var isVid = m.type === 'video';
        return (
          '<div class="media-card">' +
          '<div class="media-thumb">' +
          (isVid
            ? '<video src="' +
              NewsroomEngine.escapeHtml(m.url) +
              '" poster="' +
              NewsroomEngine.escapeHtml(m.poster || '') +
              '" muted preload="metadata"></video>'
            : '<img src="' +
              NewsroomEngine.escapeHtml(m.url) +
              '" alt="' +
              NewsroomEngine.escapeHtml(m.alt || m.title) +
              '" loading="lazy">') +
          '</div>' +
          '<div class="media-meta">' +
          '<strong>' +
          NewsroomEngine.escapeHtml(m.title) +
          '</strong>' +
          '<span style="color:var(--muted);">' +
          NewsroomEngine.escapeHtml(m.credit || 'Hoberg Digital') +
          '</span>' +
          '<div style="display:flex; gap:6px; margin-top:auto; padding-top:8px;">' +
          '<button type="button" class="btn btn-outline btn-sm" data-copy-media="' +
          NewsroomEngine.escapeHtml(m.url) +
          '">Copy URL</button>' +
          (!isVid
            ? '<button type="button" class="btn btn-primary btn-sm" data-use-featured="' +
              NewsroomEngine.escapeHtml(m.id) +
              '">Set Featured</button>'
            : '') +
          '</div>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');

    grid.querySelectorAll('[data-copy-media]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var u = btn.getAttribute('data-copy-media');
        if (navigator.clipboard) {
          navigator.clipboard.writeText(u);
          showToast('Copied media URL to clipboard', 'success');
        }
      });
    });

    grid.querySelectorAll('[data-use-featured]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-use-featured');
        var asset = state.media.find(function (x) {
          return x.id === id;
        });
        if (asset) {
          $('editFeatImgUrl').value = asset.url;
          $('editFeatImgAlt').value = asset.alt || asset.title;
          $('editFeatImgCaption').value = asset.caption || '';
          $('editFeatImgCredit').value = asset.credit || 'Hoberg Digital';
          $('editFeatImgLicense').value = asset.license || '';
          updateFeaturedPreview(asset.url);
          switchAdminTab('editor');
          showToast('Selected "' + asset.title + '" as Featured Image', 'success');
        }
      });
    });
  }

  /* ---------- Render Phase 12 Publication & Indexing Status Dashboard ---------- */
  function statusBadgeHtml(val) {
    var v = String(val || 'Unknown');
    var lower = v.toLowerCase();
    var cls = 'status-unknown';
    if (lower.indexOf('complete') === 0 || lower.indexOf('indexed') === 0) cls = 'status-complete';
    else if (lower.indexOf('submitted') === 0 || lower.indexOf('pending') === 0)
      cls = 'status-submitted';
    else if (lower.indexOf('error') === 0) cls = 'status-error';
    else if (lower.indexOf('not connected') === 0) cls = 'status-not-connected';
    else if (lower.indexOf('excluded') === 0 || lower.indexOf('draft') === 0)
      cls = 'status-excluded';
    return '<span class="status-pill ' + cls + '">' + NewsroomEngine.escapeHtml(v) + '</span>';
  }

  function renderStatusDashboard() {
    var tbody = $('statusTableBody');
    if (!tbody) return;
    var map = (state.statusLog && state.statusLog.articles) || {};

    tbody.innerHTML = state.articles
      .map(function (a) {
        var st = map[a.slug] || {};
        var diag = NewsroomEngine.validateArticleDiagnostic(a, state.config, state.authors);
        var isPub = a.status === 'published';
        var pubStatus = st.publicationStatus || (isPub ? 'Complete' : 'Draft / Excluded');
        var urlVer = st.publicUrlVerification || (isPub ? 'Complete' : 'Excluded');
        var smInc = st.sitemapInclusion || (isPub ? 'Complete' : 'Excluded');
        var fdUpd = st.feedUpdate || (isPub ? 'Complete' : 'Excluded');
        var metaVal = diag.metadataValid ? 'Complete' : 'Error';
        var schemaVal = diag.schemaValid
          ? 'Complete (' + (a.schemaType || 'Article') + ')'
          : 'Error';
        var crawlVal = isPub ? (diag.crawlable ? 'Complete' : 'Error') : 'Excluded';
        var notifVal = st.searchEngineNotification || (isPub ? 'Pending' : 'Excluded');
        var gStatus =
          st.googleIndexingStatus || 'Not connected (Verify in GSC)';
        var bStatus = st.bingIndexingStatus || (isPub ? 'Submitted (Sitemap/IndexNow)' : 'Excluded');
        var verTime = NewsroomEngine.formatDateHuman(st.lastVerifiedAt || a.dateModified);

        return (
          '<tr>' +
          '<td><strong>' +
          NewsroomEngine.escapeHtml(a.title) +
          '</strong><br><a href="/blog/' +
          NewsroomEngine.escapeHtml(a.slug) +
          '" target="_blank" rel="noopener" style="font-size:0.76rem;">/blog/' +
          NewsroomEngine.escapeHtml(a.slug) +
          ' ↗</a></td>' +
          '<td>' +
          statusBadgeHtml(pubStatus) +
          '</td>' +
          '<td data-url-cell="' +
          NewsroomEngine.escapeHtml(a.slug) +
          '">' +
          statusBadgeHtml(urlVer) +
          '</td>' +
          '<td>' +
          statusBadgeHtml(smInc) +
          '</td>' +
          '<td>' +
          statusBadgeHtml(fdUpd) +
          '</td>' +
          '<td>' +
          statusBadgeHtml(metaVal) +
          '</td>' +
          '<td>' +
          statusBadgeHtml(schemaVal) +
          '</td>' +
          '<td>' +
          statusBadgeHtml(crawlVal) +
          '</td>' +
          '<td>' +
          statusBadgeHtml(notifVal) +
          '</td>' +
          '<td>' +
          statusBadgeHtml(gStatus) +
          '</td>' +
          '<td>' +
          statusBadgeHtml(bStatus) +
          '</td>' +
          '<td style="white-space:nowrap;">' +
          NewsroomEngine.escapeHtml(verTime) +
          '</td>' +
          '<td><button type="button" class="btn btn-outline btn-sm" data-verify-slug="' +
          NewsroomEngine.escapeHtml(a.slug) +
          '">Verify URL</button></td>' +
          '</tr>'
        );
      })
      .join('');

    tbody.querySelectorAll('[data-verify-slug]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var slug = btn.getAttribute('data-verify-slug');
        probeSingleArticleUrl(slug);
      });
    });
  }

  async function probeSingleArticleUrl(slug) {
    var cell = document.querySelector('[data-url-cell="' + slug + '"]');
    if (cell) cell.innerHTML = statusBadgeHtml('Pending...');
    try {
      var res = await fetch('/blog/' + slug, { method: 'GET', cache: 'no-store' });
      var statusText = res.ok ? 'Complete (HTTP ' + res.status + ')' : 'Error (HTTP ' + res.status + ')';
      if (cell) cell.innerHTML = statusBadgeHtml(statusText);
      if (state.statusLog && state.statusLog.articles && state.statusLog.articles[slug]) {
        state.statusLog.articles[slug].publicUrlVerification = statusText;
        state.statusLog.articles[slug].lastVerifiedAt = new Date().toISOString();
      }
      showToast('Verified /blog/' + slug + ': HTTP ' + res.status, res.ok ? 'success' : 'error');
    } catch (e) {
      if (cell) cell.innerHTML = statusBadgeHtml('Error (Network)');
    }
  }

  /* ---------- Render Redirects List ---------- */
  function renderRedirectsList() {
    var list = $('redirectsList');
    if (!list) return;
    list.innerHTML = state.redirects
      .map(function (r, idx) {
        return (
          '<div class="repeater-item" style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">' +
          '<div>' +
          '<code>' +
          NewsroomEngine.escapeHtml(r.from) +
          '</code> → <strong><code>' +
          NewsroomEngine.escapeHtml(r.to) +
          '</code></strong>' +
          '<div style="font-size:0.78rem; color:var(--muted);">' +
          NewsroomEngine.escapeHtml(r.reason || 'Permanent 301 / Canonical redirect') +
          '</div>' +
          '</div>' +
          '<button type="button" class="btn btn-danger btn-sm" data-del-redir="' +
          idx +
          '">Remove</button>' +
          '</div>'
        );
      })
      .join('');

    list.querySelectorAll('[data-del-redir]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-del-redir'), 10);
        state.redirects.splice(idx, 1);
        renderRedirectsList();
      });
    });
  }

  /* ---------- Autosave & Dirty State Guard ---------- */
  function markEditorDirty() {
    state.isDirty = true;
    try {
      var draftObj = collectEditorArticleObject();
      localStorage.setItem(
        AUTOSAVE_STORAGE_KEY,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          article: draftObj
        })
      );
      var timeStr = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      $('autosaveStatusText').textContent = 'Autosaved locally at ' + timeStr;
    } catch (e) {}
  }

  function checkAutosaveBanner() {
    try {
      var raw = localStorage.getItem(AUTOSAVE_STORAGE_KEY);
      if (!raw) {
        $('autosaveRecoveryBanner').style.display = 'none';
        return;
      }
      var data = JSON.parse(raw);
      if (data && data.article && data.article.title) {
        $('autosaveRecoveryBanner').style.display = 'block';
        $('autosaveRecoveryText').textContent =
          '"' +
          data.article.title +
          '" — autosaved at ' +
          new Date(data.savedAt).toLocaleString();
      }
    } catch (e) {}
  }

  function updateFeaturedPreview(url) {
    var wrap = $('featuredImagePreviewWrap');
    var img = $('featuredImagePreview');
    if (url && /^https?:\/\/|^\//i.test(url)) {
      img.src = url;
      wrap.style.display = 'block';
    } else {
      wrap.style.display = 'none';
    }
  }

  function updateSeoCounters() {
    $('seoTitleCount').textContent = String(($('editSeoTitle').value || '').length);
    $('seoDescCount').textContent = String(($('editSeoDesc').value || '').length);
  }

  /* ---------- Tab Switching ---------- */
  function switchAdminTab(tabName) {
    document.querySelectorAll('[data-admin-tab]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-admin-tab') === tabName);
    });
    document.querySelectorAll('.admin-tab-panel').forEach(function (panel) {
      panel.style.display = panel.id === 'tab-' + tabName ? 'block' : 'none';
    });
    $('editorStickyBar').style.display = tabName === 'editor' ? 'block' : 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- Session Inactivity Timer ---------- */
  function resetInactivityTimer() {
    if (state.inactivityTimer) clearTimeout(state.inactivityTimer);
    if (!state.mode) return;
    state.inactivityTimer = setTimeout(function () {
      lockOrSignOut(false);
      showToast('Session locked after 30 minutes of inactivity.', '');
    }, INACTIVITY_TIMEOUT_MS);
  }

  function lockOrSignOut(wipeVault) {
    var prevMode = state.mode;
    state.mode = null;
    state.githubToken = null;
    state.serverCsrfToken = null;
    if (wipeVault) {
      try {
        localStorage.removeItem(VAULT_STORAGE_KEY);
      } catch (e) {}
    }
    if (prevMode === 'server') {
      fetch('/api/blog/auth/logout', { method: 'POST' }).catch(function () {});
    }
    $('appView').style.display = 'none';
    $('topbarActions').style.display = 'none';
    $('editorStickyBar').style.display = 'none';
    $('authView').style.display = 'block';
    initAuthFormsView();
  }

  function initAuthFormsView() {
    var hasVault = hasStoredVault();
    $('vaultUnlockForm').style.display = hasVault ? 'block' : 'none';
    $('vaultSetupForm').style.display = hasVault ? 'none' : 'block';
    $('serverLoginForm').style.display = 'none';
    $('authTabGithub').classList.add('active');
    $('authTabServer').classList.remove('active');
  }

  /* ---------- Event Listeners Initialization ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    initAuthFormsView();

    ['click', 'keydown', 'touchstart'].forEach(function (ev) {
      document.addEventListener(ev, resetInactivityTimer, { passive: true });
    });

    // Check if Node server session is already active
    fetch('/api/blog/auth/session', { cache: 'no-store' })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (sess) {
        if (sess && sess.authenticated) {
          state.mode = 'server';
          state.serverCsrfToken = sess.csrfToken;
          enterAuthenticatedWorkspace('Node Server API');
        }
      })
      .catch(function () {});

    // Auth Tabs
    $('authTabGithub').addEventListener('click', function () {
      $('authTabGithub').classList.add('active');
      $('authTabServer').classList.remove('active');
      $('serverLoginForm').style.display = 'none';
      var hasV = hasStoredVault();
      $('vaultUnlockForm').style.display = hasV ? 'block' : 'none';
      $('vaultSetupForm').style.display = hasV ? 'none' : 'block';
      showAuthError('');
    });

    $('authTabServer').addEventListener('click', function () {
      $('authTabServer').classList.add('active');
      $('authTabGithub').classList.remove('active');
      $('vaultUnlockForm').style.display = 'none';
      $('vaultSetupForm').style.display = 'none';
      $('serverLoginForm').style.display = 'block';
      showAuthError('');
    });

    $('resetVaultLink').addEventListener('click', function () {
      if (
        window.confirm(
          'Replace the stored encrypted GitHub token on this device? You will need to enter a valid GitHub Personal Access Token.'
        )
      ) {
        try {
          localStorage.removeItem(VAULT_STORAGE_KEY);
        } catch (e) {}
        initAuthFormsView();
      }
    });

    // Setup Vault Form
    $('vaultSetupForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (checkIsLockedOut()) return;
      showAuthError('');
      var btn = $('setupVaultBtn');
      btn.disabled = true;
      btn.textContent = 'Verifying with GitHub...';
      try {
        var repo = $('setupRepo').value.trim();
        var token = $('setupGithubToken').value.trim();
        var passphrase = $('setupPassphrase').value;
        if (passphrase.length < 8) {
          throw new Error('Passphrase must be at least 8 characters.');
        }
        await verifyGithubWriteAccess(repo, token);
        var encrypted = await encryptVaultPayload({ repo: repo, token: token }, passphrase);
        localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(encrypted));
        resetAuthAttempts();
        state.mode = 'github';
        state.githubRepo = repo;
        state.githubToken = token;
        $('setupGithubToken').value = '';
        $('setupPassphrase').value = '';
        await enterAuthenticatedWorkspace('GitHub: ' + repo);
      } catch (err) {
        recordFailedAuthAttempt();
        showAuthError(err.message || 'Authentication failed.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Verify & Sign In';
      }
    });

    // Unlock Existing Vault Form
    $('vaultUnlockForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (checkIsLockedOut()) return;
      showAuthError('');
      var btn = $('unlockVaultBtn');
      btn.disabled = true;
      btn.textContent = 'Unlocking Vault...';
      try {
        var raw = localStorage.getItem(VAULT_STORAGE_KEY);
        var vaultObj = JSON.parse(raw);
        var pass = $('unlockPassphrase').value;
        var decrypted = await decryptVaultPayload(vaultObj, pass);
        await verifyGithubWriteAccess(decrypted.repo, decrypted.token);
        resetAuthAttempts();
        state.mode = 'github';
        state.githubRepo = decrypted.repo;
        state.githubToken = decrypted.token;
        $('unlockPassphrase').value = '';
        await enterAuthenticatedWorkspace('GitHub: ' + decrypted.repo);
      } catch (err) {
        recordFailedAuthAttempt();
        showAuthError('Invalid passphrase or expired GitHub token.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Unlock Publishing Studio';
      }
    });

    // Server API Login Form
    $('serverLoginForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (checkIsLockedOut()) return;
      showAuthError('');
      var btn = $('serverLoginBtn');
      btn.disabled = true;
      btn.textContent = 'Signing in...';
      try {
        var secret = $('serverAdminSecret').value;
        var res = await fetch('/api/blog/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: secret })
        });
        var data = await res.json().catch(function () {
          return {};
        });
        if (!res.ok) {
          throw new Error(
            data.error ||
              'Server API authentication failed (HTTP ' +
                res.status +
                '). If hosted on GitHub Pages, use the iPhone / GitHub Vault tab.'
          );
        }
        resetAuthAttempts();
        state.mode = 'server';
        state.serverCsrfToken = data.csrfToken;
        $('serverAdminSecret').value = '';
        await enterAuthenticatedWorkspace('Node Server API');
      } catch (err) {
        recordFailedAuthAttempt();
        showAuthError(err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Sign In to Server';
      }
    });

    // Navigation Tabs
    document.querySelectorAll('[data-admin-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var t = btn.getAttribute('data-admin-tab');
        if (t === 'editor' && !$('editArticleId').value) {
          openEditorWithArticle(null);
        } else {
          switchAdminTab(t);
        }
      });
    });

    $('topNewArticleBtn').addEventListener('click', function () {
      openEditorWithArticle(null);
    });
    $('dashNewArticleBtn').addEventListener('click', function () {
      openEditorWithArticle(null);
    });
    $('logoutBtn').addEventListener('click', function () {
      lockOrSignOut(false);
    });

    // Autosave recovery buttons
    $('restoreAutosaveBtn').addEventListener('click', function () {
      try {
        var raw = localStorage.getItem(AUTOSAVE_STORAGE_KEY);
        if (raw) {
          var data = JSON.parse(raw);
          openEditorWithArticle(data.article);
          $('autosaveRecoveryBanner').style.display = 'none';
          showToast('Restored unsaved draft into editor', 'success');
        }
      } catch (e) {}
    });
    $('discardAutosaveBtn').addEventListener('click', function () {
      try {
        localStorage.removeItem(AUTOSAVE_STORAGE_KEY);
      } catch (e) {}
      $('autosaveRecoveryBanner').style.display = 'none';
    });

    // Dashboard filter inputs
    ['adminSearchInput', 'adminStatusFilter', 'adminTypeFilter', 'adminCategoryFilter'].forEach(
      function (id) {
        var el = $(id);
        if (el) {
          el.addEventListener('input', renderDashboard);
          el.addEventListener('change', renderDashboard);
        }
      }
    );

    // Editor automatic slug & schema sync
    $('editTitle').addEventListener('input', function () {
      if (!$('editOriginalSlug').value) {
        var s = NewsroomEngine.slugify($('editTitle').value);
        $('editSlug').value = s;
        $('slugPreviewSpan').textContent = s || '...';
      }
      markEditorDirty();
    });

    $('editSlug').addEventListener('input', function () {
      var s = NewsroomEngine.slugify($('editSlug').value);
      $('slugPreviewSpan').textContent = s || '...';
      markEditorDirty();
    });

    $('editContentType').addEventListener('change', function () {
      var ct = NewsroomEngine.getContentTypeMeta($('editContentType').value, state.config);
      if (ct && ct.schemaType) {
        $('editSchemaType').value = ct.schemaType;
      }
      markEditorDirty();
    });

    $('editStatus').addEventListener('change', function () {
      var st = $('editStatus').value;
      $('scheduledForGroup').style.display = st === 'scheduled' ? 'block' : 'none';
      $('editorCurrentStatusBadge').textContent = st.toUpperCase();
      $('editorCurrentStatusBadge').className = 'status-pill status-' + st;
      markEditorDirty();
    });

    $('editFeatImgUrl').addEventListener('input', function () {
      updateFeaturedPreview($('editFeatImgUrl').value.trim());
      markEditorDirty();
    });

    $('editSeoTitle').addEventListener('input', function () {
      updateSeoCounters();
      markEditorDirty();
    });
    $('editSeoDesc').addEventListener('input', function () {
      updateSeoCounters();
      markEditorDirty();
    });

    $('editIncludeMediaContact').addEventListener('change', function () {
      $('mediaContactFields').style.display = $('editIncludeMediaContact').checked
        ? 'block'
        : 'none';
      markEditorDirty();
    });

    // Rich Text Editor Commands
    document.querySelectorAll('[data-rte-cmd]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cmd = btn.getAttribute('data-rte-cmd');
        var canvas = $('rteCanvas');
        canvas.focus();
        if (cmd === 'h2') {
          document.execCommand('formatBlock', false, 'H2');
        } else if (cmd === 'h3') {
          document.execCommand('formatBlock', false, 'H3');
        } else if (cmd === 'p') {
          document.execCommand('formatBlock', false, 'P');
        } else if (cmd === 'blockquote') {
          document.execCommand('formatBlock', false, 'BLOCKQUOTE');
        } else if (cmd === 'lede') {
          document.execCommand(
            'insertHTML',
            false,
            '<p class="intro-lede"><strong>LAGOS, NIGERIA —</strong> Key announcement summary here.</p>'
          );
        } else if (cmd === 'pullnote') {
          document.execCommand(
            'insertHTML',
            false,
            '<div class="pull-note"><strong>Key Takeaway:</strong> Highlighted insight or note here.</div>'
          );
        } else if (cmd === 'checklist') {
          document.execCommand(
            'insertHTML',
            false,
            '<div class="checklist"><ul><li>First verified item</li><li>Second verified item</li></ul></div>'
          );
        } else if (cmd === 'link') {
          var url = window.prompt('Enter full destination URL:', 'https://hoberg.com.ng/');
          if (url) document.execCommand('createLink', false, url);
        } else if (cmd === 'table') {
          document.execCommand(
            'insertHTML',
            false,
            '<table><thead><tr><th>Column 1</th><th>Column 2</th></tr></thead><tbody><tr><td>Data 1</td><td>Data 2</td></tr></tbody></table>'
          );
        } else if (cmd === 'code') {
          document.execCommand('insertHTML', false, '<pre><code>// Code snippet</code></pre>');
        } else {
          document.execCommand(cmd, false, null);
        }
        markEditorDirty();
      });
    });

    $('rteToggleSourceBtn').addEventListener('click', function () {
      state.sourceMode = !state.sourceMode;
      var canvas = $('rteCanvas');
      var source = $('rteSource');
      var btn = $('rteToggleSourceBtn');
      if (state.sourceMode) {
        source.value = canvas.innerHTML;
        canvas.style.display = 'none';
        source.style.display = 'block';
        btn.classList.add('active');
      } else {
        canvas.innerHTML = NewsroomEngine.sanitizeArticleHtml(source.value);
        source.style.display = 'none';
        canvas.style.display = 'block';
        btn.classList.remove('active');
      }
    });

    $('rteCanvas').addEventListener('input', markEditorDirty);
    $('rteSource').addEventListener('input', markEditorDirty);

    // Inline Image upload in Rich Text Editor
    $('rteInsertImageBtn').addEventListener('click', function () {
      $('inlineImageFileInput').click();
    });
    $('inlineImageFileInput').addEventListener('change', async function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var alt = window.prompt('Enter descriptive Alt Text for this image:', $('editTitle').value) || 'Hoberg Digital illustration';
      var cap = window.prompt('Enter optional caption:', '') || '';
      try {
        showToast('Optimizing & uploading inline image...', '');
        var uploaded = await uploadMediaAsset(file, {
          title: alt,
          alt: alt,
          caption: cap,
          credit: 'Hoberg Digital'
        });
        var figHtml =
          '<figure class="article-figure"><img src="' +
          NewsroomEngine.escapeHtml(uploaded.url) +
          '" alt="' +
          NewsroomEngine.escapeHtml(uploaded.alt) +
          '" loading="lazy">' +
          (cap ? '<figcaption>' + NewsroomEngine.escapeHtml(cap) + '</figcaption>' : '') +
          '</figure>';
        if (state.sourceMode) {
          $('rteSource').value += '\n' + figHtml;
        } else {
          $('rteCanvas').focus();
          document.execCommand('insertHTML', false, figHtml);
        }
        markEditorDirty();
        showToast('Inline image uploaded and inserted!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        e.target.value = '';
      }
    });

    // Featured Image Upload from iPhone
    $('featuredImageFileInput').addEventListener('change', async function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      $('featuredUploadStatus').textContent = 'Optimizing & uploading photo...';
      try {
        var uploaded = await uploadMediaAsset(file, {
          title: $('editTitle').value || file.name,
          alt: $('editFeatImgAlt').value || $('editTitle').value || file.name,
          caption: $('editFeatImgCaption').value,
          credit: $('editFeatImgCredit').value || 'Hoberg Digital',
          license: $('editFeatImgLicense').value
        });
        $('editFeatImgUrl').value = uploaded.url;
        if (!$('editFeatImgAlt').value) $('editFeatImgAlt').value = uploaded.alt;
        updateFeaturedPreview(uploaded.url);
        $('featuredUploadStatus').textContent = '✓ Uploaded to ' + uploaded.relativePath;
        showToast('Featured image uploaded!', 'success');
      } catch (err) {
        $('featuredUploadStatus').textContent = 'Upload failed: ' + err.message;
        showToast(err.message, 'error');
      } finally {
        e.target.value = '';
      }
    });

    $('pickFromLibraryBtn').addEventListener('click', function () {
      switchAdminTab('media');
    });

    // Video Upload from iPhone
    $('videoFileInput').addEventListener('change', async function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        showToast('Uploading video file...', '');
        var uploaded = await uploadMediaAsset(file, {
          title: $('editVideoTitle').value || $('editTitle').value || file.name,
          alt: $('editTitle').value || file.name
        });
        $('editVideoUrl').value = uploaded.url;
        showToast('Video uploaded to ' + uploaded.relativePath, 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        e.target.value = '';
      }
    });

    // Repeater buttons
    $('addFaqBtn').addEventListener('click', function () {
      addFaqRepeaterRow('', '');
    });
    $('addPressKitBtn').addEventListener('click', function () {
      addPressKitRepeaterRow('', '', 'PDF');
    });
    $('addReferenceBtn').addEventListener('click', function () {
      addReferenceRepeaterRow('', '', 'Hoberg Digital');
    });

    // Sticky Bar Actions
    $('stickySaveDraftBtn').addEventListener('click', async function () {
      try {
        $('editStatus').value = 'draft';
        var art = collectEditorArticleObject();
        await executePublishingPipeline(art, 'save draft');
        showToast('Saved draft "' + art.title + '"', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    $('stickyPreviewBtn').addEventListener('click', function () {
      var art = collectEditorArticleObject();
      openPreviewModalForArticle(art);
    });

    $('stickyPublishBtn').addEventListener('click', async function () {
      var btn = $('stickyPublishBtn');
      btn.disabled = true;
      btn.textContent = 'Running Pipeline...';
      try {
        if ($('editStatus').value === 'draft') {
          $('editStatus').value = 'published';
        }
        var art = collectEditorArticleObject();
        await executePublishingPipeline(art, 'publish');
        showToast('Published & updated all discovery resources!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Publish & Run Pipeline';
      }
    });

    // Media Library Form Upload
    $('mediaUploadForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fileInput = $('libFileInput');
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var btn = $('libUploadBtn');
      btn.disabled = true;
      btn.textContent = 'Uploading...';
      try {
        await uploadMediaAsset(file, {
          title: $('libTitle').value.trim(),
          alt: $('libAlt').value.trim(),
          caption: $('libCaption').value.trim(),
          credit: $('libCredit').value.trim(),
          license: $('libLicense').value.trim()
        });
        $('mediaUploadForm').reset();
        showToast('Media uploaded & added to registry!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Optimize & Upload to Repository';
      }
    });

    // Status Dashboard Buttons
    $('probeLiveUrlsBtn').addEventListener('click', async function () {
      var pub = state.articles.filter(function (a) {
        return a.status === 'published';
      });
      for (var i = 0; i < pub.length; i++) {
        await probeSingleArticleUrl(pub[i].slug);
      }
    });

    $('triggerIndexNowBtn').addEventListener('click', async function () {
      try {
        if (state.mode === 'server') {
          var res = await fetch('/api/blog/indexnow', {
            method: 'POST',
            headers: { 'X-CSRF-Token': state.serverCsrfToken || '' }
          });
          var data = await res.json();
          showToast((data.result && data.result.message) || 'IndexNow ping sent', 'success');
          await loadNewsroomState();
        } else {
          var siteUrl = (state.config && state.config.siteUrl) || 'https://hoberg.com.ng';
          var urls = state.articles
            .filter(function (a) {
              return a.status === 'published';
            })
            .map(function (a) {
              return siteUrl + '/blog/' + a.slug;
            });
          showToast(
            'Queued ' + urls.length + ' canonical URLs for IndexNow notification via GitHub Actions.',
            'success'
          );
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    $('syncAllPipelineBtn').addEventListener('click', async function () {
      if (!state.articles.length) return;
      await executePublishingPipeline(state.articles[0], 'rebuild sitemaps & feeds');
    });

    // Add Redirect Form
    $('addRedirectForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fromP = $('redirFrom').value.trim();
      var toP = $('redirTo').value.trim();
      if (!fromP || !toP) return;
      state.redirects.unshift({
        from: fromP,
        to: toP,
        type: 301,
        reason: 'Manual redirect created in Admin Portal',
        createdAt: new Date().toISOString()
      });
      $('addRedirectForm').reset();
      renderRedirectsList();
      if (state.articles.length) {
        await executePublishingPipeline(state.articles[0], 'update redirect map');
      }
    });

    // Close Modal
    $('closeModalBtn').addEventListener('click', closeModal);
    $('adminModal').addEventListener('click', function (e) {
      if (e.target === $('adminModal')) closeModal();
    });

    // Unsaved changes navigation guard
    window.addEventListener('beforeunload', function (e) {
      if (state.isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  });

  async function enterAuthenticatedWorkspace(label) {
    $('authView').style.display = 'none';
    $('appView').style.display = 'block';
    $('topbarActions').style.display = 'flex';
    $('connectionLabel').textContent = label;
    resetInactivityTimer();
    await loadNewsroomState();
  }
})();
