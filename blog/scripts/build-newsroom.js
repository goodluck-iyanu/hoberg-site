#!/usr/bin/env node
/**
 * HOBERG DIGITAL NEWSROOM — AUTOMATED BUILD & PUBLISHING PIPELINE
 * Generates all static article routes (/blog/[slug]/index.html), legacy compatibility pages,
 * Newsroom homepage (/blog/index.html), XML sitemaps, RSS/Atom/JSON feeds, llms.txt,
 * redirect stubs, IndexNow notifications, and evidence-based status reports.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const NewsroomEngine = require('../js/newsroom-engine.js');

const ROOT_DIR = path.resolve(__dirname, '../..');
const BLOG_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(BLOG_DIR, 'data');
const ARTICLES_DIR = path.join(BLOG_DIR, 'articles');

function readJson(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e.message);
  }
  return fallback;
}

function writeJsonAtomic(filePath, data) {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function computeArticleHash(article) {
  const payload = JSON.stringify({
    slug: article.slug,
    title: article.title,
    subtitle: article.subtitle,
    summary: article.summary,
    status: article.status,
    dateModified: article.dateModified,
    bodyHtml: article.bodyHtml
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function sendIndexNowRequest(config, urlList) {
  return new Promise((resolve) => {
    if (!config.indexNow || !config.indexNow.enabled || !urlList.length) {
      return resolve({ status: 'Skipped', httpCode: null, message: 'No URLs to submit.' });
    }
    const body = JSON.stringify({
      host: config.indexNow.host || 'hoberg.com.ng',
      key: config.indexNow.key,
      keyLocation: config.indexNow.keyLocation,
      urlList
    });

    const req = https.request(
      'https://api.indexnow.org/indexnow',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'HobergDigitalNewsroom/1.0 (+https://hoberg.com.ng/blog)'
        },
        timeout: 8000
      },
      (res) => {
        let respData = '';
        res.on('data', (chunk) => (respData += chunk));
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 202) {
            resolve({
              status: 'Submitted',
              httpCode: res.statusCode,
              message: `IndexNow accepted ${urlList.length} URL(s) (HTTP ${res.statusCode}). Indexing is determined by participating search engines.`
            });
          } else {
            resolve({
              status: 'Pending',
              httpCode: res.statusCode,
              message: `IndexNow returned HTTP ${res.statusCode}: ${respData.slice(0, 140)}`
            });
          }
        });
      }
    );

    req.on('error', (err) => {
      resolve({
        status: 'Pending',
        httpCode: null,
        message: `Network unavailable for live IndexNow ping (${err.code || err.message}); queued for retry on deployment.`
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        status: 'Pending',
        httpCode: null,
        message: 'IndexNow request timed out; queued for retry.'
      });
    });

    req.write(body);
    req.end();
  });
}

async function runBuildPipeline(options = {}) {
  const config = readJson(path.join(DATA_DIR, 'config.json'), {});
  const authors = readJson(path.join(DATA_DIR, 'authors.json'), []);
  const categories = readJson(path.join(DATA_DIR, 'categories.json'), []);
  const articles = readJson(path.join(DATA_DIR, 'articles.json'), []);
  const redirects = readJson(path.join(DATA_DIR, 'redirects.json'), []);
  const existingStatusLog = readJson(path.join(DATA_DIR, 'status-log.json'), {
    lastBuildAt: null,
    indexNowKeyLocation: (config.indexNow && config.indexNow.keyLocation) || '',
    articles: {}
  });

  const now = new Date();
  let articlesModified = false;

  // 1. Check scheduled articles and promote if scheduledFor <= now
  for (const art of articles) {
    if (art.status === 'scheduled' && art.scheduledFor) {
      const schedTime = new Date(art.scheduledFor);
      if (!isNaN(schedTime.getTime()) && schedTime <= now) {
        art.status = 'published';
        art.datePublished = art.scheduledFor;
        art.dateModified = now.toISOString();
        articlesModified = true;
      }
    }
    if (!art.readingTime && art.bodyHtml) {
      art.readingTime = NewsroomEngine.computeReadingTime(art.bodyHtml);
    }
  }

  if (articlesModified) {
    writeJsonAtomic(path.join(DATA_DIR, 'articles.json'), articles);
  }

  const reservedDirs = new Set([
    'admin',
    'articles',
    'assets',
    'css',
    'data',
    'js',
    'scripts',
    'uploads'
  ]);

  const publishedSlugs = new Set();

  // 2. Generate static pages for each published article, and clean up unpublished/draft routes
  for (const art of articles) {
    const slug = art.slug;
    if (!slug || reservedDirs.has(slug)) continue;

    const slugDir = path.join(BLOG_DIR, slug);
    const slugIndexFile = path.join(slugDir, 'index.html');

    if (art.status === 'published') {
      publishedSlugs.add(slug);
      if (!fs.existsSync(slugDir)) {
        fs.mkdirSync(slugDir, { recursive: true });
      }
      const html = NewsroomEngine.generateArticlePageHtml(art, articles, config, authors, {
        isLegacyStub: false
      });
      fs.writeFileSync(slugIndexFile, html, 'utf8');

      // Also update legacy /blog/articles/[slug].html if it existed or is in blog/articles/
      const legacyFile = path.join(ARTICLES_DIR, `${slug}.html`);
      if (art.legacyPath || fs.existsSync(legacyFile)) {
        if (!fs.existsSync(ARTICLES_DIR)) fs.mkdirSync(ARTICLES_DIR, { recursive: true });
        const legacyHtml = NewsroomEngine.generateArticlePageHtml(art, articles, config, authors, {
          isLegacyStub: true
        });
        fs.writeFileSync(legacyFile, legacyHtml, 'utf8');
      }
    } else {
      // Ensure drafts, scheduled, and archived articles do NOT have public static HTML directories
      if (fs.existsSync(slugIndexFile)) {
        fs.unlinkSync(slugIndexFile);
        try {
          fs.rmdirSync(slugDir);
        } catch (e) {
          // ignore if non-empty
        }
      }
    }
  }

  // 3. Generate redirect stubs for renamed slugs (/blog/[old-slug]/index.html -> /blog/[new-slug])
  for (const redir of redirects) {
    if (!redir.from || !redir.to) continue;
    const match = redir.from.match(/^\/blog\/([a-z0-9-]+)\/?$/i);
    if (match) {
      const oldSlug = match[1];
      if (!publishedSlugs.has(oldSlug) && !reservedDirs.has(oldSlug)) {
        const oldDir = path.join(BLOG_DIR, oldSlug);
        if (!fs.existsSync(oldDir)) fs.mkdirSync(oldDir, { recursive: true });
        const targetFull = redir.to.startsWith('http')
          ? redir.to
          : `${config.siteUrl || 'https://hoberg.com.ng'}${redir.to}`;
        const redirectHtml = NewsroomEngine.generateRedirectPageHtml(
          redir.from,
          targetFull,
          redir.to
        );
        fs.writeFileSync(path.join(oldDir, 'index.html'), redirectHtml, 'utf8');
      }
    }
  }

  // 4. Generate Newsroom Homepage (/blog/index.html)
  const homepageHtml = NewsroomEngine.generateNewsroomHomepageHtml(
    articles,
    config,
    categories,
    authors
  );
  fs.writeFileSync(path.join(BLOG_DIR, 'index.html'), homepageHtml, 'utf8');

  // 5. Generate XML Sitemaps (root sitemap.xml and blog/sitemap.xml)
  const { rootSitemapXml, blogSitemapXml } = NewsroomEngine.generateSitemapsXml(articles, config);
  fs.writeFileSync(path.join(ROOT_DIR, 'sitemap.xml'), rootSitemapXml, 'utf8');
  fs.writeFileSync(path.join(BLOG_DIR, 'sitemap.xml'), blogSitemapXml, 'utf8');

  // 6. Generate RSS 2.0, Atom 1.0, and JSON Feed
  const { rssXml, atomXml, jsonFeed } = NewsroomEngine.generateFeeds(articles, config, authors);
  fs.writeFileSync(path.join(BLOG_DIR, 'feed.xml'), rssXml, 'utf8');
  fs.writeFileSync(path.join(BLOG_DIR, 'atom.xml'), atomXml, 'utf8');
  fs.writeFileSync(path.join(BLOG_DIR, 'feed.json'), jsonFeed, 'utf8');

  // 7. Generate llms.txt (root and blog/llms.txt)
  const { rootLlmsTxt, blogLlmsTxt } = NewsroomEngine.generateLlmsTxt(articles, config);
  fs.writeFileSync(path.join(ROOT_DIR, 'llms.txt'), rootLlmsTxt, 'utf8');
  fs.writeFileSync(path.join(BLOG_DIR, 'llms.txt'), blogLlmsTxt, 'utf8');

  // 8. Ensure robots.txt allows public search & AI crawlers and protects /blog/admin
  const robotsTxt = `# Hoberg Digital — https://hoberg.com.ng/
# Founded and owned by Goodluck Iyanu. Lagos, Nigeria.
# Full facts for crawlers and models: https://hoberg.com.ng/llms.txt
# Official Newsroom: https://hoberg.com.ng/blog

User-agent: *
Allow: /
Disallow: /blog/admin
Disallow: /api/blog/

User-agent: Googlebot
Allow: /
Disallow: /blog/admin

User-agent: Googlebot-Image
Allow: /

User-agent: Googlebot-News
Allow: /blog

User-agent: Google-Extended
Allow: /

User-agent: Bingbot
Allow: /
Disallow: /blog/admin

User-agent: GPTBot
Allow: /
Disallow: /blog/admin

User-agent: ChatGPT-User
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Anthropic-AI
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Applebot
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: CCBot
Allow: /

User-agent: Amazonbot
Allow: /

User-agent: meta-externalagent
Allow: /

Sitemap: https://hoberg.com.ng/sitemap.xml
Sitemap: https://hoberg.com.ng/blog/sitemap.xml
`;
  fs.writeFileSync(path.join(ROOT_DIR, 'robots.txt'), robotsTxt, 'utf8');

  // 9. Ensure IndexNow key verification file exists at root and /blog
  if (config.indexNow && config.indexNow.key) {
    const keyFile = `${config.indexNow.key}.txt`;
    fs.writeFileSync(path.join(ROOT_DIR, keyFile), config.indexNow.key, 'utf8');
    fs.writeFileSync(path.join(BLOG_DIR, keyFile), config.indexNow.key, 'utf8');
  }

  // 10. Validate every article and build evidence-based status log
  const urlsToNotify = [];
  const nextStatusArticles = {};
  const siteUrl = config.siteUrl || 'https://hoberg.com.ng';

  for (const art of articles) {
    const prevStatus = (existingStatusLog.articles && existingStatusLog.articles[art.slug]) || {};
    const diag = NewsroomEngine.validateArticleDiagnostic(art, config, authors);
    const contentHash = computeArticleHash(art);
    const isPublished = art.status === 'published';
    const isIndexable = isPublished && !(art.seo && art.seo.noindex);
    const publicUrl = `${siteUrl}/blog/${art.slug}`;
    const staticFileExists = fs.existsSync(path.join(BLOG_DIR, art.slug, 'index.html'));
    const inSitemap = isIndexable && rootSitemapXml.includes(`<loc>${publicUrl}</loc>`);
    const inFeed = isIndexable && rssXml.includes(`<link>${publicUrl}</link>`);

    if (isIndexable && (options.forceIndexNow || prevStatus.notifiedHash !== contentHash)) {
      urlsToNotify.push(publicUrl);
    }

    nextStatusArticles[art.slug] = {
      slug: art.slug,
      title: art.title,
      contentType: art.contentType,
      publicationStatus:
        art.status === 'published'
          ? 'Complete'
          : art.status === 'scheduled'
          ? 'Pending'
          : 'Draft / Excluded',
      publicUrl: publicUrl,
      publicUrlVerification: isPublished
        ? staticFileExists
          ? 'Complete'
          : 'Error'
        : 'Excluded (Non-Public)',
      sitemapInclusion: isIndexable ? (inSitemap ? 'Complete' : 'Error') : 'Excluded',
      feedUpdate: isIndexable ? (inFeed ? 'Complete' : 'Error') : 'Excluded',
      metadataValidation: diag.metadataValid ? 'Complete' : 'Error',
      metadataIssues: diag.metadataIssues,
      structuredDataValidation: diag.schemaValid ? 'Complete' : 'Error',
      schemaType: art.schemaType || 'Article',
      schemaIssues: diag.schemaIssues,
      technicalCrawlability: isIndexable
        ? diag.crawlable
          ? 'Complete'
          : 'Error'
        : 'Excluded (Noindex/Draft)',
      crawlIssues: diag.crawlIssues,
      searchEngineNotification: prevStatus.searchEngineNotification || (isIndexable ? 'Pending' : 'Excluded'),
      notificationDetail:
        prevStatus.notificationDetail ||
        (isIndexable ? 'Ready for IndexNow submission.' : 'Not applicable for unpublished content.'),
      googleIndexingStatus: process.env.GOOGLE_SEARCH_CONSOLE_TOKEN
        ? prevStatus.googleIndexingStatus || 'Submitted (Via Sitemap)'
        : 'Not connected (Verify in Google Search Console)',
      bingIndexingStatus: prevStatus.bingIndexingStatus || (isIndexable ? 'Pending IndexNow' : 'Excluded'),
      notifiedHash: prevStatus.notifiedHash || null,
      lastVerifiedAt: now.toISOString(),
      outstandingActions: [
        ...diag.metadataIssues,
        ...diag.schemaIssues,
        ...(isPublished ? diag.crawlIssues : [])
      ]
    };
  }

  // 11. Optional IndexNow notification for newly published or updated articles
  let indexNowResult = null;
  if (options.notifyIndexNow && urlsToNotify.length > 0) {
    const urlsWithHome = [`${siteUrl}/blog`, ...urlsToNotify];
    indexNowResult = await sendIndexNowRequest(config, urlsWithHome);
    for (const art of articles) {
      const publicUrl = `${siteUrl}/blog/${art.slug}`;
      if (urlsToNotify.includes(publicUrl)) {
        const entry = nextStatusArticles[art.slug];
        entry.searchEngineNotification = indexNowResult.status;
        entry.notificationDetail = indexNowResult.message;
        entry.bingIndexingStatus =
          indexNowResult.status === 'Submitted'
            ? 'Submitted (IndexNow Accepted — Awaiting Crawl)'
            : 'Pending Retry (Sitemap Active)';
        if (indexNowResult.status === 'Submitted') {
          entry.notifiedHash = computeArticleHash(art);
        }
      }
    }
  }

  const updatedStatusLog = {
    lastBuildAt: now.toISOString(),
    totalArticles: articles.length,
    publishedCount: articles.filter((a) => a.status === 'published').length,
    draftCount: articles.filter((a) => a.status === 'draft').length,
    scheduledCount: articles.filter((a) => a.status === 'scheduled').length,
    archivedCount: articles.filter((a) => a.status === 'archived').length,
    sitemapUrl: `${siteUrl}/sitemap.xml`,
    newsroomSitemapUrl: `${siteUrl}/blog/sitemap.xml`,
    rssFeedUrl: `${siteUrl}/blog/feed.xml`,
    atomFeedUrl: `${siteUrl}/blog/atom.xml`,
    jsonFeedUrl: `${siteUrl}/blog/feed.json`,
    indexNowKeyLocation: (config.indexNow && config.indexNow.keyLocation) || '',
    lastIndexNowResult: indexNowResult || existingStatusLog.lastIndexNowResult || null,
    articles: nextStatusArticles
  };

  writeJsonAtomic(path.join(DATA_DIR, 'status-log.json'), updatedStatusLog);

  return updatedStatusLog;
}

if (require.main === module) {
  const notify = process.argv.includes('--notify-indexnow');
  const force = process.argv.includes('--force-indexnow');
  runBuildPipeline({ notifyIndexNow: notify, forceIndexNow: force })
    .then((report) => {
      console.log(
        `Newsroom build pipeline complete: ${report.publishedCount} published, ${report.draftCount} drafts, ${report.scheduledCount} scheduled.`
      );
      if (report.lastIndexNowResult) {
        console.log('IndexNow:', report.lastIndexNowResult.message);
      }
    })
    .catch((err) => {
      console.error('Build pipeline failed:', err);
      process.exit(1);
    });
}

module.exports = { runBuildPipeline };

