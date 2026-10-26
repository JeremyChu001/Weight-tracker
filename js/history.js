import { state, deleteRecord } from './state.js';
import { addDays, mondayOf, formatFull, formatLong, formatShort, formatDayMonth, formatMonthYear, formatWeekdayDayMonth, monthStart, addMonths, daysInMonth, weekdayMon0, isValidISO, rangeDates } from './dates.js';
import * as C from './calc.js';
import { missingCore, EXERCISE_TYPES } from './model.js';
import { $, $$, esc, toast, dialog, confirmDialog } from './ui.js';

const ui = { tab: 'list', q: '', from: '', to: '', month: null };
const exLabel = ids => ids.map(id => EXERCISE_TYPES.find(t => t.id === id)?.label).filter(Boolean).join(', ');

export function renderHistory(root, params) {
  if (params?.get?.('add')) ui.tab = 'calendar';
  if (!ui.month) ui.month = monthStart(state.today);
  root.innerHTML = `
    <div class="seg wide" role="tablist" aria-label="History view">
      ${[['list', 'Days'], ['calendar', 'Calendar'], ['weeks', 'Weeks']].map(([k, l]) => `<button type="button" role="tab" aria-selected="${ui.tab === k}" aria-checked="${ui.tab === k}" data-tab="${k}">${l}</button>`).join('')}
    </div>
    <div id="hist-body"></div>`;
  $$('[data-tab]', root).forEach(b => b.addEventListener('click', () => { ui.tab = b.dataset.tab; renderHistory(root); }));
  const body = $('#hist-body', root);
  if (ui.tab === 'list') renderList(body);
  else if (ui.tab === 'calendar') renderCalendar(body, params?.get?.('add'));
  else renderWeeks(body);
}

