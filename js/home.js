import { state, saveSettings } from './state.js';
import { addDays, mondayOf, formatLong, formatDayMonth, formatWeekdayDayMonth, formatShort, diffDays } from './dates.js';
import * as C from './calc.js';
import { missingCore, EXERCISE_TYPES } from './model.js';
import { renderChart } from './charts.js';
import { statCard, legend, tip } from './components.js';
import { $, esc, toast } from './ui.js';

let weekOffset = 0;
const exLabel = ids => ids.map(id => EXERCISE_TYPES.find(t => t.id === id)?.label).filter(Boolean).join(', ');

export function renderHome(root, params = {}) {
  const { records, settings: s, fmt: f, today } = state;
  const todayRec = state.byDate.get(today);
  const savedDate = params.get?.('saved');
  const w = C.windows(today);
  const latest = C.latestWeight(records, today);
  const backupDays = s.lastBackupAt ? Math.floor((Date.now() - Date.parse(s.lastBackupAt)) / 86400000) : null;

  let html = '';
  if (savedDate) {
    const r = state.byDate.get(savedDate);
    if (r) html += `<div class="banner ok" role="status"><strong>Check-in saved.</strong> Morning measurements recorded for ${esc(formatLong(r.measurementDate))}; habits for ${esc(formatLong(r.lifestyleDate))}. <a href="#/checkin/${r.checkInDate}">Edit</a></div>`;
  }
  if (records.length && (backupDays === null || backupDays >= 7)) {
    html += `<div class="banner warn row between"><span>${backupDays === null ? 'You have not backed up your data yet.' : `Last backup was ${backupDays} days ago.`} Your records exist only on this device.</span><a class="btn sm" href="#/settings?backup=1">Back up</a></div>`;
  }

  // Today's status
  if (todayRec) {
    const miss = missingCore(todayRec);
    html += `<div class="card status done row between">
      <div><div class="eyebrow">Today's check-in</div><div class="status-title"><span class="tick" aria-hidden="true">✓</span> Completed</div>
      <div class="muted small">${miss.length ? `Not recorded: ${esc(miss.join(', '))}` : 'All core metrics recorded'}</div></div>
      <a class="btn ghost" href="#/checkin/${today}">Edit</a></div>`;
  } else {
    html += `<div class="card status row between">
      <div><div class="eyebrow">Today's check-in</div><div class="status-title">Not completed yet</div>
      <div class="muted small">${esc(formatLong(today))}</div></div>
      <a class="btn primary" href="#/checkin">Start check-in</a></div>`;
  }

  html += keyNumbers();
  html += goalCard(latest);
  html += `<div class="card" id="weekly-card"></div>`;

  // Summary cards
  const avgW = C.weightAverage(records, today);
  const prog = C.progressStats(records, today, s.startWeightKg);
  const cal = C.windowStats(records, 'caloriesKcal', 'lifestyleDate', w.lifestyle.start, w.lifestyle.end);
  const pro = C.windowStats(records, 'proteinG', 'lifestyleDate', w.lifestyle.start, w.lifestyle.end);
  const stp = C.windowStats(records, 'steps', 'lifestyleDate', w.lifestyle.start, w.lifestyle.end);
  const slp = C.windowStats(records, 'sleepMinutes', 'sleepNightEnd', w.morning.start, w.morning.end);
  const ex = C.exerciseStats(records, w.lifestyle.start, w.lifestyle.end);
  const range = win => `${formatDayMonth(win.start)}–${formatDayMonth(win.end)}`;
  const daysSub = (st, win) => st.n ? `${st.n} of 7 days logged · ${range(win)}` : `Nothing logged ${range(win)}`;
  html += `<h2 class="h2">Last 7 days</h2><div class="stats">
    ${statCard('Latest weight', latest ? f.weight(latest.kg) : '—', latest ? esc(formatDayMonth(latest.date)) + (latest.date !== today ? ' · no weigh-in today' : '') : 'No weight recorded', { id: 'latest' })}
    ${statCard('7-day average weight', avgW.n >= C.MIN_ROLLING ? f.weight(avgW.avg) : '—', avgW.n >= C.MIN_ROLLING ? `${avgW.n} weigh-ins · ${range(w.morning)}` : `Needs ${C.MIN_ROLLING}+ weigh-ins (${avgW.n} so far)`, { id: 'avg7' })}
    ${statCard('Change since start', prog.hasWeights ? f.weightDiff(prog.changeKg) : '—', prog.hasWeights ? `from ${f.weight(prog.startKg)}${prog.startFromSetting ? '' : ' (first weigh-in)'}` : 'No weight recorded', { id: 'change' })}
    ${statCard('Avg calories', cal.n ? f.kcal(cal.avg) : '—', daysSub(cal, w.lifestyle), { id: 'cal' })}
    ${statCard('Avg protein', pro.n ? f.grams(Math.round(pro.avg)) : '—', daysSub(pro, w.lifestyle), { id: 'protein' })}
    ${statCard('Avg steps', stp.n ? f.steps(stp.avg) : '—', daysSub(stp, w.lifestyle), { id: 'steps' })}
    ${statCard('Avg sleep', slp.n ? f.sleep(slp.avg) : '—', slp.n ? `${slp.n} of 7 nights logged` : 'No sleep logged', { id: 'sleep' })}
    ${statCard('Workouts', ex.answered ? String(ex.workouts) : '—', ex.answered ? `${ex.answered} of 7 days answered${ex.resistance ? ` · ${ex.resistance} resistance` : ''}` : 'No exercise logged', { id: 'workouts' })}
  </div>`;

  html += `<div class="card"><div class="row between"><h2 class="h3">Weight, last 30 days</h2><a href="#/progress" class="link">Full chart</a></div>
    ${legend([{ kind: 'dot', cls: 's-daily', label: 'Daily weigh-in' }, { kind: 'line', cls: 's-avg', label: '7-day average' }])}
    <div id="home-weight-chart"></div></div>`;

  // Yesterday's habits (from today's check-in)
  const y = todayRec;
  html += `<div class="card"><div class="row between"><h2 class="h3">Yesterday — ${esc(formatWeekdayDayMonth(addDays(today, -1)))}</h2>${y ? `<a class="link" href="#/checkin/${today}">Correct</a>` : ''}</div>
    ${y ? `<dl class="kv">
      <dt>Calories</dt><dd>${f.kcal(y.caloriesKcal)}</dd>
      <dt>Protein</dt><dd>${f.grams(y.proteinG)}</dd>
      <dt>Steps</dt><dd>${f.steps(y.steps)}</dd>
      <dt>Sleep (last night)</dt><dd>${f.sleep(y.sleepMinutes)}${y.sleepQuality ? ` · quality ${y.sleepQuality}/5` : ''}</dd>
      <dt>Exercise</dt><dd>${y.exercised === null ? '—' : y.exercised ? `Yes${y.exerciseTypes.length ? ' · ' + esc(exLabel(y.exerciseTypes)) : ''}${y.exerciseMinutes !== null ? ` · ${y.exerciseMinutes} min` : ''}${y.resistanceTraining ? ' · resistance' : ''}` : 'No'}</dd>
    </dl>` : `<p class="muted">Yesterday's habits are recorded in this morning's check-in. <a href="#/checkin">Start check-in</a></p>`}
  </div>`;

  html += `<div class="quick-links"><a class="btn ghost" href="#/history">View history</a><a class="btn ghost" href="#/history?add=1">Add a past check-in</a></div>`;
  root.innerHTML = html;

  bindGoal(root);
  renderWeekly($('#weekly-card', root));

  const start = addDays(today, -29);
  const ws = C.weightSeries(records);
  const avg = C.rollingAverage(ws);
  renderChart($('#home-weight-chart', root), {
    start, end: today, height: 170, ariaLabel: 'Weight over the last 30 days',
    emptyText: 'No weigh-ins in the last 30 days.',
    yFormat: v => f.num(f.weightVal(v), 0),
    series: [
      { kind: 'dots', cls: 's-daily', data: ws.map(p => ({ date: p.date, value: p.kg })) },
      { kind: 'line', cls: 's-avg', data: avg.map(p => ({ date: p.date, value: p.kg, n: p.n })) },
    ],
    refs: s.targetWeightKg !== null ? [] : [],
    tooltip: (date, items) => {
      const d = items.find(i => i.s.cls === 's-daily'), a = items.find(i => i.s.cls === 's-avg');
      if (!d && !a) return null;
      return tip(formatShort(date), [d ? ['Weight', f.weight(d.d.value)] : null, a ? ['7-day avg', `${f.weight(a.d.value)} (${a.d.n})`] : null].filter(Boolean));
    },
  });
}

