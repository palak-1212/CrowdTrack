/* ═══════════════════════════════════════════════════════════
   CrowdTrack — script.js
   Backend coordination: reads data.txt & suggestion.txt
   ═══════════════════════════════════════════════════════════ */

'use strict';

// ════════════════════════════════════════════════════════════
// CONSTANTS & STATE
// ════════════════════════════════════════════════════════════
const DATA_FILE       = 'data.txt';
const SUGGESTION_FILE = 'suggestion.txt';
const CAM_BASE_URL    = 'http://127.0.0.1:5000';
const MAX_ZONE        = 120;
const MAX_HISTORY     = 60;
const PRED_WINDOW     = 5;
const THRESH_WARN     = Math.round(MAX_ZONE * 0.63);
const THRESH_CRIT     = Math.round(MAX_ZONE * 0.84);

const ZONES = [
  { key:'zone1',  name:'Zone A', sub:'Main Stage',    gate:'Gate 1', col:'#3b82f6' },
  { key:'zone2',  name:'Zone B', sub:'Food Court',    gate:'Gate 1', col:'#10b981' },
  { key:'zone3',  name:'Zone C', sub:'Exhibition',    gate:'Gate 2', col:'#f59e0b' },
  { key:'zone4',  name:'Zone D', sub:'Outdoor Arena', gate:'Gate 2', col:'#8b5cf6' },
];
const GATES = [
  { key:'entry1', name:'Gate 1' },
  { key:'entry2', name:'Gate 2' },
];

let currentData   = { zone1:0, zone2:0, zone3:0, zone4:0, entry1:0, entry2:0, total:0 };
let history       = { zone1:[], zone2:[], zone3:[], zone4:[], entry1:[], entry2:[], total:[] };
let sessionMax    = { zone1:0, zone2:0, zone3:0, zone4:0, entry1:0, entry2:0 };
let sessionSums   = { zone1:0, zone2:0, zone3:0, zone4:0 };
let sessionCounts = { zone1:0, zone2:0, zone3:0, zone4:0 };
let alerts        = [];
let reportLog     = [];
let startTime     = Date.now();
let alertDebounce = {};
let currentModalZone = null;

let suggestionsData = [];
let sugFilter       = 'all';
let incidentsData   = [];
let alertFilter     = 'all';
let currentSeverity = 'green';

let liveCamPeak    = 0;
let camOnline      = false;

// ════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════
function tryLogin() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value.trim();
  if ((u && p) || (u === 'admin' && p === 'admin')) {
    document.getElementById('s-login').classList.remove('active');
    const main = document.getElementById('s-main');
    main.classList.add('active');
    main.style.display = 'flex';
    const av = u.substring(0,2).toUpperCase();
    document.getElementById('userAvatar').textContent = av;
    document.getElementById('userName').textContent   = u;
    startApp();
  } else {
    document.getElementById('loginErr').style.display = 'block';
  }
}

function logout() {
  document.getElementById('s-main').classList.remove('active');
  document.getElementById('s-main').style.display = 'none';
  document.getElementById('s-login').classList.add('active');
  document.getElementById('loginErr').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  ['loginUser','loginPass'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') tryLogin();
    });
  });
});

// ════════════════════════════════════════════════════════════
// APP BOOT
// ════════════════════════════════════════════════════════════
function startApp() {
  updateClock();
  setInterval(updateClock, 1000);
  tick();
  setInterval(tick, 2000);
  fetchSuggestions();
  setInterval(fetchSuggestions, 5000);
  fetchAlertFile();
  setInterval(fetchAlertFile, 3000);
  setInterval(pollCameraCount, 1500);
}

// ════════════════════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════════════════════
const TAB_TITLES = {
  't-overview':    'Overview & Predictions',
  't-monitor':     'Monitor',
  't-zones':       'Zones',
  't-suggestions': 'Suggestions',
  't-alerts':      'Alerts & Incidents',
  't-camera':      'Live Camera',
  't-report':      'Reports',
};

function showTab(id, el) {
  document.querySelectorAll('.tab-page').forEach(t => t.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
  if (el) {
    el.classList.add('active');
    if (el.id === 'nav-alerts') applyAlertTabColor();
  }
  document.getElementById('topbarTitle').textContent = TAB_TITLES[id] || id;
  if (id === 't-monitor') {
    setTimeout(drawRYGDensity, 50);
    setTimeout(() => updateBarChart(currentData), 80);
    setTimeout(() => updateGateBarChart(currentData), 100);
    setTimeout(drawCameras, 120);
    setTimeout(drawHeatmap, 140);
  }
  if (id === 't-report') renderReport();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

function updateClock() {
  document.getElementById('topbarTime').textContent =
    new Date().toLocaleTimeString('en-GB', { hour12: false });
}

// ════════════════════════════════════════════════════════════
// DATA FETCH (data.txt → sensor readings)
// ════════════════════════════════════════════════════════════
async function tick() {
  let d = null;
  try {
    const res = await fetch(DATA_FILE, { cache: 'no-store' });
    if (!res.ok) throw new Error('file unavailable');
    const txt = await res.text();
    d = parseDataText(txt);
    if (!d) throw new Error('parse failed');
  } catch (_) {
    d = simulateData();
  }
  const total = (d.zone1||0)+(d.zone2||0)+(d.zone3||0)+(d.zone4||0);
  d.total = total;
  d.occupancy_pct = Math.round(total / (MAX_ZONE * 4) * 100);
  d.capacity = MAX_ZONE * 4;
  d.timestamp = Date.now();
  currentData = d;
  processData(d);
}

function simulateData() {
  const drift = (k, max) => {
    const old = (currentData[k] !== undefined) ? currentData[k] : 40;
    return Math.max(0, Math.min(max, old + Math.floor(Math.random() * 11) - 5));
  };
  return {
    zone1:  drift('zone1',  MAX_ZONE),
    zone2:  drift('zone2',  MAX_ZONE),
    zone3:  drift('zone3',  MAX_ZONE),
    zone4:  drift('zone4',  MAX_ZONE),
    entry1: drift('entry1', 60),
    entry2: drift('entry2', 60),
  };
}

function parseDataText(raw) {
  const clean = raw.trim();
  if (!clean) return null;
  try { return normalizeIncomingData(JSON.parse(clean)); } catch(_) {}
  const out = {};
  clean.split(/\r?\n/).forEach(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const m = t.match(/^([a-zA-Z0-9_]+)\s*[:=]\s*(-?\d+(?:\.\d+)?)$/);
    if (m) out[m[1].toLowerCase()] = Number(m[2]);
  });
  return normalizeIncomingData(out);
}

function normalizeIncomingData(data) {
  if (!data || typeof data !== 'object') return null;
  const flat = {};
  Object.entries(data).forEach(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.entries(v).forEach(([sk, sv]) => flat[(k+sk).toLowerCase()] = Number(sv));
    } else { flat[k.toLowerCase()] = Number(v); }
  });
  return {
    zone1:  Number.isFinite(flat.zone1)  ? flat.zone1  : 0,
    zone2:  Number.isFinite(flat.zone2)  ? flat.zone2  : 0,
    zone3:  Number.isFinite(flat.zone3)  ? flat.zone3  : 0,
    zone4:  Number.isFinite(flat.zone4)  ? flat.zone4  : 0,
    entry1: Number.isFinite(flat.entry1) ? flat.entry1 : 0,
    entry2: Number.isFinite(flat.entry2) ? flat.entry2 : 0,
  };
}

