/* ─────────────────────────────────────────────
   TRAINING DASHBOARD — app.js
   Vanilla JS + Canvas API, no frameworks
───────────────────────────────────────────── */

'use strict';

// ── DATA FILES ───────────────────────────────
const DATA_FILES = [
  'data/master_summary_garmin_2025.json',
  'data/master_summary_hevy_2025.json',
  'data/master_summary_garmin_2026.json',
  'data/master_summary_suunto_2026.json',
  'data/master_summary_hevy_2026.json',
];

// ── EVENTS ───────────────────────────────────
const EVENTS = [
  { label: 'Island Walk',     date: '2026-06-20' },
  { label: 'Intertidal Race', date: '2026-08-15' },
  { label: 'Trail Weekend',   date: '2026-11-09' },
];

// ── CATEGORIES ───────────────────────────────
const CATEGORIES = [
  { key: 'run',  label: 'Running',           color: '#E8705A' },
  { key: 'walk', label: 'Walking & Hiking',  color: '#5A9B6E' },
  { key: 'gym',  label: 'Gym Strength',      color: '#4A6FA8' },
  { key: 'acc',       label: 'Accessory Work', color: '#8B7EC8' },
  { key: 'jump',     label: 'Jump Rope',      color: '#D4A82A' },
  { key: 'gymcardio', label: 'Gym Cardio',   color: '#C45C2A' },
];

// ── VISUAL SCALE (bar height only, not values) ─
const VISUAL_SCALE = {
  run: 1.0,
  walk: 0.5,
  gym: 1.0,
  acc: 1.0,
  jump: 2.0,
  gymcardio: 1.0,
};

// ── CHART CONFIG ─────────────────────────────
const CHART_HEIGHT   = 440;
const CHART_PAD_TOP  = 24;
const CHART_PAD_BOT  = 52;
const CHART_PAD_SIDE = 16;
const BAR_RADIUS     = 3;
const DAY_BAR_WIDTH  = 20;
const DAY_BAR_GAP    = 8;
const TARGET_FILL    = 0.82; // tallest bar reaches this fraction of drawable height

// ── STATE ────────────────────────────────────
let allActivities = [];
let currentView   = 'day';
let hiddenCats    = new Set();
let openSegment   = null; // { bucketKey, catKey }
let buckets       = [];
let pixelRatio    = window.devicePixelRatio || 1;

// ── CLASSIFY ─────────────────────────────────
function classify(s) {
  const type = (s.activityType || '').toLowerCase();
  const name = (s.name || '');
  const src  = (s.source || '').toLowerCase();

  if (type === 'running' || type === 'trail_running')           return 'run';
  if (type === 'walking'  || type === 'hiking')                 return 'walk';
  if (type === 'jump_rope')                                     return 'jump';
  if (type === 'gym_cardio')                                    return 'gymcardio';
  if (src === 'hevy' && (/Gym Day|Gyn Day|Full body barbell|Body \+ free wights/i.test(name) || name === 'Day 1' || name === 'Day 2' || name === 'Lazy')) return 'gym';
  if (src === 'hevy' && /MOBO|Hip and Glute|FeetFocus|Toe ?[Pp]ro|Calves|Accessories/i.test(name.trim())) return 'acc';
  return null;
}

// ── METRIC ───────────────────────────────────
function getMetric(s, raw, catKey) {
  if (catKey === 'run')  return s.distanceKm || 0;
  if (catKey === 'walk') return s.distanceKm || 0;
  if (catKey === 'jump') {
    if (s.repetitionCount) return s.repetitionCount;
    // Garmin Cardio: estimate from duration at 72.72 skips/min
    return Math.round((s.durationSeconds || 0) / 60 * 72.72);
  }
  if (catKey === 'gymcardio') return s.durationSeconds || 0;
  if (catKey === 'acc') {
    // Sum reps from raw windows (repetitionCount is a jump rope field, not set here)
    let reps = 0;
    const windows = (raw && raw.windows) ? raw.windows : [];
    for (const w of windows) {
      for (const set of (w.sets || [])) {
        reps += set.reps || 0;
      }
    }
    return reps;
  }
  if (catKey === 'gym') {
    // Sum sets×reps×kg (non-warmup, non-null weight), null weight = 85
    let load = 0;
    const windows = (raw && raw.windows) ? raw.windows : [];
    for (const w of windows) {
      for (const set of (w.sets || [])) {
        if (set.setType === 'warmup') continue;
        const kg   = set.weightKg != null ? set.weightKg : 85;
        const reps = set.reps || 0;
        load += kg * reps;
      }
    }
    return load;
  }
  return 0;
}

