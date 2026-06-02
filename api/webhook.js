// api/webhook.js — Vercel serverless function (Node).
// Simpro fires this on schedule create/update/delete. We re-pull the current
// week from the Simpro API, rebuild the HTML, and commit to GitHub. Re-pulling
// the whole week (rather than patching one block) keeps the output idempotent
// and always consistent with Simpro.

const { fetchWeeks } = require('../lib/simpro');
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
    // Always rebuild from the current week onward (8 weeks ahead),
    // regardless of which week the edited schedule belonged to. This keeps the
    // published page anchored to "now" so the timestamp refreshes on every
    // event and the next-week view stays available — instead of bailing out
    // when the edited week happens to have no rows.
    const { weeks, totalTechs } = await fetchWeeks(undefined, 8);

    if (!totalTechs) {
      // Acknowledge so Simpro doesn't retry-storm, but report the empty pull.
      res.status(200).json({ ok: false, reason: 'no schedule rows returned' });
      return;
    }

    const html = buildHtml({ weeks });
    const span = `${weeks[0].start}→${weeks[weeks.length - 1].end}`;
    const commit = await commitFile({
      html,
      message: `Auto-refresh EES schedule (${span}) ${new Date().toISOString()}`,
    });

    res.status(200).json({ ok: true, totalTechs, span, htmlLen: html.length, commit });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
};
