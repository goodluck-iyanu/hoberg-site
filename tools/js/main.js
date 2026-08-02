/* ===========================================================
   TIKDROP — FRONTEND SCRIPT

   IMPORTANT — READ BEFORE DEPLOYING:
   This file handles UI only. Actual video resolution (turning a
   TikTok link into a no-watermark MP4 URL) MUST happen on a
   server, not in this browser script — TikTok blocks direct
   cross-origin requests from a browser, and the extraction logic
   changes often enough that it needs a backend you control.

   This script expects a backend endpoint at:
     POST /api/resolve   body: { url: "<tiktok link>" }
     → responds: { title, author, thumbnail, noWatermarkUrl, hdUrl }

   See /server-example/resolve.example.js for a reference
   implementation you can deploy on your own server. Until that
   endpoint exists, the form below will show a clear "not
   connected yet" message instead of failing silently.
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
      });
    });
  }

  /* ---------- Paste button ---------- */
  var pasteBtn = document.getElementById('pasteBtn');
  var urlInput = document.getElementById('tiktokUrl');
  if (pasteBtn && urlInput) {
    pasteBtn.addEventListener('click', async function () {
      try {
        var text = await navigator.clipboard.readText();
        if (text) urlInput.value = text.trim();
        urlInput.focus();
      } catch (err) {
        urlInput.focus();
      }
    });
  }

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

  /* ---------- Download flow ---------- */
  var form = document.getElementById('downloadForm');
  var statusLine = document.getElementById('statusLine');
  var resultCard = document.getElementById('resultCard');
  var submitBtn = document.getElementById('submitBtn');

  function isLikelyTikTokUrl(value) {
    return /tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com/i.test(value);
  }

  function setStatus(message, type) {
    statusLine.textContent = message || '';
    statusLine.className = 'status-line' + (type ? ' ' + type : '');
  }

  function renderResult(data) {
    document.getElementById('resultTitle').textContent = data.title || 'TikTok video';
    document.getElementById('resultAuthor').textContent = data.author ? '@' + data.author : '';
    document.getElementById('resultSd').href = data.noWatermarkUrl || '#';
    document.getElementById('resultHd').href = data.hdUrl || data.noWatermarkUrl || '#';
    resultCard.classList.add('show');
  }

  if (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var value = urlInput.value.trim();
      resultCard.classList.remove('show');

      if (!value) {
        setStatus('Paste a TikTok video link first.', 'error');
        return;
      }
      if (!isLikelyTikTokUrl(value)) {
        setStatus('That doesn\'t look like a TikTok link. Copy the share link from the TikTok app and try again.', 'error');
        return;
      }

      submitBtn.disabled = true;
      setStatus('Processing your link…');
      var originalBtnText = submitBtn.textContent;
      submitBtn.innerHTML = '<span class="spinner"></span> Processing';

      try {
        var response = await fetch('/api/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: value })
        });

        if (!response.ok) {
          throw new Error('backend-not-connected');
        }

        var data = await response.json();
        renderResult(data);
        setStatus('Ready — pick a download option below.', 'success');
      } catch (err) {
        // The resolve backend isn't wired up yet — see resolve.example.js
        setStatus('The download backend isn\'t connected yet. See /server-example for the API this form expects.', 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
      }
    });
  }

});