// ════════════════════════════════════════════════════════════
// PROCESS DATA → UPDATE UI
// ════════════════════════════════════════════════════════════
function processData(d) {
  ZONES.forEach(z => {
    history[z.key].push(d[z.key] || 0);
    if (history[z.key].length > MAX_HISTORY) history[z.key].shift();
    sessionMax[z.key]    = Math.max(sessionMax[z.key], d[z.key] || 0);
    sessionSums[z.key]  += (d[z.key] || 0);
    sessionCounts[z.key]++;
  });
  GATES.forEach(g => {
    history[g.key].push(d[g.key] || 0);
    if (history[g.key].length > MAX_HISTORY) history[g.key].shift();
    sessionMax[g.key] = Math.max(sessionMax[g.key], d[g.key] || 0);
  });
  history.total.push(d.total || 0);
  if (history.total.length > MAX_HISTORY) history.total.shift();

  const pred = computePrediction(history.total, 'total');
  reportLog.unshift({
    time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
    z1: d.zone1, z2: d.zone2, z3: d.zone3, z4: d.zone4,
    e1: d.entry1, e2: d.entry2, total: d.total,
    occ: d.occupancy_pct, prediction: pred.label,
  });
  if (reportLog.length > 100) reportLog.pop();

  updateStats(d);
  renderZoneGrid(d);
  renderZonesFullGrid(d);
  renderGateGrid(d);
  renderPrediction(d);
  drawTrendChart();
  checkInternalAlerts(d, new Date());

  const monitorActive = document.getElementById('t-monitor').classList.contains('active');
  if (monitorActive) {
    drawRYGDensity();
    updateBarChart(d);
    updateGateBarChart(d);
    drawHeatmap();
    drawCameras();
  }
}

// ════════════════════════════════════════════════════════════
// STATS
// ════════════════════════════════════════════════════════════
function statusOf(v) {
  if (v >= THRESH_CRIT) return 'high';
  if (v >= THRESH_WARN) return 'medium';
  return 'low';
}

function updateStats(d) {
  const total = d.total || 0;
  const occ   = d.occupancy_pct || 0;
  setEl('statTotal',  total);
  setEl('statOccPct', `${occ}% of capacity`);

  let peakZone = ZONES[0], peakVal = 0;
  ZONES.forEach(z => { if ((d[z.key]||0) > peakVal) { peakVal = d[z.key]; peakZone = z; } });
  const ps = statusOf(peakVal);
  setEl('statPeak',    peakZone.name);
  setEl('statPeakVal', `${peakVal} people`);
  const pc = document.getElementById('statPeakCard');
  if (pc) pc.className = `stat-card ${ps==='high'?'danger':ps==='medium'?'warn':''}`;

  setEl('statGate1', d.entry1 || 0);
  setEl('statGate2', d.entry2 || 0);

  const activeAlerts = alerts.filter(a => !a.cleared).length;
  setEl('statAlerts', activeAlerts);
  const ac = document.getElementById('statAlertCard');
  if (ac) ac.className = `stat-card${activeAlerts > 0 ? ' danger' : ''}`;

  const totalSessions = Object.values(sessionCounts).reduce((a,b) => a+b, 0);
  const totalSums     = Object.values(sessionSums).reduce((a,b) => a+b, 0);
  const sessAvg = totalSessions > 0 ? Math.round(totalSums / totalSessions) : 0;
  const sessMax = Object.values(sessionMax).reduce((a,b) => a+b, 0);
  setEl('metricSessionAvg', sessAvg);
  setEl('metricSessionMax', sessMax);
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const mm = String(Math.floor(uptime/60)).padStart(2,'0');
  const ss = String(uptime % 60).padStart(2,'0');
  setEl('metricUptime',  `${mm}:${ss}`);
  setEl('metricDataPts', history.total.length);

  const badge    = document.getElementById('topAlertBadge');
  const navBadge = document.getElementById('navAlertCount');
  if (activeAlerts > 0) {
    if (badge)    { badge.style.display = 'flex'; badge.textContent = activeAlerts; }
    if (navBadge) { navBadge.style.display = 'inline'; navBadge.textContent = activeAlerts; }
  } else {
    if (badge)    badge.style.display = 'none';
    if (navBadge) navBadge.style.display = 'none';
  }
}

// ════════════════════════════════════════════════════════════
// ZONE GRID
// ════════════════════════════════════════════════════════════
function renderZoneGrid(d) {
  const grid = document.getElementById('zoneGrid');
  if (!grid) return;
  let anyHigh = false, anyMed = false;
  grid.innerHTML = ZONES.map(z => {
    const v   = d[z.key] || 0;
    const pct = Math.round(v / MAX_ZONE * 100);
    const s   = statusOf(v);
    const col = s==='high'?'var(--high)':s==='medium'?'var(--med)':'var(--low)';
    if (s==='high')   anyHigh = true;
    if (s==='medium') anyMed  = true;
    return `<div class="zone-card" onclick="openModal('${z.key}')">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div class="zone-card-name">${z.name}</div>
          <div class="zone-card-sub">${z.sub}</div>
        </div>
        <span class="zone-status-chip" style="background:${col}18;color:${col}">${s.toUpperCase()}</span>
      </div>
      <div class="zone-card-count" style="color:${col}">${v}</div>
      <div class="zone-bar-wrap">
        <div class="zone-bar" style="width:${pct}%;background:${col}"></div>
      </div>
      <div class="zone-card-footer">
        <span>${pct}% capacity</span><span>Max ${MAX_ZONE}</span>
      </div>
    </div>`;
  }).join('');
  const badge = document.getElementById('overviewZoneBadge');
  if (badge) {
    if (anyHigh)     { badge.textContent='CRITICAL'; badge.style.cssText='border-color:var(--danger);color:var(--danger)'; }
    else if (anyMed) { badge.textContent='CAUTION';  badge.style.cssText='border-color:var(--warn);color:var(--warn)'; }
    else             { badge.textContent='ALL CLEAR'; badge.style.cssText='border-color:var(--accent);color:var(--accent)'; }
  }
}