function matches(r) {
  if (ui.from && r.checkInDate < ui.from) return false;
  if (ui.to && r.checkInDate > ui.to) return false;
  if (ui.q) {
    const q = ui.q.toLowerCase();
    const hay = [r.notes, exLabel(r.exerciseTypes), formatFull(r.checkInDate), formatFull(r.lifestyleDate), r.checkInDate].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function weekHeader(monday) {
  const { records, fmt: f } = state;
  const sunday = addDays(monday, 6);
  const w = C.windowStats(records, 'weightKg', 'measurementDate', monday, sunday);
  const c = C.windowStats(records, 'caloriesKcal', 'lifestyleDate', monday, sunday);
  const ex = C.exerciseStats(records, monday, sunday);
  const parts = [];
  if (w.n) parts.push(`avg weight ${f.weight(w.avg)} (${w.n})`);
  if (c.n) parts.push(`avg ${f.kcal(c.avg)} (${c.n} day${c.n === 1 ? '' : 's'})`);
  if (ex.answered) parts.push(`${ex.workouts} workout${ex.workouts === 1 ? '' : 's'}`);
  return `<div class="week-head"><div class="week-range">${esc(formatDayMonth(monday))} – ${esc(formatDayMonth(sunday))}</div><div class="muted small">${parts.length ? esc(parts.join(' · ')) : 'No data'}</div></div>`;
}

function renderList(body) {
  const { records, fmt: f, today } = state;
  body.innerHTML = `
    <div class="card filters">
      <label class="field-label" for="h-q">Search notes and exercise</label>
      <input id="h-q" type="search" placeholder="e.g. travel, cardio" value="${esc(ui.q)}" autocomplete="off">
      <div class="row gap">
        <div class="grow"><label class="field-label" for="h-from">From</label><input id="h-from" type="date" value="${ui.from}" max="${today}"></div>
        <div class="grow"><label class="field-label" for="h-to">To</label><input id="h-to" type="date" value="${ui.to}" max="${today}"></div>
      </div>
      ${ui.q || ui.from || ui.to ? '<button type="button" class="link" id="h-clear">Clear filters</button>' : ''}
    </div>
    <div id="h-list"></div>`;
  const draw = () => {
    const list = records.filter(matches).sort((a, b) => (a.checkInDate < b.checkInDate ? 1 : -1));
    const el = $('#h-list', body);
    if (!records.length) { el.innerHTML = `<div class="card empty">No check-ins yet. <a href="#/checkin">Record your first check-in</a>.</div>`; return; }
    if (!list.length) { el.innerHTML = `<div class="card empty">No check-ins match these filters.</div>`; return; }
    let html = `<p class="muted small">${list.length} check-in${list.length === 1 ? '' : 's'}</p>`, cur = null;
    for (const r of list) {
      const m = mondayOf(r.checkInDate);
      if (m !== cur) { if (cur) html += '</div>'; html += `<div class="card week-group">${weekHeader(m)}`; cur = m; }
      const miss = missingCore(r);
      html += `<button type="button" class="day-row" data-open="${r.checkInDate}">
        <span class="day-date"><b>${esc(formatShort(r.checkInDate))}</b>${r.checkInDate === today ? ' <span class="pill">Today</span>' : ''}</span>
        <span class="day-vals">${r.weightKg !== null ? `<b>${f.weight(r.weightKg)}</b>` : '<span class="muted">no weight</span>'}${r.caloriesKcal !== null ? ` · ${f.kcal(r.caloriesKcal)}` : ''}${r.steps !== null ? ` · ${f.steps(r.steps)} steps` : ''}</span>
        ${miss.length ? `<span class="badge" title="Not recorded: ${esc(miss.join(', '))}">Incomplete · ${miss.length} missing</span>` : '<span class="badge ok">Complete</span>'}
        ${r.notes ? `<span class="day-note muted small">${esc(r.notes.slice(0, 90))}${r.notes.length > 90 ? '…' : ''}</span>` : ''}
      </button>`;
    }
    el.innerHTML = html + '</div>';
    $$('[data-open]', el).forEach(b => b.addEventListener('click', () => openDetail(b.dataset.open)));
  };
  draw();
  $('#h-q', body).addEventListener('input', e => { ui.q = e.target.value.trim(); draw(); });
  $('#h-from', body).addEventListener('change', e => { ui.from = isValidISO(e.target.value) ? e.target.value : ''; renderList(body); });
  $('#h-to', body).addEventListener('change', e => { ui.to = isValidISO(e.target.value) ? e.target.value : ''; renderList(body); });
  $('#h-clear', body)?.addEventListener('click', () => { ui.q = ui.from = ui.to = ''; renderList(body); });
}

function renderCalendar(body, addMode) {
  const { today, byDate } = state;
  const m = ui.month, n = daysInMonth(m), lead = weekdayMon0(m);
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="cal-cell blank"></span>';
  for (let d = 1; d <= n; d++) {
    const date = m.slice(0, 8) + String(d).padStart(2, '0');
    const r = byDate.get(date);
    const future = date > today;
    const cls = ['cal-cell', r ? (missingCore(r).length ? 'has incomplete' : 'has') : '', date === today ? 'today' : '', future ? 'future' : ''].join(' ');
    cells += `<button type="button" class="${cls}" data-date="${date}" ${future ? 'disabled' : ''} aria-label="${esc(formatFull(date))}${r ? (missingCore(r).length ? ', incomplete check-in' : ', check-in recorded') : ', no check-in'}"><span>${d}</span></button>`;
  }
  body.innerHTML = `<div class="card">
    ${addMode ? '<div class="banner info">Choose the morning of the check-in you want to add or correct.</div>' : ''}
    <div class="row between cal-nav">
      <button type="button" class="btn ghost sm" id="cal-prev" aria-label="Previous month">‹</button>
      <h2 class="h3">${esc(formatMonthYear(m))}</h2>
      <button type="button" class="btn ghost sm" id="cal-next" aria-label="Next month" ${addMonths(m, 1) > today ? 'disabled' : ''}>›</button>
    </div>
    <div class="cal-grid cal-head">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<span>${d}</span>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-legend small muted"><span><i class="cal-dot"></i> Complete</span><span><i class="cal-dot hollow"></i> Incomplete</span><span>Dates are check-in mornings</span></div>
    ${m !== monthStart(today) ? '<button type="button" class="link" id="cal-today">Go to this month</button>' : ''}
  </div>`;
  $('#cal-prev', body).addEventListener('click', () => { ui.month = addMonths(m, -1); renderCalendar(body, addMode); });
  $('#cal-next', body).addEventListener('click', () => { ui.month = addMonths(m, 1); renderCalendar(body, addMode); });
  $('#cal-today', body)?.addEventListener('click', () => { ui.month = monthStart(today); renderCalendar(body, addMode); });
  $$('.cal-cell[data-date]', body).forEach(b => b.addEventListener('click', () => {
    const date = b.dataset.date;
    if (byDate.get(date)) openDetail(date);
    else location.hash = `#/checkin/${date}`;
  }));
}

function renderWeeks(body) {
  const { records, fmt: f, today, settings: s } = state;
  const weeks = [...new Set([mondayOf(today), ...C.weeksWithData(records)])].sort().reverse();
  body.innerHTML = `<p class="muted small">Monday–Sunday weeks, grouped by the date the food was eaten. Completed weeks never change unless you edit one of their days.</p>` + weeks.map((m, i) => {
    const ws = C.weekSummary(records, m, today);
    const w = C.windowStats(records, 'weightKg', 'measurementDate', m, ws.sunday);
    const ex = C.exerciseStats(records, m, ws.sunday);
    return `<details class="card week-sum" ${i === 0 ? 'open' : ''}>
      <summary><span class="week-range">${ws.isCurrent ? 'Current week · ' : ''}${esc(formatWeekdayDayMonth(m))} – ${esc(formatWeekdayDayMonth(ws.sunday))}</span>
        <span class="muted small">${ws.n ? `${f.kcal(ws.total)} total · ${ws.n} day${ws.n === 1 ? '' : 's'} logged · avg ${f.kcal(ws.avg)}` : 'No calorie data logged'}</span></summary>
      <table class="data-table"><thead><tr><th scope="col">Day</th><th scope="col">Calories</th><th scope="col">Target</th></tr></thead><tbody>
        ${ws.days.map(d => `<tr><td>${esc(formatShort(d.date))}</td><td>${d.future ? '<span class="muted">upcoming</span>' : d.value === null ? '<span class="muted">not logged</span>' : f.kcal(d.value)}</td><td>${s.calorieTarget !== null && d.value !== null ? f.signedInt(d.value - s.calorieTarget, ' kcal') : '—'}</td></tr>`).join('')}
      </tbody></table>
      <p class="small">${w.n ? `Average weight ${f.weight(w.avg)} (${w.n} weigh-ins)` : 'No weigh-ins'} · ${ex.answered ? `${ex.workouts} workout day${ex.workouts === 1 ? '' : 's'}` : 'no exercise logged'}</p>
    </details>`;
  }).join('');
}

export async function openDetail(date) {
  const r = state.byDate.get(date);
  if (!r) return;
  const f = state.fmt;
  const miss = missingCore(r);
  const row = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
  const body = `
    ${miss.length ? `<div class="banner warn small">Not recorded: ${esc(miss.join(', '))}</div>` : ''}
    <h3 class="h4">Morning of ${esc(formatFull(r.measurementDate))}</h3>
    <dl class="kv">${row('Weight', f.weight(r.weightKg))}${row('Waist', f.length(r.waistCm))}</dl>
    <h3 class="h4">Sleep · night of ${esc(formatDayMonth(r.sleepNightStart))} → ${esc(formatDayMonth(r.sleepNightEnd))}</h3>
    <dl class="kv">${row('Duration', f.sleep(r.sleepMinutes))}${row('Quality', r.sleepQuality ? `${r.sleepQuality}/5` : '—')}</dl>
    <h3 class="h4">Habits on ${esc(formatFull(r.lifestyleDate))}</h3>
    <dl class="kv">${row('Calories', f.kcal(r.caloriesKcal))}${row('Protein', f.grams(r.proteinG))}${row('Steps', f.steps(r.steps))}
      ${row('Exercised', r.exercised === null ? '—' : r.exercised ? 'Yes' : 'No')}
      ${r.exercised ? row('Type', esc(exLabel(r.exerciseTypes)) || '—') + row('Duration', r.exerciseMinutes !== null ? `${r.exerciseMinutes} min` : '—') : ''}
      ${row('Resistance training', r.resistanceTraining === null ? '—' : r.resistanceTraining ? 'Yes' : 'No')}
      ${row('Water', f.litres(r.waterL))}${row('Energy', r.energy ? `${r.energy}/5` : '—')}${row('Hunger', r.hunger ? `${r.hunger}/5` : '—')}${row('Stress', r.stress ? `${r.stress}/5` : '—')}
    </dl>
    ${r.notes ? `<h3 class="h4">Notes</h3><p class="notes">${esc(r.notes)}</p>` : ''}
    <p class="fineprint">Last updated ${esc(new Date(r.updatedAt).toLocaleString('en-GB'))}</p>`;
  const choice = await dialog({
    title: `Check-in · ${formatLong(r.checkInDate)}`, body,
    buttons: [{ label: 'Delete', value: 'delete', kind: 'danger-ghost' }, { label: 'Close', value: null }, { label: 'Edit', value: 'edit', kind: 'primary' }],
  });
  if (choice === 'edit') location.hash = `#/checkin/${r.checkInDate}`;
  if (choice === 'delete') {
    const ok = await confirmDialog('Delete this check-in?',
      `<p>This permanently deletes the check-in for <strong>${esc(formatFull(r.checkInDate))}</strong>: the morning weight for ${esc(formatDayMonth(r.measurementDate))} and the habits for ${esc(formatDayMonth(r.lifestyleDate))}.</p><p>It cannot be undone unless you have a backup.</p>`, 'Delete check-in', true);
    if (ok) {
      try { await deleteRecord(r.id); toast(`Check-in for ${formatLong(r.checkInDate)} deleted.`); }
      catch (e) { toast(e.message, 'error'); }
    }
  }
}
