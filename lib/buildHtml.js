// lib/buildHtml.js
// Builds the EES weekly-schedule page. Markup, colors, and layout are kept
// byte-for-byte consistent with the manual update-ees-schedule skill so the
// published site looks identical whether refreshed by hand or by webhook.

function colorFor(t) {
  const l = (t || '').toLowerCase();
  if (l.includes('public holiday')) return ['#fce4ec', '#e91e63', 'Public Holiday'];
  if (l.includes('unpaid time off')) return ['#ffebee', '#c62828', 'Unpaid Time Off'];
  if (l.includes('time off')) return ['#ffebee', '#c62828', 'Time Off'];
  if (l.includes('warehouse')) return ['#fff8e1', '#f9a825', 'Warehouse'];
  if (l.includes('meeting')) return ['#ede7f6', '#6a1b9a', 'Meeting'];
  if (l.includes('job')) return ['#e3f2fd', '#1565c0', 'Job'];
  return ['#f5f5f5', '#555', t];
}

function buildHtml({ sched, dates }) {
  const today = new Date().toISOString().slice(0, 10);
  const gc = '160px ' + dates.map(() => '1fr').join(' ');
  const hdr =
    '<div></div>' +
    dates
      .map(
        (d) =>
          `<div style="font-weight:bold;text-align:center;padding:4px;${
            d === today ? 'background:#e3f2fd;border:2px solid #1565c0;' : ''
          }">${d}</div>`
      )
      .join('');

  let rows = '';
  Object.keys(sched)
    .sort()
    .forEach((t) => {
      rows += `<div style="padding:6px 8px;font-weight:500;border-right:1px solid #ddd;background:#fafafa">${t}</div>`;
      dates.forEach((d) => {
        let c = `<div style="padding:4px;${d === today ? 'background:#e8f5e9;' : ''}">`;
        (sched[t][d] || []).forEach((raw) => {
          const p = raw.split(' | ');
          const [bg, br, lbl] = colorFor(p[0] || raw);
          c +=
            `<div style="background:${bg};border-left:4px solid ${br};border-radius:3px;padding:4px 6px;margin-bottom:3px;font-size:12px">` +
            `<b>${lbl}</b>` +
            (p[1] ? '<br>' + p[1] : '') +
            (p[2] ? '<br><span style="color:#555">' + p[2] + '</span>' : '') +
            (p[3] ? '<br>' + p[3] : '') +
            (p[4] ? '<br><i>' + p[4] + '</i>' : '') +
            (p[5] ? '<br><span style="color:#777">' + p[5] + '</span>' : '') +
            `</div>`;
        });
        rows += c + '</div>';
      });
    });

  const leg = [
    ['Job', '#e3f2fd', '#1565c0'],
    ['Public Holiday', '#fce4ec', '#e91e63'],
    ['Unpaid Time Off', '#ffebee', '#c62828'],
    ['Warehouse', '#fff8e1', '#f9a825'],
    ['Meeting', '#ede7f6', '#6a1b9a'],
  ]
    .map(
      ([l, bg, bc]) =>
        `<span style="background:${bg};border-left:4px solid ${bc};display:inline-block;padding:2px 8px;margin-right:8px;border-radius:3px;font-size:12px">${l}</span>`
    )
    .join('');

  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>EES Schedule</title>` +
    `<style>body{margin:0;font-family:Arial,sans-serif;background:#f5f5f5}` +
    `.hdr{background:#1a237e;color:#fff;padding:14px 20px;display:flex;justify-content:space-between;align-items:center}` +
    `.leg{background:#fff;padding:8px 16px;border-bottom:1px solid #ddd}` +
    `.grid{display:grid;grid-template-columns:${gc};border:1px solid #ddd;background:#fff;margin:12px}` +
    `.grid>div{border-bottom:1px solid #eee;min-height:36px}</style></head><body>` +
    `<div class="hdr"><span style="font-size:18px;font-weight:bold">Eastern Electric Solutions — Week of ${dates[0]}</span>` +
    `<span style="font-size:12px;opacity:.8">Updated: ${new Date().toLocaleString()}</span></div>` +
    `<div class="leg">${leg}</div><div class="grid">${hdr}${rows}</div></body></html>`
  );
}

module.exports = { buildHtml, colorFor };