/** Headline tiles: overall calories, weeks to target date, last/this week's weight. */
function keyNumbers() {
  const { records, settings: s, fmt: f, today } = state;
  const monday = mondayOf(today), lastMonday = addDays(monday, -7), lastSunday = addDays(monday, -1);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const cal = C.windowStats(records, 'caloriesKcal', 'lifestyleDate', '1900-01-01', today);
  const firstCal = records.find(r => r.caloriesKcal !== null)?.lifestyleDate;
  const calTile = statCard('Overall average calories', cal.n ? f.kcal(cal.avg) : '—',
    cal.n ? `${plural(cal.n, 'logged day')} since ${esc(formatDayMonth(firstCal))}` : 'No calories logged yet', { id: 'key-cal' });

  const g = C.goalCountdown({ latest: null, targetKg: s.targetWeightKg, targetDate: s.targetDate, today });
  let weeks, weeksSub;
  if (!g.hasDate) { weeks = '—'; weeksSub = '<a href="#/settings">Set a target date</a>'; }
  else if (g.datePassed) { weeks = 'Passed'; weeksSub = `Target date was ${esc(formatDayMonth(g.targetDate))}`; }
  else if (g.dateIsToday) { weeks = '0 weeks'; weeksSub = 'Target date is today'; }
  else { weeks = `${f.num(g.weeksRemaining, 1)} weeks`; weeksSub = `${plural(g.daysRemaining, 'day')} to ${esc(formatDayMonth(g.targetDate))}`; }
  const weeksTile = statCard('Weeks to target date', weeks, weeksSub, { id: 'key-weeks' });

  const last = C.windowStats(records, 'weightKg', 'measurementDate', lastMonday, lastSunday);
  const cur = C.windowStats(records, 'weightKg', 'measurementDate', monday, today);
  const lastTile = statCard("Last week's average weight", last.n ? f.weight(last.avg) : '—',
    `${last.n ? plural(last.n, 'weigh-in') : 'No weigh-ins'} · ${esc(formatDayMonth(lastMonday))}–${esc(formatDayMonth(lastSunday))}`, { id: 'key-lastwk' });
  let curSub = `${cur.n ? plural(cur.n, 'weigh-in') : 'No weigh-ins yet'} · Mon ${esc(formatDayMonth(monday))} to today`;
  if (cur.n && last.n) curSub += ` · ${f.weightDiff(cur.avg - last.avg)} vs last week`;
  const curTile = statCard("This week's running average", cur.n ? f.weight(cur.avg) : '—', curSub, { id: 'key-thiswk' });

  return `<div class="stats key-numbers">${calTile}${weeksTile}${lastTile}${curTile}</div>`;
}