// ════════════════════════════════════════════════════════════
// ZONES FULL GRID
// ════════════════════════════════════════════════════════════
function renderZonesFullGrid(d) {
  const grid = document.getElementById('zonesFullGrid');
  if (!grid) return;
  grid.innerHTML = ZONES.map(z => {
    const v   = d[z.key] || 0;
    const pct = Math.round(v / MAX_ZONE * 100);
    const s   = statusOf(v);
    const col = s==='high'?'var(--high)':s==='medium'?'var(--med)':'var(--low)';
    const pred = computePrediction(history[z.key], z.key);
    return `<div class="zone-full-card" onclick="openModal('${z.key}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
        <div>
          <div style="font-size:.95rem;font-weight:700">${z.name} — ${z.sub}</div>
          <div style="font-size:.65rem;font-family:var(--font-mono);color:var(--muted);margin-top:2px">Gateway: ${z.gate}</div>
        </div>
        <span class="zone-status-chip" style="background:${col}18;color:${col}">${s.toUpperCase()}</span>
      </div>
      <div style="font-size:2.2rem;font-weight:700;font-family:var(--font-mono);color:${col};margin-bottom:10px">${v}</div>
      <div class="zone-bar-wrap" style="margin-bottom:10px">
        <div class="zone-bar" style="width:${pct}%;background:${col}"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:.68rem;font-family:var(--font-mono);color:var(--muted);margin-bottom:10px">
        <span>${pct}% of ${MAX_ZONE} capacity</span>
        <span>Session Max: ${sessionMax[z.key]}</span>
      </div>
      <div style="font-size:.75rem;font-family:var(--font-mono);color:${pred.trend==='increasing'?'var(--danger)':pred.trend==='decreasing'?'var(--success)':'var(--accent)'}">
        Trend: ${pred.label}
      </div>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════
// GATE GRID
// ════════════════════════════════════════════════════════════
function renderGateGrid(d) {
  const grid = document.getElementById('gateGrid');
  if (!grid) return;
  const maxFlow = 60;
  grid.innerHTML = GATES.map(g => {
    const v   = d[g.key] || 0;
    const pct = Math.min(100, Math.round(v / maxFlow * 100));
    const col = v > 45 ? 'var(--danger)' : v > 25 ? 'var(--warn)' : 'var(--success)';
    return `<div class="gate-row">
      <span class="gate-name">${g.name}</span>
      <div class="gate-bar-outer"><div class="gate-bar-inner" style="width:${pct}%;background:${col}"></div></div>
      <span class="gate-val" style="color:${col}">${v}</span>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════
// PREDICTION ENGINE
// ════════════════════════════════════════════════════════════
function computePrediction(hist, label) {
  if (!hist || hist.length < PRED_WINDOW)
    return { trend:'awaiting', label:'Awaiting Data', delta:null, slope:null };
  const recent = hist.slice(-PRED_WINDOW);
  const deltas = [];
  for (let i = 1; i < recent.length; i++) deltas.push(recent[i] - recent[i-1]);
  const avgDelta = deltas.reduce((a,b) => a+b, 0) / deltas.length;
  const slope    = (recent[recent.length-1] - recent[0]) / (PRED_WINDOW - 1);
  const threshold = label === 'total' ? 4 : 2;
  let trend, statusLabel;
  if (slope > threshold)       { trend='increasing'; statusLabel='Crowd Increasing'; }
  else if (slope < -threshold) { trend='decreasing'; statusLabel='Crowd Decreasing'; }
  else                         { trend='stable';     statusLabel='Stable'; }
  return { trend, label:statusLabel, delta:recent[recent.length-1]-recent[0], slope, avgDelta, recent };
}

function renderPrediction(d) {
  const pred = computePrediction(history.total, 'total');
  const iconWrap   = document.getElementById('predIconWrap');
  const predStatus = document.getElementById('predStatus');
  const predDetail = document.getElementById('predDetail');
  const predSample = document.getElementById('predSampleCount');

  const tClass = pred.trend === 'awaiting' ? 'stable' : pred.trend;
  if (iconWrap)   iconWrap.className = `prediction-icon-wrap ${tClass}`;
  if (predStatus) { predStatus.className = `prediction-status ${tClass}`; predStatus.textContent = pred.label; }
  if (predSample) predSample.textContent = `${history.total.length} / ${MAX_HISTORY} samples`;

  if (pred.slope !== null) {
    const cur      = history.total[history.total.length-1] || 0;
    const proj2m   = Math.max(0, Math.round(cur + pred.slope * 60));
    const capacity = MAX_ZONE * 4;
    const riskPct  = Math.min(100, Math.round(proj2m / capacity * 100));
    const risk     = riskPct > 80 ? 'HIGH' : riskPct > 55 ? 'MEDIUM' : 'LOW';
    if (predDetail) predDetail.textContent = `Slope: ${pred.slope>0?'+':''}${pred.slope.toFixed(1)} ppl/tick · Avg Δ: ${pred.avgDelta>0?'+':''}${pred.avgDelta.toFixed(1)} · Window: last ${PRED_WINDOW} readings`;
    setEl('predTrendDelta',   (pred.delta>0?'+':'')+pred.delta);
    setEl('predAvgChange',    (pred.avgDelta>0?'+':'')+pred.avgDelta.toFixed(1));
    setEl('predPeakForecast', proj2m);
    setEl('predConfidence',   history.total.length >= MAX_HISTORY ? 'HIGH' : history.total.length >= 20 ? 'MED' : 'LOW');
  } else {
    ['predTrendDelta','predAvgChange','predPeakForecast','predConfidence'].forEach(id => setEl(id,'—'));
    if (predDetail) predDetail.textContent = 'Collecting baseline readings…';
  }

  const zpGrid = document.getElementById('zonePredGrid');
  if (zpGrid) {
    zpGrid.innerHTML = ZONES.map(z => {
      const zp  = computePrediction(history[z.key], z.key);
      const col = zp.trend==='increasing'?'var(--danger)':zp.trend==='decreasing'?'var(--success)':'var(--accent)';
      const bgCol = zp.trend==='increasing'?'rgba(239,68,68,0.1)':zp.trend==='decreasing'?'rgba(16,185,129,0.1)':'rgba(37,99,235,0.1)';
      const cur = currentData[z.key] || 0;
      return `<div class="zpred-item">
        <div class="zpred-icon" style="background:${bgCol};color:${col}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            ${zp.trend==='increasing'
              ? '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'
              : zp.trend==='decreasing'
              ? '<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>'
              : '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 12 19"/>'}
          </svg>
        </div>
        <div>
          <div class="zpred-name">${z.name} <span style="color:var(--muted);font-weight:400;font-size:.65rem">· ${z.sub}</span></div>
          <div class="zpred-sub">${cur} / ${MAX_ZONE} people</div>
        </div>
        <div class="zpred-trend" style="color:${col}">${zp.label}</div>
      </div>`;
    }).join('');
  }
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ════════════════════════════════════════════════════════════
// CHARTS
// ════════════════════════════════════════════════════════════
function drawTrendChart() {
  const canvas = document.getElementById('trendChart');
  if (!canvas) return;
  const wrap = canvas.parentElement;
  const W = wrap.offsetWidth || 600; const H = 180;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);
  const pad = { l:36, r:16, t:12, b:20 };
  const gW  = W - pad.l - pad.r;
  const gH  = H - pad.t - pad.b;

  const sets = [
    { key:'total', col:'#3b82f6', label:'Total', lw:2, dash:[] },
    ...ZONES.map(z => ({ key:z.key, col:z.col, label:z.name, lw:1, dash:[3,3] }))
  ];
  const allVals = Object.values(history).flat();
  const maxV    = Math.max(...allVals, 10);

  ctx.strokeStyle = 'rgba(36,50,74,0.6)'; ctx.lineWidth = 1;
  [0,.25,.5,.75,1].forEach(t => {
    const y = pad.t + gH * (1-t);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l+gW, y); ctx.stroke();
    ctx.fillStyle = '#7f95b6'; ctx.font = '8px IBM Plex Mono';
    ctx.fillText(Math.round(maxV*t), 2, y+3);
  });

  sets.forEach(s => {
    const data = history[s.key];
    if (!data || data.length < 2) return;
    ctx.save();
    ctx.strokeStyle = s.col; ctx.lineWidth = s.lw;
    ctx.setLineDash(s.dash);
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = pad.l + (i / (MAX_HISTORY-1)) * gW;
      const y = pad.t + gH * (1 - v/maxV);
      i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    });
    ctx.stroke();
    ctx.restore();
  });

  ctx.fillStyle = '#7f95b6'; ctx.font = '8px IBM Plex Mono';
  ctx.fillText(`← ${MAX_HISTORY} ticks ago`, pad.l, H-4);
  ctx.textAlign = 'right';
  ctx.fillText('now', W-pad.r, H-4);
  ctx.textAlign = 'left';
}

