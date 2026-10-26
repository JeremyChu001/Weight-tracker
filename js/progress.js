import { state } from './state.js';
import { addDays, mondayOf, formatDayMonth, formatShort, formatMedium, diffDays, rangeDates } from './dates.js';
import * as C from './calc.js';
import { renderChart, dataTable } from './charts.js';
import { statCard, legend, tip } from './components.js';
import { $, $$, esc } from './ui.js';

let range = '30';
const RANGES = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All time']];

function rangeBounds(today, records) {
  if (range !== 'all') return { start: addDays(today, -(+range - 1)), end: today };
  const first = records.length ? records.reduce((m, r) => (r.lifestyleDate < m ? r.lifestyleDate : m), today) : today;
  return { start: first < addDays(today, -6) ? first : addDays(today, -6), end: today };
}

/** Daily values, or weekly averages of logged days when the range is long. */
function habitSeries(records, field, dateKey, start, end) {
  const days = diffDays(start, end) + 1;
  const daily = records.filter(r => r[dateKey] >= start && r[dateKey] <= end && r[field] !== null && r[field] !== undefined)
    .map(r => ({ date: r[dateKey], value: r[field] }));
  if (days <= 120) return { weekly: false, data: daily };
  const byWeek = new Map();
  for (const d of daily) { const m = mondayOf(d.date); if (!byWeek.has(m)) byWeek.set(m, []); byWeek.get(m).push(d.value); }
  return { weekly: true, data: [...byWeek].map(([m, v]) => ({ date: m, value: v.reduce((a, b) => a + b, 0) / v.length, n: v.length })) };
}

