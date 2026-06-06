// refresh.js — self-contained EES schedule refresher for GitHub Actions.
// Pulls 8 weeks from Simpro, rebuilds index.html with week tabs.
//
// Required env (GitHub repository secrets):
//   SIMPRO_CLIENT_ID, SIMPRO_CLIENT_SECRET, SIMPRO_USERNAME, SIMPRO_PASSWORD
// Optional: SIMPRO_BASE_URL, SIMPRO_COMPANY_ID

const fs = require('fs');
const BASE = process.env.SIMPRO_BASE_URL || 'https://easternelectricsolutions.simprosuite.com';
const COMPANY = process.env.SIMPRO_COMPANY_ID || '0';
const NUM_WEEKS = 8;

async function getToken() {
  const r = await fetch(`${BASE}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'password', client_id: process.env.SIMPRO_CLIENT_ID, client_secret: process.env.SIMPRO_CLIENT_SECRET, username: process.env.SIMPRO_USERNAME, password: process.env.SIMPRO_PASSWORD }) });
  const d = await r.json();
  if (!d.access_token) throw new Error(`Simpro token failed (${r.status})`);
  return d.access_token;
}

function weekRange(ref = new Date()) {
  const d = new Date(ref), day = (d.getUTCDay() + 6) % 7;
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - day);
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  return { start: mon.toISOString().slice(0,10), end: sun.toISOString().slice(0,10) };
}

const col = (t) => { const l = (t||'').toLowerCase();
  if (l.includes('public holiday')) return ['#fce4ec','#e91e63','Public Holiday'];
  if (l.includes('unpaid time off')) return ['#ffebee','#c62828','Unpaid Time Off'];
  if (l.includes('time off')) return ['#ffebee','#c62828','Time Off'];
  if (l.includes('warehouse')) return ['#fff8e1','#f9a825','Warehouse'];
  if (l.includes('meeting')) return ['#ede7f6','#6a1b9a','Meeting'];
  if (l.includes('job')) return ['#e3f2fd','#1565c0','Job'];
  return ['#f5f5f5','#555',t]; };

async function fetchWeek(api, ref, actMap, jobCache) {
  const { start, end } = weekRange(ref);
  const rows = [];
  for (const t of ['job','activity']) {
    try { const p = await api(`/schedules/?Date=between(${start},${end})&Type=${t}&pageSize=250`); if (Array.isArray(p)) rows.push(...p); } catch(e) { console.error(e.message); }
  }
  const jobIds = [...new Set(rows.filter(s=>s.Type==='job').map(s=>s.Project&&s.Project.ProjectID).filter(id=>id&&!(id in jobCache)))];
  for (const id of jobIds) {
    try { const j = await api(`/jobs/${id}`); jobCache[id] = { name: j.Name||j.Description||'', customer: (j.Customer&&(j.Customer.CompanyName||[j.Customer.GivenName,j.Customer.FamilyName].filter(Boolean).join(' ').trim()))||'', site: (j.Site&&j.Site.Name)||'' }; } catch(e) { console.error(e.message); }
  }
  const fmt = (s,b) => {
    const time = [b.StartTime,b.EndTime].filter(Boolean).map(t=>String(t).slice(0,5)).join('\u2013');
    if (s.Type==='job') { const j=(s.Project&&jobCache[s.Project.ProjectID])||{}; return ['Job',[j.name,j.customer].filter(Boolean).join(' \u2014 ')||s.Reference||'Job',j.site||'',time,''].join(' | '); }
    return [actMap[String(s.Reference)]||(b.ScheduleRate&&b.ScheduleRate.Name)||'Activity','','',time,''].join(' | ');
  };
  const sched = {};
  for (const s of rows) {
    const name=(s.Staff&&s.Staff.Name)||'Unassigned', blocks=(s.Blocks&&s.Blocks.length)?s.Blocks:[{}];
    for (const b of blocks) { const date=(s.Date||'').slice(0,10); if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue; (sched[name]=sched[name]||{}); (sched[name][date]=sched[name][date]||[]).push(fmt(s,b)); }
  }
  const dates=[], cur=new Date(start+'T00:00:00Z'), last=new Date(end+'T00:00:00Z');
  while(cur<=last){dates.push(cur.toISOString().slice(0,10));cur.setUTCDate(cur.getUTCDate()+1);}
  return {start,end,dates,sched,techs:Object.keys(sched).length};
}

function weekGrid({sched,dates}) {
  const today=new Date().toISOString().slice(0,10), gc='160px '+dates.map(()=>'1fr').join(' ');
  const hdr='<div></div>'+dates.map(d=>`<div style="font-weight:bold;text-align:center;padding:4px;${d===today?'background:#e3f2fd;border:2px solid #1565c0;':''}">${d}</div>`).join('');
  let body='';
  Object.keys(sched).sort().forEach(t=>{
    body+=`<div style="padding:6px 8px;font-weight:500;border-right:1px solid #ddd;background:#fafafa">${t}</div>`;
    dates.forEach(d=>{
      let c=`<div style="padding:4px;${d===today?'background:#e8f5e9;':''}">`;
      (sched[t][d]||[]).forEach(raw=>{const p=raw.split(' | ');const [bg,br,lbl]=col(p[0]||raw);c+=`<div style="background:${bg};border-left:4px solid ${br};border-radius:3px;padding:4px 6px;margin-bottom:3px;font-size:12px"><b>${lbl}</b>${p[1]?'<br>'+p[1]:''}${p[2]?'<br><span style="color:#555">'+p[2]+'</span>':''}${p[3]?'<br>'+p[3]:''}${p[4]?'<br><i>'+p[4]+'</i>':''}</div>`;});
      body+=c+'</div>';
    });
  });
  return `<div class="grid" style="grid-template-columns:${gc}">${hdr}${body}</div>`;
}

async function main() {
  const token=await getToken();
  const api=async(p)=>{const r=await fetch(`${BASE}/api/v1.0/companies/${COMPANY}${p}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});if(!r.ok)throw new Error(`GET ${p} -> ${r.status}`);return r.json();};
  const actMap={};
  try{const acts=await api('/setup/activities/?pageSize=250');if(Array.isArray(acts))acts.forEach(a=>(actMap[String(a.ID)]=a.Name));}catch(e){console.error(e.message);}
  const jobCache={},base=new Date(),weeks=[];
  for(let i=0;i<NUM_WEEKS;i++){
    const ref=new Date(base);ref.setUTCDate(base.getUTCDate()+i*7);
    const w=await fetchWeek(api,ref,actMap,jobCache);
    w.title=`${i===0?'This Week':i===1?'Next Week':'+'+i+' Weeks'} (${w.start})`;
    weeks.push(w);
  }
  const totalTechs=weeks.reduce((n,w)=>n+w.techs,0);
  if(!totalTechs){console.error('No schedule rows; leaving index.html unchanged.');process.exit(0);}
  const leg=[['Job','#e3f2fd','#1565c0'],['Public Holiday','#fce4ec','#e91e63'],['Unpaid Time Off','#ffebee','#c62828'],['Warehouse','#fff8e1','#f9a825'],['Meeting','#ede7f6','#6a1b9a']].map(([l,bg,bc])=>`<span style="background:${bg};border-left:4px solid ${bc};display:inline-block;padding:2px 8px;margin-right:8px;border-radius:3px;font-size:12px">${l}</span>`).join('');
  const tabs=weeks.map((w,i)=>`<button class="wtab" onclick="showWeek(${i})" style="border:none;cursor:pointer;font-size:13px;font-weight:bold;padding:6px 14px;margin-right:6px;border-radius:4px;color:#fff;background:${i===0?'#1565c0':'#9fa8da'}">${w.title}</button>`).join('');
  const panels=weeks.map((w,i)=>`<div class="weekpanel" style="display:${i===0?'block':'none'}">${weekGrid(w)}</div>`).join('');
  const updated=new Date().toLocaleString('en-US',{timeZone:'America/New_York',timeZoneName:'short'});
  const script=`<script>function showWeek(n){var p=document.querySelectorAll('.weekpanel');for(var i=0;i<p.length;i++)p[i].style.display=(i===n?'block':'none');var t=document.querySelectorAll('.wtab');for(var j=0;j<t.length;j++)t[j].style.background=(j===n?'#1565c0':'#9fa8da');}<\/script>`;
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>EES Schedule</title><style>body{margin:0;font-family:Arial,sans-serif;background:#f5f5f5}.hdr{background:#1a237e;color:#fff;padding:14px 20px;display:flex;justify-content:space-between;align-items:center}.tabs{background:#fff;padding:10px 16px;border-bottom:1px solid #ddd}.leg{background:#fff;padding:8px 16px;border-bottom:1px solid #ddd}.grid{display:grid;border:1px solid #ddd;background:#fff;margin:12px}.grid>div{border-bottom:1px solid #eee;min-height:36px}</style></head><body><div class="hdr"><span style="font-size:18px;font-weight:bold">Eastern Electric Solutions \u2014 Weekly Schedule</span><span style="font-size:12px;opacity:.8">Updated: ${updated}</span></div><div class="tabs">${tabs}</div><div class="leg">${leg}</div>${panels}${script}</body></html>`;
  fs.writeFileSync('index.html',html);
  console.log(`Wrote index.html \u2014 ${totalTechs} techs across ${weeks.length} weeks.`);
}

main().catch(e=>{console.error(e);process.exit(1);});
