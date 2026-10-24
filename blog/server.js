#!/usr/bin/env node
/**
 * HOBERG DIGITAL NEWSROOM — PRODUCTION SERVER & API BACKEND
 * =========================================================
 * Zero-dependency Node.js HTTP server for https://hoberg.com.ng
 * Serves static site + /blog newsroom + protected /api/blog/* endpoints.
 *
 * Security Architecture:
 * - No hardcoded or default admin credentials. Requires HOBERG_ADMIN_SECRET
 *   or HOBERG_ADMIN_PASSWORD_HASH (format: "<hex-salt>:<hex-scrypt-64>") in env.
 * - Constant-time secret verification via crypto.scryptSync + crypto.timingSafeEqual.
 * - IP-based rate limiting (max 5 failed attempts per 15-minute window).
 * - HMAC-SHA256 signed HttpOnly, SameSite=Strict session cookies + CSRF header verification.
 * - Binary magic-byte inspection on file uploads (JPEG, PNG, WebP, GIF, MP4, WebM, PDF).
 * - Automatic execution of the 12-step Hoberg Newsroom Publishing Pipeline on every write.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { runBuildPipeline } = require('./scripts/build-newsroom.js');
const NewsroomEngine = require('./js/newsroom-engine.js');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'blog', 'data');
const UPLOADS_DIR = path.join(ROOT_DIR, 'blog', 'uploads');

// Session & Rate-Limit Store
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FAILED_ATTEMPTS = 5;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

function readRequestBody(req, maxBytes = 35 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Payload exceeds maximum allowed size'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    ...extraHeaders
  });
  res.end(body);
}

/**
 * Inspects binary magic bytes to prevent disguised executable or script uploads
 */
function verifyMagicBytes(buffer, ext) {
  if (!buffer || buffer.length < 4) return false;
  const e = ext.toLowerCase().replace(/^\./, '');
  if (e === 'jpg' || e === 'jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (e === 'png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }
  if (e === 'gif') {
    return (
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38
    );
  }
  if (e === 'webp') {
    return (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    );
  }
  if (e === 'pdf') {
    return buffer.toString('ascii', 0, 4) === '%PDF';
  }
  if (e === 'mp4') {
    return buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp';
  }
  if (e === 'webm') {
    return (
      buffer[0] === 0x1a &&
      buffer[1] === 0x45 &&
      buffer[2] === 0xdf &&
      buffer[3] === 0xa3
    );
  }
  return false;
}

/**
 * Verify admin secret against HOBERG_ADMIN_SECRET or HOBERG_ADMIN_PASSWORD_HASH
 */
