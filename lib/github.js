// lib/github.js
// Commit the regenerated index.html to the GitHub Pages repo. Fetches the
// current file SHA (required for updates) then PUTs the new content. GitHub
// Pages redeploys automatically on push, so this is the deploy trigger too.

async function commitFile({ html, message }) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO; // e.g. PEgan-OM/ees-schedule
  const path = process.env.GITHUB_PATH || 'index.html';
  const branch = process.env.GITHUB_BRANCH || 'main';
  const api = `https://api.github.com/repos/${repo}/contents/${path}`;

  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ees-schedule-webhook',
  };

  // Current SHA (may not exist on first run).
  let sha;
  const sr = await fetch(`${api}?ref=${branch}`, { headers });
  if (sr.ok) sha = (await sr.json()).sha;

  const content = Buffer.from(html, 'utf-8').toString('base64');
  const pr = await fetch(api, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: message || `Refresh EES schedule ${new Date().toISOString()}`,
      content,
      branch,
      ...(sha ? { sha } : {}),
    }),
  });

  const body = await pr.json();
  if (!pr.ok) throw new Error(`GitHub commit failed (${pr.status}): ${JSON.stringify(body)}`);
  return { status: pr.status, commit: body.commit?.sha };
}

module.exports = { commitFile };