function goalCard(latest) {
  const { settings: s, fmt: f, today, records } = state;
  const g = C.goalCountdown({ latest, startKg: s.startWeightKg, targetKg: s.targetWeightKg, targetDate: s.targetDate, today });
  if (!g.hasTarget) {
    return `<div class="card goal"><div class="eyebrow">Goal countdown</div><p>Set a target weight in <a href="#/settings">Settings</a> to see your countdown.</p></div>`;
  }
  const title = `Your goal: ${f.weight(g.targetKg, Number.isInteger(f.weightVal(g.targetKg)) ? 0 : 1)}${g.hasDate ? ` by ${esc(formatLong(g.targetDate))}` : ''}`;
  let hero, heroSub = '';
  if (!g.hasLatest) {
    hero = `<div class="goal-hero muted">No weight recorded yet</div>`;
    heroSub = `<a href="#/checkin">Record your morning weight</a> to start the countdown.`;
  } else if (g.reached) {
    const below = -g.remainingKg;
    hero = `<div class="goal-hero reached" data-goal="remaining">Goal weight reached</div>`;
    heroSub = Number(f.weightVal(below).toFixed(1)) > 0
      ? `Congratulations. You are <strong>${f.weight(below)} below</strong> your goal weight.`
      : 'Congratulations. You are at your goal weight.';
  } else {
    const rem = f.weightVal(g.remainingKg);
    hero = `<div class="goal-hero" data-goal="remaining">${rem < 0.05 ? `Less than 0.1 ${f.wu}` : f.weight(g.remainingKg)} <span>to goal</span></div>`;
  }
  const basis = g.hasLatest ? `<div class="muted small">Based on your latest weigh-in: ${f.weight(g.currentKg)} on ${esc(formatDayMonth(g.latestDate))}${g.latestDate !== today ? ` (${diffDays(g.latestDate, today)} day${diffDays(g.latestDate, today) === 1 ? '' : 's'} ago)` : ''}</div>` : '';

  let daysTxt, weeksTxt, rateTxt;
  if (!g.hasDate) { daysTxt = weeksTxt = rateTxt = '—'; }
  else if (g.datePassed) { daysTxt = 'Target date passed'; weeksTxt = '—'; rateTxt = 'Not calculated'; }
  else if (g.dateIsToday) { daysTxt = 'Target date is today'; weeksTxt = '0 weeks'; rateTxt = 'Not calculated'; }
  else {
    daysTxt = `${g.daysRemaining} day${g.daysRemaining === 1 ? '' : 's'}`;
    weeksTxt = `${f.num(g.weeksRemaining, 1)} weeks`;
    rateTxt = g.reached ? 'Goal reached' : g.requiredKgPerWeek !== undefined ? `${f.weightNum(g.requiredKgPerWeek, 2)} ${f.wu}/week` : '—';
  }

  let progress = '';
  if (g.progressInvalid) progress = `<p class="muted small">Your starting weight (${f.weight(g.startKg)}) is at or below the target, so progress towards it cannot be calculated. Update your starting weight in <a href="#/settings">Settings</a>.</p>`;
  else if (g.startKg === undefined) {
    const first = C.firstWeight(records);
    progress = `<div class="banner info">Set a starting weight to see your progress.${first ? ` <button type="button" class="btn sm" id="use-first" data-kg="${first.kg}" data-date="${first.date}">Use first recorded weight (${f.weight(first.kg)}, ${esc(formatDayMonth(first.date))})</button>` : ''} <a href="#/settings">Settings</a></div>`;
  } else if (g.progressPct !== undefined) {
    progress = `<div class="progress-wrap">
      <div class="row between small"><span>${f.num(g.progressPct, 0)}% of the way${g.progressPct > 100 ? ' (target passed)' : ''}</span><span class="muted">Current ${f.weight(g.currentKg)}</span></div>
      <div class="progress" role="progressbar" aria-label="Progress from starting weight to goal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(g.progressBar)}"><div class="progress-fill" style="width:${g.progressBar.toFixed(1)}%"></div></div>
      <div class="row between small muted"><span>Start ${f.weight(g.startKg)}</span><span>Goal ${f.weight(g.targetKg)}</span></div>
    </div>`;
  } else progress = `<p class="muted small">Progress appears after your first weigh-in. Start: ${f.weight(g.startKg)}.</p>`;

  const aggressive = g.aggressive ? `<div class="banner neutral small">This required rate is more than 1% of your current body weight per week, which is faster than is generally considered sustainable. A later target date or a steadier pace may be more realistic. Progress at any steady rate is still progress.</div>` : '';

  return `<div class="card goal" id="goal-card">
    <div class="eyebrow">Goal countdown</div>
    <h2 class="goal-title">${title}</h2>
    ${hero}${heroSub ? `<p class="goal-sub">${heroSub}</p>` : ''}${basis}
    <div class="goal-grid">
      <div><div class="stat-label">Time remaining</div><div class="goal-num" data-goal="days">${daysTxt}</div><div class="stat-sub" data-goal="weeks">${weeksTxt}${g.hasDate && !g.datePassed ? ' remaining' : ''}</div></div>
      <div><div class="stat-label">Required average rate</div><div class="goal-num" data-goal="rate">${rateTxt}</div><div class="stat-sub">${g.hasDate ? `Target date ${esc(formatLong(g.targetDate))}` : '<a href="#/settings">Set a target date</a>'}</div></div>
    </div>
    ${progress}
    ${aggressive}
    <p class="fineprint">The required rate is the mathematical average needed to meet your chosen deadline. It is not a guarantee or a personalised medical recommendation. Day-to-day weight varies with water, salt and digestion, so the 7-day average is a better guide to your trend.</p>
  </div>`;
}

