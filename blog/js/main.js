/* ===========================================================
   HOBERG DIGITAL NEWSROOM & BLOG — PUBLIC FRONTEND SCRIPT
   Mobile nav, search, content-type/category/tag filtering,
   sorting, pagination, FAQ accordion, TOC scroll-spy & sharing
   =========================================================== */

document.addEventListener('DOMContentLoaded', function () {
  /* ---------- 1. Mobile nav toggle ---------- */
  var navToggle = document.querySelector('.nav-toggle');
  var mainNav = document.querySelector('.main-nav');
  if (navToggle && mainNav) {
    navToggle.addEventListener('click', function () {
      var isOpen = mainNav.classList.toggle('open');
      navToggle.classList.toggle('open', isOpen);
      navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
    mainNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        mainNav.classList.remove('open');
        navToggle.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mainNav.classList.contains('open')) {
        mainNav.classList.remove('open');
        navToggle.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
        navToggle.focus();
      }
    });
  }

  /* ---------- 2. Newsroom Archive Search, Filtering, Sorting & Pagination ---------- */
  var archiveGrid = document.getElementById('archiveGrid');
  var searchInput = document.getElementById('blogSearch');
  var searchForm = document.getElementById('searchForm');
  var searchEmpty = document.getElementById('searchEmpty');
  var sortSelect = document.getElementById('sortSelect');
  var resetFiltersBtn = document.getElementById('resetFiltersBtn');
  var activeFilterBanner = document.getElementById('activeFilterBanner');
  var paginationBar = document.getElementById('paginationBar');

  if (archiveGrid) {
    var allArchiveCards = Array.prototype.slice.call(
      archiveGrid.querySelectorAll('[data-search-card]')
    );
    var PAGE_SIZE = 6;

    var state = {
      q: '',
      category: 'all',
      type: 'all',
      tag: 'all',
      sort: 'newest',
      page: 1
    };

    // Hydrate initial filter state from URL query params
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get('q')) state.q = params.get('q');
      if (params.get('category')) state.category = params.get('category');
      if (params.get('type')) state.type = params.get('type');
      if (params.get('tag')) state.tag = params.get('tag');
      if (params.get('sort')) state.sort = params.get('sort');
      if (params.get('page')) state.page = Math.max(1, parseInt(params.get('page'), 10) || 1);
    } catch (e) {
      // ignore URLSearchParams errors on older browsers
    }

    if (searchInput && state.q) {
      searchInput.value = state.q;
    }
    if (sortSelect && state.sort) {
      sortSelect.value = state.sort;
    }

    function syncUrlParams() {
      try {
        var params = new URLSearchParams();
        if (state.q) params.set('q', state.q);
        if (state.category !== 'all') params.set('category', state.category);
        if (state.type !== 'all') params.set('type', state.type);
        if (state.tag !== 'all') params.set('tag', state.tag);
        if (state.sort !== 'newest') params.set('sort', state.sort);
        if (state.page > 1) params.set('page', String(state.page));
        var qs = params.toString();
        var nextUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
        window.history.replaceState(null, '', nextUrl);
      } catch (e) {
        // ignore
      }
    }

    function renderArchive() {
      var term = state.q.trim().toLowerCase();

      // Update active states on pills & category cards
      document.querySelectorAll('[data-type-filter]').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-type-filter') === state.type);
      });
      document.querySelectorAll('[data-category-filter]').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-category-filter') === state.category);
      });
      document.querySelectorAll('[data-tag-filter]').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-tag-filter') === state.tag);
      });

      // Filter cards
      var matched = allArchiveCards.filter(function (card) {
        if (state.category !== 'all' && card.getAttribute('data-category') !== state.category) {
          return false;
        }
        if (state.type !== 'all' && card.getAttribute('data-content-type') !== state.type) {
          return false;
        }
        if (state.tag !== 'all') {
          var tags = (card.getAttribute('data-tags') || '').split('|');
          if (tags.indexOf(state.tag) === -1) return false;
        }
        if (term !== '') {
          var haystack = (
            (card.getAttribute('data-title') || '') +
            ' ' +
            (card.getAttribute('data-keywords') || '')
          ).toLowerCase();
          if (haystack.indexOf(term) === -1) return false;
        }
        return true;
      });

      // Sort matched cards
      matched.sort(function (a, b) {
        if (state.sort === 'oldest') {
          return new Date(a.getAttribute('data-date')) - new Date(b.getAttribute('data-date'));
        }
        if (state.sort === 'updated') {
          return (
            new Date(b.getAttribute('data-updated')) - new Date(a.getAttribute('data-updated'))
          );
        }
        return new Date(b.getAttribute('data-date')) - new Date(a.getAttribute('data-date'));
      });

      // Re-append sorted cards in DOM
      matched.forEach(function (card) {
        archiveGrid.appendChild(card);
      });

      var totalMatches = matched.length;
      var totalPages = Math.max(1, Math.ceil(totalMatches / PAGE_SIZE));
      if (state.page > totalPages) state.page = totalPages;

      var startIdx = (state.page - 1) * PAGE_SIZE;
      var endIdx = startIdx + PAGE_SIZE;

      allArchiveCards.forEach(function (card) {
        card.style.display = 'none';
      });
      matched.slice(startIdx, endIdx).forEach(function (card) {
        card.style.display = '';
      });

      if (searchEmpty) {
        searchEmpty.style.display = totalMatches === 0 ? 'block' : 'none';
      }

      var hasActiveFilter =
        term !== '' ||
        state.category !== 'all' ||
        state.type !== 'all' ||
        state.tag !== 'all' ||
        state.sort !== 'newest';

      if (resetFiltersBtn) {
        resetFiltersBtn.style.display = hasActiveFilter ? 'inline-flex' : 'none';
      }

      if (activeFilterBanner) {
        if (hasActiveFilter) {
          var parts = [];
          if (term) parts.push('search "' + state.q + '"');
          if (state.category !== 'all') parts.push('category "' + state.category + '"');
          if (state.type !== 'all') parts.push('type "' + state.type + '"');
          if (state.tag !== 'all') parts.push('tag "#' + state.tag + '"');
          activeFilterBanner.style.display = 'flex';
          activeFilterBanner.innerHTML =
            '<span>Showing <strong>' +
            totalMatches +
            '</strong> of ' +
            allArchiveCards.length +
            ' releases' +
            (parts.length ? ' matching ' + parts.join(', ') : '') +
            '</span>';
        } else {
          activeFilterBanner.style.display = 'none';
        }
      }

      // Render pagination controls
      if (paginationBar) {
        if (totalPages <= 1) {
          paginationBar.innerHTML = '';
        } else {
          var html = '';
          html +=
            '<button type="button" class="page-btn" data-page="' +
            (state.page - 1) +
            '" ' +
            (state.page <= 1 ? 'disabled' : '') +
            ' aria-label="Previous page">← Prev</button>';
          for (var p = 1; p <= totalPages; p++) {
            html +=
              '<button type="button" class="page-btn ' +
              (p === state.page ? 'active' : '') +
              '" data-page="' +
              p +
              '" aria-label="Page ' +
              p +
              '" ' +
              (p === state.page ? 'aria-current="page"' : '') +
              '>' +
              p +
              '</button>';
          }
          html +=
            '<button type="button" class="page-btn" data-page="' +
            (state.page + 1) +
            '" ' +
            (state.page >= totalPages ? 'disabled' : '') +
            ' aria-label="Next page">Next →</button>';
          paginationBar.innerHTML = html;

          paginationBar.querySelectorAll('[data-page]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var nextP = parseInt(btn.getAttribute('data-page'), 10);
              if (nextP >= 1 && nextP <= totalPages && nextP !== state.page) {
                state.page = nextP;
                renderArchive();
                var latestSec = document.getElementById('latest');
                if (latestSec) latestSec.scrollIntoView({ behavior: 'smooth' });
              }
            });
          });
        }
      }

      syncUrlParams();
    }

    if (searchForm) {
      searchForm.addEventListener('submit', function (e) {
        e.preventDefault();
        state.q = searchInput ? searchInput.value : '';
        state.page = 1;
        renderArchive();
        var targetSection = document.getElementById('latest');
        if (targetSection) targetSection.scrollIntoView({ behavior: 'smooth' });
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        state.q = searchInput.value;
        state.page = 1;
        renderArchive();
      });
    }

    if (sortSelect) {
      sortSelect.addEventListener('change', function () {
        state.sort = sortSelect.value;
        state.page = 1;
        renderArchive();
      });
    }

    document.querySelectorAll('[data-type-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.type = btn.getAttribute('data-type-filter') || 'all';
        state.page = 1;
        renderArchive();
      });
    });

    document.querySelectorAll('[data-category-filter]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var clickedCat = chip.getAttribute('data-category-filter') || 'all';
        state.category = state.category === clickedCat ? 'all' : clickedCat;
        state.page = 1;
        renderArchive();
        var targetSection = document.getElementById('latest');
        if (targetSection) targetSection.scrollIntoView({ behavior: 'smooth' });
      });
    });

    document.querySelectorAll('[data-tag-filter]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var clickedTag = chip.getAttribute('data-tag-filter') || 'all';
        state.tag = state.tag === clickedTag ? 'all' : clickedTag;
        state.page = 1;
        renderArchive();
      });
    });

    if (resetFiltersBtn) {
      resetFiltersBtn.addEventListener('click', function () {
        state.q = '';
        state.category = 'all';
        state.type = 'all';
        state.tag = 'all';
        state.sort = 'newest';
        state.page = 1;
        if (searchInput) searchInput.value = '';
        if (sortSelect) sortSelect.value = 'newest';
        renderArchive();
      });
    }

    renderArchive();
  }

  /* ---------- 3. Share Toolbar (Native iOS Share & Copy Link) ---------- */
  document.querySelectorAll('[data-share-native]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var url = btn.getAttribute('data-url') || window.location.href;
      var title = btn.getAttribute('data-title') || document.title;
      if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(function () {});
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          var orig = btn.textContent;
          btn.textContent = 'Link Copied!';
          setTimeout(function () {
            btn.textContent = orig;
          }, 2000);
        });
      }
    });
  });

  document.querySelectorAll('[data-copy-url]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var url = btn.getAttribute('data-copy-url') || window.location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          var orig = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(function () {
            btn.textContent = orig;
          }, 2000);
        });
      }
    });
  });

  /* ---------- 4. FAQ Accordion ---------- */
  document.querySelectorAll('.faq-item').forEach(function (item) {
    var question = item.querySelector('.faq-question');
    var answer = item.querySelector('.faq-answer');
    if (!question || !answer) return;
    question.setAttribute('aria-expanded', 'false');
    question.addEventListener('click', function () {
      var isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach(function (openItem) {
        if (openItem !== item) {
          openItem.classList.remove('open');
          var oa = openItem.querySelector('.faq-answer');
          var oq = openItem.querySelector('.faq-question');
          if (oa) oa.style.maxHeight = null;
          if (oq) oq.setAttribute('aria-expanded', 'false');
        }
      });
      if (isOpen) {
        item.classList.remove('open');
        answer.style.maxHeight = null;
        question.setAttribute('aria-expanded', 'false');
      } else {
        item.classList.add('open');
        answer.style.maxHeight = answer.scrollHeight + 'px';
        question.setAttribute('aria-expanded', 'true');
      }
    });
  });

  /* ---------- 5. Highlight active TOC link on scroll ---------- */
  var tocLinks = document.querySelectorAll('.toc-box ol a');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var headings = Array.prototype.map
      .call(tocLinks, function (link) {
        var href = link.getAttribute('href');
        if (!href || href.charAt(0) !== '#') return null;
        return document.getElementById(href.slice(1));
      })
      .filter(Boolean);

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            tocLinks.forEach(function (l) {
              l.style.color = '';
              l.style.fontWeight = '';
            });
            var activeLink = document.querySelector('.toc-box ol a[href="#' + entry.target.id + '"]');
            if (activeLink) {
              activeLink.style.color = '#C8102E';
              activeLink.style.fontWeight = '700';
            }
          }
        });
      },
      { rootMargin: '-100px 0px -70% 0px' }
    );

    headings.forEach(function (h) {
      observer.observe(h);
    });
  }
});
