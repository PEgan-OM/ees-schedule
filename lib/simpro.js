// lib/simpro.js
// Simpro REST API client: OAuth token + weekly schedule fetch + normalization.
// Field mapping verified against the live EES tenant (company 0).
//
// The /schedules list endpoint is intentionally minimal — it returns Staff,
// Date, Blocks (with StartTime/EndTime), Type ("job"|"activity"), and a
// Reference. It does NOT include customer/site/job/activity names, so we
// enrich:
//   - job schedules     → GET /jobs/{ProjectID}  (Customer, Site, Name)  [cached]
//   - activity schedules → GET /setup/activities/ (ID → Name map)        [once]

const BASE = process.env.SIMPRO_BASE_URL; // https://easternelectricsolutions.simprosuite.com
const COMPANY_ID = process.env.SIMPRO_COMPANY_ID || '0';

async function getToken() {
  const body = new URLSearchParams({
    grant_type: process.env.SIMPRO_GRANT_TYPE || 'password',
    client_id: process.env.SIMPRO_CLIENT_ID,
    client_secret: process.env.SIMPRO_CLIENT_SECRET,
  });
  if ((process.env.SIMPRO_GRANT_TYPE || 'password') === 'password') {
    body.set('username', process.env.SIMPRO_USERNAME);
    body.set('password', process.env.SIMPRO_PASSWORD);
  }
  const r = await fetch(`${BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`Simpro token failed (${r.status}): ${JSON.stringify(d)}`);
  return d.access_token;
}

function weekRange(ref = new Date()) {
  const d = new Date(ref);
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - day);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const iso = (x) => x.toISOString().slice(0, 10);
  return { start: iso(monday), end: iso(sunday) };
}

function makeApi(token) {
  return async function apiGet(path) {
    const r = await fetch(`${BASE}/api/v1.0/companies/${COMPANY_ID}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`Simpro GET ${path} -> ${r.status}`);
    return r.json();
  };
}

async function fetchWeek(refDate) {
  const token = await getToken();
  const api = makeApi(token);
  const { start, end } = weekRange(refDate);

  // Pull both job and activity schedule rows for the week.
  const rows = [];
  for (const t of ['job', 'activity']) {
    try {
      const page = await api(
        `/schedules/?Date=between(${start},${end})&Type=${t}&pageSize=250`
      );
      if (Array.isArray(page)) rows.push(...page);
    } catch (e) {
      console.error(e.message);
    }
  }

  // Build activity ID → name map (one call).
  const activityMap = {};
  try {
    const acts = await api(`/setup/activities/?pageSize=250`);
    if (Array.isArray(acts)) acts.forEach((a) => (activityMap[String(a.ID)] = a.Name));
  } catch (e) {
    console.error(e.message);
  }

  // Resolve each unique job once.
  const jobCache = {};
  const jobIds = [
    ...new Set(
      rows
        .filter((s) => s.Type === 'job')
        .map((s) => s.Project && s.Project.ProjectID)
        .filter(Boolean)
    ),
  ];
  for (const id of jobIds) {
    try {
      const j = await api(`/jobs/${id}`);
      jobCache[id] = {
        name: j.Name || j.Description || '',
        customer:
          (j.Customer &&
            (j.Customer.CompanyName ||
              [j.Customer.GivenName, j.Customer.FamilyName].filter(Boolean).join(' ').trim())) ||
          '',
        site: (j.Site && j.Site.Name) || '',
      };
    } catch (e) {
      console.error(e.message);
    }
  }

  // Normalize into { name: { date: [rawLabel] } }.
  const sched = {};
  for (const s of rows) {
    const name = (s.Staff && s.Staff.Name) || 'Unassigned';
    const blocks = Array.isArray(s.Blocks) && s.Blocks.length ? s.Blocks : [{}];
    for (const b of blocks) {
      const date = (s.Date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (!sched[name]) sched[name] = {};
      if (!sched[name][date]) sched[name][date] = [];
      sched[name][date].push(formatLabel(s, b, jobCache, activityMap));
    }
  }

  // Full Mon–Sun column set.
  const dates = [];
  const cur = new Date(start);
  const last = new Date(end);
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return { sched, dates, start, end, techs: Object.keys(sched).length };
}

/**
 * Raw ' | '-delimited label consumed by buildHtml:
 *   part0 kind   → drives color (must contain Job / Time Off / Public Holiday / Meeting / Warehouse)
 *   part1 title  → "Job Name — Customer"  or activity name
 *   part2 site
 *   part3 time   → "HH:MM–HH:MM"
 */
function formatLabel(s, b, jobCache, activityMap) {
  const time = [b.StartTime, b.EndTime]
    .filter(Boolean)
    .map((t) => String(t).slice(0, 5))
    .join('–');

  if (s.Type === 'job') {
    const j = (s.Project && jobCache[s.Project.ProjectID]) || {};
    const title = [j.name, j.customer].filter(Boolean).join(' — ') || s.Reference || 'Job';
    return ['Job', title, j.site || '', time, ''].join(' | ');
  }

  // activity: Reference is the activity ID; fall back to the block's rate name.
  const actName =
    activityMap[String(s.Reference)] ||
    (b.ScheduleRate && b.ScheduleRate.Name) ||
    'Activity';
  return [actName, '', '', time, ''].join(' | ');
}

module.exports = { fetchWeek, weekRange, getToken };