function updateBarChart(d) {
  const canvas = document.getElementById('barChart');
  if (!canvas) return;
  const W = canvas.parentElement.offsetWidth || 300; const H = 220;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);
  const pad = { t:20, b:30, l:36, r:10 };
  const gW  = W - pad.l - pad.r; const gH = H - pad.t - pad.b;
  const barW = gW / (ZONES.length * 1.6);
  const gap  = (gW - barW * ZONES.length) / (ZONES.length + 1);

  ctx.strokeStyle='rgba(36,50,74,0.5)'; ctx.lineWidth=1;
  [0,.5,1].forEach(t => {
    const y = pad.t + gH*(1-t);
    ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(pad.l+gW,y); ctx.stroke();
    ctx.fillStyle='#7f95b6'; ctx.font='8px IBM Plex Mono'; ctx.fillText(Math.round(MAX_ZONE*t),2,y+3);
  });

  ZONES.forEach((z, i) => {
    const v   = d[z.key] || 0;
    const pct = v / MAX_ZONE;
    const x   = pad.l + gap*(i+1) + barW*i;
    const bH  = gH * pct; const y = pad.t + gH - bH;
    const grad = ctx.createLinearGradient(0,y,0,y+bH);
    grad.addColorStop(0, z.col+'cc'); grad.addColorStop(1, z.col+'44');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.roundRect(x,y,barW,bH,2); ctx.fill();
    ctx.fillStyle='#e6edf7'; ctx.font='bold 9px IBM Plex Mono'; ctx.textAlign='center';
    ctx.fillText(v, x+barW/2, y-4);
    ctx.fillStyle='#7f95b6'; ctx.font='9px IBM Plex Mono';
    ctx.fillText(z.name, x+barW/2, H-8);
    ctx.textAlign='left';
  });
}

function updateGateBarChart(d) {
  const canvas = document.getElementById('gateBarChart');
  if (!canvas) return;
  const W = canvas.parentElement.offsetWidth || 300; const H = 220;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);
  const pad = { t:20, b:30, l:36, r:10 };
  const gW  = W-pad.l-pad.r; const gH=H-pad.t-pad.b;
  const maxFlow=60; const barW=gW/(GATES.length*1.6);
  const gap=(gW-barW*GATES.length)/(GATES.length+1);

  ctx.strokeStyle='rgba(36,50,74,0.5)'; ctx.lineWidth=1;
  [0,.5,1].forEach(t => {
    const y=pad.t+gH*(1-t);
    ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+gW,y);ctx.stroke();
    ctx.fillStyle='#7f95b6';ctx.font='8px IBM Plex Mono';ctx.fillText(Math.round(maxFlow*t),2,y+3);
  });

  GATES.forEach((g,i) => {
    const v=d[g.key]||0; const pct=v/maxFlow;
    const x=pad.l+gap*(i+1)+barW*i;
    const bH=gH*pct; const y=pad.t+gH-bH;
    const col=v>45?'#ef4444':v>25?'#f59e0b':'#10b981';
    const grad=ctx.createLinearGradient(0,y,0,y+bH);
    grad.addColorStop(0,col+'cc'); grad.addColorStop(1,col+'44');
    ctx.fillStyle=grad; ctx.beginPath();ctx.roundRect(x,y,barW,bH,2);ctx.fill();
    ctx.fillStyle='#e6edf7';ctx.font='bold 9px IBM Plex Mono';ctx.textAlign='center';
    ctx.fillText(v,x+barW/2,y-4);
    ctx.fillStyle='#7f95b6';ctx.font='9px IBM Plex Mono';
    ctx.fillText(g.name,x+barW/2,H-8);
    ctx.textAlign='left';
  });
}

function drawRYGDensity() {
  const canvas = document.getElementById('rygCanvas');
  if (!canvas) return;
  const wrap = document.getElementById('rygWrap');
  const W = wrap ? wrap.offsetWidth : 600; const H = 160;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);
  const n = MAX_HISTORY; const colW = W/n; const rowH = H/ZONES.length;

  ZONES.forEach((z, zi) => {
    const data = history[z.key];
    for (let i = 0; i < n; i++) {
      const v = data[data.length - n + i] || 0;
      const pct = v / MAX_ZONE;
      let col;
      if      (pct >= 0.84) col = `rgba(239,68,68,${0.5+pct*0.5})`;
      else if (pct >= 0.63) col = `rgba(245,158,11,${0.4+pct*0.5})`;
      else                   col = `rgba(16,185,129,${0.2+pct*0.6})`;
      ctx.fillStyle = col;
      ctx.fillRect(Math.floor(i*colW), zi*rowH, Math.ceil(colW)+1, rowH);
    }
    ctx.fillStyle='rgba(255,255,255,0.45)'; ctx.font='9px IBM Plex Mono';
    ctx.fillText(z.name, 4, zi*rowH+rowH/2+3);
  });
}