// ── BUCKET HELPERS ───────────────────────────
function bucketKey(dateStr, view) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (view === 'day')   return dateStr;
  if (view === 'month') return `${y}-${String(m).padStart(2,'0')}`;
  // week: ISO week start (Monday)
  const date = new Date(y, m-1, d);
  const day  = (date.getDay() + 6) % 7; // Mon=0
  const mon  = new Date(date);
  mon.setDate(d - day);
  return `${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS_INIT = ['S','M','T','W','T','F','S'];

function bucketLabel(key, view, prevKey) {
  const [y, m, d] = key.split('-').map(Number);

  if (view === 'day') {
    const date     = new Date(y, m-1, d);
    const dayInit  = DAYS_INIT[date.getDay()];
    const prevY    = prevKey ? Number(prevKey.split('-')[0]) : null;
    const showYear = prevY !== null && prevY !== y;
    // [dayInitial, dateNum, monthAbbrev, yearOrNull]
    return [dayInit, String(d), MONTHS[m-1], showYear ? String(y) : null];
  }

  if (view === 'week') {
    const prevY    = prevKey ? Number(prevKey.split('-')[0]) : null;
    const showYear = prevY !== null && prevY !== y;
    // [dateNum, monthAbbrev, yearOrNull]
    return [String(d), MONTHS[m-1], showYear ? String(y) : null];
  }

  // month — always show year
  return [MONTHS[m-1], String(y)];
}

function allBucketKeys(view) {
  if (!allActivities.length) return [];
  const dates = allActivities.map(a => a.summary.date).sort();
  const first = dates[0]; const last = dates[dates.length-1];
  const keys  = [];
  const seen  = new Set();

  // Walk day by day and collect unique bucket keys
  const cur = new Date(first);
  const end = new Date(last);
  while (cur <= end) {
    const ds = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
    const k  = bucketKey(ds, view);
    if (!seen.has(k)) { seen.add(k); keys.push(k); }
    cur.setDate(cur.getDate() + 1);
  }
  return keys;
}

// ── BUILD BUCKETS ────────────────────────────
function buildBuckets(view) {
  const map = {};
  for (const item of allActivities) {
    const s   = item.summary;
    const cat = classify(s);
    if (!cat) continue;
    const k = bucketKey(s.date, view);
    if (!map[k]) map[k] = { run:[], walk:[], gym:[], acc:[], jump:[], gymcardio:[] };
    map[k][cat].push(item);
  }

  const keys = allBucketKeys(view);
  return keys.map((k, i) => ({
    key:   k,
    label: bucketLabel(k, view, i > 0 ? keys[i-1] : null),
    cats:  map[k] || { run:[], walk:[], gym:[], acc:[], jump:[], gymcardio:[] },
  }));
}

// ── COMPUTE BAR HEIGHTS ──────────────────────
// Per-category PBs (duration & metric) → ceiling → normalise so tallest hits TARGET_FILL
function computeHeights(bkts, view, hidden) {
  // 1. PBs per category
  const durationPB = {}; const metricPB = {};
  for (const cat of CATEGORIES) {
    durationPB[cat.key] = 0; metricPB[cat.key] = 0;
  }
  for (const b of bkts) {
    for (const cat of CATEGORIES) {
      const acts = b.cats[cat.key];
      const dur  = acts.reduce((s,a) => s + (a.summary.durationSeconds||0), 0);
      const met  = acts.reduce((s,a) => s + getMetric(a.summary, a.raw, cat.key), 0);
      if (dur > durationPB[cat.key]) durationPB[cat.key] = dur;
      if (met > metricPB[cat.key])  metricPB[cat.key]  = met;
    }
  }

  const maxDurPB = Math.max(...Object.values(durationPB), 1);

  // 2. Per-bucket raw heights per category (fraction of drawable height)
  const drawH = CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOT;
  const rawBars = bkts.map(b => {
    const segs = {};
    for (const cat of CATEGORIES) {
      if (hidden.has(cat.key)) { segs[cat.key] = 0; continue; }
      const acts = b.cats[cat.key];
      const met  = acts.reduce((s,a) => s + getMetric(a.summary, a.raw, cat.key), 0);
      if (!met) { segs[cat.key] = 0; continue; }
      const ceiling = (durationPB[cat.key] / maxDurPB);  // 0–1
      const frac    = metricPB[cat.key] > 0 ? (met / metricPB[cat.key]) : 0;
      segs[cat.key] = ceiling * frac * VISUAL_SCALE[cat.key];
    }
    return { key: b.key, segs };
  });

  // 3. Normalise so tallest combined bar = TARGET_FILL
  const maxTotal = Math.max(...rawBars.map(b => Object.values(b.segs).reduce((s,v)=>s+v,0)), 0.001);
  const scale    = (TARGET_FILL / maxTotal) * drawH;

  return rawBars.map(b => {
    const px = {};
    for (const cat of CATEGORIES) px[cat.key] = Math.round(b.segs[cat.key] * scale);
    return { key: b.key, px };
  });
}

// ── CANVAS DRAW ──────────────────────────────
let hitAreas = []; // [{x, y, w, h, bucketKey, catKey}]

function drawChart() {
  const canvas = document.getElementById('chart-canvas');
  const ctx    = canvas.getContext('2d');
  const dpr    = pixelRatio;

  const keys   = allBucketKeys(currentView);
  const n      = keys.length;
  if (!n) return;

  let canvasW;
  const wrap   = document.getElementById('chart-scroll');
  const wrapW  = wrap.clientWidth;

  if (currentView === 'day') {
    const barSlot = DAY_BAR_WIDTH + DAY_BAR_GAP;
    canvasW = Math.max(wrapW, CHART_PAD_SIDE * 2 + n * barSlot);
  } else {
    canvasW = wrapW;
  }

  canvas.style.width  = canvasW + 'px';
  canvas.style.height = CHART_HEIGHT + 'px';
  canvas.width  = canvasW * dpr;
  canvas.height = CHART_HEIGHT * dpr;
  ctx.scale(dpr, dpr);

  // Clear
  ctx.clearRect(0, 0, canvasW, CHART_HEIGHT);

  const heights  = computeHeights(buckets, currentView, hiddenCats);
  const heightMap = {};
  for (const h of heights) heightMap[h.key] = h.px;

  const drawH  = CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOT;
  const baseY  = CHART_PAD_TOP + drawH;

  // Bar slot width
  let slotW, barW;
  if (currentView === 'day') {
    slotW = DAY_BAR_WIDTH + DAY_BAR_GAP;
    barW  = DAY_BAR_WIDTH;
  } else {
    slotW = (canvasW - CHART_PAD_SIDE * 2) / n;
    barW  = Math.max(8, slotW * 0.55);
  }

  // Grid lines — subtle
  const gridCount = 4;
  ctx.strokeStyle = '#E2DFDA';
  ctx.lineWidth   = 1;
  for (let i = 1; i <= gridCount; i++) {
    const y = baseY - (drawH * i / gridCount);
    ctx.beginPath();
    ctx.moveTo(CHART_PAD_SIDE, y);
    ctx.lineTo(canvasW - CHART_PAD_SIDE, y);
    ctx.stroke();
  }

  hitAreas = [];

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  for (let i = 0; i < buckets.length; i++) {
    const b     = buckets[i];
    const px    = heightMap[b.key] || {};
    const slotX = CHART_PAD_SIDE + i * slotW;
    const barX  = slotX + (slotW - barW) / 2;
    const isToday = (b.key === todayStr);

    // Today highlight
    if (isToday && currentView === 'day') {
      ctx.fillStyle = 'rgba(232,112,90,0.06)';
      ctx.beginPath();
      ctx.roundRect(barX - 4, CHART_PAD_TOP, barW + 8, drawH, 4);
      ctx.fill();
    }

    // Open segment highlight
    const isOpen = openSegment && openSegment.bucketKey === b.key;

    // Draw stacked bars bottom-up
    let curY = baseY;
    for (const cat of CATEGORIES) {
      const h = px[cat.key] || 0;
      if (!h) continue;
      const segY = curY - h;

      const isHighlighted = isOpen && openSegment.catKey === cat.key;

      ctx.fillStyle = isHighlighted
        ? lighten(cat.color, 0.15)
        : (isOpen ? fade(cat.color, 0.55) : cat.color);

      const isTop = (cat === lastVisibleCat(px));
      roundedRect(ctx, barX, segY, barW, h, isTop ? BAR_RADIUS : 0, 0, 0, 0);
      ctx.fill();

      hitAreas.push({ x: barX, y: segY, w: barW, h, bucketKey: b.key, catKey: cat.key, barIndex: i });
      curY = segY;
    }

    // X-axis label
    const lbl  = b.label;
    const cPri = isToday ? 'rgba(232,112,90,0.9)' : '#9B9890';
    const cSec = isToday ? 'rgba(232,112,90,0.7)' : '#B8B5B0';
    const cYear = '#E8705A';
    ctx.textAlign = 'center';
    const cx = barX + barW / 2;

    if (currentView === 'day') {
      // lbl = [dayInit, dateNum, monthAbbrev, yearOrNull]
      ctx.font = `400 11px "DM Mono", monospace`;
      ctx.fillStyle = cSec;   ctx.fillText(lbl[0], cx, baseY + 13); // day initial
      ctx.fillStyle = cPri;   ctx.fillText(lbl[1], cx, baseY + 25); // date number
      ctx.fillStyle = cSec;   ctx.fillText(lbl[2], cx, baseY + 37); // month
      if (lbl[3]) {
        ctx.fillStyle = cYear; ctx.fillText(lbl[3], cx, baseY + 42); // year (new year only)
      }
    } else if (currentView === 'week') {
      // lbl = [dateNum, monthAbbrev, yearOrNull]
      ctx.font = `400 11px "DM Mono", monospace`;
      ctx.fillStyle = cPri; ctx.fillText(lbl[0], cx, baseY + 15); // date number
      ctx.fillStyle = cSec; ctx.fillText(lbl[1], cx, baseY + 27); // month
      if (lbl[2]) {
        ctx.fillStyle = cYear; ctx.fillText(lbl[2], cx, baseY + 39); // year (new year only)
      }
    } else {
      // month: lbl = [monthAbbrev, year]
      ctx.font = `400 11px "DM Mono", monospace`;
      ctx.fillStyle = cPri; ctx.fillText(lbl[0], cx, baseY + 15);
      ctx.fillStyle = cSec; ctx.fillText(lbl[1], cx, baseY + 27);
    }
  }

  // Scroll to right on day view initial load
  if (currentView === 'day' && !canvas._scrolled) {
    canvas._scrolled = true;
    requestAnimationFrame(() => {
      const scroll = document.getElementById('chart-scroll');
      scroll.scrollLeft = scroll.scrollWidth;
    });
  }
}

function lastVisibleCat(px) {
  for (let i = CATEGORIES.length - 1; i >= 0; i--) {
    if ((px[CATEGORIES[i].key] || 0) > 0) return CATEGORIES[i];
  }
  return null;
}

function fade(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function lighten(hex, amount) {
  const r = Math.min(255, parseInt(hex.slice(1,3),16) + Math.round(255*amount));
  const g = Math.min(255, parseInt(hex.slice(3,5),16) + Math.round(255*amount));
  const b = Math.min(255, parseInt(hex.slice(5,7),16) + Math.round(255*amount));
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

function roundedRect(ctx, x, y, w, h, tl, tr, br, bl) {
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

// ── CANVAS CLICK ─────────────────────────────
document.addEventListener('click', e => {
  const canvas = document.getElementById('chart-canvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (e.clientX < rect.left || e.clientX > rect.right ||
      e.clientY < rect.top  || e.clientY > rect.bottom) return;

  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  for (const hit of hitAreas) {
    if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) {
      if (openSegment && openSegment.bucketKey === hit.bucketKey && openSegment.catKey === hit.catKey) {
        openSegment = null;
      } else {
        openSegment = { bucketKey: hit.bucketKey, catKey: hit.catKey };
      }
      drawChart();
      renderDetailPanel();
      return;
    }
  }

  // Click outside any bar — close
  if (openSegment) {
    openSegment = null;
    drawChart();
    renderDetailPanel();
  }
});

// ── DETAIL PANEL ─────────────────────────────
const MAP_CATS = new Set(['run', 'walk']);

function renderDetailPanel() {
  const panel = document.getElementById('detail-panel');

  if (!openSegment) {
    panel.classList.remove('open');
    panel.innerHTML = '';
    if (window._leafletMap) { window._leafletMap.remove(); window._leafletMap = null; }
    return;
  }

  const { bucketKey: bk, catKey } = openSegment;
  const bucket = buckets.find(b => b.key === bk);
  if (!bucket) return;

  const activities = bucket.cats[catKey] || [];
  const cat        = CATEGORIES.find(c => c.key === catKey);
  if (!activities.length) return;

  if (currentView === 'day') {
    renderDetailDay(panel, bk, catKey, activities, cat);
  } else {
    renderDetailAggregate(panel, bk, catKey, activities, cat);
  }
}

// ── DAY VIEW DETAIL (unchanged behaviour) ────
function renderDetailDay(panel, bk, catKey, activities, cat) {
  const item = activities[0];
  if (!item) return;
  const s = item.summary;

  // Gym Strength gets its own rich layout
  if (catKey === 'gym') {
    renderGymDetail(panel, bk, item, cat);
    return;
  }

  // Jump Rope gets its own compact layout
  if (catKey === 'jump') {
    renderJumpRopeDetail(panel, bk, item, cat);
    return;
  }

  // Accessory Work gets its own exercise-list layout
  if (catKey === 'acc') {
    renderAccessoryDetail(panel, bk, item, cat);
    return;
  }

  const displayName = s.stravaName ? `${s.name} — ${s.stravaName}` : s.name;
  const bucketTitle = formatDate(bk);

  const hasMap    = MAP_CATS.has(catKey) && item.gpsTrack && item.gpsTrack.length > 0;
  const photos    = (s.photoFilenames || []);
  const hasPhotos = photos.length > 0;

  let cols = 1;
  if (hasMap)    cols++;
  if (hasPhotos) cols++;
  const gridStyle = `grid-template-columns: repeat(${cols}, 1fr)`;

  const statsHTML  = buildStatsHTML(s, item.raw, catKey);
  const zonesHTML  = buildZonesHTML(s, catKey);
  const photosHTML = buildPhotosHTML(photos);

  const mapCol    = hasMap    ? `<div class="dp-col dp-col-map" id="dp-map-container"></div>` : '';
  const statsCol  = `<div class="dp-col dp-col-stats"><div class="dp-stat-name">${displayName}</div><div class="dp-stat-grid">${statsHTML}</div>${zonesHTML}</div>`;
  const photosCol = hasPhotos ? `<div class="dp-col dp-col-photos">${photosHTML}</div>` : '';

  const colsHTML = [mapCol, statsCol, photosCol].filter(Boolean).join('');

  panel.innerHTML = `
    <div class="detail-header">
      <div class="detail-title">
        <span class="detail-cat-dot" style="background:${cat.color}"></span>
        ${cat.label} · ${bucketTitle}
      </div>
      <span class="detail-close" id="detail-close-btn">✕</span>
    </div>
    <div class="detail-body">
      <div class="dp-grid" style="${gridStyle}">${colsHTML}</div>
    </div>`;

  panel.classList.add('open');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  document.getElementById('detail-close-btn').addEventListener('click', () => {
    openSegment = null;
    drawChart();
    renderDetailPanel();
  });

  if (hasPhotos) {
    requestAnimationFrame(() => {
      document.querySelectorAll('.dp-thumb').forEach(el => {
        el.addEventListener('click', () => {
          const photoList = JSON.parse(el.dataset.photos);
          openLightbox(photoList, parseInt(el.dataset.index));
        });
      });
    });
  }

  if (hasMap) {
    if (window._leafletMap) { window._leafletMap.remove(); window._leafletMap = null; }
    requestAnimationFrame(() => initMap(item.gpsTrack, cat.color));
  }
}

// ── GYM STRENGTH DETAIL PANEL ────────────────
const COMPOUND_NAMES = new Set([
  'Deadlift (Barbell)', 'Overhead Press (Barbell)',
  'Squat (Barbell)', 'Bench Press (Barbell)',
]);

const WENDLER_SCHEMES = {
  1: { sets: '5 / 5 / 5+',   pcts: '65% / 75% / 85%' },
  2: { sets: '3 / 3 / 3+',   pcts: '70% / 80% / 90%' },
  3: { sets: '5 / 3 / 1+',   pcts: '75% / 85% / 95%' },
};

const RIR_SCHEMES = { 1: '3 RIR', 2: '2 RIR', 3: '2 RIR' };

// Detect programme from raw compound exerciseNotes
function detectProgramme(windows) {
  for (const w of windows) {
    if (COMPOUND_NAMES.has(w.exerciseTitle)) {
      const notes = w.exerciseNotes || '';
      if (/^RIR/i.test(notes)) return 'rir';
      if (/^B\d/i.test(notes))  return 'wendler';
    }
  }
  return null;
}

// Superset colour pairs — border colour, background tint
const SUPERSET_COLORS = [
  { border: '#1D9E75', bg: 'rgba(29,158,117,0.07)' },  // teal
  { border: '#534AB7', bg: 'rgba(83,74,183,0.07)'  },  // purple
  { border: '#D85A30', bg: 'rgba(216,90,48,0.07)'  },  // coral
  { border: '#3B6D11', bg: 'rgba(59,109,17,0.07)'  },  // green
  { border: '#BA7517', bg: 'rgba(186,117,23,0.07)' },  // amber
  { border: '#185FA5', bg: 'rgba(24,95,165,0.07)'  },  // blue
];

function renderGymDetail(panel, bk, item, cat) {
  const s       = item.summary;
  const windows = (item.raw && item.raw.windows) ? item.raw.windows : [];
  const block   = s.block;
  const week    = s.week;

  // Separate compounds and assistance
  const compounds  = windows.filter(w => COMPOUND_NAMES.has(w.exerciseTitle));
  const assistance = windows.filter(w => !COMPOUND_NAMES.has(w.exerciseTitle));

  // Build title line
  const dateShort = (() => {
    const [y, m, d] = bk.split('-').map(Number);
    return `${d} ${MONTHS[m-1]} ${y}`;
  })();

  let titleLine = `${s.name} &nbsp;·&nbsp; ${dateShort}`;
  if (block != null && week != null) {
    const prog = detectProgramme(windows);
    titleLine += ` &nbsp;·&nbsp; Block ${block} &nbsp;·&nbsp; Week ${week}`;
    if (prog === 'rir') {
      const rir = RIR_SCHEMES[week] || '';
      if (rir) titleLine += ` &nbsp;·&nbsp; ${rir}`;
    } else {
      const scheme = WENDLER_SCHEMES[week] || {};
      if (scheme.sets) titleLine += ` &nbsp;·&nbsp; ${scheme.sets} &nbsp;·&nbsp; ${scheme.pcts}`;
    }
    titleLine += ` &nbsp;·&nbsp; ${fmtDuration(s.durationSeconds)}`;
  } else {
    titleLine += ` &nbsp;·&nbsp; ${fmtDuration(s.durationSeconds)}`;
  }

  // Format a single set as reps×weight
  function fmtSet(st) {
    if (st.durationSeconds != null) {
      const kg = st.weightKg != null ? `×${st.weightKg}kg` : '';
      return `${st.durationSeconds}s${kg}`;
    }
    const reps = st.reps || '—';
    const kg   = st.weightKg != null ? `${st.weightKg}kg` : 'BW';
    return `${reps}×${kg}`;
  }

  // Build compound block HTML
  function compoundBlockHTML(w) {
    const workingSets = w.sets.filter(st => st.setType === 'normal');
    const warmupSets  = w.sets.filter(st => st.setType === 'warmup');
    const topIdx      = workingSets.length - 1;

    const setsLine = workingSets.map((st, i) => {
      const formatted = fmtSet(st);
      return i === topIdx
        ? `<span class="gym-top-set">${formatted}</span>`
        : formatted;
    }).join(' · ');

    const warmupsLine = warmupSets.length
      ? `<div class="gym-ex-warmups">W ${warmupSets.map(fmtSet).join(' · ')}</div>`
      : '';

    return `<div class="gym-block gym-compound">
      <div class="gym-ex-name">${w.exerciseTitle}</div>
      <div class="gym-ex-sets">${setsLine || '—'}</div>
      ${warmupsLine}
    </div>`;
  }

  // Build ordered assistance list — supersets first, then standalones
  // Assign each unique supersetId a tint index 1..4, cycling by order of appearance
  const seenSupersets = new Set();
  const ssTintIndex   = new Map();
  const orderedAssist = [];
  for (const w of assistance) {
    if (w.supersetId != null && !seenSupersets.has(w.supersetId)) {
      seenSupersets.add(w.supersetId);
      ssTintIndex.set(w.supersetId, (ssTintIndex.size % 4) + 1);
      orderedAssist.push({ type: 'superset', id: w.supersetId,
        members: assistance.filter(x => x.supersetId === w.supersetId) });
    }
  }
  for (const w of assistance) {
    if (w.supersetId == null) {
      orderedAssist.push({ type: 'standalone', window: w });
    }
  }

  // Build assistance block HTML
  function assistBlockHTML(w, ssTint) {
    const workingSets = w.sets.filter(st => st.setType === 'normal');
    const setsLine = workingSets.map(fmtSet).join(' · ');
    const ssClass = ssTint ? ` gym-ss gym-ss-${ssTint}` : '';
    return `<div class="gym-block gym-assist${ssClass}">
      <div class="gym-ex-name">${w.exerciseTitle}</div>
      <div class="gym-ex-sets">${setsLine || '—'}</div>
    </div>`;
  }

  const assistHTML = orderedAssist.map(entry => {
    if (entry.type === 'standalone') return assistBlockHTML(entry.window, 0);
    const tint = ssTintIndex.get(entry.id);
    return entry.members.map(w => assistBlockHTML(w, tint)).join('');
  }).join('');

  panel.innerHTML = `
    <div class="detail-header">
      <div class="detail-title">
        <span class="detail-cat-dot" style="background:${cat.color}"></span>
        ${titleLine}
      </div>
      <span class="detail-close" id="detail-close-btn">✕</span>
    </div>
    <div class="detail-body">
      <div class="gym-detail-wrap">
        <div class="gym-exercise-row">
          ${compounds.map(compoundBlockHTML).join('')}
        </div>
        <div class="gym-exercise-row">
          ${assistHTML}
        </div>
      </div>
    </div>`;

  panel.classList.add('open');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  document.getElementById('detail-close-btn').addEventListener('click', () => {
    openSegment = null;
    drawChart();
    renderDetailPanel();
  });
}

// ── JUMP ROPE DETAIL ─────────────────────────
function renderJumpRopeDetail(panel, bk, item, cat) {
  const s = item.summary;

  // Title line: Jump Rope · 13 Apr 2026 · 9m 12s
  const dateShort = (() => {
    const [y, m, d] = bk.split('-').map(Number);
    return `${d} ${MONTHS[m-1]} ${y}`;
  })();
  const titleLine = `${s.name} &nbsp;·&nbsp; ${dateShort} &nbsp;·&nbsp; ${fmtDurationPrecise(s.durationSeconds)}`;

  // Build stat blocks — flex-wrap row, right border between, last has no border
  const statBlocks = [];

  // Duration — always present
  statBlocks.push(`
    <div class="dp-jr-stat">
      <div class="dp-jr-stat-lbl">DURATION</div>
      <div class="dp-jr-stat-val">${fmtDurationPrecise(s.durationSeconds)}</div>
    </div>`);

  // Skips — show "—" when null
  const skips = s.repetitionCount;
  statBlocks.push(`
    <div class="dp-jr-stat">
      <div class="dp-jr-stat-lbl">SKIPS</div>
      <div class="${skips != null ? 'dp-jr-stat-val' : 'dp-jr-stat-val-null'}">${skips != null ? skips.toLocaleString() : '—'}</div>
    </div>`);

  // HR stats — only when present
  const hasHR = s.avgHrBpm != null;
  if (hasHR) {
    statBlocks.push(`
      <div class="dp-jr-stat">
        <div class="dp-jr-stat-lbl">AVG HR</div>
        <div class="dp-jr-stat-val">${s.avgHrBpm} bpm</div>
      </div>`);
    statBlocks.push(`
      <div class="dp-jr-stat">
        <div class="dp-jr-stat-lbl">MAX HR</div>
        <div class="dp-jr-stat-val">${s.maxHrBpm} bpm</div>
      </div>`);
  }

  // HR zones bar — only when zones populated
  const z = s.hrZones;
  const zoneTotal = z ? (z.z1Seconds||0) + (z.z2Seconds||0) + (z.z3Seconds||0) + (z.z4Seconds||0) + (z.z5Seconds||0) : 0;
  if (z && zoneTotal > 0) {
    const pct = v => Math.round((v||0) / zoneTotal * 100);
    const zoneColors = ['#60B8D4','#6DBF7E','#F5C842','#F07C3A','#E84040'];
    const zoneVals = [z.z1Seconds, z.z2Seconds, z.z3Seconds, z.z4Seconds, z.z5Seconds];
    const bars = zoneVals.map((v, i) => {
      const p = pct(v);
      return p > 0 ? `<div style="width:${p}%;background:${zoneColors[i]};height:100%"></div>` : '';
    }).join('');
    const labels = ['Z1','Z2','Z3','Z4','Z5'].map((lbl, i) =>
      `<span style="font-size:11px;color:${zoneColors[i]}">${lbl}</span>`
    ).join('');
    statBlocks.push(`
      <div class="dp-jr-stat dp-jr-zones-block">
        <div class="dp-jr-stat-lbl">HR ZONES</div>
        <div class="dp-jr-zones-bar">${bars}</div>
        <div class="dp-jr-zones-labels">${labels}</div>
      </div>`);
  }

  panel.innerHTML = `
    <div class="detail-header">
      <div class="detail-title">
        <span class="detail-cat-dot" style="background:${cat.color}"></span>
        ${titleLine}
      </div>
      <span class="detail-close" id="detail-close-btn">✕</span>
    </div>
    <div class="detail-body">
      <div class="dp-jr-wrap">
        <div class="dp-jr-stats">${statBlocks.join('')}</div>
      </div>
    </div>`;

  panel.classList.add('open');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  document.getElementById('detail-close-btn').addEventListener('click', () => {
    openSegment = null;
    drawChart();
    renderDetailPanel();
  });
}

// ── ACCESSORY DETAIL PANEL ───────────────────
// ── SHARED ACCESSORY EXERCISE BLOCK BUILDER ──
function buildAccExerciseHTML(raw) {
  const windows = (raw && raw.windows) ? raw.windows : [];

  function fmtAccSet(st) {
    if (st.durationSeconds != null) return `${st.durationSeconds}s`;
    const reps = st.reps != null ? st.reps : '—';
    if (st.weightKg == null || st.weightKg === 0) return `${reps}`;
    return `${reps}×${st.weightKg}kg`;
  }

  const seenSupersets = new Set();
  const ssTintIndex   = new Map();
  const orderedExs    = [];
  for (const w of windows) {
    if (w.supersetId != null && !seenSupersets.has(w.supersetId)) {
      seenSupersets.add(w.supersetId);
      ssTintIndex.set(w.supersetId, (ssTintIndex.size % 4) + 1);
      orderedExs.push({ type: 'superset', id: w.supersetId,
        members: windows.filter(x => x.supersetId === w.supersetId) });
    }
  }
  for (const w of windows) {
    if (w.supersetId == null) orderedExs.push({ type: 'standalone', window: w });
  }

  function exBlockHTML(w, ssTint) {
    const sets = (w.sets || []).filter(st => st.setType !== 'warmup');
    const setsLine = sets.map(fmtAccSet).join(' · ');
    const ssClass = ssTint ? ` gym-ss gym-ss-${ssTint}` : '';
    return `<div class="gym-block gym-assist${ssClass}">
      <div class="gym-ex-name">${w.exerciseTitle}</div>
      <div class="gym-ex-sets">${setsLine || '—'}</div>
    </div>`;
  }

  return orderedExs.map(entry => {
    if (entry.type === 'standalone') return exBlockHTML(entry.window, 0);
    const tint = ssTintIndex.get(entry.id);
    return entry.members.map(w => exBlockHTML(w, tint)).join('');
  }).join('');
}

function renderAccessoryDetail(panel, bk, item, cat) {
  const s = item.summary;
  const dateShort = (() => {
    const [y, m, d] = bk.split('-').map(Number);
    return `${d} ${MONTHS[m-1]} ${y}`;
  })();
  const titleLine = `${s.name.trim()} &nbsp;·&nbsp; ${dateShort} &nbsp;·&nbsp; ${fmtDuration(s.durationSeconds)}`;

  panel.innerHTML = `
    <div class="detail-header">
      <div class="detail-title">
        <span class="detail-cat-dot" style="background:${cat.color}"></span>
        ${titleLine}
      </div>
      <span class="detail-close" id="detail-close-btn">✕</span>
    </div>
    <div class="detail-body">
      <div class="gym-detail-wrap">
        <div class="gym-exercise-row">
          ${buildAccExerciseHTML(item.raw)}
        </div>
      </div>
    </div>`;

  panel.classList.add('open');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  document.getElementById('detail-close-btn').addEventListener('click', () => {
    openSegment = null;
    drawChart();
    renderDetailPanel();
  });
}

// ── AGGREGATE ROW CONTENT BUILDERS ───────────

function buildRunWalkInlineStats(s) {
  const parts = [];
  if (s.durationSeconds) parts.push(fmtDuration(s.durationSeconds));
  if (s.avgHrBpm)        parts.push(`${s.avgHrBpm} bpm avg`);
  if (s.maxHrBpm)        parts.push(`${s.maxHrBpm} bpm max`);
  if (s.avgPaceMinPerKm) parts.push(`${fmtPace(s.avgPaceMinPerKm)} /km`);
  if (s.elevationGainM)  parts.push(`${Math.round(s.elevationGainM)}m elev`);
  return parts.join(' · ');
}

function buildJumpInlineStats(s) {
  const parts = [];
  parts.push(fmtDurationPrecise(s.durationSeconds));
  if (s.repetitionCount != null) parts.push(`${s.repetitionCount.toLocaleString()} skips`);
  else parts.push(`<span style="opacity:0.4">—</span>`);
  if (s.avgHrBpm) parts.push(`${s.avgHrBpm} bpm avg`);
  if (s.maxHrBpm) parts.push(`${s.maxHrBpm} bpm max`);
  if (s.hrZones) {
    const z = s.hrZones;
    const total = (z.z1Seconds||0)+(z.z2Seconds||0)+(z.z3Seconds||0)+(z.z4Seconds||0)+(z.z5Seconds||0);
    if (total > 0) {
      const zoneColors = ['#60B8D4','#6DBF7E','#F5C842','#F07C3A','#E84040'];
      const zoneVals = [z.z1Seconds,z.z2Seconds,z.z3Seconds,z.z4Seconds,z.z5Seconds];
      const bars = zoneVals.map((v,i) => {
        const p = Math.round((v||0)/total*100);
        return p > 0 ? `<div style="width:${p}%;background:${zoneColors[i]};height:100%"></div>` : '';
      }).join('');
      parts.push(`<span class="dp-bar-zones-wrap"><span class="dp-bar-zones-bar">${bars}</span></span>`);
    }
  }
  return parts.join(' · ');
}

function buildGymCardioInlineStats(s) {
  const parts = [fmtDuration(s.durationSeconds)];
  if (s.avgHrBpm) parts.push(`${s.avgHrBpm} bpm avg`);
  if (s.maxHrBpm) parts.push(`${s.maxHrBpm} bpm max`);
  return parts.join(' · ');
}

function buildGymBarParts(item) {
  const windows    = (item.raw && item.raw.windows) ? item.raw.windows : [];
  const compounds  = windows.filter(w => COMPOUND_NAMES.has(w.exerciseTitle));
  const assistance = windows.filter(w => !COMPOUND_NAMES.has(w.exerciseTitle));

  function fmtSet(st) {
    if (st.durationSeconds != null) {
      const kg = st.weightKg != null ? `×${st.weightKg}kg` : '';
      return `${st.durationSeconds}s${kg}`;
    }
    const kg = st.weightKg != null ? `${st.weightKg}kg` : 'BW';
    return `${st.reps || '—'}×${kg}`;
  }

  const compoundsHTML = compounds.map(w => {
    const workingSets = w.sets.filter(st => st.setType === 'normal');
    const setsStr = workingSets.map(fmtSet).join('·');
    return `<div class="dp-bar-gym-compound">
      <span class="dp-bar-gym-name">${w.exerciseTitle}</span>
      <span class="dp-bar-gym-sets">${setsStr}</span>
    </div>`;
  }).join('');

  const seenNames = new Set();
  const assistNames = [];
  for (const w of assistance) {
    if (!seenNames.has(w.exerciseTitle)) {
      seenNames.add(w.exerciseTitle);
      assistNames.push(w.exerciseTitle);
    }
  }
  const assistHTML = assistNames.join(' · ');

  return { compoundsHTML, assistHTML };
}

// ── WEEK / MONTH AGGREGATE DETAIL ────────────
function renderDetailAggregate(panel, bk, catKey, activities, cat) {
  const bucketTitle = currentView === 'week'
    ? `Week of ${formatDate(bk)}`
    : formatMonth(bk);

  const totalMetric   = activities.reduce((s, a) => s + getMetric(a.summary, a.raw, catKey), 0);
  const totalDuration = activities.reduce((s, a) => s + (a.summary.durationSeconds || 0), 0);
  const count         = activities.length;
  const avgDuration   = count ? Math.round(totalDuration / count) : 0;

  let metricLabel = '', metricValue = '', avgMetricLabel = '', avgMetricValue = '';
  if (catKey === 'run' || catKey === 'walk') {
    metricLabel    = 'total km';    metricValue    = totalMetric.toFixed(1);
    avgMetricLabel = 'avg km';      avgMetricValue = (totalMetric / count).toFixed(1);
  } else if (catKey === 'gymcardio') {
    metricLabel    = 'total time';  metricValue    = fmtDuration(totalMetric);
    avgMetricLabel = 'avg time';    avgMetricValue = fmtDuration(Math.round(totalMetric / count));
  } else if (catKey === 'jump') {
    metricLabel    = 'total skips'; metricValue    = Math.round(totalMetric).toLocaleString();
    avgMetricLabel = 'avg skips';   avgMetricValue = Math.round(totalMetric / count).toLocaleString();
  } else if (catKey === 'acc') {
    metricLabel    = 'total reps';  metricValue    = Math.round(totalMetric).toLocaleString();
    avgMetricLabel = 'avg reps';    avgMetricValue = Math.round(totalMetric / count).toLocaleString();
  } else if (catKey === 'gym') {
    metricLabel    = 'total load';  metricValue    = Math.round(totalMetric).toLocaleString() + ' kg';
    avgMetricLabel = 'avg load';    avgMetricValue = Math.round(totalMetric / count).toLocaleString() + ' kg';
  }

  const summaryStats = [
    { val: metricValue,                lbl: metricLabel                         },
    { val: fmtDuration(totalDuration), lbl: 'total time'                        },
    { val: String(count),              lbl: count === 1 ? 'session' : 'sessions' },
    { val: avgMetricValue,             lbl: avgMetricLabel                       },
    { val: fmtDuration(avgDuration),   lbl: 'avg duration'                      },
  ].filter(st => st.val && st.val !== '—');

  const summaryHTML = summaryStats.map(st => `
    <div class="dp-stat">
      <div class="dp-stat-val">${st.val}</div>
      <div class="dp-stat-lbl">${st.lbl}</div>
    </div>`).join('');

  // run/walk/gym support click-to-expand; others are static
  const canExpand = catKey === 'run' || catKey === 'walk' || catKey === 'gym';

  const sorted = [...activities].sort((a, b) => a.summary.date.localeCompare(b.summary.date));

  const rowsHTML = sorted.map((item, idx) => {
    const s           = item.summary;
    const dateStr     = formatDate(s.date);
    const displayName = s.stravaName ? `${s.name} — ${s.stravaName}` : s.name;

    let barContent = '';

    if (catKey === 'run' || catKey === 'walk') {
      const kmStr = s.distanceKm ? `${s.distanceKm.toFixed(2)} km` : '';
      const hasPhotos = s.photoFilenames && s.photoFilenames.length > 0;
      const cameraIcon = hasPhotos ? `<span class="dp-row-camera"><svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 3L6.5 1.5h3L10.5 3H13a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h2.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="8" cy="7.5" r="2" stroke="currentColor" stroke-width="1.2"/></svg></span>` : '';
      barContent = `
        <div class="dp-row-left">
          <div class="dp-row-date">${dateStr}</div>
          <div class="dp-row-name-inline">
            <span class="dp-row-name-text">${displayName}</span>
            <span class="dp-row-inline-stats">${buildRunWalkInlineStats(s)}</span>
            ${cameraIcon}
            ${kmStr ? `<span class="dp-row-km">${kmStr}</span>` : ''}
          </div>
        </div>
        <div class="dp-row-chevron">›</div>`;

    } else if (catKey === 'gym') {
      const _gs       = item.summary;
      const _windows  = (item.raw && item.raw.windows) ? item.raw.windows : [];
      const _hasW     = _gs.block != null && _gs.week != null;
      const _prog     = _hasW ? detectProgramme(_windows) : null;
      let progLabel = '';
      if (_hasW) {
        if (_prog === 'rir') {
          progLabel = `<span class="dp-row-gym-meta">Block ${_gs.block} · Week ${_gs.week} · RIR</span>`;
        } else {
          progLabel = `<span class="dp-row-gym-meta">Block ${_gs.block} · Week ${_gs.week} · 5/3/1</span>`;
        }
      }
      const { compoundsHTML, assistHTML } = buildGymBarParts(item);
      barContent = `
        <div class="dp-row-left dp-row-left-gym">
          <div class="dp-row-date">${dateStr}</div>
          <div class="dp-row-gym-title">${displayName} ${progLabel}</div>
          <div class="dp-row-gym-exercises">
            <div class="dp-row-gym-compounds-wrap">${compoundsHTML}</div>${assistHTML ? `<span class="dp-row-gym-assist-inline">${assistHTML}</span>` : ''}
          </div>
        </div>
        <div class="dp-row-chevron">›</div>`;

    } else if (catKey === 'acc') {
      // Name + duration stacked left; exercise blocks flow to the right
      barContent = `
        <div class="dp-row-acc-wrap">
          <div class="dp-row-date">${dateStr}</div>
          <div class="dp-row-acc-content">
            <div class="dp-row-acc-name-col">
              <span class="dp-row-name-text">${s.name.trim()}</span>
              <div class="dp-row-acc-dur">${fmtDuration(s.durationSeconds)}</div>
            </div>
            <div class="dp-row-acc-exercises">
              <div class="gym-exercise-row">${buildAccExerciseHTML(item.raw)}</div>
            </div>
          </div>
        </div>`;

    } else if (catKey === 'jump') {
      barContent = `
        <div class="dp-row-left">
          <div class="dp-row-date">${dateStr}</div>
          <div class="dp-row-name-inline">
            <span class="dp-row-name-text">Jump Rope</span>
            <span class="dp-row-inline-stats">${buildJumpInlineStats(s)}</span>
          </div>
        </div>`;

    } else if (catKey === 'gymcardio') {
      barContent = `
        <div class="dp-row-left">
          <div class="dp-row-date">${dateStr}</div>
          <div class="dp-row-name-inline">
            <span class="dp-row-name-text">${displayName}</span>
            <span class="dp-row-inline-stats">${buildGymCardioInlineStats(s)}</span>
          </div>
        </div>`;
    }

    const expandDiv = canExpand ? `<div class="dp-activity-expand" id="dp-expand-${idx}"></div>` : '';
    const rowClass  = canExpand ? 'dp-activity-row dp-row-expandable' : 'dp-activity-row dp-row-static';
    return `<div class="dp-agg-item"><div class="${rowClass}" data-idx="${idx}" ${canExpand ? 'tabindex="0"' : ''}>${barContent}</div>${expandDiv}</div>`;
  }).join('');

  const expandAllBtn = canExpand
    ? `<button class="dp-expand-all-btn" id="dp-expand-all-btn" title="Expand all">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 5.5L7 9.5L11 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
       </button>`
    : '';

  panel.innerHTML = `
    <div class="detail-header">
      <div class="detail-title">
        <span class="detail-cat-dot" style="background:${cat.color}"></span>
        ${cat.label} · ${bucketTitle}
      </div>
      <div class="detail-header-actions">
        ${expandAllBtn}
        <span class="detail-close" id="detail-close-btn">✕</span>
      </div>
    </div>
    <div class="detail-body">
      <div class="dp-agg-layout">
        <div class="dp-agg-summary">
          <div class="dp-stat-grid dp-agg-stat-grid">${summaryHTML}</div>
        </div>
        <div class="dp-agg-list">${rowsHTML}</div>
      </div>
    </div>`;

  panel.classList.add('open');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  document.getElementById('detail-close-btn').addEventListener('click', () => {
    openSegment = null;
    drawChart();
    renderDetailPanel();
  });

  if (!canExpand) return;

  // Independent toggle — each row expands/collapses on its own
  const rows = panel.querySelectorAll('.dp-row-expandable');

  function expandRow(row) {
    const idx = parseInt(row.dataset.idx);
    const expandEl = document.getElementById(`dp-expand-${idx}`);
    if (row.classList.contains('dp-row-active')) return;
    row.classList.add('dp-row-active');
    renderExpandedActivity(expandEl, sorted[idx], catKey, cat);
    expandEl.classList.add('open');
  }

  function collapseRow(row) {
    const idx = parseInt(row.dataset.idx);
    const expandEl = document.getElementById(`dp-expand-${idx}`);
    if (!row.classList.contains('dp-row-active')) return;
    expandEl.classList.remove('open');
    expandEl.innerHTML = '';
    row.classList.remove('dp-row-active');
    if (window._leafletMap) { window._leafletMap.remove(); window._leafletMap = null; }
  }

  rows.forEach(row => {
    const expandEl = document.getElementById(`dp-expand-${row.dataset.idx}`);
    if (expandEl) expandEl.addEventListener('click', () => row.click());

    row.addEventListener('click', () => {
      if (row.classList.contains('dp-row-active')) {
        collapseRow(row);
      } else {
        expandRow(row);
      }
      updateExpandAllBtn();
    });
  });

  // Expand / collapse all
  const expandAllBtnEl = document.getElementById('dp-expand-all-btn');
  let allExpanded = false;

  function updateExpandAllBtn() {
    if (!expandAllBtnEl) return;
    const openCount = panel.querySelectorAll('.dp-row-expandable.dp-row-active').length;
    allExpanded = openCount === rows.length;
    expandAllBtnEl.classList.toggle('dp-expand-all-open', allExpanded);
    expandAllBtnEl.title = allExpanded ? 'Collapse all' : 'Expand all';
  }

  if (expandAllBtnEl) {
    expandAllBtnEl.addEventListener('click', () => {
      if (allExpanded) {
        rows.forEach(r => collapseRow(r));
      } else {
        rows.forEach(r => expandRow(r));
      }
      updateExpandAllBtn();
    });
  }
}

// ── EXPANDED SINGLE ACTIVITY (inside aggregate list) ──
function renderExpandedActivity(container, item, catKey, cat) {
  if (catKey === 'gym') {
    const s       = item.summary;
    const windows = (item.raw && item.raw.windows) ? item.raw.windows : [];
    const compounds  = windows.filter(w => COMPOUND_NAMES.has(w.exerciseTitle));
    const assistance = windows.filter(w => !COMPOUND_NAMES.has(w.exerciseTitle));

    const dateShort = (() => {
      const [y, m, d] = item.summary.date.split('-').map(Number);
      return `${d} ${MONTHS[m-1]} ${y}`;
    })();

    let titleLine = `${s.name} &nbsp;·&nbsp; ${dateShort}`;
    if (s.block != null && s.week != null) {
      const prog = detectProgramme(windows);
      titleLine += ` &nbsp;·&nbsp; Block ${s.block} &nbsp;·&nbsp; Week ${s.week}`;
      if (prog === 'rir') {
        const rir = RIR_SCHEMES[s.week] || '';
        if (rir) titleLine += ` &nbsp;·&nbsp; ${rir}`;
      } else {
        const scheme = WENDLER_SCHEMES[s.week] || {};
        if (scheme.sets) titleLine += ` &nbsp;·&nbsp; ${scheme.sets} &nbsp;·&nbsp; ${scheme.pcts}`;
      }
    }
    titleLine += ` &nbsp;·&nbsp; ${fmtDuration(s.durationSeconds)}`;

    function fmtSet(st) {
      if (st.durationSeconds != null) {
        const kg = st.weightKg != null ? `×${st.weightKg}kg` : '';
        return `${st.durationSeconds}s${kg}`;
      }
      const kg = st.weightKg != null ? `${st.weightKg}kg` : 'BW';
      return `${st.reps || '—'}×${kg}`;
    }

    function compoundBlockHTML(w) {
      const workingSets = w.sets.filter(st => st.setType === 'normal');
      const warmupSets  = w.sets.filter(st => st.setType === 'warmup');
      const topIdx      = workingSets.length - 1;
      const setsLine = workingSets.map((st, i) => {
        const formatted = fmtSet(st);
        return i === topIdx ? `<span class="gym-top-set">${formatted}</span>` : formatted;
      }).join(' · ');
      const warmupsLine = warmupSets.length
        ? `<div class="gym-ex-warmups">W ${warmupSets.map(fmtSet).join(' · ')}</div>` : '';
      return `<div class="gym-block gym-compound">
        <div class="gym-ex-name">${w.exerciseTitle}</div>
        <div class="gym-ex-sets">${setsLine || '—'}</div>
        ${warmupsLine}
      </div>`;
    }

    const seenSupersets = new Set();
    const ssTintIndex   = new Map();
    const orderedAssist = [];
    for (const w of assistance) {
      if (w.supersetId != null && !seenSupersets.has(w.supersetId)) {
        seenSupersets.add(w.supersetId);
        ssTintIndex.set(w.supersetId, (ssTintIndex.size % 4) + 1);
        orderedAssist.push({ type: 'superset', id: w.supersetId,
          members: assistance.filter(x => x.supersetId === w.supersetId) });
      }
    }
    for (const w of assistance) {
      if (w.supersetId == null) orderedAssist.push({ type: 'standalone', window: w });
    }

    function assistBlockHTML(w, ssTint) {
      const workingSets = w.sets.filter(st => st.setType === 'normal');
      const setsLine = workingSets.map(fmtSet).join(' · ');
      const ssClass = ssTint ? ` gym-ss gym-ss-${ssTint}` : '';
      return `<div class="gym-block gym-assist${ssClass}">
        <div class="gym-ex-name">${w.exerciseTitle}</div>
        <div class="gym-ex-sets">${setsLine || '—'}</div>
      </div>`;
    }

    const assistHTML = orderedAssist.map(entry => {
      if (entry.type === 'standalone') return assistBlockHTML(entry.window, 0);
      const tint = ssTintIndex.get(entry.id);
      return entry.members.map(w => assistBlockHTML(w, tint)).join('');
    }).join('');

    container.innerHTML = `
      <div class="gym-detail-wrap dp-exp-gym-wrap">
        <div class="gym-exercise-row">
          ${compounds.map(compoundBlockHTML).join('')}
        </div>
        <div class="gym-exercise-row">
          ${assistHTML}
        </div>
      </div>`;
    return;
  }

  // Run / Walk expanded view
  const s         = item.summary;
  const hasMap    = MAP_CATS.has(catKey) && item.gpsTrack && item.gpsTrack.length > 0;
  const photos    = (s.photoFilenames || []);
  const hasPhotos = photos.length > 0;

  let cols = 1;
  if (hasMap)    cols++;
  if (hasPhotos) cols++;
  const gridStyle = `grid-template-columns: repeat(${cols}, 1fr)`;

  const displayName = s.stravaName ? `${s.name} — ${s.stravaName}` : s.name;
  const statsHTML   = buildStatsHTML(s, item.raw, catKey);
  const zonesHTML   = buildZonesHTML(s, catKey);
  const photosHTML  = buildPhotosHTML(photos);

  const mapCol    = hasMap    ? `<div class="dp-col dp-col-map dp-exp-map" id="dp-map-container"></div>` : '';
  const statsCol  = `<div class="dp-col dp-col-stats"><div class="dp-stat-name">${displayName}</div><div class="dp-stat-grid">${statsHTML}</div>${zonesHTML}</div>`;
  const photosCol = hasPhotos ? `<div class="dp-col dp-col-photos">${photosHTML}</div>` : '';

  container.innerHTML = `
    <div class="dp-grid dp-exp-grid" style="${gridStyle}">
      ${[mapCol, statsCol, photosCol].filter(Boolean).join('')}
    </div>`;

  if (hasPhotos) {
    requestAnimationFrame(() => {
      container.querySelectorAll('.dp-thumb').forEach(el => {
        el.addEventListener('click', () => {
          const photoList = JSON.parse(el.dataset.photos);
          openLightbox(photoList, parseInt(el.dataset.index));
        });
      });
    });
  }

  if (hasMap) {
    if (window._leafletMap) { window._leafletMap.remove(); window._leafletMap = null; }
    requestAnimationFrame(() => initMap(item.gpsTrack, cat.color));
  }
}

// ── SHARED STATS HELPERS ──────────────────────
function buildStatsHTML(s, raw, catKey) {
  const metricVal = getMetric(s, raw, catKey);
  let metricLabel = '', metricValue = '';
  if (catKey === 'run' || catKey === 'walk') {
    metricLabel = 'distance'; metricValue = `${metricVal.toFixed(2)} km`;
  } else if (catKey === 'gymcardio') {
    metricLabel = ''; metricValue = ''; // duration shown below; name is the key info
  } else if (catKey === 'jump') {
    metricLabel = 'skips'; metricValue = metricVal.toLocaleString();
  } else if (catKey === 'acc') {
    metricLabel = 'reps'; metricValue = metricVal.toLocaleString();
  } else if (catKey === 'gym') {
    metricLabel = 'kg load'; metricValue = Math.round(metricVal).toLocaleString();
  }

  return [
    metricValue ? { val: metricValue, lbl: metricLabel } : null,
    { val: fmtDuration(s.durationSeconds), lbl: 'duration' },
    s.avgHrBpm        ? { val: `${s.avgHrBpm} bpm`,               lbl: 'avg hr'    } : null,
    s.maxHrBpm        ? { val: `${s.maxHrBpm} bpm`,               lbl: 'max hr'    } : null,
    s.avgPaceMinPerKm ? { val: fmtPace(s.avgPaceMinPerKm),        lbl: 'pace'      } : null,
    s.elevationGainM  ? { val: `${Math.round(s.elevationGainM)}m`, lbl: 'elev gain' } : null,
  ].filter(Boolean).map(st => `
    <div class="dp-stat">
      <div class="dp-stat-val">${st.val}</div>
      <div class="dp-stat-lbl">${st.lbl}</div>
    </div>`).join('');
}

function buildZonesHTML(s, catKey) {
  if ((catKey !== 'run' && catKey !== 'walk') || !s.hrZones) return '';
  const z = s.hrZones;
  const total = (z.z1Seconds||0) + (z.z2Seconds||0) + (z.z3Seconds||0) + (z.z4Seconds||0) + (z.z5Seconds||0);
  if (!total) return '';

  const pct = v => Math.round((v||0) / total * 100);
  const zones = [
    { color: '#60B8D4', pct: pct(z.z1Seconds) },
    { color: '#6DBF7E', pct: pct(z.z2Seconds) },
    { color: '#F5C842', pct: pct(z.z3Seconds) },
    { color: '#F07C3A', pct: pct(z.z4Seconds) },
    { color: '#E84040', pct: pct(z.z5Seconds) },
  ].filter(z => z.pct > 0);

  const bars   = zones.map(z => `<div style="width:${z.pct}%;background:${z.color};height:100%"></div>`).join('');
  const labels = ['Z1','Z2','Z3','Z4','Z5'].map((lbl, i) => {
    const colors = ['#60B8D4','#6DBF7E','#F5C842','#F07C3A','#E84040'];
    return `<span style="font-size:11px;color:${colors[i]}">${lbl}</span>`;
  }).join('');

  return `<div class="dp-zones">
    <div class="dp-zones-lbl">hr zones</div>
    <div class="dp-zones-bar">${bars}</div>
    <div class="dp-zones-labels">${labels}</div>
  </div>`;
}

function buildPhotosHTML(photos) {
  if (!photos.length) return '';
  const slots  = photos.slice(0, 3);
  const thumbs = slots.map((f, i) =>
    `<div class="dp-thumb" data-index="${i}" data-photos='${JSON.stringify(photos)}'>
      <img src="photos/${f}" alt="photo ${i+1}" onerror="this.parentElement.style.display='none'">
    </div>`
  ).join('');
  const cls = slots.length === 1 ? 'dp-mosaic-1' : slots.length === 2 ? 'dp-mosaic-2' : 'dp-mosaic-3';
  return `<div class="dp-mosaic ${cls}">${thumbs}</div>`;
}

function initMap(track, color) {
  const container = document.getElementById('dp-map-container');
  if (!container) return;

  // Load Leaflet if not already loaded
  if (!window.L) {
    const link = document.createElement('link');
    link.rel  = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    script.onload = () => renderMap(container, track, color);
    document.head.appendChild(script);
  } else {
    renderMap(container, track, color);
  }
}

function renderMap(container, track, color) {
  const L   = window.L;
  const map = L.map(container, { zoomControl: true, attributionControl: false });
  window._leafletMap = map;

  // CartoDB tiles — work locally and on GitHub Pages
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
  }).addTo(map);

  const latlngs = track.map(p => [p[0], p[1]]);

  const line = L.polyline(latlngs, {
    color:  color,
    weight: 3,
    opacity: 0.85,
    lineJoin: 'round',
  }).addTo(map);

  // Start marker (green dot)
  const startIcon = L.divIcon({
    className: '',
    html: `<div style="width:10px;height:10px;border-radius:50%;background:#5A9B6E;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
  // End marker (coloured dot)
  const endIcon = L.divIcon({
    className: '',
    html: `<div style="width:10px;height:10px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });

  L.marker(latlngs[0], { icon: startIcon }).addTo(map);
  L.marker(latlngs[latlngs.length - 1], { icon: endIcon }).addTo(map);

  map.fitBounds(line.getBounds(), { padding: [16, 16] });
}

// ── LIGHTBOX ─────────────────────────────────
let _lbPhotos = [];
let _lbIndex  = 0;

function openLightbox(photos, index) {
  _lbPhotos = photos;
  _lbIndex  = index;

  let lb = document.getElementById('lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'lightbox';
    lb.innerHTML = `
      <div id="lb-backdrop"></div>
      <div id="lb-content">
        <img id="lb-img" alt="activity photo" />
        <div id="lb-counter"></div>
        <button id="lb-prev">&#8592;</button>
        <button id="lb-next">&#8594;</button>
        <button id="lb-close">&#10005;</button>
      </div>`;
    document.body.appendChild(lb);
    document.getElementById('lb-backdrop').addEventListener('click', closeLightbox);
    document.getElementById('lb-close').addEventListener('click', closeLightbox);
    document.getElementById('lb-prev').addEventListener('click', () => lbNav(-1));
    document.getElementById('lb-next').addEventListener('click', () => lbNav(1));
    document.addEventListener('keydown', lbKeyHandler);
  }

  lbRender();
  lb.classList.add('open');
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (lb) lb.classList.remove('open');
}

function lbNav(dir) {
  _lbIndex = (_lbIndex + dir + _lbPhotos.length) % _lbPhotos.length;
  lbRender();
}

function lbRender() {
  document.getElementById('lb-img').src = `photos/${_lbPhotos[_lbIndex]}`;
  document.getElementById('lb-counter').textContent = `${_lbIndex + 1} / ${_lbPhotos.length}`;
  document.getElementById('lb-prev').style.display = _lbPhotos.length > 1 ? '' : 'none';
  document.getElementById('lb-next').style.display = _lbPhotos.length > 1 ? '' : 'none';
}

function lbKeyHandler(e) {
  const lb = document.getElementById('lightbox');
  if (!lb || !lb.classList.contains('open')) return;
  if (e.key === 'Escape')      closeLightbox();
  if (e.key === 'ArrowLeft')   lbNav(-1);
  if (e.key === 'ArrowRight')  lbNav(1);
}

function fmtPace(minPerKm) {
  if (!minPerKm) return '—';
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${String(s).padStart(2,'0')}`;
}

// ── LEGEND ───────────────────────────────────
function renderLegend() {
  const el = document.getElementById('legend');
  el.innerHTML = CATEGORIES.map(cat => `
    <div class="legend-item${hiddenCats.has(cat.key) ? ' hidden' : ''}" data-cat="${cat.key}">
      <div class="legend-dot" style="background:${cat.color}"></div>
      <span class="legend-label">${cat.label}</span>
    </div>`).join('');

  el.querySelectorAll('.legend-item').forEach(item => {
    item.addEventListener('click', () => {
      const k = item.dataset.cat;
      if (hiddenCats.has(k)) hiddenCats.delete(k);
      else hiddenCats.add(k);
      item.classList.toggle('hidden');
      drawChart();
    });
  });
}

// ── COUNTDOWNS ───────────────────────────────
function renderCountdowns() {
  const el  = document.getElementById('countdowns');
  const now = new Date();
  now.setHours(0,0,0,0);
  el.innerHTML = EVENTS.map(ev => {
    const d    = new Date(ev.date);
    const diff = Math.ceil((d - now) / 86400000);
    if (diff < 0) return '';
    return `<div class="countdown-pill">
      <span class="countdown-days">${diff}</span>
      <span class="countdown-label">${ev.label}</span>
    </div>`;
  }).join('');
}

// ── HEADER STATS ─────────────────────────────
function renderHeaderStats() {
  const el = document.getElementById('header-meta');

  const totalRuns  = allActivities.filter(a => classify(a.summary) === 'run').length;
  const totalRunKm = allActivities.filter(a => classify(a.summary) === 'run')
    .reduce((s,a) => s + (a.summary.distanceKm||0), 0);
  const gymSessions  = allActivities.filter(a => classify(a.summary) === 'gym').length;
  const jumpSessions = allActivities.filter(a => classify(a.summary) === 'jump').length;

  el.innerHTML = `
    <div class="meta-stat"><span class="val">${totalRunKm.toFixed(0)}</span><span class="lbl">km run</span></div>
    <div class="meta-stat"><span class="val">${totalRuns}</span><span class="lbl">runs</span></div>
    <div class="meta-stat"><span class="val">${gymSessions}</span><span class="lbl">gym</span></div>
    <div class="meta-stat"><span class="val">${jumpSessions}</span><span class="lbl">jump rope</span></div>
  `;
}

// ── FORMAT HELPERS ────────────────────────────
function fmtDuration(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtDurationPrecise(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return `${m}m ${sec}s`;
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const date   = new Date(y, m-1, d);
  return `${days[date.getDay()]} ${d} ${months[m-1]} ${y}`;
}

function formatMonth(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[m-1]} ${y}`;
}

// ── VIEW TOGGLE ──────────────────────────────
document.getElementById('view-toggle').addEventListener('click', e => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn) return;
  currentView = btn.dataset.view;
  document.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
  openSegment = null;
  buckets     = buildBuckets(currentView);
  // Reset scroll flag so day view rescrolls
  const canvas = document.getElementById('chart-canvas');
  if (canvas) canvas._scrolled = false;
  drawChart();
  renderDetailPanel();
});

// ── RESIZE ───────────────────────────────────
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawChart, 100);
});

// ── LOAD & INIT ──────────────────────────────
async function loadData() {
  const wrap = document.getElementById('chart-scroll');
  wrap.innerHTML = `<div class="loading-state"><div class="loading-spinner"></div><span>Loading activities…</span></div>`;

  const results = await Promise.allSettled(DATA_FILES.map(f => fetch(f).then(r => r.json())));
  allActivities = [];
  for (const r of results) {
    if (r.status === 'fulfilled') allActivities.push(...r.value);
  }

  // Sort by date ascending
  allActivities.sort((a, b) => a.summary.date.localeCompare(b.summary.date));

  // Restore canvas
  wrap.innerHTML = '<canvas id="chart-canvas"></canvas>';
  // Re-attach click listener handled by delegation on document

  buckets = buildBuckets(currentView);

  renderHeaderStats();
  renderLegend();
  drawChart();
}

loadData();
