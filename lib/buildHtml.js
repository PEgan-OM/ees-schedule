// lib/buildHtml.js
// Builds the EES weekly-schedule page. Markup, colors, and layout are kept
// byte-for-byte consistent with the manual update-ees-schedule skill so the
// published site looks identical whether refreshed by hand or by webhook.
//
// The page renders multiple weeks (current + next) with a tab toggle so the
// office can look ahead without leaving the page. Pass a single { sched, dates }
// (legacy) or a { weeks: [{ title, dates, sched }, ...] } object.

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

// Build a single week's grid (header row + tech rows) as an HTML string.
function weekGrid({ sched, dates }) {
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

  return `<div class="grid" style="grid-template-columns:${gc}">${hdr}${rows}</div>`;
}

function buildHtml(input) {
  // Accept legacy single-week shape or the new multi-week shape.
  const weeks =
    input && input.weeks
      ? input.weeks
      : [{ title: `Week of ${input.dates[0]}`, dates: input.dates, sched: input.sched }];

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

  const tabs = weeks
    .map(
      (w, i) =>
        `<button class="wtab" onclick="showWeek(${i})" style="border:none;cursor:pointer;font-size:13px;font-weight:bold;padding:6px 14px;margin-right:6px;border-radius:4px;color:#fff;background:${
          i === 0 ? '#1565c0' : '#9fa8da'
        }">${w.title}</button>`
    )
    .join('');

  const panels = weeks
    .map(
      (w, i) =>
        `<div class="weekpanel" style="display:${i === 0 ? 'block' : 'none'}">${weekGrid(w)}</div>`
    )
    .join('');

  // Timestamp shown to the office. Rendered in US Eastern so it reads as local
  // time regardless of where the serverless function or CI runner executes.
  const updated = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'short',
  });

  const script =
    `<script>function showWeek(n){` +
    `var p=document.querySelectorAll('.weekpanel');for(var i=0;i<p.length;i++)p[i].style.display=(i===n?'block':'none');` +
    `var t=document.querySelectorAll('.wtab');for(var j=0;j<t.length;j++)t[j].style.background=(j===n?'#1565c0':'#9fa8da');}</script>`;

  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>EES Schedule</title>` +
    `<style>body{margin:0;font-family:Arial,sans-serif;background:#f5f5f5}` +
    `.hdr{background:#1a237e;color:#fff;padding:14px 20px;display:flex;justify-content:space-between;align-items:center}` +
    `.tabs{background:#fff;padding:10px 16px;border-bottom:1px solid #ddd}` +
    `.leg{background:#fff;padding:8px 16px;border-bottom:1px solid #ddd}` +
    `.grid{display:grid;border:1px solid #ddd;background:#fff;margin:12px}` +
    `.grid>div{border-bottom:1px solid #eee;min-height:36px}</style></head><body>` +
    `<div class="hdr"><span style="font-size:18px;font-weight:bold">Eastern Electric Solutions — Weekly Schedule</span>` +
    `<span style="font-size:12px;opacity:.8">Updated: ${updated}</span></div>` +
    `<div class="tabs">${tabs}</div>` +
    `<div class="leg">${leg}</div>` +
    `${panels}${script}</body></html>`
  );
}

module.exports = { buildHtml, colorFor, weekGrid };