function drawHeatmap() {
  const canvas = document.getElementById('heatmapCanvas');
  if (!canvas) return;
  const W = canvas.offsetWidth || 600; const H = 360;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d1829'; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='rgba(49,65,94,0.7)'; ctx.lineWidth=1;
  ctx.strokeRect(30,30,W-60,H-60);

  const zones = [
    { key:'zone1', x:30, y:30, w:(W-60)/2, h:(H-60)/2 },
    { key:'zone2', x:30+(W-60)/2, y:30, w:(W-60)/2, h:(H-60)/2 },
    { key:'zone3', x:30, y:30+(H-60)/2, w:(W-60)/2, h:(H-60)/2 },
    { key:'zone4', x:30+(W-60)/2, y:30+(H-60)/2, w:(W-60)/2, h:(H-60)/2 },
  ];
  const zinfo = { zone1:ZONES[0], zone2:ZONES[1], zone3:ZONES[2], zone4:ZONES[3] };

  zones.forEach(z => {
    const v = currentData[z.key] || 0;
    const t = v / MAX_ZONE;
    const r = Math.min(255, Math.round(t * 255 * 1.5));
    const g = Math.max(0, Math.round((1-t) * 200));
    ctx.fillStyle = `rgba(${r},${g},40,${0.25 + t * 0.55})`;
    ctx.fillRect(z.x+2, z.y+2, z.w-4, z.h-4);
    ctx.fillStyle='rgba(230,237,247,0.8)'; ctx.font='bold 11px IBM Plex Mono'; ctx.textAlign='center';
    ctx.fillText(zinfo[z.key].name, z.x+z.w/2, z.y+z.h/2-6);
    ctx.font='9px IBM Plex Mono'; ctx.fillStyle='rgba(159,179,209,0.8)';
    ctx.fillText(`${v} / ${MAX_ZONE}`, z.x+z.w/2, z.y+z.h/2+10);
    ctx.textAlign='left';
    const s = statusOf(v);
    ctx.strokeStyle = s==='high'?'rgba(239,68,68,0.5)':s==='medium'?'rgba(245,158,11,0.4)':'rgba(16,185,129,0.2)';
    ctx.lineWidth=1; ctx.strokeRect(z.x+2,z.y+2,z.w-4,z.h-4);
  });

  ctx.fillStyle='rgba(127,149,182,0.6)'; ctx.font='8px IBM Plex Mono'; ctx.textAlign='center';
  ctx.fillText('GATE 1', W/4, H-12);
  ctx.fillText('GATE 2', 3*W/4, H-12);
  ctx.textAlign='left';
}

function drawCameras() {
  ['AB','CD'].forEach((suffix, si) => {
    const canvas = document.getElementById(`camCanvas${suffix}`);
    if (!canvas) return;
    const W = canvas.offsetWidth || 400; const H = 200;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a1220'; ctx.fillRect(0,0,W,H);

    const zones = si===0 ? ['zone1','zone2'] : ['zone3','zone4'];
    const total = zones.reduce((a,k) => a + (currentData[k]||0), 0);
    const count = Math.min(total, 80);
    const seed  = Math.floor(Date.now()/2000);

    for (let i = 0; i < count; i++) {
      const rx = ((i*37+seed*3+si*13)%97)/97;
      const ry = ((i*53+seed*7+si*17)%89)/89;
      const x  = 20 + rx*(W-40);
      const y  = 20 + ry*(H-40);
      const r  = 3 + Math.random()*2;
      const t2 = (currentData[zones[0]]||0) / MAX_ZONE;
      const col = t2 > 0.84 ? '#ef4444' : t2 > 0.63 ? '#f59e0b' : '#06b6d4';
      ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
      ctx.fillStyle = col+'aa'; ctx.fill();
    }

    ctx.fillStyle='rgba(0,0,0,0.04)';
    for (let y=0; y<H; y+=3) ctx.fillRect(0,y,W,1);

    ctx.strokeStyle='rgba(6,182,212,0.3)'; ctx.lineWidth=1;
    const br=14;
    [[0,0],[W,0],[0,H],[W,H]].forEach(([cx,cy]) => {
      ctx.beginPath();
      ctx.moveTo(cx+(cx===0?0:-br),cy); ctx.lineTo(cx+(cx===0?br:0),cy);
      ctx.moveTo(cx,cy+(cy===0?0:-br)); ctx.lineTo(cx,cy+(cy===0?br:0));
      ctx.stroke();
    });

    const cntEl = document.getElementById(`camCount${suffix}`);
    if (cntEl) cntEl.textContent = total;
  });
}

// ════════════════════════════════════════════════════════════
// LIVE CAMERA TAB — Python backend integration
// ════════════════════════════════════════════════════════════
async function pollCameraCount() {
  try {
    const res = await fetch(`${CAM_BASE_URL}/count`, { cache:'no-store' });
    if (!res.ok) throw new Error('offline');
    const json = await res.json();
    const count = json.count ?? 0;

    // Update count display
    setEl('liveCamCount', count);
    setEl('liveCamTime',  new Date().toLocaleTimeString('en-GB', { hour12:false }));

    // Session peak
    if (count > liveCamPeak) {
      liveCamPeak = count;
      setEl('liveCamPeak', liveCamPeak);
    }

    // Mark online
    if (!camOnline) {
      camOnline = true;
      setCamStatus(true);
    }
  } catch(_) {
    if (camOnline) {
      camOnline = false;
      setCamStatus(false);
    }
  }
}

function setCamStatus(online) {
  const dot  = document.getElementById('camStatusDot');
  const text = document.getElementById('camStatusText');
  const badge = document.getElementById('camFeedBadge');
  const img   = document.getElementById('liveCamFeed');
  const offline = document.getElementById('camOfflineMsg');

  if (online) {
    if (dot)  { dot.className = 'cam-status-dot online'; }
    if (text) text.textContent = 'Online';
    if (badge) { badge.style.borderColor='var(--success)'; badge.style.color='var(--success)'; badge.textContent='LIVE'; }
    if (img)  img.style.display = 'block';
    if (offline) offline.style.display = 'none';
  } else {
    if (dot)  { dot.className = 'cam-status-dot offline'; }
    if (text) text.textContent = 'Offline';
    if (badge) { badge.style.borderColor='var(--danger)'; badge.style.color='var(--danger)'; badge.textContent='OFFLINE'; }
    if (img)  img.style.display = 'none';
    if (offline) offline.style.display = 'flex';
    setEl('liveCamCount', '—');
  }
}

