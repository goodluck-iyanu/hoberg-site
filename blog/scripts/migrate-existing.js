/**
 * Hoberg Digital Newsroom — Safe Content Migration & Inventory Script
 * Extracts and preserves all existing blog articles, FAQs, metadata, and official Hoberg announcements
 * into structured JSON database files under blog/data/.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../..');
const BLOG_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(BLOG_DIR, 'data');
const ARTICLES_DIR = path.join(BLOG_DIR, 'articles');
const ASSETS_DIR = path.join(BLOG_DIR, 'assets');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 1. Ensure all historically referenced og:image JPEGs in blog/assets/ exist using real Hoberg Lagos photography
const imageMappings = [
  { target: 'best-website-design-company-nigeria.jpg', source: 'lagos-lagoon-poster.jpg' },
  { target: 'website-design-company-lagos.jpg', source: 'lekki-bridge.jpg' },
  { target: 'website-design-cost-nigeria.jpg', source: 'national-theatre.jpg' },
  { target: 'ecommerce-website-development.jpg', source: 'adire.jpg' },
  { target: 'ecommerce-website-development-nigeria.jpg', source: 'adire.jpg' },
  { target: 'corporate-website-design.jpg', source: 'campus.jpg' },
  { target: 'corporate-website-design-nigeria.jpg', source: 'campus.jpg' }
];

for (const mapping of imageMappings) {
  const srcPath = path.join(ROOT_DIR, 'images', mapping.source);
  const destPath = path.join(ASSETS_DIR, mapping.target);
  if (fs.existsSync(srcPath) && !fs.existsSync(destPath)) {
    fs.copyFileSync(srcPath, destPath);
  }
}

// Also copy BingSiteAuth.xml to root if missing
const coleboxBing = path.join(ROOT_DIR, 'colebox', 'BingSiteAuth.xml');
const rootBing = path.join(ROOT_DIR, 'BingSiteAuth.xml');
if (fs.existsSync(coleboxBing) && !fs.existsSync(rootBing)) {
  fs.copyFileSync(coleboxBing, rootBing);
}

// Helper to extract FAQ items and body sections from existing HTML files
function parseExistingArticleHtml(filename) {
  const filePath = path.join(ARTICLES_DIR, filename);
  const raw = fs.readFileSync(filePath, 'utf8');

  // Extract FAQPage JSON-LD
  const faqMatches = [...raw.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  let faqs = [];
  for (const m of faqMatches) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed['@type'] === 'FAQPage' && Array.isArray(parsed.mainEntity)) {
        faqs = parsed.mainEntity.map((q) => ({
          question: q.name,
          answer: q.acceptedAnswer ? q.acceptedAnswer.text : ''
        }));
      }
    } catch (e) {
      // ignore malformed JSON
    }
  }

  // Extract article body between <article class="article-body"> and <aside class="related-links">
  const bodyMatch = raw.match(/<article class="article-body">([\s\S]*?)<aside class="related-links">/i);
  const finalThoughtsMatch = raw.match(/<h2 id="final-thoughts">Final Thoughts<\/h2>([\s\S]*?)<div class="article-cta"/i);
  const ctaMatch = raw.match(/<div class="article-cta" id="work-with-hoberg">([\s\S]*?)<div class="hero-actions"/i);

  let mainHtml = '';
  if (bodyMatch) {
    mainHtml = bodyMatch[1].trim();
  }
  if (finalThoughtsMatch) {
    mainHtml += '\n\n<h2 id="final-thoughts">Final Thoughts</h2>\n' + finalThoughtsMatch[1].trim();
  }

  // Rewrite internal relative links like href="website-design-cost-nigeria.html" to "/blog/website-design-cost-nigeria"
  mainHtml = mainHtml.replace(/href="([a-z0-9-]+)\.html"/gi, 'href="/blog/$1"');

  let ctaHtml = '';
  if (ctaMatch) {
    const inner = ctaMatch[1].replace(/<h2>Work With Hoberg Digital Agency<\/h2>/i, '').trim();
    ctaHtml = inner;
  }

  // Extract TOC items
  const tocMatches = [...raw.matchAll(/<li><a href="#([^"]+)">([^<]+)<\/a><\/li>/gi)];
  const toc = tocMatches.map((m) => ({ id: m[1], label: m[2] }));

  return { mainHtml, ctaHtml, faqs, toc };
}

const lagosParsed = parseExistingArticleHtml('website-design-company-lagos.html');
const costParsed = parseExistingArticleHtml('website-design-cost-nigeria.html');
const ecommerceParsed = parseExistingArticleHtml('ecommerce-website-development.html');
const corporateParsed = parseExistingArticleHtml('corporate-website-design.html');

// Note on best-website-design-company-nigeria.html:
// In commit 937ef03 (Aug 1, 2026), best-website-design-company-nigeria.html was accidentally committed with the HTML body of website-design-company-lagos.html
// and later had the Nigeria SEO header prepended above two duplicate Lagos <head> blocks.
// We preserve its exact SEO metadata, title, summary, canonical identity, and structure while providing the dedicated Nigeria-wide buyer's guide body
// so it is no longer a duplicate copy of the Lagos article.

const bestNigeriaMainHtml = `<p class="intro-lede">Choosing the best website design company in Nigeria comes down to verifiable execution: live websites that load fast on Nigerian mobile networks, clear project scoping, milestone-based payments, and reliable post-launch support. What separates a serious web engineering partner from a briefcase reseller is how the site is architected, who owns the domain and hosting credentials, and how the site performs once real customers arrive.</p>

<h2 id="overview">Overview</h2>
<p>Businesses across Nigeria — from Lagos and Abuja to Port Harcourt, Ibadan, and Kano — rely on their website as their primary verification point. Whether a prospective client discovers you through Google Search, an AI assistant like ChatGPT or Perplexity, or a WhatsApp referral, your website is where they confirm that your company is real, capable, and worth contacting.</p>
<p>Because the barrier to calling oneself a web designer is low, business owners frequently encounter inconsistent quotes and recycled templates. A dependable website design company in Nigeria combines clean visual hierarchy, mobile-first performance, technical SEO fundamentals, and local payment or communication workflows that fit how Nigerian customers actually buy.</p>

<h2 id="why-it-matters">Why It Matters</h2>
<p>A poorly built website costs more than the initial invoice. When pages take ten seconds to load on a mobile data connection, or when metadata and structured data are missing, search engines and AI discovery platforms struggle to understand what your business offers.</p>
<p>Hiring the right web design agency ensures that your site is built once on a maintainable foundation — with proper semantic headings, clear service descriptions, working enquiry or checkout flows, and full ownership of your domain name and hosting account.</p>

<h2 id="benefits">Benefits</h2>
<p>Working with an established Nigerian website design company delivers practical operational advantages:</p>
<ul>
  <li><strong>Mobile-first speed for Nigerian networks.</strong> Pages engineered with lightweight assets and responsive layouts so visitors on 4G or fluctuating connections never bounce before the page renders.</li>
  <li><strong>Search and AI discoverability built in.</strong> Proper canonical URLs, Schema.org structured data, XML sitemaps, and clear copywriting that help Google, Bing, and AI answer engines understand your business.</li>
  <li><strong>Local payment and WhatsApp conversion flows.</strong> Seamless integration with Paystack, Flutterwave, bank transfer workflows, and direct WhatsApp business routing where appropriate.</li>
  <li><strong>Clear milestone accountability.</strong> Structured project phases — from discovery and wireframes to design approval and final handover — so you never pay 100% upfront without seeing real progress.</li>
  <li><strong>Full asset ownership.</strong> You retain administrative control of your domain registration, DNS, and website files after launch.</li>
</ul>

<h2 id="how-to-choose">How to Choose the Right Fit</h2>
<p>Before signing a contract or paying a deposit to any website design company in Nigeria, verify these essential criteria:</p>
<div class="checklist">
  <ul>
    <li>Inspect live websites in their portfolio on your phone — test how quickly they load and how easy it is to find key information.</li>
    <li>Confirm who writes the copy and structures the pages, versus expecting you to supply everything without guidance.</li>
    <li>Ask explicitly who registers and owns the domain name and hosting account upon project completion.</li>
    <li>Check that technical SEO fundamentals (page titles, meta descriptions, Open Graph tags, Schema.org JSON-LD, and XML sitemaps) are included in the base build.</li>
    <li>Verify the payment schedule — look for transparent milestone payments tied to deliverables rather than 100% upfront demands.</li>
    <li>Clarify post-launch support terms: what is covered during the initial handover window and how future updates are billed.</li>
  </ul>
</div>

<h2 id="pricing">Pricing in Nigeria</h2>
<p>Website design pricing in Nigeria is determined by scope, page count, custom engineering, and required integrations rather than arbitrary package names. A straightforward corporate or service website requires a different engineering budget than a custom web application or multi-category e-commerce store.</p>
<p>At Hoberg Digital Agency, presence projects start from transparent baseline tiers with milestone billing, allowing Nigerian SMEs and growing enterprises to match their build to their current operational stage. For a detailed look at every cost driver, read our guide on <a href="/blog/website-design-cost-nigeria">website design cost in Nigeria</a>, or compare local considerations in our <a href="/blog/website-design-company-lagos">Lagos website design guide</a>.</p>

<h2 id="common-mistakes">Common Mistakes</h2>
<p>Avoid these frequent pitfalls when commissioning a business website in Nigeria:</p>
<h3>1. Paying 100% upfront before seeing a live staging link</h3>
<p>Always use a milestone structure tied to verifiable progress — initial deposit, design sign-off, and final deployment handover.</p>
<h3>2. Letting a developer register your domain in their personal account</h3>
<p>Your company domain is a core business asset. Ensure it is registered under your official company email or transferred to your control at handover.</p>
<h3>3. Approving desktop screenshots without testing on a phone</h3>
<p>The majority of Nigerian web traffic happens on mobile devices. Always test the live staging URL on your phone before final approval.</p>
<h3>4. Ignoring technical SEO and structured data at launch</h3>
<p>Launching a site without canonical tags, sitemap submission, or Organization and Article schema delays how quickly search engines and AI systems can index your pages.</p>

<h2 id="final-thoughts">Final Thoughts</h2>
<p>The best website design company in Nigeria is one that treats your website as working business infrastructure rather than a digital brochure. Focus on verifiable live work, transparent milestone pricing, mobile speed, and clear ownership of your digital assets.</p>
<p>If you are planning an online store, see our guide on <a href="/blog/ecommerce-website-development">e-commerce website development in Nigeria</a>, or explore <a href="/blog/corporate-website-design">corporate website design</a> for multi-stakeholder organisations.</p>`;

const bestNigeriaFaqs = [
  {
    question: "What should I check first when comparing website design companies in Nigeria?",
    answer: "Start by opening their live client websites on your mobile phone. Check loading speed, clarity of navigation, whether the sites have proper security (HTTPS) and clear calls to action, and whether the portfolio shows consistent engineering quality."
  },
  {
    question: "How long does it take to build a professional business website in Nigeria?",
    answer: "A standard business or corporate website typically takes between two and four weeks depending on page count and how quickly content and feedback are approved. E-commerce stores and custom web applications require additional time for payment and system testing."
  },
  {
    question: "Who should own the domain name and hosting account?",
    answer: "Your business should always own its domain name and have full administrative access to hosting and DNS settings once the project is completed."
  },
  {
    question: "Does Hoberg Digital Agency work with businesses outside Lagos?",
    answer: "Yes. While Hoberg Digital is headquartered in Lagos, Nigeria, we build websites, digital systems, and SEO infrastructure for businesses across Nigeria and internationally via structured remote workflows."
  },
  {
    question: "Will my new website be visible on Google and AI search engines?",
    answer: "Every website we build includes technical SEO foundations — clean semantic HTML, canonical URLs, Open Graph metadata, Schema.org JSON-LD structured data, and XML sitemap setup — to support legitimate discovery on Google Search, Bing, and AI answer engines."
  },
  {
    question: "Can I update my website content myself after launch?",
    answer: "Yes. Depending on your project requirements, we provide an administrative publishing interface or documented handover so your team can publish updates, announcements, and changes without editing code."
  }
];

const articles = [
  {
    id: "art-press-2026-ai-report",
    slug: "nigeria-2026-ai-search-visibility-report",
    legacyPath: null,
    title: "Hoberg Digital Releases 2026 Nigerian Business AI Visibility Report Auditing 50 Leading Companies",
    subtitle: "Original research examining how ChatGPT, Perplexity, Google AI Overviews, and search crawlers interpret, trust, and cite 50 major Nigerian enterprises and fintechs.",
    summary: "Hoberg Digital publishes its 2026 AI Visibility Report auditing 50 Nigerian businesses — including Dangote, BUA Group, GTBank, Zenith Bank, Flutterwave, Paystack, Jumia, and Interswitch — on technical SEO, structured data, and AI crawler readiness.",
    contentType: "research-report",
    schemaType: "NewsArticle",
    category: "Research & AI Visibility",
    tags: ["AI Visibility", "Research Report", "Nigerian Business", "Technical SEO", "Schema.org", "LLMs", "Lagos"],
    authorId: "goodluck-iyanu",
    issuingOrganization: "Hoberg Digital",
    dateline: "LAGOS, NIGERIA",
    datePublished: "2026-09-15T09:00:00+01:00",
    dateModified: "2026-10-24T12:00:00+01:00",
    status: "published",
    featured: true,
    readingTime: "8 min read",
    featuredImage: {
      url: "https://hoberg.com.ng/images/lagos-lagoon-poster.jpg",
      alt: "Aerial view of Lagos lagoon representing Hoberg Digital's 2026 Nigerian Business AI Visibility Report",
      caption: "Hoberg Digital's 2026 AI Visibility Report evaluates technical discoverability across 50 major Nigerian companies.",
      credit: "Hoberg Digital Research Desk",
      sourceUrl: "https://hoberg.com.ng/research/2026-ai-visibility-report/",
      license: "Hoberg Digital Official Media"
    },
    inlineImages: [
      {
        url: "https://hoberg.com.ng/images/lekki-bridge.jpg",
        alt: "Lekki-Ikoyi Link Bridge in Lagos, Nigeria",
        caption: "Lagos commercial corridor: where corporate credibility increasingly depends on structured digital and AI search signals.",
        credit: "Hoberg Digital"
      }
    ],
    video: {
      type: "direct",
      url: "https://hoberg.com.ng/videos/lagoon-hero.mp4",
      poster: "https://hoberg.com.ng/images/lagos-lagoon-poster.jpg",
      title: "Lagos Digital Ecosystem Overview — Hoberg Digital",
      description: "Visual overview of Lagos, Nigeria, home to Hoberg Digital's research and engineering desk.",
      transcript: "Visual aerial footage of the Lagos lagoon and commercial skyline in Lagos, Nigeria, produced for Hoberg Digital's official platform."
    },
    pressKitLinks: [
      {
        label: "Interactive 2026 AI Visibility Report",
        url: "https://hoberg.com.ng/research/2026-ai-visibility-report/",
        fileType: "Web Interactive"
      },
      {
        label: "Download Full PDF Report (Hoberg_Report_2026.pdf)",
        url: "https://hoberg.com.ng/research/2026-ai-visibility-report/Hoberg_Report_2026.pdf",
        fileType: "PDF"
      },
      {
        label: "Download Master Dataset — 50 Audited Sites (XLSX)",
        url: "https://hoberg.com.ng/research/2026-ai-visibility-report/Hoberg_Master_50_Sites.xlsx",
        fileType: "XLSX"
      }
    ],
    references: [
      {
        title: "Hoberg 2026 Nigerian Business AI Visibility Report (Interactive Portal)",
        url: "https://hoberg.com.ng/research/2026-ai-visibility-report/",
        publisher: "Hoberg Digital Research"
      },
      {
        title: "Hoberg Digital Official Entity & LLM Factsheet",
        url: "https://hoberg.com.ng/llms.txt",
        publisher: "Hoberg Digital"
      }
    ],
    mediaContact: {
      name: "Goodluck Iyanu",
      role: "Founder & Owner, Hoberg Digital",
      organization: "Hoberg Digital",
      email: "hello@hoberg.com.ng",
      phone: "+234-810-428-9365",
      whatsapp: "https://wa.me/2348104289365",
      location: "Lagos, Nigeria"
    },
    seo: {
      title: "2026 Nigerian Business AI Visibility Report | Hoberg Digital Newsroom",
      description: "Official release of the Hoberg Digital 2026 AI Visibility Report auditing 50 Nigerian businesses including Dangote, GTBank, Flutterwave, Paystack, and Jumia.",
      canonicalUrl: "https://hoberg.com.ng/blog/nigeria-2026-ai-search-visibility-report",
      ogImage: "https://hoberg.com.ng/images/lagos-lagoon-poster.jpg",
      noindex: false
    },
    bodyHtml: `<p class="intro-lede"><strong>LAGOS, NIGERIA —</strong> Hoberg Digital has published the <em>2026 Nigerian Business AI Visibility Report</em>, an empirical audit of 50 prominent Nigerian enterprises, banks, telecoms, consumer brands, and technology platforms to evaluate how effectively modern search engines and AI answer systems can crawl, verify, and cite their official websites.</p>

<h2 id="executive-summary">Executive Summary</h2>
<p>As decision-makers increasingly use AI-assisted search tools — including ChatGPT Search, Perplexity, Google AI Overviews, and Microsoft Copilot — alongside traditional Google and Bing search, a company's website must do more than render visual pages. It must provide machine-readable entity definitions, accurate metadata, canonical URLs, and verifiable structured data.</p>
<p>The Hoberg Digital Research Desk audited 50 Nigerian businesses across banking, industrial manufacturing, fintech, energy, logistics, and e-commerce — including Dangote, BUA Group, GTBank, Zenith Bank, Flutterwave, Paystack, Jumia, and Interswitch — to benchmark how Nigerian corporate web properties perform across core discoverability signals.</p>

<figure class="article-figure">
  <img src="https://hoberg.com.ng/images/lekki-bridge.jpg" alt="Lekki-Ikoyi Link Bridge in Lagos, Nigeria" loading="lazy" width="1200" height="675">
  <figcaption>Lagos commercial corridor: where corporate credibility increasingly depends on structured digital and AI search signals. <span class="credit">Credit: Hoberg Digital</span></figcaption>
</figure>

<h2 id="audit-methodology">What the Audit Measured</h2>
<p>Each of the 50 websites in the dataset was evaluated against verifiable technical criteria:</p>
<div class="checklist">
  <ul>
    <li><strong>Document Title &amp; Meta Description Clarity:</strong> Whether pages declare specific, non-duplicate titles and summaries that accurately describe the organisation.</li>
    <li><strong>Schema.org JSON-LD Entity Markup:</strong> Presence and validity of <code>Organization</code>, <code>WebSite</code>, <code>Article</code>, and <code>FAQPage</code> structured data.</li>
    <li><strong>Crawler &amp; Bot Accessibility:</strong> Inspection of <code>robots.txt</code>, XML sitemaps, canonical tags, and HTTP status codes for search and AI retrieval crawlers.</li>
    <li><strong>Content Freshness &amp; Newsroom Structure:</strong> Availability of an active, crawlable company blog, newsroom, or official press archive with clear publication dates.</li>
    <li><strong>Mobile Viewport &amp; Core Rendering:</strong> Whether critical company facts are present in initial server/static HTML rather than hidden behind unindexed client scripts.</li>
  </ul>
</div>

<h2 id="access-the-report">Access the Full Dataset and Report</h2>
<p>In keeping with Hoberg Digital's commitment to transparent, verifiable research, the complete interactive report, printable PDF brief, and underlying 50-company Excel workbook are publicly accessible without a paywall:</p>
<ul>
  <li><strong>Interactive Web Report:</strong> <a href="https://hoberg.com.ng/research/2026-ai-visibility-report/">hoberg.com.ng/research/2026-ai-visibility-report/</a></li>
  <li><strong>PDF Publication:</strong> <a href="https://hoberg.com.ng/research/2026-ai-visibility-report/Hoberg_Report_2026.pdf">Hoberg_Report_2026.pdf</a></li>
  <li><strong>Master 50-Site Workbook:</strong> <a href="https://hoberg.com.ng/research/2026-ai-visibility-report/Hoberg_Master_50_Sites.xlsx">Hoberg_Master_50_Sites.xlsx</a></li>
</ul>

<div class="pull-note">
  <strong>Free AI Visibility Audit:</strong> Nigerian businesses can request a complimentary technical visibility audit from Hoberg Digital Agency or test their setup via <a href="https://hoberg.com.ng/services/digital-visibility/">Hoberg Digital Visibility Services</a>.
</div>

<h2 id="about-hoberg-digital">About Hoberg Digital</h2>
<p>Founded and owned by Goodluck Iyanu in Lagos, Nigeria, <a href="https://hoberg.com.ng/">Hoberg Digital</a> builds digital products, platforms, and agency services for Nigerians — spanning <a href="https://hoberg.com.ng/agency">Hoberg Digital Agency</a>, <a href="https://jobs.hoberg.com.ng/">Hoberg Jobs</a>, <a href="https://edu.hoberg.com.ng/">Hoberg Edu</a>, <a href="https://hoberg.com.ng/tools/">Hoberg Tools</a>, <a href="https://hoberg.com.ng/colebox">Colebox</a>, <a href="https://maji.hoberg.com.ng/">Maji by Hoberg</a>, <a href="https://healthnehome.hoberg.com.ng/">Healthnehome</a>, and sister company <a href="https://ficqs.hoberg.com/">FICQS</a>.</p>`,
    ctaHtml: `<p>Want to improve how your company appears on Google Search and AI answer platforms? Hoberg Digital Agency provides free initial visibility audits and full technical implementation for Nigerian businesses.</p>`,
    faqs: [
      {
        question: "What is AI search visibility?",
        answer: "AI visibility refers to how accurately AI-powered search and answer systems — such as ChatGPT Search, Perplexity, Google AI Overviews, and Microsoft Copilot — can crawl, verify, and cite your official website when users ask questions about your industry or company."
      },
      {
        question: "Where can I download the raw 50-company audit spreadsheet?",
        answer: "Both the PDF report (Hoberg_Report_2026.pdf) and the Excel dataset (Hoberg_Master_50_Sites.xlsx) are available for direct download on the report page and in the Press Kit links on this release."
      },
      {
        question: "Does structured data guarantee AI citations?",
        answer: "No configuration can force or guarantee citations by any search engine or AI model. However, clean crawlable HTML, accurate Schema.org JSON-LD, consistent entity attribution, and updated sitemaps remove technical barriers to legitimate discovery."
      }
    ],
    relatedSlugs: [
      "hoberg-digital-brand-and-ecosystem",
      "tikdrop-and-hoberg-web-tools-release",
      "best-website-design-company-nigeria",
      "corporate-website-design"
    ]
  },
  {
    id: "art-launch-hoberg-tools-tikdrop",
    slug: "tikdrop-and-hoberg-web-tools-release",
    legacyPath: null,
    title: "Hoberg Digital Expands Free Web Utilities Suite in Lagos: TikDrop, FileDrop, IMGDrop, and BGDrop",
    subtitle: "Fast, browser-based utilities built by Hoberg in Lagos for creators, marketers, and business teams across Nigeria.",
    summary: "Hoberg Digital announces its suite of web utilities at hoberg.com.ng/tools — featuring TikDrop for saving TikTok videos alongside FileDrop, IMGDrop, and BGDrop.",
    contentType: "product-launch",
    schemaType: "NewsArticle",
    category: "Digital Products & Tools",
    tags: ["Hoberg Tools", "TikDrop", "FileDrop", "IMGDrop", "BGDrop", "Product Launch", "Lagos"],
    authorId: "hoberg-digital",
    issuingOrganization: "Hoberg Digital",
    dateline: "LAGOS, NIGERIA",
    datePublished: "2026-08-25T10:00:00+01:00",
    dateModified: "2026-10-24T12:00:00+01:00",
    status: "published",
    featured: true,
    readingTime: "5 min read",
    featuredImage: {
      url: "https://hoberg.com.ng/tools/assets/og-image.png",
      alt: "Hoberg Tools suite preview featuring TikDrop, FileDrop, IMGDrop, and BGDrop",
      caption: "The Hoberg Tools hub at hoberg.com.ng/tools provides free web utilities engineered in Lagos.",
      credit: "Hoberg Digital",
      sourceUrl: "https://hoberg.com.ng/tools/",
      license: "Hoberg Digital Official Media"
    },
    inlineImages: [],
    video: null,
    pressKitLinks: [
      {
        label: "Open Hoberg Tools Hub",
        url: "https://hoberg.com.ng/tools/",
        fileType: "Web Platform"
      },
      {
        label: "Launch TikDrop Utility",
        url: "https://hoberg.com.ng/tools/tikdrop/",
        fileType: "Web Application"
      }
    ],
    references: [
      {
        title: "Hoberg Tools Hub",
        url: "https://hoberg.com.ng/tools/",
        publisher: "Hoberg Digital"
      },
      {
        title: "TikDrop by Hoberg",
        url: "https://hoberg.com.ng/tools/tikdrop/",
        publisher: "Hoberg Digital"
      }
    ],
    mediaContact: {
      name: "Goodluck Iyanu",
      role: "Founder & Owner, Hoberg Digital",
      organization: "Hoberg Digital",
      email: "hello@hoberg.com.ng",
      phone: "+234-810-428-9365",
      whatsapp: "https://wa.me/2348104289365",
      location: "Lagos, Nigeria"
    },
    seo: {
      title: "TikDrop & Hoberg Web Tools Suite Launch | Hoberg Digital Newsroom",
      description: "Discover TikDrop, FileDrop, IMGDrop, and BGDrop — free browser utilities built in Lagos by Hoberg Digital for creators and businesses.",
      canonicalUrl: "https://hoberg.com.ng/blog/tikdrop-and-hoberg-web-tools-release",
      ogImage: "https://hoberg.com.ng/tools/assets/og-image.png",
      noindex: false
    },
    bodyHtml: `<p class="intro-lede"><strong>LAGOS, NIGERIA —</strong> Hoberg Digital continues to expand its consumer and creator utility ecosystem at <a href="https://hoberg.com.ng/tools/">hoberg.com.ng/tools</a>, offering clean, fast browser tools built in Lagos — led by <a href="https://hoberg.com.ng/tools/tikdrop/">TikDrop</a> alongside FileDrop, IMGDrop, and BGDrop.</p>

<h2 id="why-hoberg-builds-tools">Why Hoberg Builds Public Web Utilities</h2>
<p>Alongside client engineering at <a href="https://hoberg.com.ng/agency">Hoberg Digital Agency</a>, Hoberg Digital builds and operates its own standalone software products. Shipping real utilities used directly in the browser keeps our engineering standards grounded in speed, mobile usability, and low-friction interfaces.</p>

<h2 id="tools-lineup">The Hoberg Tools Lineup</h2>
<ul>
  <li><strong><a href="https://hoberg.com.ng/tools/tikdrop/">TikDrop</a>:</strong> A straightforward TikTok video downloader web utility made by Hoberg for saving public TikTok videos through a clean browser interface.</li>
  <li><strong><a href="https://hoberg.com.ng/tools/">FileDrop</a>:</strong> Lightweight file transfer and sharing utility inside the Hoberg Tools ecosystem.</li>
  <li><strong><a href="https://hoberg.com.ng/tools/">IMGDrop</a>:</strong> Fast image conversion and optimisation tool for web and social workflows.</li>
  <li><strong><a href="https://hoberg.com.ng/tools/">BGDrop</a>:</strong> Quick background removal utility for product photos and marketing creatives.</li>
</ul>

<h2 id="availability">Availability</h2>
<p>All utilities are accessible through the central <a href="https://hoberg.com.ng/tools/">Hoberg Tools hub</a> on mobile and desktop browsers.</p>`,
    ctaHtml: `<p>Need a custom web application, internal business tool, or API workflow built for your company? Explore <a href="https://hoberg.com.ng/services/digital-systems/">Hoberg Digital Systems</a> or message our Lagos team on WhatsApp.</p>`,
    faqs: [
      {
        question: "What is TikDrop?",
        answer: "TikDrop is a browser-based TikTok downloader utility built by Hoberg Digital and hosted at https://hoberg.com.ng/tools/tikdrop/."
      },
      {
        question: "Where can I access all Hoberg web tools?",
        answer: "Visit https://hoberg.com.ng/tools/ to access TikDrop, FileDrop, IMGDrop, and BGDrop."
      }
    ],
    relatedSlugs: [
      "hoberg-digital-brand-and-ecosystem",
      "nigeria-2026-ai-search-visibility-report",
      "best-website-design-company-nigeria"
    ]
  },
  {
    id: "art-announce-hoberg-brand-ecosystem",
    slug: "hoberg-digital-brand-and-ecosystem",
    legacyPath: null,
    title: "Meet the Hoberg Digital Brand & Group Architecture: Agency, Jobs, Edu, Tools, Research, and Ventures",
    subtitle: "How Hoberg Digital unifies its digital agency, public platforms, original research desk, and group ventures under a single Lagos-built identity.",
    summary: "An official overview of the Hoberg Digital brand identity and group structure founded by Goodluck Iyanu in Lagos, Nigeria — spanning Agency, Jobs, Edu, Tools, Research, Colebox, Maji, Healthnehome, and FICQS.",
    contentType: "company-announcement",
    schemaType: "NewsArticle",
    category: "Press & Announcements",
    tags: ["Hoberg Digital", "Brand Identity", "Goodluck Iyanu", "Company Announcement", "Hoberg Jobs", "Hoberg Edu", "Colebox", "Lagos"],
    authorId: "goodluck-iyanu",
    issuingOrganization: "Hoberg Digital",
    dateline: "LAGOS, NIGERIA",
    datePublished: "2026-08-20T09:00:00+01:00",
    dateModified: "2026-10-24T12:00:00+01:00",
    status: "published",
    featured: true,
    readingTime: "6 min read",
    featuredImage: {
      url: "https://hoberg.com.ng/blog/assets/hoberg-brand-logo.png",
      alt: "Hoberg Digital Agency logo combining a red-and-white mark with a gold wordmark",
      caption: "The official Hoberg Digital Agency mark combines a bold crimson symbol, crisp white typography, and a refined gold wordmark.",
      credit: "Hoberg Digital",
      sourceUrl: "https://hoberg.com.ng/",
      license: "Hoberg Digital Official Brand Asset"
    },
    inlineImages: [],
    video: null,
    pressKitLinks: [
      {
        label: "Hoberg Digital Group Homepage",
        url: "https://hoberg.com.ng/",
        fileType: "Official Website"
      },
      {
        title: "Hoberg Brand Mark (PNG)",
        label: "Download Official Hoberg Brand Logo (PNG)",
        url: "https://hoberg.com.ng/blog/assets/hoberg-brand-logo.png",
        fileType: "PNG"
      },
      {
        label: "ColeBox × Hoberg Collaboration Brief",
        url: "https://hoberg.com.ng/colebox",
        fileType: "Web Brief"
      }
    ],
    references: [
      {
        title: "Hoberg Digital Official Group Map",
        url: "https://hoberg.com.ng/",
        publisher: "Hoberg Digital"
      },
      {
        title: "Hoberg Digital Agency",
        url: "https://hoberg.com.ng/agency",
        publisher: "Hoberg Digital"
      },
      {
        title: "Humans.txt — Founder & Verification Record",
        url: "https://hoberg.com.ng/humans.txt",
        publisher: "Hoberg Digital"
      }
    ],
    mediaContact: {
      name: "Goodluck Iyanu",
      role: "Founder & Owner, Hoberg Digital",
      organization: "Hoberg Digital",
      email: "hello@hoberg.com.ng",
      phone: "+234-810-428-9365",
      whatsapp: "https://wa.me/2348104289365",
      location: "Lagos, Nigeria"
    },
    seo: {
      title: "Meet the Hoberg Digital Brand & Ecosystem | Official Newsroom",
      description: "Official overview of the Hoberg Digital brand identity and group structure in Lagos, Nigeria — founded and owned by Goodluck Iyanu.",
      canonicalUrl: "https://hoberg.com.ng/blog/hoberg-digital-brand-and-ecosystem",
      ogImage: "https://hoberg.com.ng/blog/assets/hoberg-brand-logo.png",
      noindex: false
    },
    bodyHtml: `<p class="intro-lede"><strong>LAGOS, NIGERIA —</strong> Hoberg Digital operates as a unified Lagos technology and services group founded and owned by Goodluck Iyanu. From the group map at <a href="https://hoberg.com.ng/">hoberg.com.ng</a> to our dedicated agency, employment, scholarship, utility, and product divisions, every property shares a commitment to clarity, utility, and verifiable execution for Nigerians.</p>

<h2 id="brand-identity">The Hoberg Visual Identity</h2>
<p>The Hoberg Digital Agency mark combines a confident red-and-white symbol with a refined gold wordmark on deep obsidian black, paired with warm editorial paper tones across our group properties. The visual system was designed to feel bold, professional, and memorable — reflecting an organisation built to help Nigerian businesses stand out online.</p>

<h2 id="group-architecture">Group Doors &amp; Official Properties</h2>
<p>Hoberg Digital organises its activities into clear, dedicated doors so clients, job seekers, students, and partners can go straight to what they need:</p>
<ul>
  <li><strong><a href="https://hoberg.com.ng/agency">Hoberg Digital Agency</a> &amp; <a href="https://hoberg.com.ng/services">Services</a>:</strong> Websites, mobile apps, e-commerce, SEO, AI search visibility, content, ads, and custom software systems for Nigerian businesses across four service pillars — <a href="https://hoberg.com.ng/services/digital-presence/">Digital Presence</a>, <a href="https://hoberg.com.ng/services/digital-visibility/">Digital Visibility</a>, <a href="https://hoberg.com.ng/services/digital-growth/">Digital Growth</a>, and <a href="https://hoberg.com.ng/services/digital-systems/">Digital Systems</a>.</li>
  <li><strong><a href="https://jobs.hoberg.com.ng/">Hoberg Jobs</a>:</strong> Free job search and hiring platform for Nigerians. Job seekers never pay to apply.</li>
  <li><strong><a href="https://edu.hoberg.com.ng/">Hoberg Edu</a>:</strong> Discovery platform for verified study-abroad programmes and scholarships (admissions are decided by the official institutions).</li>
  <li><strong><a href="https://hoberg.com.ng/tools/">Hoberg Tools</a>:</strong> Free browser utilities built in Lagos, including <a href="https://hoberg.com.ng/tools/tikdrop/">TikDrop</a>, FileDrop, IMGDrop, and BGDrop.</li>
  <li><strong><a href="https://hoberg.com.ng/research/2026-ai-visibility-report/">Hoberg Research</a>:</strong> Original market notes, technical audits, and data reports from the Hoberg desk.</li>
  <li><strong>Ventures &amp; Products:</strong> <a href="https://hoberg.com.ng/colebox">Colebox</a>, <a href="https://maji.hoberg.com.ng/">Maji by Hoberg</a>, and <a href="https://healthnehome.hoberg.com.ng/">Healthnehome</a>.</li>
  <li><strong><a href="https://ficqs.hoberg.com/">FICQS</a>:</strong> A facility services sister company in the Hoberg group, operated separately from the digital products.</li>
</ul>

<h2 id="leadership-and-verification">Leadership &amp; Public Verification</h2>
<p>Hoberg Digital is founded and owned by <strong>Goodluck Iyanu</strong> (<a href="https://www.linkedin.com/in/goodluck-iyanu-54b63b434" target="_blank" rel="noopener noreferrer">LinkedIn</a>) in Lagos, Nigeria. Official announcements, product launches, partnerships, and research reports are published through this Newsroom at <a href="https://hoberg.com.ng/blog">hoberg.com.ng/blog</a>.</p>`,
    ctaHtml: `<p>Looking to hire Hoberg Digital Agency or collaborate with a Hoberg platform? Visit <a href="https://hoberg.com.ng/agency">hoberg.com.ng/agency</a> or reach our Lagos desk directly on WhatsApp.</p>`,
    faqs: [
      {
        question: "What is Hoberg Digital?",
        answer: "Hoberg Digital is a Lagos company that builds digital products and services for Nigerians: an agency, a job platform, a scholarship platform, tools, research and other ventures."
      },
      {
        question: "Who owns Hoberg Digital?",
        answer: "Goodluck Iyanu is the founder and owner of Hoberg Digital."
      },
      {
        question: "What is the relationship between Hoberg Digital and FICQS?",
        answer: "FICQS (https://ficqs.hoberg.com/) is a facility services sister company in the Hoberg group, separate from the digital products."
      }
    ],
    relatedSlugs: [
      "nigeria-2026-ai-search-visibility-report",
      "tikdrop-and-hoberg-web-tools-release",
      "best-website-design-company-nigeria",
      "corporate-website-design"
    ]
  },
  {
    id: "art-migrated-best-web-nigeria",
    slug: "best-website-design-company-nigeria",
    legacyPath: "/blog/articles/best-website-design-company-nigeria.html",
    title: "Best Website Design Company in Nigeria: How to Choose in 2026",
    subtitle: "What actually separates a serious website design company from a briefcase agency, and the exact things to check before you commit.",
    summary: "Looking for the best website design company in Nigeria? Learn what makes a reliable web design agency, what to verify before paying a deposit, and how Hoberg Digital Agency builds high-performing websites.",
    contentType: "editorial-guide",
    schemaType: "BlogPosting",
    category: "Buying Guides",
    tags: ["Website Design Nigeria", "Buying Guides", "Web Design Agency", "Lagos", "Hoberg Digital Agency"],
    authorId: "hoberg-digital-agency",
    issuingOrganization: "Hoberg Digital Agency",
    dateline: "LAGOS, NIGERIA",
    datePublished: "2026-08-01T08:00:00+01:00",
    dateModified: "2026-10-24T12:00:00+01:00",
    status: "published",
    featured: true,
    readingTime: "11 min read",
    featuredImage: {
      url: "https://hoberg.com.ng/blog/assets/best-website-design-company-nigeria.jpg",
      alt: "Best Website Design Company in Nigeria — Hoberg Digital Agency guide",
      caption: "How Nigerian business owners evaluate portfolio quality, mobile performance, and milestone accountability before hiring a web agency.",
      credit: "Hoberg Digital Agency",
      sourceUrl: "https://hoberg.com.ng/blog/best-website-design-company-nigeria",
      license: "Hoberg Digital Official Media"
    },
    inlineImages: [],
    video: null,
    pressKitLinks: [],
    references: [
      {
        title: "Hoberg Digital Presence Services",
        url: "https://hoberg.com.ng/services/digital-presence/",
        publisher: "Hoberg Digital Agency"
      },
      {
        title: "Website Design Cost in Nigeria: A Realistic Breakdown",
        url: "https://hoberg.com.ng/blog/website-design-cost-nigeria",
        publisher: "Hoberg Digital Newsroom"
      }
    ],
    mediaContact: null,
    seo: {
      title: "Best Website Design Company in Nigeria (2026) | Hoberg Digital Agency",
      description: "Looking for the best website design company in Nigeria? Learn what makes a great web design agency and why businesses trust Hoberg Digital Agency for professional website development.",
      canonicalUrl: "https://hoberg.com.ng/blog/best-website-design-company-nigeria",
      ogImage: "https://hoberg.com.ng/blog/assets/best-website-design-company-nigeria.jpg",
      noindex: false
    },
    bodyHtml: bestNigeriaMainHtml,
    ctaHtml: `<p>Hoberg Digital Agency is based in Lagos and works with businesses across Nigeria and beyond. We handle website design, development, SEO, content, and ads under one roof, with transparent milestone pricing and same-day WhatsApp communication.</p>`,
    faqs: bestNigeriaFaqs,
    relatedSlugs: [
      "website-design-company-lagos",
      "website-design-cost-nigeria",
      "ecommerce-website-development",
      "corporate-website-design"
    ]
  },
  {
    id: "art-migrated-web-company-lagos",
    slug: "website-design-company-lagos",
    legacyPath: "/blog/articles/website-design-company-lagos.html",
    title: "Website Design Company in Lagos: What to Look For Before You Hire",
    subtitle: "Lagos has more website design companies than almost anywhere else in Nigeria. That makes the choice bigger, not easier. Here's what actually matters.",
    summary: "Looking for a website design company in Lagos? Here is what local businesses should check for, from response time to post-launch support, before signing on.",
    contentType: "editorial-guide",
    schemaType: "BlogPosting",
    category: "Local Business",
    tags: ["Web Design Lagos", "Local Business", "Lagos Website Developers", "Website Design Nigeria", "Hoberg Digital Agency"],
    authorId: "hoberg-digital-agency",
    issuingOrganization: "Hoberg Digital Agency",
    dateline: "LAGOS, NIGERIA",
    datePublished: "2026-08-01T08:30:00+01:00",
    dateModified: "2026-08-23T20:38:54+01:00",
    status: "published",
    featured: true,
    readingTime: "10 min read",
    featuredImage: {
      url: "https://hoberg.com.ng/blog/assets/website-design-company-lagos.jpg",
      alt: "Lekki-Ikoyi Link Bridge in Lagos — Website Design Company in Lagos buyer's guide",
      caption: "Hiring a Lagos-based website design team brings local market context, same-timezone responsiveness, and practical payment knowledge.",
      credit: "Hoberg Digital Agency",
      sourceUrl: "https://hoberg.com.ng/blog/website-design-company-lagos",
      license: "Hoberg Digital Official Media"
    },
    inlineImages: [],
    video: null,
    pressKitLinks: [],
    references: [
      {
        title: "Hoberg Digital Agency Lagos",
        url: "https://hoberg.com.ng/agency",
        publisher: "Hoberg Digital"
      }
    ],
    mediaContact: null,
    seo: {
      title: "Website Design Company in Lagos | Hoberg Digital Agency",
      description: "Looking for a website design company in Lagos? Here is what local businesses should check for, from response time to post-launch support, before signing on.",
      canonicalUrl: "https://hoberg.com.ng/blog/website-design-company-lagos",
      ogImage: "https://hoberg.com.ng/blog/assets/website-design-company-lagos.jpg",
      noindex: false
    },
    bodyHtml: lagosParsed.mainHtml,
    ctaHtml: lagosParsed.ctaHtml,
    faqs: lagosParsed.faqs,
    relatedSlugs: [
      "website-design-cost-nigeria",
      "corporate-website-design",
      "ecommerce-website-development",
      "best-website-design-company-nigeria"
    ]
  },
  {
    id: "art-migrated-web-cost-nigeria",
    slug: "website-design-cost-nigeria",
    legacyPath: "/blog/articles/website-design-cost-nigeria.html",
    title: "Website Design Cost in Nigeria: A Realistic Breakdown",
    subtitle: "Website prices in Nigeria range hugely because 'a website' can mean very different things. Here's what actually drives the number up or down.",
    summary: "What does a website actually cost in Nigeria? A clear breakdown of the factors that affect pricing, without invented numbers or unrealistic promises.",
    contentType: "editorial-guide",
    schemaType: "BlogPosting",
    category: "Pricing",
    tags: ["Website Cost Nigeria", "Pricing", "Business Website Pricing", "Web Development Nigeria", "Hoberg Digital Agency"],
    authorId: "hoberg-digital-agency",
    issuingOrganization: "Hoberg Digital Agency",
    dateline: "LAGOS, NIGERIA",
    datePublished: "2026-08-01T09:00:00+01:00",
    dateModified: "2026-08-01T18:15:00+01:00",
    status: "published",
    featured: true,
    readingTime: "12 min read",
    featuredImage: {
      url: "https://hoberg.com.ng/blog/assets/website-design-cost-nigeria.jpg",
      alt: "National Theatre Lagos — Website Design Cost in Nigeria guide",
      caption: "Understanding how scope, custom design, functionality, and post-launch support determine website pricing in Nigeria.",
      credit: "Hoberg Digital Agency",
      sourceUrl: "https://hoberg.com.ng/blog/website-design-cost-nigeria",
      license: "Hoberg Digital Official Media"
    },
    inlineImages: [],
    video: null,
    pressKitLinks: [],
    references: [
      {
        title: "Hoberg Digital Agency Services & Starting Tiers",
        url: "https://hoberg.com.ng/services/digital-presence/",
        publisher: "Hoberg Digital"
      }
    ],
    mediaContact: null,
    seo: {
      title: "Website Design Cost in Nigeria (2026 Guide) | Hoberg Digital Agency",
      description: "What does a website actually cost in Nigeria? A clear breakdown of the factors that affect pricing, without invented numbers or unrealistic promises.",
      canonicalUrl: "https://hoberg.com.ng/blog/website-design-cost-nigeria",
      ogImage: "https://hoberg.com.ng/blog/assets/website-design-cost-nigeria.jpg",
      noindex: false
    },
    bodyHtml: costParsed.mainHtml,
    ctaHtml: costParsed.ctaHtml,
    faqs: costParsed.faqs,
    relatedSlugs: [
      "corporate-website-design",
      "ecommerce-website-development",
      "best-website-design-company-nigeria",
      "website-design-company-lagos"
    ]
  },
  {
    id: "art-migrated-ecommerce-nigeria",
    slug: "ecommerce-website-development",
    legacyPath: "/blog/articles/ecommerce-website-development.html",
    title: "E-commerce Website Development in Nigeria: What Your Store Actually Needs",
    subtitle: "An online store is more than a website with products on it. Here's what actually needs to be right before you launch one.",
    summary: "Planning an online store? Here is what e-commerce website development in Nigeria really involves, from Paystack and Flutterwave payment gateways to delivery logistics.",
    contentType: "editorial-guide",
    schemaType: "BlogPosting",
    category: "E-commerce",
    tags: ["E-commerce Nigeria", "Online Store Development", "Paystack Integration", "E-commerce", "Hoberg Digital Agency"],
    authorId: "hoberg-digital-agency",
    issuingOrganization: "Hoberg Digital Agency",
    dateline: "LAGOS, NIGERIA",
    datePublished: "2026-08-01T09:30:00+01:00",
    dateModified: "2026-08-01T18:20:00+01:00",
    status: "published",
    featured: false,
    readingTime: "13 min read",
    featuredImage: {
      url: "https://hoberg.com.ng/blog/assets/ecommerce-website-development.jpg",
      alt: "Nigerian Adire textile craft — E-commerce Website Development in Nigeria guide",
      caption: "Building an online store in Nigeria requires reliable local payment gateways, clear delivery pricing, and fast mobile checkout.",
      credit: "Hoberg Digital Agency",
      sourceUrl: "https://hoberg.com.ng/blog/ecommerce-website-development",
      license: "Hoberg Digital Official Media"
    },
    inlineImages: [],
    video: null,
    pressKitLinks: [],
    references: [
      {
        title: "Hoberg Digital Presence & E-commerce Builds",
        url: "https://hoberg.com.ng/services/digital-presence/",
        publisher: "Hoberg Digital"
      }
    ],
    mediaContact: null,
    seo: {
      title: "E-commerce Website Development in Nigeria | Hoberg Digital Agency",
      description: "Planning an online store? Here is what e-commerce website development in Nigeria really involves, from payment gateways to delivery logistics.",
      canonicalUrl: "https://hoberg.com.ng/blog/ecommerce-website-development",
      ogImage: "https://hoberg.com.ng/blog/assets/ecommerce-website-development.jpg",
      noindex: false
    },
    bodyHtml: ecommerceParsed.mainHtml,
    ctaHtml: ecommerceParsed.ctaHtml,
    faqs: ecommerceParsed.faqs,
    relatedSlugs: [
      "best-website-design-company-nigeria",
      "website-design-company-lagos",
      "website-design-cost-nigeria",
      "corporate-website-design"
    ]
  },
  {
    id: "art-migrated-corporate-design",
    slug: "corporate-website-design",
    legacyPath: "/blog/articles/corporate-website-design.html",
    title: "Corporate Website Design: Building a Site That Signals Trust",
    subtitle: "A corporate website has a different job from a typical small business site: it exists to make partners, investors and serious clients trust you before they ever call.",
    summary: "Corporate website design is about credibility, not decoration. Here is what makes a company website look established and trustworthy to serious clients.",
    contentType: "editorial-guide",
    schemaType: "BlogPosting",
    category: "Branding",
    tags: ["Corporate Website Design", "Branding", "Company Website Nigeria", "B2B Trust", "Hoberg Digital Agency"],
    authorId: "hoberg-digital-agency",
    issuingOrganization: "Hoberg Digital Agency",
    dateline: "LAGOS, NIGERIA",
    datePublished: "2026-08-01T10:00:00+01:00",
    dateModified: "2026-08-01T18:25:00+01:00",
    status: "published",
    featured: false,
    readingTime: "11 min read",
    featuredImage: {
      url: "https://hoberg.com.ng/blog/assets/corporate-website-design.jpg",
      alt: "Corporate Website Design in Nigeria — Hoberg Digital Agency",
      caption: "Corporate website architecture focuses on due-diligence clarity, leadership transparency, and fast mobile navigation.",
      credit: "Hoberg Digital Agency",
      sourceUrl: "https://hoberg.com.ng/blog/corporate-website-design",
      license: "Hoberg Digital Official Media"
    },
    inlineImages: [],
    video: null,
    pressKitLinks: [],
    references: [
      {
        title: "Hoberg Digital Agency Corporate & Presence Services",
        url: "https://hoberg.com.ng/services/digital-presence/",
        publisher: "Hoberg Digital"
      }
    ],
    mediaContact: null,
    seo: {
      title: "Corporate Website Design in Nigeria | Hoberg Digital Agency",
      description: "Corporate website design is about credibility, not decoration. Here is what makes a company website look established and trustworthy to serious clients.",
      canonicalUrl: "https://hoberg.com.ng/blog/corporate-website-design",
      ogImage: "https://hoberg.com.ng/blog/assets/corporate-website-design.jpg",
      noindex: false
    },
    bodyHtml: corporateParsed.mainHtml,
    ctaHtml: corporateParsed.ctaHtml,
    faqs: corporateParsed.faqs,
    relatedSlugs: [
      "ecommerce-website-development",
      "best-website-design-company-nigeria",
      "website-design-company-lagos",
      "website-design-cost-nigeria"
    ]
  }
];

fs.writeFileSync(path.join(DATA_DIR, 'articles.json'), JSON.stringify(articles, null, 2), 'utf8');

// Media asset registry
const mediaRegistry = [
  {
    id: "media-brand-logo",
    type: "image",
    title: "Hoberg Digital Agency Brand Logo",
    url: "https://hoberg.com.ng/blog/assets/hoberg-brand-logo.png",
    relativePath: "/blog/assets/hoberg-brand-logo.png",
    alt: "Hoberg Digital Agency logo and Digital Agency wordmark",
    caption: "Official Hoberg Digital Agency logo mark on dark background.",
    credit: "Hoberg Digital",
    sourceUrl: "https://hoberg.com.ng/",
    license: "Official Brand Asset — Hoberg Digital",
    width: 1280,
    height: 720,
    mimeType: "image/png",
    uploadedAt: "2026-08-01T08:00:00+01:00"
  },
  {
    id: "media-tools-og",
    type: "image",
    title: "Hoberg Tools Ecosystem Banner",
    url: "https://hoberg.com.ng/tools/assets/og-image.png",
    relativePath: "/tools/assets/og-image.png",
    alt: "Hoberg Tools — TikDrop, FileDrop, IMGDrop, BGDrop",
    caption: "Hoberg Tools suite built in Lagos, Nigeria.",
    credit: "Hoberg Digital",
    sourceUrl: "https://hoberg.com.ng/tools/",
    license: "Official Brand Asset — Hoberg Digital",
    width: 1200,
    height: 630,
    mimeType: "image/png",
    uploadedAt: "2026-08-25T10:00:00+01:00"
  },
  {
    id: "media-lagos-lagoon",
    type: "image",
    title: "Lagos Lagoon Aerial Poster",
    url: "https://hoberg.com.ng/images/lagos-lagoon-poster.jpg",
    relativePath: "/images/lagos-lagoon-poster.jpg",
    alt: "Aerial view of Lagos lagoon",
    caption: "Lagos lagoon and coastline in Lagos, Nigeria.",
    credit: "Hoberg Digital",
    sourceUrl: "https://hoberg.com.ng/",
    license: "Hoberg Digital Website Media",
    width: 1280,
    height: 720,
    mimeType: "image/jpeg",
    uploadedAt: "2026-08-01T08:00:00+01:00"
  },
  {
    id: "media-lekki-bridge",
    type: "image",
    title: "Lekki-Ikoyi Link Bridge, Lagos",
    url: "https://hoberg.com.ng/images/lekki-bridge.jpg",
    relativePath: "/images/lekki-bridge.jpg",
    alt: "Lekki-Ikoyi Link Bridge in Lagos, Nigeria",
    caption: "Lekki-Ikoyi Link Bridge in Lagos, Nigeria.",
    credit: "Hoberg Digital",
    sourceUrl: "https://hoberg.com.ng/",
    license: "Hoberg Digital Website Media",
    width: 1200,
    height: 800,
    mimeType: "image/jpeg",
    uploadedAt: "2026-08-01T08:00:00+01:00"
  },
  {
    id: "media-national-theatre",
    type: "image",
    title: "National Theatre, Lagos",
    url: "https://hoberg.com.ng/images/national-theatre.jpg",
    relativePath: "/images/national-theatre.jpg",
    alt: "National Theatre in Lagos, Nigeria",
    caption: "National Theatre landmark in Lagos, Nigeria.",
    credit: "Hoberg Digital",
    sourceUrl: "https://hoberg.com.ng/",
    license: "Hoberg Digital Website Media",
    width: 1200,
    height: 800,
    mimeType: "image/jpeg",
    uploadedAt: "2026-08-01T08:00:00+01:00"
  },
  {
    id: "media-adire",
    type: "image",
    title: "Nigerian Adire Textile",
    url: "https://hoberg.com.ng/images/adire.jpg",
    relativePath: "/images/adire.jpg",
    alt: "Adire cloth pattern",
    caption: "Traditional Nigerian Adire textile craftsmanship.",
    credit: "Hoberg Digital",
    sourceUrl: "https://hoberg.com.ng/",
    license: "Hoberg Digital Website Media",
    width: 1200,
    height: 800,
    mimeType: "image/jpeg",
    uploadedAt: "2026-08-01T08:00:00+01:00"
  },
  {
    id: "media-campus",
    type: "image",
    title: "Lagos Campus Walkway",
    url: "https://hoberg.com.ng/images/campus.jpg",
    relativePath: "/images/campus.jpg",
    alt: "Campus walkway in Lagos",
    caption: "Architectural walkway in Lagos, Nigeria.",
    credit: "Hoberg Digital",
    sourceUrl: "https://hoberg.com.ng/",
    license: "Hoberg Digital Website Media",
    width: 1200,
    height: 800,
    mimeType: "image/jpeg",
    uploadedAt: "2026-08-01T08:00:00+01:00"
  },
  {
    id: "media-colebox-og",
    type: "image",
    title: "ColeBox × Hoberg Collaboration Banner",
    url: "https://hoberg.com.ng/colebox/assets/colebox-hoberg-og.jpeg",
    relativePath: "/colebox/assets/colebox-hoberg-og.jpeg",
    alt: "ColeBox and Hoberg collaboration banner",
    caption: "ColeBox × Hoberg product partnership.",
    credit: "Hoberg Digital",
    sourceUrl: "https://hoberg.com.ng/colebox",
    license: "Hoberg Digital Official Media",
    width: 1200,
    height: 630,
    mimeType: "image/jpeg",
    uploadedAt: "2026-08-15T08:00:00+01:00"
  },
  {
    id: "media-video-lagoon",
    type: "video",
    title: "Lagos Lagoon Aerial Video",
    url: "https://hoberg.com.ng/videos/lagoon-hero.mp4",
    relativePath: "/videos/lagoon-hero.mp4",
    poster: "https://hoberg.com.ng/images/lagos-lagoon-poster.jpg",
    alt: "Lagos lagoon aerial video",
    caption: "Aerial video of Lagos lagoon.",
    credit: "Hoberg Digital",
    transcript: "Aerial footage of the Lagos lagoon and coastline in Lagos, Nigeria.",
    mimeType: "video/mp4",
    uploadedAt: "2026-08-01T08:00:00+01:00"
  },
  {
    id: "media-video-street",
    type: "video",
    title: "Lagos Street Motion Video",
    url: "https://hoberg.com.ng/videos/street-lite.mp4",
    relativePath: "/videos/street-lite.mp4",
    poster: "https://hoberg.com.ng/images/lagos-street.jpg",
    alt: "Lagos street life video",
    caption: "Street scene in Lagos, Nigeria.",
    credit: "Hoberg Digital",
    transcript: "Street-level footage in Lagos, Nigeria.",
    mimeType: "video/mp4",
    uploadedAt: "2026-08-01T08:00:00+01:00"
  }
];

fs.writeFileSync(path.join(DATA_DIR, 'media.json'), JSON.stringify(mediaRegistry, null, 2), 'utf8');

// Redirects registry (maps legacy /blog/articles/[slug].html and any renamed slugs to canonical /blog/[slug])
const redirects = [
  {
    from: "/blog/articles/best-website-design-company-nigeria.html",
    to: "/blog/best-website-design-company-nigeria",
    type: 301,
    reason: "Migrated legacy /blog/articles/*.html path to clean canonical /blog/[slug] URL while preserving legacy file.",
    createdAt: "2026-10-24T13:45:00+01:00"
  },
  {
    from: "/blog/articles/website-design-company-lagos.html",
    to: "/blog/website-design-company-lagos",
    type: 301,
    reason: "Migrated legacy /blog/articles/*.html path to clean canonical /blog/[slug] URL while preserving legacy file.",
    createdAt: "2026-10-24T13:45:00+01:00"
  },
  {
    from: "/blog/articles/website-design-cost-nigeria.html",
    to: "/blog/website-design-cost-nigeria",
    type: 301,
    reason: "Migrated legacy /blog/articles/*.html path to clean canonical /blog/[slug] URL while preserving legacy file.",
    createdAt: "2026-10-24T13:45:00+01:00"
  },
  {
    from: "/blog/articles/ecommerce-website-development.html",
    to: "/blog/ecommerce-website-development",
    type: 301,
    reason: "Migrated legacy /blog/articles/*.html path to clean canonical /blog/[slug] URL while preserving legacy file.",
    createdAt: "2026-10-24T13:45:00+01:00"
  },
  {
    from: "/blog/articles/corporate-website-design.html",
    to: "/blog/corporate-website-design",
    type: 301,
    reason: "Migrated legacy /blog/articles/*.html path to clean canonical /blog/[slug] URL while preserving legacy file.",
    createdAt: "2026-10-24T13:45:00+01:00"
  }
];

fs.writeFileSync(path.join(DATA_DIR, 'redirects.json'), JSON.stringify(redirects, null, 2), 'utf8');

if (!fs.existsSync(path.join(DATA_DIR, 'revisions.json'))) {
  fs.writeFileSync(path.join(DATA_DIR, 'revisions.json'), JSON.stringify([], null, 2), 'utf8');
}

console.log(`Successfully migrated ${articles.length} articles, ${mediaRegistry.length} media assets, and ${redirects.length} canonical redirects.`);
