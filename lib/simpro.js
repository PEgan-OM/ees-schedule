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

// Sunday → Saturday week, mirroring how Simpro displays the schedule.
function weekRange(ref = new Date()) {
  const d = new Date(ref);
  const day = d.getUTCDay(); // 0 = Sunday
  const sunday = new Date(d);
  sunday.setUTCDate(d.getUTCDate() - day);
  const saturday = new Date(sunday);
  saturday.setUTCDate(sunday.getUTCDate() + 6);
  const iso = (x) => x.toISOString().slice(0, 10);
  return { start: iso(sunday), end: iso(saturday) };
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

// Load the activity ID → name map (one call). Returns {} on failure.
async function loadActivityMap(api) {
  const activityMap = {};
  try {
    const acts = await api(`/setup/activities/?pageSize=250`);
    if (Array.isArray(acts)) acts.forEach((a) => (activityMap[String(a.ID)] = a.Name));
  } catch (e) {
    console.error(e.message);
  }
  return activityMap;
}

// Pull + normalize one week using a shared api, activity map, and job cache.
// jobCache persists across weeks so each job is resolved at most once.
async function fetchWeekWith(api, refDate, activityMap, jobCache) {
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

  // Resolve each unique job once (skip any already cached from prior weeks).
  const jobIds = [
    ...new Set(
      rows
        .filter((s) => s.Type === 'job')
        .map((s) => s.Project && s.Project.ProjectID)
        .filter((id) => id && !(id in jobCache))
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

  // Full Sun–Sat column set. Anchor to explicit UTC midnight so the day-of-week
  // header always parses cleanly (see fmtDate in buildHtml.js).
  const dates = [];
  const cur = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return { sched, dates, start, end, techs: Object.keys(sched).length };
}

// Backward-compatible single-week fetch (own token + activity map).
async function fetchWeek(refDate) {
  const token = await getToken();
  const api = makeApi(token);
  const activityMap = await loadActivityMap(api);
  return fetchWeekWith(api, refDate, activityMap, {});
}

function weekTitle(i, start) {
  const label = i === 0 ? 'This Week' : i === 1 ? 'Next Week' : `+${i} Weeks`;
  return `${label} (${start})`;
}

// Fetch several consecutive weeks starting from the week of refDate.
// Returns { weeks: [{ title, start, end, dates, sched, techs }], totalTechs }.
async function fetchWeeks(refDate, numWeeks = 8) {
  const base = refDate ? new Date(refDate) : new Date();
  // Authenticate once and share the activity map + job cache across all weeks
  // so we don't re-auth or re-resolve the same jobs N times (keeps the
  // serverless function well under its execution-time limit at 8 weeks).
  const token = await getToken();
  const api = makeApi(token);
  const activityMap = await loadActivityMap(api);
  const jobCache = {};

  const weeks = [];
  for (let i = 0; i < numWeeks; i++) {
    const ref = new Date(base);
    ref.setUTCDate(base.getUTCDate() + i * 7);
    const w = await fetchWeekWith(api, ref, activityMap, jobCache);
    weeks.push({
      title: weekTitle(i, w.start),
      start: w.start,
      end: w.end,
      dates: w.dates,
      sched: w.sched,
      techs: w.techs,
    });
  }
  return { weeks, totalTechs: weeks.reduce((n, w) => n + w.techs, 0) };
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

module.exports = { fetchWeek, fetchWeeks, weekRange, getToken };