function handleCamError() {
  camOnline = false;
  setCamStatus(false);
}

function retryCam() {
  const img = document.getElementById('liveCamFeed');
  if (img) {
    img.style.display = 'block';
    img.src = `${CAM_BASE_URL}/video?t=${Date.now()}`;
  }
  const offline = document.getElementById('camOfflineMsg');
  if (offline) offline.style.display = 'none';
}

// ════════════════════════════════════════════════════════════
// INTERNAL ALERTS
// ════════════════════════════════════════════════════════════
function checkInternalAlerts(d, now) {
  const timeStr = now.toLocaleTimeString('en-GB', { hour12:false });
  ZONES.forEach(z => {
    const v = d[z.key] || 0;
    if (v >= THRESH_CRIT) {
      if (!alertDebounce[z.key] || now - alertDebounce[z.key] > 30000) {
        alertDebounce[z.key] = now;
        addAlert('danger', `${z.name} CRITICAL — ${v} people (${Math.round(v/MAX_ZONE*100)}% capacity)`, timeStr, z.name);
      }
    } else if (v >= THRESH_WARN) {
      if (!alertDebounce[z.key+'w'] || now - alertDebounce[z.key+'w'] > 60000) {
        alertDebounce[z.key+'w'] = now;
        addAlert('warn', `${z.name} busy — ${v} people, approaching limit`, timeStr, z.name);
      }
    }
  });
  GATES.forEach(g => {
    const v = d[g.key] || 0;
    if (v > 45 && (!alertDebounce[g.key+'surge'] || now-alertDebounce[g.key+'surge'] > 30000)) {
      alertDebounce[g.key+'surge'] = now;
      addAlert('warn', `${g.name} high flow — ${v} people/min`, timeStr, g.name);
    }
  });
  const pred = computePrediction(history.total, 'total');
  if (pred.trend==='increasing' && pred.slope > 5) {
    if (!alertDebounce['pred_inc'] || now-alertDebounce['pred_inc'] > 60000) {
      alertDebounce['pred_inc'] = now;
      addAlert('info', `Crowd increasing rapidly (slope +${pred.slope.toFixed(1)}/tick)`, timeStr, 'System');
    }
  }
}

function addAlert(level, msg, time, zone) {
  alerts.unshift({ level, msg, time, zone, cleared:false });
  if (alerts.length > 50) alerts.pop();
  renderAlertList();
}