export function renderProgress(root) {
  const { records, settings: s, fmt: f, today } = state;
  const { start, end } = rangeBounds(today, records);
  const lifeStart = addDays(start, -1), lifeEnd = addDays(end, -1);
  const ps = C.progressStats(records, today, s.startWeightKg);
  const rangeDays = diffDays(start, end) + 1;

  let html = `<div class="seg wide range-seg" role="radiogroup" aria-label="Time range">${RANGES.map(([v, l]) =>
    `<button type="button" role="radio" aria-checked="${range === v}" data-range="${v}">${l}</button>`).join('')}</div>`;

  html += `<div class="card"><h2 class="h3">Morning weight</h2>
    ${legend([{ kind: 'dot', cls: 's-daily', label: 'Daily weigh-in' }, { kind: 'line', cls: 's-avg', label: '7-day average' }, ...(ps.hasWeights ? [{ kind: 'ref', cls: 'r-start', label: 'Starting weight' }] : []), ...(s.targetWeightKg !== null ? [{ kind: 'ref', cls: 'r-target', label: 'Target weight' }] : [])])}
    <div id="pg-weight"></div>
    <p class="fineprint">The 7-day average uses only the weigh-ins actually recorded in each 7-calendar-day window and is shown once a window holds at least ${C.MIN_ROLLING}. Gaps longer than a week are left as gaps. A single day's change mostly reflects water and digestion and should not be read as fat gained or lost.</p>
    <details class="table-toggle"><summary>View weight data as a table</summary><div id="pg-weight-table"></div></details>
  </div>`;

  // Statistics
  if (ps.hasWeights) {
    const trend = t => (t ? `${f.weightDiff(t.kgPerWeek, 2)}/week` : '—');
    html += `<h2 class="h2">Weight statistics</h2><div class="stats">
      ${statCard('Starting weight', f.weight(ps.startKg), ps.startFromSetting ? 'from Settings' : `first weigh-in, ${esc(formatDayMonth(ps.first.date))}`)}
      ${statCard('Latest weight', f.weight(ps.latest.kg), esc(formatMedium(ps.latest.date)))}
      ${statCard('Total change', f.weightDiff(ps.changeKg), f.pct(ps.changePct, 1) + ' of starting weight')}
      ${statCard('Highest', f.weight(ps.max.kg), esc(formatMedium(ps.max.date)))}
      ${statCard('Lowest', f.weight(ps.min.kg), esc(formatMedium(ps.min.date)))}
      ${statCard('7-day average', ps.avg7.n >= C.MIN_ROLLING ? f.weight(ps.avg7.avg) : '—', `${ps.avg7.n} weigh-in${ps.avg7.n === 1 ? '' : 's'}`)}
      ${statCard('30-day average', ps.avg30.n >= C.MIN_ROLLING ? f.weight(ps.avg30.avg) : '—', `${ps.avg30.n} weigh-in${ps.avg30.n === 1 ? '' : 's'}`)}
      ${statCard('Average weekly change', trend(ps.trend28 || ps.trendAll), ps.trend28 ? `trend over last 28 days (${ps.trend28.n} weigh-ins)` : ps.trendAll ? `trend over all ${ps.trendAll.n} weigh-ins` : 'needs 4+ weigh-ins over 14+ days')}
    </div>`;
  } else html += `<div class="card empty">No weigh-ins recorded yet. Statistics appear after your first morning weight.</div>`;

  // Habit averages over selected range
  const cal = C.windowStats(records, 'caloriesKcal', 'lifestyleDate', lifeStart, lifeEnd);
  const pro = C.windowStats(records, 'proteinG', 'lifestyleDate', lifeStart, lifeEnd);
  const stp = C.windowStats(records, 'steps', 'lifestyleDate', lifeStart, lifeEnd);
  const slp = C.windowStats(records, 'sleepMinutes', 'sleepNightEnd', start, end);
  const ex = C.exerciseStats(records, lifeStart, lifeEnd);
  const sub = st => `${st.n} of ${rangeDays} days logged`;
  html += `<h2 class="h2">Habits · ${esc(formatDayMonth(lifeStart))} – ${esc(formatDayMonth(lifeEnd))}</h2><div class="stats">
    ${statCard('Avg daily calories', cal.n ? f.kcal(cal.avg) : '—', sub(cal))}
    ${statCard('Avg daily protein', pro.n ? f.grams(Math.round(pro.avg)) : '—', sub(pro))}
    ${statCard('Avg daily steps', stp.n ? f.steps(stp.avg) : '—', sub(stp))}
    ${statCard('Avg nightly sleep', slp.n ? f.sleep(slp.avg) : '—', `${slp.n} of ${rangeDays} nights logged`)}
    ${statCard('Workout days', ex.answered ? String(ex.workouts) : '—', ex.answered ? `of ${ex.answered} days with exercise recorded` : 'No exercise logged')}
    ${statCard('Resistance sessions', ex.answered ? String(ex.resistance) : '—', 'days with resistance training')}
  </div>`;

  const ins = C.insights(records, today, s, kg => f.weight(kg, 1));
  html += `<div class="card"><h2 class="h3">Observations</h2>${ins.length ? `<ul class="insights">${ins.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="muted">Not enough recent data for observations yet. These appear after a few days of check-ins.</p>'}
    <p class="fineprint">These describe what your records show. Habits and weight changes occurring together does not mean one caused the other.</p></div>`;

  const habitCard = (id, title, note = '') => `<div class="card"><h2 class="h3">${title}</h2><div id="${id}-legend"></div><div id="${id}"></div>${note}<details class="table-toggle"><summary>View as a table</summary><div id="${id}-table"></div></details></div>`;
  html += habitCard('pg-cal', 'Calories vs target');
  html += habitCard('pg-pro', 'Protein vs target');
  html += habitCard('pg-steps', 'Daily steps vs target');
  html += habitCard('pg-sleep', 'Sleep duration', '<p class="fineprint">Plotted on the morning the sleep ended.</p>');
  html += habitCard('pg-ex', 'Weekly exercise frequency', '<p class="fineprint">Days with exercise in each Monday–Sunday week, by the date the exercise took place.</p>');
  root.innerHTML = html;

  $$('[data-range]', root).forEach(b => b.addEventListener('click', () => { range = b.dataset.range; renderProgress(root); }));

  // Weight chart
  const ws = C.weightSeries(records);
  const avg = C.rollingAverage(ws);
  const inRange = ws.filter(p => p.date >= start && p.date <= end);
  renderChart($('#pg-weight', root), {
    start, end, height: 230, ariaLabel: 'Morning weight with 7-day average',
    emptyText: 'No weigh-ins in this period.',
    yFormat: v => f.num(f.weightVal(v), 0),
    series: [
      { kind: 'dots', cls: 's-daily', data: ws.map(p => ({ date: p.date, value: p.kg })) },
      { kind: 'line', cls: 's-avg', data: avg.map(p => ({ date: p.date, value: p.kg, n: p.n })) },
    ],
    refs: [
      ...(ps.hasWeights && inRange.length ? [{ value: ps.startKg, label: `Start ${f.weightNum(ps.startKg)}`, cls: 'r-start' }] : []),
      ...(s.targetWeightKg !== null && inRange.length ? [{ value: s.targetWeightKg, label: `Target ${f.weightNum(s.targetWeightKg)}`, cls: 'r-target' }] : []),
    ],
    tooltip: (date, items) => {
      const d = items.find(i => i.s.cls === 's-daily'), a = items.find(i => i.s.cls === 's-avg');
      if (!d && !a) return null;
      return tip(formatShort(date), [d ? ['Weight', f.weight(d.d.value)] : ['Weight', 'Not recorded'], a ? ['7-day avg', `${f.weight(a.d.value)} · ${a.d.n} weigh-ins`] : null].filter(Boolean));
    },
  });
  const avgByDate = new Map(avg.map(a => [a.date, a]));
  $('#pg-weight-table', root).appendChild(dataTable(['Date', 'Weight', '7-day average (weigh-ins)'],
    [...inRange].reverse().map(p => { const a = avgByDate.get(p.date); return [formatMedium(p.date), f.weight(p.kg), a ? `${f.weight(a.kg)} (${a.n})` : '—']; })));

  const habit = (id, field, dateKey, s0, e0, { cls, target, targetLabel, fmtV, yFmt, label }) => {
    const hs = habitSeries(records, field, dateKey, s0, e0);
    $(`#${id}-legend`, root).innerHTML = legend([{ kind: 'bar', cls, label: hs.weekly ? `${label} (weekly average of logged days)` : label }, ...(target !== null ? [{ kind: 'ref', cls: 'r-target', label: targetLabel }] : [])]);
    renderChart($(`#${id}`, root), {
      start: hs.weekly ? mondayOf(s0) : s0, end: e0, includeZero: true, height: 180, ariaLabel: label,
      emptyText: 'Nothing logged in this period.', yFormat: yFmt,
      series: [{ kind: 'bars', cls, barDays: hs.weekly ? 7 : 1, data: hs.data }],
      refs: target !== null ? [{ value: target, label: `${targetLabel} ${fmtV(target)}`, cls: 'r-target' }] : [],
      tooltip: (date, items) => {
        const it = items[0];
        if (!it) return tip(formatShort(date), [[label, 'Not logged']]);
        return tip(hs.weekly ? `Week of ${formatDayMonth(date)}` : formatShort(date), [[label, fmtV(it.d.value)], ...(hs.weekly ? [['Days logged', String(it.d.n)]] : []), ...(target !== null ? [['Target', fmtV(target)]] : [])]);
      },
    });
    $(`#${id}-table`, root).appendChild(dataTable([hs.weekly ? 'Week starting' : 'Date', hs.weekly ? `${label} (avg)` : label],
      [...hs.data].reverse().map(d => [formatMedium(d.date), fmtV(d.value) + (hs.weekly ? ` (${d.n} days)` : '')])));
  };
  const k = v => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : String(Math.round(v)));
  habit('pg-cal', 'caloriesKcal', 'lifestyleDate', lifeStart, lifeEnd, { cls: 's-cal', target: s.calorieTarget, targetLabel: 'Target', fmtV: v => f.kcal(Math.round(v)), yFmt: k, label: 'Calories' });
  habit('pg-pro', 'proteinG', 'lifestyleDate', lifeStart, lifeEnd, { cls: 's-pro', target: s.proteinTarget, targetLabel: 'Target', fmtV: v => f.grams(Math.round(v)), yFmt: v => String(Math.round(v)), label: 'Protein (g)' });
  habit('pg-steps', 'steps', 'lifestyleDate', lifeStart, lifeEnd, { cls: 's-steps', target: s.stepTarget, targetLabel: 'Target', fmtV: v => f.steps(Math.round(v)), yFmt: k, label: 'Steps' });
  habit('pg-sleep', 'sleepMinutes', 'sleepNightEnd', start, end, { cls: 's-sleep', target: s.sleepGoalMinutes, targetLabel: 'Goal', fmtV: v => f.sleep(v), yFmt: v => `${Math.round(v / 60)}h`, label: 'Sleep' });

  // Weekly exercise
  const weeks = C.weeklyExercise(records, lifeStart, lifeEnd).filter(w => w.answered > 0);
  $('#pg-ex-legend', root).innerHTML = '';
  renderChart($('#pg-ex', root), {
    start: mondayOf(lifeStart), end: addDays(mondayOf(lifeEnd), 6), includeZero: true, height: 160, ariaLabel: 'Workout days per week',
    emptyText: 'No exercise logged in this period.', yFormat: v => String(v), minPad: 1,
    series: [{ kind: 'bars', cls: 's-ex', barDays: 7, data: weeks.map(w => ({ date: w.monday, value: w.workouts, w })) }],
    tooltip: (date, items) => {
      const m = mondayOf(date), it = items[0] || null;
      const w = it?.d.w || weeks.find(x => x.monday === m);
      if (!w) return tip(`Week of ${formatDayMonth(m)}`, [['Exercise', 'Not logged']]);
      return tip(`Week of ${formatDayMonth(w.monday)}`, [['Workout days', String(w.workouts)], ['Resistance', String(w.resistance)], ['Days recorded', `${w.answered} of 7`]]);
    },
  });
  $('#pg-ex-table', root).appendChild(dataTable(['Week starting', 'Workout days', 'Resistance days', 'Days recorded'],
    [...weeks].reverse().map(w => [formatMedium(w.monday), String(w.workouts), String(w.resistance), `${w.answered} of 7`])));
}
