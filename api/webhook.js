// api/webhook.js — Vercel serverless function (Node).
// Simpro fires this on schedule create/update/delete. Fetches 8 weeks of
// schedule data from Simpro, rebuilds index.html, and commits directly to
// the GitHub Pages repo — no GitHub Actions dependency.
//
// Required Vercel env vars:
//   WEBHOOK_SECRET         — shared secret sent by Simpro as ?token=...
//   GITHUB_DISPATCH_TOKEN  — fine-grained PAT (Contents: read+write on ees-schedule repo)
//   GITHUB_REPO            — e.g. PEgan-OM/ees-schedule
//   SIMPRO_CLIENT_ID, SIMPRO_CLIENT_SECRET, SIMPRO_USERNAME, SIMPRO_PASSWORD
// Optional:
//   SIMPRO_BASE_URL        — defaults to EES tenant
//   SIMPRO_COMPANY_ID      — defaults to 0

const { fetchWeeks } = require('../lib/simpro');
const { buildHtml }  = require('../lib/buildHtml');
const { commitFile } = require('../lib/github');

const NUM_WEEKS = 8;

module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  // Shared-secret check. Simpro sends ?token=... in the callback URL.
  const secret = process.env.WEBHOOK_SECRET;
  if (secret) {
    const provided =
      req.headers['x-webhook-secret'] ||
      (req.query && req.query.token) ||
      '';
    if (provided !== secret) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
  }

  // lib/github.js reads GITHUB_TOKEN; the Vercel env var is GITHUB_DISPATCH_TOKEN.
  if (!process.env.GITHUB_TOKEN && process.env.GITHUB_DISPATCH_TOKEN) {
    process.env.GITHUB_TOKEN = process.env.GITHUB_DISPATCH_TOKEN;
  }

  try {
    const { weeks, totalTechs } = await fetchWeeks(null, NUM_WEEKS);

    if (!totalTechs) {
      console.warn('No schedule rows returned from Simpro — skipping commit.');
      res.status(200).json({ ok: true, skipped: true, reason: 'no data' });
      return;
    }

    const html = buildHtml({ weeks });
    const result = await commitFile({
      html,
      message: `Refresh EES schedule ${new Date().toISOString()}`,
    });

    res.status(200).json({
      ok: true,
      techs: totalTechs,
      weeks: weeks.length,
      commit: result,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
};