function renderAlertList() {
  const list = document.getElementById('alertList');
  if (!list) return;
  const visible = alerts.filter(a => !a.cleared).slice(0,8);
  if (!visible.length) { list.innerHTML='<div class="no-alerts">No alerts</div>'; return; }
  list.innerHTML = visible.map(a => {
    const dotC = a.level==='danger'?'danger':a.level==='warn'?'warn':a.level==='info'?'info':'success';
    return `<div class="alert-item ${a.level}">
      <div class="alert-dot ${dotC}"></div>
      <span class="alert-msg">${a.msg}</span>
      <span class="alert-time">${a.time}</span>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════
// SUGGESTION FILE READER — parses SuggestionEngine.java output
// ════════════════════════════════════════════════════════════
async function fetchSuggestions(manual=false) {
  try {
    const res = await fetch(SUGGESTION_FILE, { cache:'no-store' });
    if (!res.ok) throw new Error('suggestion.txt unavailable');
    const txt = await res.text();
    const parsed = parseSuggestions(txt);
    if (parsed.length) suggestionsData = parsed;
    renderSuggestions();
    const el = document.getElementById('sugLastUpdate');
    if (el) el.textContent = `Last updated: ${new Date().toLocaleTimeString('en-GB',{hour12:false})}`;
  } catch(_) {
    if (!suggestionsData.length) {
      suggestionsData = getDemoSuggestions();
      renderSuggestions();
    }
  }
}

// Parses the key:value format written by SuggestionEngine.java
function parseSuggestions(raw) {
  const lines  = raw.split(/\r?\n/);
  const meta   = {};
  const byIdx  = {};

  lines.forEach(line => {
    const t = line.trim();
    if (!t || t.startsWith('#') || t === '---') return;

    // suggestion_N_field:value
    const sugMatch = t.match(/^suggestion_(\d+)_(\w+):(.*)$/);
    if (sugMatch) {
      const idx   = parseInt(sugMatch[1], 10);
      const field = sugMatch[2];
      const val   = sugMatch[3].trim();
      if (!byIdx[idx]) byIdx[idx] = {};
      byIdx[idx][field] = val;
      return;
    }

    // top-level meta  key:value
    const metaMatch = t.match(/^([a-zA-Z_]+):(.*)$/);
    if (metaMatch) meta[metaMatch[1]] = metaMatch[2].trim();
  });

  const now = new Date().toLocaleTimeString('en-GB', { hour12:false });

  return Object.keys(byIdx)
    .sort((a, b) => Number(a) - Number(b))
    .map(i => {
      const s = byIdx[i];
      return {
        category: inferCategoryFromSuggestion(s),
        title:    s.title  || s.id || 'Suggestion',
        body:     s.detail || '',
        meta:     s.target ? `Target: ${s.target}` : '',
        priority: s.priority || 'LOW',
        time:     now,
      };
    });
}

function inferCategoryFromSuggestion(s) {
  const id    = (s.id    || '').toLowerCase();
  const title = (s.title || '').toLowerCase();
  if (/staff|dispatch|personnel|overflow|open_overflow/.test(id))         return 'resources';
  if (/reroute|gate|throttle|bar_all|redirect/.test(id))                  return 'routing';
  if (/bar_all|critical|crush|emergency|restrict/.test(id))               return 'safety';
  if (/safe|danger|evacuate|emergency|warn|alert/.test(title))            return 'safety';
  if (/route|path|exit|entry|gate|redirect|reroute/.test(title))          return 'routing';
  if (/deploy|staff|personnel|resource|medic|security|overflow/.test(title)) return 'resources';
  return 'info';
}

function getDemoSuggestions() {
  const now = new Date().toLocaleTimeString('en-GB',{hour12:false});
  return [
    { category:'resources', priority:'HIGH',   title:'Deploy additional security to Zone A',  body:'Zone A is approaching 75% capacity. Deploy 2 additional officers near the main stage perimeter.', meta:'Target: Zone A', time:now },
    { category:'routing',   priority:'HIGH',   title:'Redirect Gate 1 traffic to Gate 2',     body:'Gate 1 is experiencing high flow rates. Direct non-critical arrivals to Gate 2 to balance load.', meta:'Target: Gate 1 → Gate 2', time:now },
    { category:'safety',    priority:'MEDIUM', title:'Monitor crowd density in Zone C',        body:'Predictive models indicate Zone C may increase in the next 10 minutes. Pre-position stewards.', meta:'Target: Zone C', time:now },
    { category:'info',      priority:'LOW',    title:'No action needed — monitor only',        body:'Crowd levels are within safe limits. Continue passive monitoring.', meta:'Target: All zones', time:now },
    { category:'resources', priority:'MEDIUM', title:'Medical team standby at Zone D',         body:'High occupancy in outdoor arena. Ensure medical team is on standby near Zone D exits.', meta:'Target: Zone D', time:now },
    { category:'routing',   priority:'LOW',    title:'Open secondary exit lanes',              body:'If total occupancy exceeds 80%, activate secondary exit lanes on the north perimeter.', meta:'Target: North perimeter', time:now },
  ];
}

function renderSuggestions() {
  const list = document.getElementById('suggestionsList');
  if (!list) return;
  const filtered = sugFilter === 'all' ? suggestionsData : suggestionsData.filter(s => s.category === sugFilter);
  if (!filtered.length) {
    list.innerHTML = `<div class="sug-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <p>${suggestionsData.length ? 'No suggestions in this category.' : 'Waiting for suggestion.txt…'}</p>
    </div>`;
    return;
  }

  const icons = {
    resources: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    routing:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="3 6 9 12 3 18"/><line x1="9" y1="12" x2="21" y2="12"/></svg>`,
    safety:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    info:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  };
  const tags = { resources:'Resource Deploy', routing:'Routing', safety:'Safety Alert', info:'Information' };

  list.innerHTML = filtered.map((s, idx) => {
    const cat = s.category || 'info';
    const pri = (s.priority || 'LOW').toUpperCase();
    return `<div class="sug-card ${cat}" style="animation-delay:${idx*0.04}s">
      <div class="sug-icon-wrap">${icons[cat]||icons.info}</div>
      <div class="sug-card-content">
        <div class="sug-card-header">
          <div class="sug-card-title">${s.title}</div>
          <span class="sug-card-tag">${tags[cat]||'Info'}</span>
        </div>
        ${s.body ? `<div class="sug-card-body">${s.body}</div>` : ''}
        <div class="sug-card-meta">
          <span class="sug-priority-badge ${pri}">${pri}</span>
          ${s.meta ? `<span>${s.meta}</span>` : ''}
          <span>Received at ${s.time}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function filterSuggestions(cat, btn) {
  sugFilter = cat;
  document.querySelectorAll('.sug-pill').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderSuggestions();
}

// ════════════════════════════════════════════════════════════
// ALERT FILE READER
// ════════════════════════════════════════════════════════════
async function fetchAlertFile() {
  try {
    const res = await fetch(DATA_FILE, { cache:'no-store' });
    if (!res.ok) throw new Error('data.txt unavailable');
    const txt  = await res.text();
    const parsed = parseAlertFile(txt);
    if (parsed && parsed.length) {
      incidentsData = parsed;
    } else {
      incidentsData = generateIncidentsFromData();
    }
  } catch(_) {
    incidentsData = generateIncidentsFromData();
  }
  renderAlertsFeed();
  updateSeveritySummary();
  applyAlertTabColor();
  const el = document.getElementById('alertLastUpdate');
  if (el) el.textContent = `Last updated: ${new Date().toLocaleTimeString('en-GB',{hour12:false})}`;
}

function parseAlertFile(raw) {
  const lines = raw.split(/\r?\n/);
  const results = [];
  lines.forEach(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const sevMatch = t.match(/\[(RED|YELLOW|GREEN|HIGH|WARN|NORMAL|CAUTION)\]/i);
    if (sevMatch) {
      const rawSev = sevMatch[1].toUpperCase();
      const sev = (rawSev==='HIGH'||rawSev==='RED') ? 'red'
                : (rawSev==='WARN'||rawSev==='YELLOW'||rawSev==='CAUTION') ? 'yellow'
                : 'green';
      const body = t.replace(/\[.*?\]/g,'').trim();
      if (body) {
        results.push({ severity:sev, title:body, body:'', timestamp:new Date().toLocaleTimeString('en-GB',{hour12:false}), priority:sev==='red'?1:sev==='yellow'?2:3 });
      }
    }
  });
  return results.sort((a,b) => a.priority - b.priority);
}

function generateIncidentsFromData() {
  const inc = [];
  const now = new Date().toLocaleTimeString('en-GB',{hour12:false});
  const d   = currentData;
  ZONES.forEach(z => {
    const v = d[z.key] || 0;
    if (v >= THRESH_CRIT) {
      inc.push({ severity:'red', title:`${z.name} — Critical Density`, body:`${v} people detected (${Math.round(v/MAX_ZONE*100)}%). Immediate action required.`, timestamp:now, priority:1 });
    } else if (v >= THRESH_WARN) {
      inc.push({ severity:'yellow', title:`${z.name} — Elevated Density`, body:`${v} people detected (${Math.round(v/MAX_ZONE*100)}%). Approaching capacity threshold.`, timestamp:now, priority:2 });
    } else {
      inc.push({ severity:'green', title:`${z.name} — Normal`, body:`${v} people. Crowd levels within acceptable range.`, timestamp:now, priority:3 });
    }
  });
  GATES.forEach(g => {
    const v = d[g.key] || 0;
    if (v > 45) {
      inc.push({ severity:'red', title:`${g.name} — High Flow Rate`, body:`${v} people/min. Surge conditions detected.`, timestamp:now, priority:1 });
    } else if (v > 25) {
      inc.push({ severity:'yellow', title:`${g.name} — Moderate Flow`, body:`${v} people/min. Monitoring entry rate.`, timestamp:now, priority:2 });
    }
  });
  return inc.sort((a,b) => a.priority - b.priority);
}

function renderAlertsFeed() {
  const feed = document.getElementById('alertsFeed');
  if (!feed) return;
  const filtered = alertFilter === 'all' ? incidentsData : incidentsData.filter(i => i.severity === alertFilter);
  if (!filtered.length) {
    feed.innerHTML = `<div class="no-alerts-msg">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      <p>${incidentsData.length ? 'No alerts in this category.' : 'System running normally — no alerts.'}</p>
    </div>`;
    return;
  }
  const sevIcons = {
    red:    `<svg class="inc-sev-icon" viewBox="0 0 24 24" fill="none" stroke="var(--sev-red)" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    yellow: `<svg class="inc-sev-icon" viewBox="0 0 24 24" fill="none" stroke="var(--sev-yellow)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    green:  `<svg class="inc-sev-icon" viewBox="0 0 24 24" fill="none" stroke="var(--sev-green)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  };
  const sevLabels = { red:'HIGH', yellow:'CAUTION', green:'NORMAL' };
  feed.innerHTML = filtered.map((inc, idx) => `
    <div class="incident-card ${inc.severity}${idx===0&&inc.severity==='red'?' new-alert':''}">
      <div class="incident-sev-badge">
        ${sevIcons[inc.severity]||sevIcons.green}
        <div class="inc-sev-label">${sevLabels[inc.severity]||'INFO'}</div>
      </div>
      <div class="incident-content">
        <div class="incident-header">
          <div class="incident-title">${inc.title}</div>
          <div class="incident-timestamp">${inc.timestamp}</div>
        </div>
        ${inc.body ? `<div class="incident-body">${inc.body}</div>` : ''}
        <div class="incident-meta">
          <span class="incident-tag">${inc.severity==='red'?'Immediate Action':inc.severity==='yellow'?'Monitor Closely':'Normal'}</span>
          ${inc.zone ? `<span class="incident-tag">${inc.zone}</span>` : ''}
        </div>
      </div>
    </div>`
  ).join('');
}

function updateSeveritySummary() {
  const counts = { green:0, yellow:0, red:0 };
  incidentsData.forEach(i => { counts[i.severity] = (counts[i.severity]||0)+1; });
  setEl('sevNumGreen',  counts.green);
  setEl('sevNumYellow', counts.yellow);
  setEl('sevNumRed',    counts.red);

  const chip = document.getElementById('sevStatusChip');
  if (!chip) return;
  if (counts.red > 0)         { chip.className='sev-status alert';   chip.textContent='HIGH ALERT'; currentSeverity='red'; }
  else if (counts.yellow > 0) { chip.className='sev-status caution'; chip.textContent='CAUTION';    currentSeverity='yellow'; }
  else                        { chip.className='sev-status normal';  chip.textContent='SYSTEM NORMAL'; currentSeverity='green'; }
}

function applyAlertTabColor() {
  const navAlert = document.getElementById('nav-alerts');
  if (!navAlert) return;
  navAlert.classList.remove('alert-sev-green','alert-sev-yellow','alert-sev-red');
  if (currentSeverity === 'red')         navAlert.classList.add('alert-sev-red');
  else if (currentSeverity === 'yellow') navAlert.classList.add('alert-sev-yellow');
  else                                   navAlert.classList.add('alert-sev-green');
}

function filterAlerts(sev, btn) {
  alertFilter = sev;
  document.querySelectorAll('.alert-pill').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderAlertsFeed();
}

function clearAllAlerts() {
  alerts.forEach(a => a.cleared = true);
  renderAlertList();
  updateStats(currentData);
}

// ════════════════════════════════════════════════════════════
// MODAL
// ════════════════════════════════════════════════════════════
function openModal(zoneKey) {
  currentModalZone = zoneKey;
  const z   = ZONES.find(z => z.key === zoneKey);
  const v   = currentData[zoneKey] || 0;
  const s   = statusOf(v);
  const avg = sessionCounts[zoneKey] > 0 ? Math.round(sessionSums[zoneKey]/sessionCounts[zoneKey]) : v;
  const col = s==='low'?'var(--low)':s==='medium'?'var(--med)':'var(--high)';

  setEl('modalTitle', `${z.name} — ${z.sub}`);
  const mc = document.getElementById('mCount');
  if (mc) { mc.textContent = v; mc.style.color = col; }
  setEl('mMax', sessionMax[zoneKey]);
  setEl('mAvg', avg);

  const pred = computePrediction(history[zoneKey], zoneKey);
  const meta = document.getElementById('modalMeta');
  if (meta) meta.innerHTML =
    `Gateway: ${z.gate} &nbsp;·&nbsp; Capacity: ${MAX_ZONE} &nbsp;·&nbsp;
     Occupancy: ${Math.round(v/MAX_ZONE*100)}% &nbsp;·&nbsp;
     Status: <span style="color:${col}">${s.toUpperCase()}</span>
     &nbsp;·&nbsp; Trend: <strong>${pred.label}</strong>`;

  document.getElementById('zoneModal').classList.add('open');
  setTimeout(() => drawModalChart(zoneKey), 10);
}

function drawModalChart(zoneKey) {
  const canvas = document.getElementById('modalChart');
  const W = canvas.offsetWidth || 480; const H = 140;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);
  const data = history[zoneKey];
  if (!data || data.length < 2) return;
  const s = statusOf(currentData[zoneKey]||0);
  const col = s==='low'?'#0891b2':s==='medium'?'#d97706':'#dc2626';
  const pad = 10;
  const grad = ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0, col+'55'); grad.addColorStop(1, col+'00');

  ctx.beginPath();
  data.forEach((v,i) => {
    const x = pad+(i/(Math.max(data.length-1,1)))*(W-pad*2);
    const y = H-pad-(v/MAX_ZONE)*(H-pad*2);
    i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  });
  const lx = pad+((data.length-1)/(Math.max(data.length-1,1)))*(W-pad*2);
  ctx.lineTo(lx,H-pad); ctx.lineTo(pad,H-pad); ctx.closePath();
  ctx.fillStyle=grad; ctx.fill();
  ctx.beginPath();
  data.forEach((v,i) => {
    const x=pad+(i/(Math.max(data.length-1,1)))*(W-pad*2);
    const y=H-pad-(v/MAX_ZONE)*(H-pad*2);
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  });
  ctx.strokeStyle=col; ctx.lineWidth=2; ctx.stroke();
}

function closeModal(e) {
  if (e.target.id==='zoneModal') document.getElementById('zoneModal').classList.remove('open');
}

// ════════════════════════════════════════════════════════════
// REPORTS
// ════════════════════════════════════════════════════════════
function renderReport() {
  const tbody = document.getElementById('reportBody');
  if (!tbody) return;
  tbody.innerHTML = reportLog.slice(0,50).map(r => {
    const pCol = r.prediction==='Crowd Increasing'?'var(--danger)':r.prediction==='Crowd Decreasing'?'var(--success)':'var(--accent)';
    return `<tr>
      <td>${r.time}</td>
      <td>${r.z1}</td><td>${r.z2}</td><td>${r.z3}</td><td>${r.z4}</td>
      <td>${r.e1}</td><td>${r.e2}</td>
      <td style="color:var(--accent)">${r.total}</td>
      <td>${r.occ}%</td>
      <td style="color:${pCol};font-size:.7rem">${r.prediction||'—'}</td>
    </tr>`;
  }).join('');
}

function exportCSV() {
  const hdr  = 'Time,Zone1,Zone2,Zone3,Zone4,Gate1,Gate2,Total,Occ%,Prediction\n';
  const rows = reportLog.map(r =>
    `${r.time},${r.z1},${r.z2},${r.z3},${r.z4},${r.e1},${r.e2},${r.total},${r.occ},${r.prediction||''}`
  ).join('\n');
  const blob = new Blob([hdr+rows], { type:'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `crowdtrack_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}