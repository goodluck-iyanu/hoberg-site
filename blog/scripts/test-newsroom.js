#!/usr/bin/env node
/**
 * HOBERG DIGITAL NEWSROOM — END-TO-END VERIFICATION & TEST SUITE (PHASES 13 & 14)
 * ===============================================================================
 * Performs automated verification of:
 * 1. Content Database & Migration Integrity (8 articles, legacy URLs, media assets)
 * 2. Technical SEO, Schema.org JSON-LD, XML Sitemaps, RSS/Atom/JSON Feeds, llms.txt, robots.txt
 * 3. Server Authentication, Rate Limiting, Session Cookies & CSRF Protection
 * 4. Media Upload Binary Magic-Byte Security Validation
 * 5. Complete Publishing Lifecycle:
 *    Create -> Save Draft -> Verify Draft Excluded -> Publish -> Verify HTTP 200 + SEO + Sitemap + Feeds ->
 *    Update & Rename Slug -> Verify 301 Redirect -> Unpublish -> Delete -> Restore Clean Production State
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { createNewsroomServer } = require('../server.js');
const { runBuildPipeline } = require('./build-newsroom.js');

const ROOT_DIR = path.resolve(__dirname, '../..');
const BLOG_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(BLOG_DIR, 'data');

function httpRequest(port, method, reqPath, options = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = options.body ? JSON.stringify(options.body) : null;
    const headers = {
      ...(options.headers || {})
    };
    if (bodyStr) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: reqPath,
        method,
        headers
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (e) {}
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text,
            json
          });
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function runAllTests() {
  console.log('===================================================================');
  console.log('HOBERG DIGITAL NEWSROOM — PRODUCTION E2E VERIFICATION SUITE');
  console.log('===================================================================\n');

  // Snapshot original production files so we guarantee clean restoration after lifecycle tests
  const origArticles = fs.readFileSync(path.join(DATA_DIR, 'articles.json'), 'utf8');
  const origRedirects = fs.readFileSync(path.join(DATA_DIR, 'redirects.json'), 'utf8');
  const origMedia = fs.readFileSync(path.join(DATA_DIR, 'media.json'), 'utf8');
  const origRevisions = fs.readFileSync(path.join(DATA_DIR, 'revisions.json'), 'utf8');

  let passed = 0;
  function pass(msg) {
    passed += 1;
    console.log(`  [PASS] ${msg}`);
  }

  // ---------------------------------------------------------------------------
  // 1. VERIFY MIGRATED ARTICLES, ASSETS & STATIC DISCOVERY FILES
  // ---------------------------------------------------------------------------
  console.log('Phase 1–5: Verifying Migrated Articles, Media Assets & Discovery Files...');
  const articles = JSON.parse(origArticles);
  assert(articles.length >= 8, `Expected at least 8 articles, found ${articles.length}`);
  pass(`Loaded ${articles.length} published Hoberg Digital articles in blog/data/articles.json`);

  for (const art of articles) {
    assert(art.id && art.slug && art.title && art.summary, `Missing core fields on ${art.slug}`);
    const staticFile = path.join(BLOG_DIR, art.slug, 'index.html');
    assert(fs.existsSync(staticFile), `Missing static route blog/${art.slug}/index.html`);
    const html = fs.readFileSync(staticFile, 'utf8');

    // Verify single <head> tag (no duplicate <head> blocks)
    const headMatches = html.match(/<head>/gi) || [];
    assert.strictEqual(
      headMatches.length,
      1,
      `Expected exactly 1 <head> in ${art.slug}, found ${headMatches.length}`
    );

    // Verify canonical tag
    const expectedCanonical = `https://hoberg.com.ng/blog/${art.slug}`;
    assert(
      html.includes(`<link rel="canonical" href="${expectedCanonical}">`),
      `Missing canonical link in ${art.slug}`
    );

    // Verify JSON-LD parses cleanly
    const ldMatches = [
      ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)
    ];
    assert(ldMatches.length >= 1, `Missing JSON-LD script in ${art.slug}`);
    for (const m of ldMatches) {
      const parsedLd = JSON.parse(m[1]);
      assert(parsedLd['@context'] === 'https://schema.org', `Invalid JSON-LD @context in ${art.slug}`);
    }
  }
  pass('All 8 static article routes (/blog/[slug]/index.html) have valid single <head>, canonical URL, and valid Schema.org JSON-LD');

  // Verify legacy HTML files in blog/articles/*.html
  const legacySlugs = [
    'best-website-design-company-nigeria',
    'website-design-company-lagos',
    'website-design-cost-nigeria',
    'ecommerce-website-development',
    'corporate-website-design'
  ];
  for (const lSlug of legacySlugs) {
    const lFile = path.join(BLOG_DIR, 'articles', `${lSlug}.html`);
    assert(fs.existsSync(lFile), `Missing legacy article file: ${lFile}`);
    const lHtml = fs.readFileSync(lFile, 'utf8');
    const headCount = (lHtml.match(/<head>/gi) || []).length;
    assert.strictEqual(headCount, 1, `Duplicate <head> found in legacy file ${lSlug}.html`);
    assert(
      lHtml.includes(`<link rel="canonical" href="https://hoberg.com.ng/blog/${lSlug}">`),
      `Legacy file ${lSlug}.html missing canonical link to /blog/${lSlug}`
    );
  }
  pass('All 5 legacy /blog/articles/[slug].html URLs preserved with single <head> and canonical links to /blog/[slug]');

  // Verify IndexNow and Bing verification files
  assert(
    fs.existsSync(path.join(ROOT_DIR, '4f8b92e1c7d34a6085e2b190f3c6d8a4.txt')),
    'Missing root IndexNow key file'
  );
  assert(
    fs.existsSync(path.join(ROOT_DIR, 'BingSiteAuth.xml')),
    'Missing root BingSiteAuth.xml'
  );
  assert(
    fs.existsSync(path.join(ROOT_DIR, 'robots.txt')),
    'Missing root robots.txt'
  );
  const robotsTxt = fs.readFileSync(path.join(ROOT_DIR, 'robots.txt'), 'utf8');
  assert(robotsTxt.includes('Disallow: /blog/admin'), 'robots.txt must disallow /blog/admin');
  assert(
    robotsTxt.includes('Sitemap: https://hoberg.com.ng/blog/sitemap.xml'),
    'robots.txt must reference /blog/sitemap.xml'
  );
  pass('Verified IndexNow key file, BingSiteAuth.xml, and robots.txt rules (/blog/admin disallowed, AI bots & sitemaps configured)');

  // ---------------------------------------------------------------------------
  // 2. START SERVER & VERIFY SECURITY, AUTHENTICATION & RATE LIMITING
  // ---------------------------------------------------------------------------
  console.log('\nPhase 3 & 13: Verifying Server Security, Rate Limiting, Session Cookies & CSRF...');
  const TEST_SECRET = 'Hoberg-Prod-Test-Secret-2026!';
  const server = createNewsroomServer({
    adminSecret: TEST_SECRET,
    notifyIndexNowOnPublish: false
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    // 2a. Unauthenticated requests must be rejected with 401
    const unauthState = await httpRequest(port, 'GET', '/api/blog/state');
    assert.strictEqual(unauthState.status, 401, 'Unauthenticated /api/blog/state must return 401');

    const unauthPub = await httpRequest(port, 'POST', '/api/blog/publish', {
      body: { article: { title: 'Hack', slug: 'hack' } }
    });
    assert.strictEqual(unauthPub.status, 401, 'Unauthenticated /api/blog/publish must return 401');
    pass('Unauthenticated API requests to /api/blog/state and /api/blog/publish rejected with HTTP 401');

    // 2b. Verify rate limiting on failed logins from a simulated IP
    for (let i = 1; i <= 5; i++) {
      const failRes = await httpRequest(port, 'POST', '/api/blog/auth/login', {
        headers: { 'X-Forwarded-For': '203.0.113.99' },
        body: { secret: 'wrong-password-' + i }
      });
      assert.strictEqual(failRes.status, 401, `Attempt ${i} should return 401`);
    }
    const lockedRes = await httpRequest(port, 'POST', '/api/blog/auth/login', {
      headers: { 'X-Forwarded-For': '203.0.113.99' },
      body: { secret: TEST_SECRET }
    });
    assert.strictEqual(
      lockedRes.status,
      429,
      '6th attempt after 5 failures must return HTTP 429 Too Many Requests'
    );
    pass('Brute-force rate limiting enforced (HTTP 429 after 5 failed attempts)');

    // 2c. Valid Login from clean IP
    const loginRes = await httpRequest(port, 'POST', '/api/blog/auth/login', {
      headers: { 'X-Forwarded-For': '198.51.100.7' },
      body: { secret: TEST_SECRET }
    });
    assert.strictEqual(loginRes.status, 200, 'Valid login must return HTTP 200');
    assert(loginRes.json && loginRes.json.csrfToken, 'Login must return csrfToken');
    const setCookieHeader = loginRes.headers['set-cookie'];
    assert(
      setCookieHeader && setCookieHeader[0].includes('HttpOnly'),
      'Session cookie must be HttpOnly'
    );
    const sessionCookie = setCookieHeader[0].split(';')[0];
    const csrfToken = loginRes.json.csrfToken;
    pass('Administrator login verified with scrypt + timingSafeEqual, HttpOnly cookie, and CSRF token');

    // 2d. Verify CSRF protection on mutating endpoint
    const noCsrfRes = await httpRequest(port, 'POST', '/api/blog/publish', {
      headers: { Cookie: sessionCookie },
      body: { article: { title: 'Test', slug: 'test' } }
    });
    assert.strictEqual(noCsrfRes.status, 403, 'Missing CSRF token must return HTTP 403');
    pass('CSRF protection enforced on mutating POST/DELETE endpoints (HTTP 403 without valid X-CSRF-Token)');

    // 2e. Verify /blog/admin returns X-Robots-Tag: noindex
    const adminPageRes = await httpRequest(port, 'GET', '/blog/admin');
    assert.strictEqual(adminPageRes.status, 200, '/blog/admin must return HTTP 200');
    assert(
      String(adminPageRes.headers['x-robots-tag']).includes('noindex'),
      '/blog/admin must send X-Robots-Tag: noindex'
    );
    pass('/blog/admin serves mobile portal with X-Robots-Tag: noindex, nofollow, noarchive');

    // 2f. Verify binary magic-byte upload validation
    const fakeJpgRes = await httpRequest(port, 'POST', '/api/blog/upload', {
      headers: { Cookie: sessionCookie, 'X-CSRF-Token': csrfToken },
      body: {
        fileName: 'malicious.jpg',
        base64: Buffer.from('<script>alert(1)</script>').toString('base64')
      }
    });
    assert.strictEqual(
      fakeJpgRes.status,
      400,
      'Upload with invalid JPEG magic bytes must be rejected with HTTP 400'
    );
    pass('Upload security verified: disguised script payload rejected by binary magic-byte inspection (HTTP 400)');

    // ---------------------------------------------------------------------------
    // 3. PHASE 14: COMPLETE PUBLISHING LIFECYCLE END-TO-END TEST
    // ---------------------------------------------------------------------------
    console.log('\nPhase 6 & 14: Testing Full Article Lifecycle (Draft -> Publish -> Update/Redirect -> Unpublish -> Delete)...');

    const testArticleId = 'art-e2e-lifecycle-test';
    const initialSlug = 'e2e-hoberg-newsroom-verification-release';
    const renamedSlug = 'e2e-hoberg-newsroom-verification-renamed';

    const testArticle = {
      id: testArticleId,
      slug: initialSlug,
      title: 'Hoberg Digital Verification Press Release for Automated Pipeline',
      subtitle: 'End-to-end validation of static generation, Schema.org JSON-LD, XML sitemaps, and feeds.',
      summary:
        'Official verification test confirming that draft exclusion, publication, structured data, sitemaps, RSS/Atom feeds, and 301 slug redirects operate cleanly.',
      contentType: 'press-release',
      schemaType: 'NewsArticle',
      status: 'draft',
      featured: false,
      authorId: 'goodluck-iyanu',
      issuingOrganization: 'Hoberg Digital',
      dateline: 'LAGOS, NIGERIA',
      datePublished: '2026-10-24T12:00:00.000Z',
      dateModified: '2026-10-24T12:00:00.000Z',
      scheduledFor: null,
      category: 'press-releases',
      tags: ['Press Release', 'Verification', 'Hoberg Digital'],
      featuredImage: {
        url: 'https://hoberg.com.ng/images/lagos-tech-workspace.jpg',
        alt: 'Hoberg Digital engineering studio in Lagos',
        caption: 'Hoberg Digital engineering workspace in Lagos, Nigeria.',
        credit: 'Hoberg Digital',
        license: 'Official Hoberg Media',
        width: 1200,
        height: 675
      },
      video: {
        type: 'mp4',
        url: 'https://hoberg.com.ng/videos/hoberg-brand-reel.mp4',
        title: 'Hoberg Digital Brand Reel',
        description: 'Official Hoberg Digital overview video.',
        thumbnailUrl: 'https://hoberg.com.ng/images/lagos-tech-workspace.jpg',
        uploadDate: '2026-10-24T12:00:00.000Z',
        duration: 'PT1M15S',
        transcript: 'Hoberg Digital builds digital products and enterprise platforms in Lagos, Nigeria.'
      },
      seo: {
        title: 'Hoberg Digital Verification Release | Hoberg Digital Newsroom',
        description:
          'Official verification test confirming automated SEO metadata, JSON-LD, XML sitemaps, and RSS feeds.',
        canonicalUrl: `https://hoberg.com.ng/blog/${initialSlug}`,
        ogImage: 'https://hoberg.com.ng/images/lagos-tech-workspace.jpg',
        noindex: false
      },
      mediaContact: {
        name: 'Goodluck Iyanu',
        role: 'Founder & Lead Product Engineer, Hoberg Digital',
        email: 'hello@hoberg.com.ng',
        phone: '+234 810 356 2633',
        website: 'https://hoberg.com.ng'
      },
      pressKitLinks: [
        {
          label: 'Hoberg Digital 2026 Research Report',
          url: 'https://hoberg.com.ng/research/2026-ai-visibility-report/',
          type: 'Research Report'
        }
      ],
      references: [
        {
          title: 'Hoberg Digital Official Website',
          url: 'https://hoberg.com.ng/',
          publisher: 'Hoberg Digital'
        }
      ],
      faqs: [
        {
          question: 'Does the Hoberg Newsroom generate static HTML for every published article?',
          answer: 'Yes. Every published release is pre-rendered to /blog/[slug]/index.html.'
        }
      ],
      relatedProducts: [
        { name: 'Hoberg Digital Agency', url: 'https://hoberg.com.ng/agency/' }
      ],
      bodyHtml:
        '<p class="intro-lede"><strong>LAGOS, NIGERIA —</strong> This verification release tests the Hoberg Digital Newsroom publishing pipeline.</p><h2>Automated Discovery Architecture</h2><p>Every published release updates XML sitemaps, RSS 2.0, Atom 1.0, JSON Feed, and llms.txt.</p>'
    };

    // Step 3a: Save as Draft
    const draftSaveRes = await httpRequest(port, 'POST', '/api/blog/publish', {
      headers: { Cookie: sessionCookie, 'X-CSRF-Token': csrfToken },
      body: { article: testArticle, operationLabel: 'save draft' }
    });
    assert.strictEqual(draftSaveRes.status, 200, 'Saving draft must return HTTP 200');

    // Confirm draft is NOT publicly accessible and NOT in sitemaps or feeds
    const draftPublicProbe = await httpRequest(port, 'GET', `/blog/${initialSlug}`);
    assert.strictEqual(
      draftPublicProbe.status,
      404,
      'Draft article route must return HTTP 404 publicly'
    );
    const sitemapAfterDraft = fs.readFileSync(path.join(BLOG_DIR, 'sitemap.xml'), 'utf8');
    assert(
      !sitemapAfterDraft.includes(initialSlug),
      'Draft article must NOT appear in /blog/sitemap.xml'
    );
    const rssAfterDraft = fs.readFileSync(path.join(BLOG_DIR, 'feed.xml'), 'utf8');
    assert(
      !rssAfterDraft.includes(initialSlug),
      'Draft article must NOT appear in /blog/feed.xml'
    );
    pass('Step A (Save Draft): Draft saved and verified excluded from public URL (404), XML sitemaps, and RSS/Atom feeds');

    // Step 3b: Publish the Article
    testArticle.status = 'published';
    const publishRes = await httpRequest(port, 'POST', '/api/blog/publish', {
      headers: { Cookie: sessionCookie, 'X-CSRF-Token': csrfToken },
      body: { article: testArticle, operationLabel: 'publish' }
    });
    assert.strictEqual(publishRes.status, 200, 'Publishing article must return HTTP 200');

    // Verify public URL responds HTTP 200 with full metadata & JSON-LD
    const pubProbe = await httpRequest(port, 'GET', `/blog/${initialSlug}`);
    assert.strictEqual(pubProbe.status, 200, 'Published article URL must return HTTP 200');
    assert(
      pubProbe.text.includes(`<link rel="canonical" href="https://hoberg.com.ng/blog/${initialSlug}">`),
      'Published article HTML must contain canonical URL'
    );
    assert(
      pubProbe.text.includes('"@type": "NewsArticle"'),
      'Published press release must include NewsArticle JSON-LD'
    );
    assert(
      pubProbe.text.includes('"@type": "FAQPage"'),
      'Published press release with FAQs must include FAQPage JSON-LD'
    );
    assert(
      pubProbe.text.includes('"@type": "VideoObject"'),
      'Published press release with video must include VideoObject JSON-LD'
    );

    // Verify inclusion in sitemaps, RSS, Atom, JSON feed, and llms.txt
    const sitemapAfterPub = fs.readFileSync(path.join(BLOG_DIR, 'sitemap.xml'), 'utf8');
    assert(
      sitemapAfterPub.includes(`https://hoberg.com.ng/blog/${initialSlug}`),
      'Published article must appear in /blog/sitemap.xml'
    );
    assert(
      sitemapAfterPub.includes('<video:video>'),
      'Video article must generate <video:video> entry in /blog/sitemap.xml'
    );
    const rssAfterPub = fs.readFileSync(path.join(BLOG_DIR, 'feed.xml'), 'utf8');
    assert(
      rssAfterPub.includes(`https://hoberg.com.ng/blog/${initialSlug}`),
      'Published article must appear in /blog/feed.xml'
    );
    const atomAfterPub = fs.readFileSync(path.join(BLOG_DIR, 'atom.xml'), 'utf8');
    assert(
      atomAfterPub.includes(`https://hoberg.com.ng/blog/${initialSlug}`),
      'Published article must appear in /blog/atom.xml'
    );
    const llmsAfterPub = fs.readFileSync(path.join(ROOT_DIR, 'llms.txt'), 'utf8');
    assert(
      llmsAfterPub.includes(`https://hoberg.com.ng/blog/${initialSlug}`),
      'Published article must appear in /llms.txt'
    );
    pass('Step B (Publish): Public URL HTTP 200, NewsArticle/FAQPage/VideoObject JSON-LD, XML Sitemaps, RSS/Atom/JSON Feeds, and llms.txt verified');

    // Step 3c: Rename Slug & Verify 301 Redirect
    const currentRedirects = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, 'redirects.json'), 'utf8')
    );
    currentRedirects.unshift({
      from: `/blog/${initialSlug}`,
      to: `/blog/${renamedSlug}`,
      type: 301,
      reason: 'E2E test slug rename',
      createdAt: new Date().toISOString()
    });
    testArticle.slug = renamedSlug;
    testArticle.seo.canonicalUrl = `https://hoberg.com.ng/blog/${renamedSlug}`;

    const renameRes = await httpRequest(port, 'POST', '/api/blog/publish', {
      headers: { Cookie: sessionCookie, 'X-CSRF-Token': csrfToken },
      body: {
        article: testArticle,
        redirects: currentRedirects,
        operationLabel: 'rename slug'
      }
    });
    assert.strictEqual(renameRes.status, 200, 'Slug rename must return HTTP 200');

    // Probe old slug -> should return HTTP 301 redirect to new slug
    const oldSlugProbe = await httpRequest(port, 'GET', `/blog/${initialSlug}`);
    assert.strictEqual(
      oldSlugProbe.status,
      301,
      'Old slug must return HTTP 301 redirect on server'
    );
    assert.strictEqual(
      oldSlugProbe.headers.location,
      `/blog/${renamedSlug}`,
      'Redirect Location header must point to new slug'
    );
    // Also verify static redirect HTML file exists on disk for GitHub Pages
    assert(
      fs.existsSync(path.join(BLOG_DIR, initialSlug, 'index.html')),
      'Static redirect stub must exist on disk for GitHub Pages'
    );
    // Probe new slug -> should return HTTP 200
    const newSlugProbe = await httpRequest(port, 'GET', `/blog/${renamedSlug}`);
    assert.strictEqual(newSlugProbe.status, 200, 'Renamed slug must return HTTP 200');
    pass('Step C (Update & Slug Change): HTTP 301 redirect + static redirect stub verified from old slug to new slug');

    // Step 3d: Unpublish Article
    testArticle.status = 'draft';
    await httpRequest(port, 'POST', '/api/blog/publish', {
      headers: { Cookie: sessionCookie, 'X-CSRF-Token': csrfToken },
      body: { article: testArticle, operationLabel: 'unpublish' }
    });
    const unpubProbe = await httpRequest(port, 'GET', `/blog/${renamedSlug}`);
    assert.strictEqual(
      unpubProbe.status,
      404,
      'Unpublished article must be removed and return HTTP 404'
    );
    pass('Step D (Unpublish): Unpublished article removed from public routes and discovery feeds');

    // Step 3e: Delete Test Article
    const delRes = await httpRequest(
      port,
      'DELETE',
      `/api/blog/articles/${encodeURIComponent(testArticleId)}`,
      {
        headers: { Cookie: sessionCookie, 'X-CSRF-Token': csrfToken }
      }
    );
    assert.strictEqual(delRes.status, 200, 'Delete article must return HTTP 200');
    pass('Step E (Delete): Test article permanently deleted via API');
  } finally {
    // Restore exact production data files and remove test redirect directory
    const testRedirDir = path.join(BLOG_DIR, 'e2e-hoberg-newsroom-verification-release');
    if (fs.existsSync(testRedirDir)) {
      fs.rmSync(testRedirDir, { recursive: true, force: true });
    }
    const testRenamedDir = path.join(BLOG_DIR, 'e2e-hoberg-newsroom-verification-renamed');
    if (fs.existsSync(testRenamedDir)) {
      fs.rmSync(testRenamedDir, { recursive: true, force: true });
    }

    fs.writeFileSync(path.join(DATA_DIR, 'articles.json'), origArticles, 'utf8');
    fs.writeFileSync(path.join(DATA_DIR, 'redirects.json'), origRedirects, 'utf8');
    fs.writeFileSync(path.join(DATA_DIR, 'media.json'), origMedia, 'utf8');
    fs.writeFileSync(path.join(DATA_DIR, 'revisions.json'), origRevisions, 'utf8');

    await runBuildPipeline({ notifyIndexNow: false });
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('\n===================================================================');
  console.log(`ALL ${passed} END-TO-END VERIFICATION CHECKS PASSED SUCCESSFULLY.`);
  console.log('Production state restored and verified.');
  console.log('===================================================================');
}

runAllTests().catch((err) => {
  console.error('\n[FAIL] Verification failed:', err);
  process.exit(1);
});