function verifyAdminPassword(candidateSecret, envConfig) {
  if (!candidateSecret || typeof candidateSecret !== 'string') return false;
  const plainEnv = envConfig.adminSecret || process.env.HOBERG_ADMIN_SECRET || '';
  const hashEnv = envConfig.adminPasswordHash || process.env.HOBERG_ADMIN_PASSWORD_HASH || '';

  if (hashEnv && hashEnv.includes(':')) {
    const [saltHex, keyHex] = hashEnv.split(':');
    const derived = crypto.scryptSync(candidateSecret, Buffer.from(saltHex, 'hex'), 64);
    const expected = Buffer.from(keyHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  }

  if (plainEnv && plainEnv.length >= 8) {
    const salt = crypto.createHash('sha256').update('hoberg-newsroom-salt').digest();
    const derivedCandidate = crypto.scryptSync(candidateSecret, salt, 64);
    const derivedExpected = crypto.scryptSync(plainEnv, salt, 64);
    return crypto.timingSafeEqual(derivedCandidate, derivedExpected);
  }

  return false;
}

function createNewsroomServer(options = {}) {
  const sessions = new Map();
  const rateLimits = new Map();
  const sessionHmacSecret =
    options.sessionSecret ||
    process.env.HOBERG_SESSION_SECRET ||
    crypto.randomBytes(32).toString('hex');

  function getClientIp(req) {
    return (
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1'
    );
  }

  function isIpRateLimited(ip) {
    const rec = rateLimits.get(ip);
    if (!rec) return false;
    if (Date.now() > rec.resetAt) {
      rateLimits.delete(ip);
      return false;
    }
    return rec.count >= MAX_FAILED_ATTEMPTS;
  }

  function recordFailedAttempt(ip) {
    const now = Date.now();
    const rec = rateLimits.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    if (now > rec.resetAt) {
      rec.count = 1;
      rec.resetAt = now + RATE_LIMIT_WINDOW_MS;
    } else {
      rec.count += 1;
    }
    rateLimits.set(ip, rec);
  }

  function clearFailedAttempts(ip) {
    rateLimits.delete(ip);
  }

  function createSession() {
    const sessionId = crypto.randomBytes(24).toString('hex');
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const sig = crypto
      .createHmac('sha256', sessionHmacSecret)
      .update(sessionId)
      .digest('hex');
    const signedToken = `${sessionId}.${sig}`;
    sessions.set(sessionId, {
      csrfToken,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS
    });
    return { signedToken, csrfToken };
  }

  function getValidSession(req) {
    const cookies = parseCookies(req.headers.cookie);
    const raw = cookies.hoberg_admin_session;
    if (!raw || !raw.includes('.')) return null;
    const [sessionId, sig] = raw.split('.');
    const expectedSig = crypto
      .createHmac('sha256', sessionHmacSecret)
      .update(sessionId)
      .digest('hex');
    const sigBuf = Buffer.from(sig || '', 'utf8');
    const expBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const sess = sessions.get(sessionId);
    if (!sess) return null;
    if (Date.now() > sess.expiresAt) {
      sessions.delete(sessionId);
      return null;
    }
    return { sessionId, ...sess };
  }

  function requireAuth(req, res, requireCsrf = true) {
    const sess = getValidSession(req);
    if (!sess) {
      sendJson(res, 401, { error: 'Unauthorized: Valid administrator session required.' });
      return null;
    }
    if (requireCsrf) {
      const headerCsrf = req.headers['x-csrf-token'];
      if (!headerCsrf || headerCsrf !== sess.csrfToken) {
        sendJson(res, 403, { error: 'Forbidden: Invalid or missing CSRF token.' });
        return null;
      }
    }
    return sess;
  }

  function loadFullState() {
    return {
      config: readJsonSafe(path.join(DATA_DIR, 'config.json'), {}),
      authors: readJsonSafe(path.join(DATA_DIR, 'authors.json'), []),
      categories: readJsonSafe(path.join(DATA_DIR, 'categories.json'), []),
      articles: readJsonSafe(path.join(DATA_DIR, 'articles.json'), []),
      media: readJsonSafe(path.join(DATA_DIR, 'media.json'), []),
      redirects: readJsonSafe(path.join(DATA_DIR, 'redirects.json'), []),
      revisions: readJsonSafe(path.join(DATA_DIR, 'revisions.json'), []),
      statusLog: readJsonSafe(path.join(DATA_DIR, 'status-log.json'), { articles: {} })
    };
  }

  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = decodeURIComponent(parsedUrl.pathname);

      // =====================================================
      // 1. API ENDPOINTS (/api/blog/*)
      // =====================================================
      if (pathname === '/api/blog/auth/session' && req.method === 'GET') {
        const sess = getValidSession(req);
        if (!sess) {
          return sendJson(res, 200, { authenticated: false });
        }
        return sendJson(res, 200, { authenticated: true, csrfToken: sess.csrfToken });
      }

      if (pathname === '/api/blog/auth/login' && req.method === 'POST') {
        const ip = getClientIp(req);
        if (isIpRateLimited(ip)) {
          return sendJson(res, 429, {
            error: 'Too many failed authentication attempts. Locked out for 15 minutes.'
          });
        }
        const configuredSecret =
          options.adminSecret ||
          process.env.HOBERG_ADMIN_SECRET ||
          options.adminPasswordHash ||
          process.env.HOBERG_ADMIN_PASSWORD_HASH;
        if (!configuredSecret) {
          return sendJson(res, 503, {
            error:
              'Server admin secret is not configured. Set HOBERG_ADMIN_SECRET in environment variables.'
          });
        }

        const rawBody = await readRequestBody(req, 16 * 1024);
        const body = JSON.parse(rawBody || '{}');
        if (!verifyAdminPassword(body.secret, options)) {
          recordFailedAttempt(ip);
          return sendJson(res, 401, { error: 'Invalid administrator credentials.' });
        }

        clearFailedAttempts(ip);
        const { signedToken, csrfToken } = createSession();
        return sendJson(
          res,
          200,
          { ok: true, authenticated: true, csrfToken },
          {
            'Set-Cookie': `hoberg_admin_session=${encodeURIComponent(
              signedToken
            )}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
          }
        );
      }

      if (pathname === '/api/blog/auth/logout' && req.method === 'POST') {
        const sess = getValidSession(req);
        if (sess) sessions.delete(sess.sessionId);
        return sendJson(
          res,
          200,
          { ok: true },
          {
            'Set-Cookie':
              'hoberg_admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'
          }
        );
      }

      if (pathname === '/api/blog/state' && req.method === 'GET') {
        if (!requireAuth(req, res, false)) return;
        return sendJson(res, 200, loadFullState());
      }

      if (pathname === '/api/blog/publish' && req.method === 'POST') {
        if (!requireAuth(req, res, true)) return;
        const rawBody = await readRequestBody(req, 10 * 1024 * 1024);
        const body = JSON.parse(rawBody || '{}');
        const incoming = body.article;
        if (!incoming || !incoming.slug || !incoming.title) {
          return sendJson(res, 400, { error: 'Article title and slug are required.' });
        }

        incoming.slug = NewsroomEngine.slugify(incoming.slug);
        incoming.bodyHtml = NewsroomEngine.sanitizeArticleHtml(incoming.bodyHtml || '');
        incoming.dateModified = new Date().toISOString();

        const currentState = loadFullState();
        const articles = currentState.articles;
        const existingIdx = articles.findIndex((a) => a.id === incoming.id);
        let previousSlug = null;

        if (existingIdx >= 0) {
          previousSlug = articles[existingIdx].slug;
          // If unpublished or slug changed, remove old static directory if it exists
          if (
            (previousSlug && previousSlug !== incoming.slug) ||
            incoming.status !== 'published'
          ) {
            const oldDir = path.join(ROOT_DIR, 'blog', previousSlug);
            if (
              previousSlug &&
              previousSlug !== 'admin' &&
              previousSlug !== 'assets' &&
              previousSlug !== 'css' &&
              previousSlug !== 'js' &&
              previousSlug !== 'data' &&
              previousSlug !== 'scripts' &&
              previousSlug !== 'uploads' &&
              fs.existsSync(oldDir)
            ) {
              fs.rmSync(oldDir, { recursive: true, force: true });
            }
          }
          articles[existingIdx] = incoming;
        } else {
          articles.unshift(incoming);
        }

        writeJsonSafe(path.join(DATA_DIR, 'articles.json'), articles);

        if (Array.isArray(body.redirects)) {
          writeJsonSafe(path.join(DATA_DIR, 'redirects.json'), body.redirects);
        }

        // Record revision entry
        const revisions = currentState.revisions;
        revisions.unshift({
          revisionId: 'rev-' + Date.now(),
          articleId: incoming.id,
          slug: incoming.slug,
          status: incoming.status,
          operation: body.operationLabel || 'publish',
          timestamp: new Date().toISOString(),
          authorId: incoming.authorId || 'goodluck-iyanu',
          summary: `${body.operationLabel || 'Updated'} "${incoming.title}"`
        });
        writeJsonSafe(path.join(DATA_DIR, 'revisions.json'), revisions.slice(0, 200));

        // Execute automated 12-step build pipeline
        const pipelineReport = await runBuildPipeline({
          notifyIndexNow: Boolean(options.notifyIndexNowOnPublish)
        });

        const updatedState = loadFullState();
        return sendJson(res, 200, {
          ok: true,
          articles: updatedState.articles,
          redirects: updatedState.redirects,
          statusLog: updatedState.statusLog,
          indexNow: pipelineReport.indexNowResult
        });
      }

      if (pathname.startsWith('/api/blog/articles/') && req.method === 'DELETE') {
        if (!requireAuth(req, res, true)) return;
        const articleId = pathname.slice('/api/blog/articles/'.length);
        const currentState = loadFullState();
        const target = currentState.articles.find((a) => a.id === articleId);
        if (!target) {
          return sendJson(res, 404, { error: 'Article not found.' });
        }

        const remaining = currentState.articles.filter((a) => a.id !== articleId);
        writeJsonSafe(path.join(DATA_DIR, 'articles.json'), remaining);

        // Remove static directory for deleted article
        const slugDir = path.join(ROOT_DIR, 'blog', target.slug);
        if (
          target.slug &&
          !['admin', 'assets', 'css', 'js', 'data', 'scripts', 'uploads', 'articles'].includes(
            target.slug
          ) &&
          fs.existsSync(slugDir)
        ) {
          fs.rmSync(slugDir, { recursive: true, force: true });
        }

        await runBuildPipeline({ notifyIndexNow: false });
        const updatedState = loadFullState();
        return sendJson(res, 200, {
          ok: true,
          articles: updatedState.articles,
          statusLog: updatedState.statusLog
        });
      }

      if (pathname === '/api/blog/upload' && req.method === 'POST') {
        if (!requireAuth(req, res, true)) return;
        const rawBody = await readRequestBody(req, 35 * 1024 * 1024);
        const body = JSON.parse(rawBody || '{}');
        const safeName = path
          .basename(String(body.fileName || ''))
          .replace(/[^a-zA-Z0-9._-]/g, '-');
        const ext = path.extname(safeName).toLowerCase();
        const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.pdf'];
        if (!safeName || !allowedExts.includes(ext)) {
          return sendJson(res, 400, {
            error: 'Unsupported file extension. Allowed: JPG, PNG, WebP, GIF, MP4, WebM, PDF.'
          });
        }

        const fileBuffer = Buffer.from(String(body.base64 || ''), 'base64');
        if (!verifyMagicBytes(fileBuffer, ext)) {
          return sendJson(res, 400, {
            error: 'File binary signature does not match declared file type.'
          });
        }

        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        fs.writeFileSync(path.join(UPLOADS_DIR, safeName), fileBuffer);

        const media = readJsonSafe(path.join(DATA_DIR, 'media.json'), []);
        const newAsset = body.asset || {
          id: 'media-' + Date.now(),
          type: ['.mp4', '.webm'].includes(ext) ? 'video' : 'image',
          title: safeName,
          url: `https://hoberg.com.ng/blog/uploads/${safeName}`,
          relativePath: `/blog/uploads/${safeName}`,
          alt: safeName,
          uploadedAt: new Date().toISOString()
        };
        media.unshift(newAsset);
        writeJsonSafe(path.join(DATA_DIR, 'media.json'), media);

        return sendJson(res, 200, { ok: true, asset: newAsset, media });
      }

      if (pathname === '/api/blog/indexnow' && req.method === 'POST') {
        if (!requireAuth(req, res, true)) return;
        const report = await runBuildPipeline({ notifyIndexNow: true });
        return sendJson(res, 200, {
          ok: true,
          result: report.indexNowResult,
          statusLog: report.statusLog
        });
      }

      // =====================================================
      // 2. REDIRECT LOOKUP (301 Permanent Redirects)
      // =====================================================
      const redirects = readJsonSafe(path.join(DATA_DIR, 'redirects.json'), []);
      const cleanPath = pathname.replace(/\/+$/, '') || '/';
      const matchedRedirect = redirects.find((r) => {
        const fromNorm = String(r.from || '').replace(/\/+$/, '') || '/';
        return fromNorm === cleanPath && fromNorm !== String(r.to || '').replace(/\/+$/, '');
      });
      if (
        matchedRedirect &&
        !pathname.startsWith('/blog/articles/') // Legacy HTML files are served directly with canonical link
      ) {
        res.writeHead(matchedRedirect.type || 301, {
          Location: matchedRedirect.to,
          'Cache-Control': 'no-cache'
        });
        res.end();
        return;
      }

      // =====================================================
      // 3. STATIC FILE RESOLUTION
      // =====================================================
      const relPath = pathname.replace(/^\/+/, '');
      let candidatePath = path.resolve(ROOT_DIR, relPath);

      // Prevent directory traversal outside ROOT_DIR
      if (!candidatePath.startsWith(ROOT_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('403 Forbidden');
        return;
      }

      if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
        candidatePath = path.join(candidatePath, 'index.html');
      } else if (!fs.existsSync(candidatePath) && !path.extname(candidatePath)) {
        const htmlVariant = candidatePath + '.html';
        const indexVariant = path.join(candidatePath, 'index.html');
        if (fs.existsSync(indexVariant)) {
          candidatePath = indexVariant;
        } else if (fs.existsSync(htmlVariant)) {
          candidatePath = htmlVariant;
        }
      }

      if (!fs.existsSync(candidatePath) || !fs.statSync(candidatePath).isFile()) {
        const notFoundFile = pathname.startsWith('/blog')
          ? path.join(ROOT_DIR, 'blog', '404.html')
          : path.join(ROOT_DIR, '404.html');
        res.writeHead(404, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Content-Type-Options': 'nosniff'
        });
        res.end(
          fs.existsSync(notFoundFile)
            ? fs.readFileSync(notFoundFile)
            : '<h1>404 Not Found</h1>'
        );
        return;
      }

      const ext = path.extname(candidatePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const headers = {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff'
      };
      if (pathname.startsWith('/blog/admin')) {
        headers['X-Robots-Tag'] = 'noindex, nofollow, noarchive';
        headers['Cache-Control'] = 'no-store';
      }

      res.writeHead(200, headers);
      res.end(fs.readFileSync(candidatePath));
    } catch (err) {
      sendJson(res, 500, { error: err.message || 'Internal Server Error' });
    }
  });

  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const srv = createNewsroomServer();
  srv.listen(port, () => {
    console.log(`Hoberg Digital Newsroom Server listening on http://localhost:${port}`);
    console.log(`- Newsroom Public Archive: http://localhost:${port}/blog`);
    console.log(`- Private Mobile Admin:    http://localhost:${port}/blog/admin`);
  });
}

module.exports = { createNewsroomServer, verifyAdminPassword, verifyMagicBytes };

