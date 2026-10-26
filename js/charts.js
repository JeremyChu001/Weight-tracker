// Minimal dependency-free SVG charts on a calendar-date x axis.
import { diffDays, addDays, formatDayMonth, formatShort } from './dates.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, parent) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks, step };
}

const observers = new WeakMap();

/**
 * Render a chart into `container`. Re-renders on resize.
 * opts: { start, end, series, refs, yFormat, tooltipFormat, includeZero, ariaLabel, emptyText, height }
 * series: [{ label, kind: 'bars'|'line'|'dots', cls, data: [{date, value, extra?}], maxGapDays }]
 */
export function renderChart(container, opts) {
  container._chartOpts = opts;
  if (!observers.has(container) && 'ResizeObserver' in window) {
    let lastW = 0;
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      if (Math.abs(w - lastW) > 4) { lastW = w; draw(container, container._chartOpts); }
    });
    ro.observe(container);
    observers.set(container, ro);
  }
  draw(container, opts);
}

function draw(container, opts) {
  container.innerHTML = '';
  container.classList.add('chart');
  const { start, end, series, refs = [], yFormat = v => String(v), includeZero = false, height = 200 } = opts;
  const hasData = series.some(s => s.data.some(d => d.value !== null && d.value !== undefined));
  if (!hasData) {
    const p = document.createElement('p'); p.className = 'chart-empty'; p.textContent = opts.emptyText || 'No data recorded for this period.';
    container.appendChild(p); return;
  }
  const W = Math.max(260, container.clientWidth || 320), H = height;
  const pad = { l: 46, r: 10, t: 14, b: 26 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const nDays = diffDays(start, end) + 1;
  const hasBars = series.some(s => s.kind === 'bars');
  const band = pw / nDays;
  const x = date => pad.l + (hasBars ? (diffDays(start, date) + 0.5) * band : nDays === 1 ? pw / 2 : (diffDays(start, date) / (nDays - 1)) * pw);

  let vals = series.flatMap(s => s.data.map(d => d.value)).filter(v => v !== null && v !== undefined);
  vals = vals.concat(refs.map(r => r.value).filter(v => v !== null && v !== undefined));
  let min = Math.min(...vals), max = Math.max(...vals);
  if (includeZero) min = Math.min(0, min);
  else { const padV = Math.max((max - min) * 0.12, opts.minPad ?? 0.5); min -= padV; max += padV; }
  const { lo, hi, ticks } = niceTicks(min, max, 4);
  const y = v => pad.t + ph - ((v - lo) / (hi - lo)) * ph;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': opts.ariaLabel || 'Chart', class: 'chart-svg' });
  container.appendChild(svg);

  // Grid + y labels
  const g = el('g', { class: 'grid' }, svg);
  for (const t of ticks) {
    el('line', { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t), class: t === lo && includeZero ? 'baseline' : 'gridline' }, g);
    const tx = el('text', { x: pad.l - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'axis-label' }, g);
    tx.textContent = yFormat(t);
  }
  // X labels: about 5, at evenly spaced day offsets
  const maxLabels = Math.max(2, Math.floor(pw / 62));
  const stepDays = Math.max(1, Math.ceil(nDays / maxLabels));
  for (let i = 0; i < nDays; i += stepDays) {
    const d = addDays(start, i);
    const tx = el('text', { x: x(d), y: H - 8, 'text-anchor': 'middle', class: 'axis-label' }, svg);
    tx.textContent = nDays <= 7 ? formatShort(d).split(' ')[0] + ' ' + formatShort(d).split(' ')[1] : formatDayMonth(d);
  }

  // Series
  for (const s of series) {
    const data = s.data.filter(d => d.value !== null && d.value !== undefined && d.date >= start && d.date <= end);
    if (s.kind === 'bars') {
      const span = s.barDays || 1; // a bar may represent several days (e.g. a week)
      const bw = Math.max(1.5, Math.min(24, band * span * 0.7));
      const base = y(Math.max(lo, 0));
      for (const d of data) {
        const top = y(d.value), h = Math.max(0, base - top), cx = x(d.date) + ((span - 1) / 2) * band;
        const r = Math.min(4, bw / 2, h);
        // Rounded data end, square at the baseline
        const path = h <= 0.5 ? `M${cx - bw / 2},${base}h${bw}` :
          `M${cx - bw / 2},${base}V${top + r}Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top}H${cx + bw / 2 - r}Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r}V${base}Z`;
        el('path', { d: path, class: `bar ${s.cls || ''} ${d.cls || ''}` }, svg);
        if (h <= 0.5) el('line', { x1: cx - bw / 2, x2: cx + bw / 2, y1: base - 1, y2: base - 1, class: `zero-mark ${s.cls || ''}` }, svg);
      }
    } else if (s.kind === 'line' || s.kind === 'dots') {
      if (s.kind === 'line' || s.connect) {
        // Break the line across gaps so nothing is implied where nothing was measured.
        const maxGap = s.maxGapDays ?? 7;
        let dStr = '', prev = null;
        for (const d of data) {
          dStr += (prev && diffDays(prev.date, d.date) <= maxGap ? 'L' : 'M') + x(d.date).toFixed(1) + ',' + y(d.value).toFixed(1);
          prev = d;
        }
        el('path', { d: dStr, class: `line ${s.cls || ''} ${s.kind === 'dots' ? 'connector' : ''}` }, svg);
      }
      if (s.kind === 'dots' || data.length === 1) {
        const r = s.kind === 'dots' ? (nDays > 120 ? 2.5 : 4) : 3;
        for (const d of data) el('circle', { cx: x(d.date), cy: y(d.value), r, class: `dot ${s.cls || ''}` }, svg);
      }
    }
  }
  // Reference lines, labelled at the right edge
  const placed = []; // label y positions on the right edge, to avoid collisions
  for (const r of refs) {
    if (r.value === null || r.value === undefined) continue;
    const ly = y(r.value);
    el('line', { x1: pad.l, x2: W - pad.r, y1: ly, y2: ly, class: `ref ${r.cls || ''}` }, svg);
    const clash = placed.some(p => Math.abs(p - ly) < 14);
    // On a clash, put the label on the left, below the line instead.
    const t = el('text', clash
      ? { x: pad.l + 4, y: ly + 13, 'text-anchor': 'start', class: 'ref-label' }
      : { x: W - pad.r - 2, y: ly - 4, 'text-anchor': 'end', class: 'ref-label' }, svg);
    if (!clash) placed.push(ly);
    t.textContent = r.label;
  }

  // Hover / touch layer
  const cross = el('line', { y1: pad.t, y2: pad.t + ph, class: 'crosshair', visibility: 'hidden' }, svg);
  const hit = el('rect', { x: pad.l, y: pad.t, width: pw, height: ph, class: 'hit' }, svg);
  const tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; tip.setAttribute('role', 'status');
  container.appendChild(tip);
  const lookup = new Map();
  for (const s of series) for (const d of s.data) {
    if (!lookup.has(d.date)) lookup.set(d.date, []);
    lookup.get(d.date).push({ s, d });
  }
  const show = ev => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * W;
    let i = hasBars ? Math.floor((px - pad.l) / band) : Math.round(((px - pad.l) / pw) * (nDays - 1));
    i = Math.max(0, Math.min(nDays - 1, i));
    // Snap to the nearest date that has data (within 3 days) for sparse series.
    let date = addDays(start, i);
    if (!lookup.has(date)) {
      for (let k = 1; k <= Math.max(3, Math.ceil(nDays / 40)); k++) {
        if (lookup.has(addDays(date, -k))) { date = addDays(date, -k); break; }
        if (lookup.has(addDays(date, k))) { date = addDays(date, k); break; }
      }
    }
    const html = opts.tooltip ? opts.tooltip(date, lookup.get(date) || []) : null;
    if (!html) { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); return; }
    cross.setAttribute('x1', x(date)); cross.setAttribute('x2', x(date)); cross.setAttribute('visibility', 'visible');
    tip.innerHTML = html; tip.hidden = false;
    const cx = (x(date) / W) * rect.width;
    const tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(rect.width - tw, cx - tw / 2)) + 'px';
    tip.style.top = '0px';
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
}

/** Build an accessible data table from rows: [[date, ...cells]] */
export function dataTable(headers, rows) {
  const t = document.createElement('table'); t.className = 'data-table';
  const thead = t.createTHead().insertRow();
  for (const h of headers) { const th = document.createElement('th'); th.textContent = h; th.scope = 'col'; thead.appendChild(th); }
  const tb = t.createTBody();
  for (const r of rows) { const tr = tb.insertRow(); r.forEach(c => { tr.insertCell().textContent = c; }); }
  return t;
}
