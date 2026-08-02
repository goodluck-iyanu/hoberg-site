/**
 * TIKDROP — REFERENCE BACKEND (NOT INCLUDED IN THE STATIC SITE)
 * =================================================================
 * The frontend (js/main.js) calls:
 *     POST /api/resolve   body: { url: "<tiktok link>" }
 *     → expects: { title, author, thumbnail, noWatermarkUrl, hdUrl }
 *
 * TikTok does not offer a public, stable API for extracting a
 * no-watermark video URL, and browsers can't call TikTok directly
 * anyway (CORS). This step has to run on a server you control.
 *
 * This example wires an Express route to a maintained open-source
 * TikTok-resolving library rather than hand-rolling scraping logic
 * here — those libraries get updated when TikTok changes its
 * internal endpoints, which happens often. You'll still need to:
 *   1. Pick and vet a library (search npm for TikTok downloader
 *      libraries, check recent commit activity before trusting one).
 *   2. Deploy this on real Node hosting — it will NOT run inside
 *      the static /tools/tikdrop/ folder on GitHub Pages, since
 *      GitHub Pages only serves static files, no server code.
 *   3. Review TikTok's Terms of Service for your jurisdiction and
 *      use case before running this in production — redistributing
 *      another platform's video content raises its own legal and
 *      policy questions that are worth getting proper advice on.
 *
 * Install (example): npm install express cors
 * Then install a TikTok-resolving library of your choice and swap
 * the resolveTikTok() function below to call it.
 */

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Simple in-memory rate limiter (swap for Redis in production)
const requestLog = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 20;
  const entry = requestLog.get(ip) || [];
  const recent = entry.filter((t) => now - t < windowMs);
  recent.push(now);
  requestLog.set(ip, recent);
  return recent.length > maxRequests;
}

/**
 * Replace this with a call into a real TikTok-resolving library.
 * It must return an object shaped like:
 *   { title, author, thumbnail, noWatermarkUrl, hdUrl }
 * or throw if the link is invalid / can't be resolved.
 */
async function resolveTikTok(tiktokUrl) {
  throw new Error(
    "resolveTikTok() is a placeholder — wire it up to a TikTok " +
    "resolving library before deploying this route."
  );
}

app.post("/api/resolve", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Try again in a minute." });
  }

  const { url } = req.body || {};
  const isTikTokUrl = typeof url === "string" && /tiktok\.com/i.test(url);

  if (!isTikTokUrl) {
    return res.status(400).json({ error: "Please provide a valid TikTok video URL." });
  }

  try {
    const result = await resolveTikTok(url);
    return res.json(result);
  } catch (err) {
    console.error("resolveTikTok failed:", err.message);
    return res.status(502).json({ error: "Could not process that link right now." });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("TikDrop resolve API listening");
});

module.exports = app;
