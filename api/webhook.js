// api/webhook.js — Vercel serverless function (Node).
// Simpro fires this on schedule create/update/delete. Rather than committing
// to GitHub directly (which requires a PAT that expires), we simply trigger
// the "Refresh EES Schedule" GitHub Actions workflow via workflow_dispatch.
// The workflow runs refresh.js using the built-in GITHUB_TOKEN, which never
// expires and never needs rotation.
//
// Required Vercel env vars:
//   WEBHOOK_SECRET        — shared secret sent by Simpro as ?token=...
//   GITHUB_DISPATCH_TOKEN — classic PAT (workflow scope, no expiry)
//   GITHUB_REPO           — e.g. PEgan-OM/ees-schedule

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

    try {
          const token = process.env.GITHUB_DISPATCH_TOKEN;
          const repo  = process.env.GITHUB_REPO; // e.g. PEgan-OM/ees-schedule

      if (!token || !repo) {
              throw new Error('GITHUB_DISPATCH_TOKEN or GITHUB_REPO not configured');
      }

      // Trigger the "Refresh EES Schedule" workflow. GitHub returns 204 on success.
      const r = await fetch(
              `https://api.github.com/repos/${repo}/actions/workflows/refresh.yml/dispatches`,
        {
                  method: 'POST',
                  headers: {
                              Authorization: `token ${token}`,
                              Accept: 'application/vnd.github+json',
                              'Content-Type': 'application/json',
                              'User-Agent': 'ees-schedule-webhook',
                  },
                  body: JSON.stringify({ ref: 'main' }),
        }
            );

      if (!r.ok) {
              const body = await r.json().catch(() => ({}));
              throw new Error(`workflow dispatch failed (${r.status}): ${JSON.stringify(body)}`);
      }

      // 204 No Content from GitHub means the workflow was queued successfully.
      res.status(200).json({ ok: true, dispatched: true });
    } catch (err) {
          console.error(err);
          res.status(500).json({ ok: false, error: String(err.message || err) });
    }
};