function bindGoal(root) {
  $('#use-first', root)?.addEventListener('click', async e => {
    const b = e.currentTarget;
    try { await saveSettings({ startWeightKg: +b.dataset.kg, startDate: b.dataset.date }); toast('Starting weight set from your first weigh-in.'); }
    catch (err) { toast(err.message, 'error'); }
  });
}

export function renderWeekly(card) {
  const { records, settings: s, fmt: f, today } = state;
  const currentMonday = mondayOf(today);
  const monday = addDays(currentMonday, 7 * weekOffset);
  const ws = C.weekSummary(records, monday, today);
  const label = `${ws.isCurrent ? 'Current week' : 'Week'}: ${formatWeekdayDayMonth(ws.monday)} – ${formatWeekdayDayMonth(ws.sunday)}`;
  const target = s.calorieTarget;
  let body;
  if (!ws.n) {
    body = `<p class="empty" data-week="empty">No calorie data logged ${ws.isCurrent ? 'this week' : 'for this week'}.</p>`;
  } else {
    const diff = target !== null ? ws.avg - target : null;
    body = `<div class="stats three">
      <div class="stat"><div class="stat-label">Running average</div><div class="stat-value" data-week="avg">${f.int(Math.round(ws.avg))}</div><div class="stat-sub">kcal per logged day</div></div>
      <div class="stat"><div class="stat-label">Total ${ws.complete ? 'for week' : 'so far'}</div><div class="stat-value" data-week="total">${f.int(ws.total)}</div><div class="stat-sub">kcal</div></div>
      <div class="stat"><div class="stat-label">Days logged</div><div class="stat-value" data-week="n">${ws.n}</div><div class="stat-sub">of ${ws.complete ? 7 : ws.elapsedDays} day${(ws.complete ? 7 : ws.elapsedDays) === 1 ? '' : 's'} ${ws.complete ? 'in week' : 'elapsed'}</div></div>
    </div>
    <p class="small">${target !== null ? `Daily target ${f.kcal(target)} · average is <strong>${f.int(Math.abs(Math.round(diff)))} kcal ${diff > 0 ? 'above' : diff < 0 ? 'below' : 'equal to'}</strong> target` : 'No daily calorie target set.'}</p>`;
  }
  const note = ws.isCurrent ? `<p class="fineprint">Calories are logged the following morning, so today's intake appears tomorrow.${diffDays(ws.monday, today) === 0 ? " This morning's entry (Sunday's intake) belongs to last week." : ''} Unlogged days are excluded from the average, not counted as zero.</p>` : '';
  card.innerHTML = `
    <div class="eyebrow">Weekly nutrition summary</div>
    <h2 class="h3" data-week="label">${esc(label)}</h2>
    ${body}
    ${legend([{ kind: 'bar', cls: 's-cal', label: 'Daily intake' }, ...(target !== null ? [{ kind: 'ref', cls: 'r-target', label: 'Target' }] : []), ...(ws.n ? [{ kind: 'ref', cls: 'r-avg', label: 'Running average' }] : [])])}
    <div id="week-chart"></div>
    ${note}
    <div class="row between week-nav">
      <button type="button" class="btn ghost sm" id="wk-prev">‹ Previous week</button>
      ${weekOffset ? `<button type="button" class="link" id="wk-now">Current week</button>` : ''}
      <button type="button" class="btn ghost sm" id="wk-next" ${weekOffset >= 0 ? 'disabled' : ''}>Next week ›</button>
    </div>`;
  if (ws.n) renderChart($('#week-chart', card), {
    start: ws.monday, end: ws.sunday, includeZero: true, height: 180,
    ariaLabel: `Daily calories, ${label}`,
    emptyText: ' ',
    yFormat: v => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : String(v)),
    series: [{ kind: 'bars', cls: 's-cal', data: ws.days.filter(d => d.value !== null).map(d => ({ date: d.date, value: d.value })) }],
    refs: [
      ...(target !== null ? [{ value: target, label: `Target ${f.int(target)}`, cls: 'r-target' }] : []),
      ...(ws.n ? [{ value: ws.avg, label: `Avg ${f.int(Math.round(ws.avg))}`, cls: 'r-avg' }] : []),
    ],
    tooltip: date => {
      const d = ws.days.find(x => x.date === date);
      return tip(formatShort(date), [['Calories', d.future ? 'Upcoming' : d.value === null ? 'Not logged' : f.kcal(d.value)]]);
    },
  });
  else $('#week-chart', card).innerHTML = weekDayStrip(ws);
  $('#wk-prev', card).addEventListener('click', () => { weekOffset--; renderWeekly(card); });
  $('#wk-next', card).addEventListener('click', () => { if (weekOffset < 0) { weekOffset++; renderWeekly(card); } });
  $('#wk-now', card)?.addEventListener('click', () => { weekOffset = 0; renderWeekly(card); });
}

function weekDayStrip(ws) {
  return `<div class="day-strip">${ws.days.map(d => `<div class="${d.future ? 'future' : ''}"><span>${esc(formatShort(d.date).split(' ')[0])}</span><b>${d.future ? '' : '—'}</b></div>`).join('')}</div>`;
}

export function resetHomeWeek() { weekOffset = 0; }
