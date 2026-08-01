/* ===========================================================
   HOBERG DIGITAL AGENCY — BLOG SCRIPT
   Mobile nav, article search/filter, FAQ accordion, newsletter
   =========================================================== */

document.addEventListener('DOMContentLoaded', function () {

  /* ---------- Mobile nav toggle ---------- */
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
  }

  /* ---------- Blog search / filter (index page) ---------- */
  var searchInput = document.getElementById('blogSearch');
  var searchForm = document.getElementById('searchForm');
  var searchEmpty = document.querySelector('.search-empty');
  var searchableCards = document.querySelectorAll('[data-search-card]');

  function runSearch(term) {
    term = term.trim().toLowerCase();
    var anyVisible = false;
    searchableCards.forEach(function (card) {
      var haystack = (card.getAttribute('data-title') + ' ' + card.getAttribute('data-keywords')).toLowerCase();
      var match = term === '' || haystack.indexOf(term) !== -1;
      card.style.display = match ? '' : 'none';
      if (match) anyVisible = true;
    });
    if (searchEmpty) {
      searchEmpty.style.display = (!anyVisible && term !== '') ? 'block' : 'none';
    }
  }

  if (searchForm) {
    searchForm.addEventListener('submit', function (e) {
      e.preventDefault();
      runSearch(searchInput.value);
      var targetSection = document.getElementById('latest');
      if (targetSection) targetSection.scrollIntoView({ behavior: 'smooth' });
    });
  }
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      runSearch(searchInput.value);
    });
  }

  /* ---------- Category filter chips (index page) ---------- */
  document.querySelectorAll('[data-category-filter]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var cat = chip.getAttribute('data-category-filter');
      if (searchInput) searchInput.value = '';
      searchableCards.forEach(function (card) {
        var match = cat === 'all' || card.getAttribute('data-category') === cat;
        card.style.display = match ? '' : 'none';
      });
      var targetSection = document.getElementById('latest');
      if (targetSection) targetSection.scrollIntoView({ behavior: 'smooth' });
    });
  });

  /* ---------- FAQ accordion ---------- */
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
          openItem.querySelector('.faq-answer').style.maxHeight = null;
          openItem.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
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

  /* ---------- Newsletter form (front-end only, no backend wired) ---------- */
  var newsletterForm = document.getElementById('newsletterForm');
  if (newsletterForm) {
    newsletterForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var successMsg = newsletterForm.parentElement.querySelector('.newsletter-success');
      var emailInput = newsletterForm.querySelector('input[type="email"]');
      if (emailInput && emailInput.value) {
        newsletterForm.style.display = 'none';
        if (successMsg) successMsg.style.display = 'block';
      }
    });
  }

  /* ---------- Highlight active TOC link on scroll (article pages) ---------- */
  var tocLinks = document.querySelectorAll('.toc-box a');
  if (tocLinks.length) {
    var headings = Array.prototype.map.call(tocLinks, function (link) {
      return document.querySelector(link.getAttribute('href'));
    }).filter(Boolean);

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          tocLinks.forEach(function (l) { l.style.color = ''; l.style.fontWeight = ''; });
          var activeLink = document.querySelector('.toc-box a[href="#' + entry.target.id + '"]');
          if (activeLink) {
            activeLink.style.color = '#C8001A';
            activeLink.style.fontWeight = '700';
          }
        }
      });
    }, { rootMargin: '-100px 0px -70% 0px' });

    headings.forEach(function (h) { observer.observe(h); });
  }

});
