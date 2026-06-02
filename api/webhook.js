// api/webhook.js — Vercel serverless function (Node).
// Simpro fires this on schedule create/update/delete. We re-pull the current
// week from the Simpro API, rebuild the HTML, and commit to GitHub. Re-pulling
// the whole week (rather than patching one block) keeps the output idempotent
// and always consistent with Simpro.

const { fetchWeek } = require('../lib/simpro');
const { buildHtml } = require('../lib/buildHtml');
const { commitFile } = require('../lib/github');

module.exports = async (req, res) => {
  // Health check / manual trigger via GET.
  const isPost = req.method === 'POST';
  if (!isPost && req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  // Shared-secret check. Configure Simpro to send ?token=... or an
  // X-Webhook-Secret header; reject anything that doesn't match.
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

  try {
    // Simpro's payload includes the affected schedule's date; use it to pick
    // the right week. Fall back to "now" if absent. Body may arrive parsed or raw.
    let payload = req.body;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch { payload = {}; }
    }
    payload = payload || {};
    const refDate =
      payload.date || payload.Date || payload?.reference?.date || undefined;

    const { sched, dates, start, end, techs } = await fetchWeek(refDate);

    if (!techs) {
      // Acknowledge so Simpro doesn't retry-storm, but report the empty pull.
      res.status(200).json({ ok: false, reason: 'no schedule rows returned', start, end });
      return;
    }

    const html = buildHtml({ sched, dates });
    const commit = await commitFile({
      html,
      message: `Auto-refresh EES schedule (${start}→${end}) ${new Date().toISOString()}`,
    });

    res.status(200).json({ ok: true, techs, start, end, htmlLen: html.length, commit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
};
