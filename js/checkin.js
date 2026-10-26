// Morning Check-In form: one screen for today's measurements and
// yesterday's habits.
import { state, saveRecord, getDraft, setDraft, clearDraft } from './state.js';
import { addDays, formatFull, formatLong, formatWeekdayDayMonth, isValidISO, formatDayMonth, formatMedium } from './dates.js';
import { EXERCISE_TYPES, NUMERIC_FIELDS, parseNumber, normalizeRecord, toKg, toCm, kgTo, cmTo, hasAnyData, sameData, newId } from './model.js';
import { previousWeight, windowStats } from './calc.js';
import { inputValue } from './format.js';
import { DuplicateDateError } from './db.js';
import { $, $$, esc, toast, dialog, debounce } from './ui.js';

const EMPTY = () => ({
  weight: '', waist: '', calories: '', protein: '', steps: '', sleepH: '', sleepM: '',
  sleepQuality: null, exercised: null, exerciseTypes: [], exerciseMinutes: '', resistance: null,
  water: '', energy: null, hunger: null, stress: null, notes: '',
});

let ctx = null;   // current form context
let saving = false;

function fromRecord(r) {
  const { weightUnit: wu, lengthUnit: lu } = state.settings;
  const v = EMPTY();
  if (!r) return v;
  v.weight = inputValue(kgTo(wu, r.weightKg), wu === 'kg' ? 2 : 1);
  v.waist = inputValue(cmTo(lu, r.waistCm), 1);
  v.calories = inputValue(r.caloriesKcal, 0);
  v.protein = inputValue(r.proteinG, 1);
  v.steps = inputValue(r.steps, 0);
  if (r.sleepMinutes !== null && r.sleepMinutes !== undefined) { v.sleepH = String(Math.floor(r.sleepMinutes / 60)); v.sleepM = String(r.sleepMinutes % 60); }
  v.sleepQuality = r.sleepQuality ?? null;
  v.exercised = r.exercised ?? null;
  v.exerciseTypes = [...(r.exerciseTypes || [])];
  v.exerciseMinutes = inputValue(r.exerciseMinutes, 0);
  v.resistance = r.resistanceTraining ?? null;
  v.water = inputValue(r.waterL, 2);
  v.energy = r.energy ?? null; v.hunger = r.hunger ?? null; v.stress = r.stress ?? null;
  v.notes = r.notes || '';
  return v;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Convert form values to record fields; collects per-field errors in display units. */
function toFields(v) {
  const { weightUnit: wu, lengthUnit: lu } = state.settings;
  const errors = {};
  const out = {};
  const num = (key, text, spec, { conv = x => x, unit = '', min = spec.min, max = spec.max, integer = spec.integer } = {}) => {
    const n = parseNumber(text);
    if (n === null) return null;
    if (Number.isNaN(n)) { errors[key] = 'Enter a number, or leave blank to skip.'; return null; }
    if (n < 0) { errors[key] = 'Cannot be negative.'; return null; }
    if (integer && !Number.isInteger(n)) { errors[key] = 'Enter a whole number.'; return null; }
    if (n < min || n > max) { errors[key] = `Enter a value between ${min} and ${max}${unit ? ' ' + unit : ''}.`; return null; }
    return conv(n);
  };
  const keepOriginal = (field, key) => ctx.existing && v[field] === ctx.initial[field] ? ctx.existing[key] : undefined;

  const wMin = Math.ceil(kgTo(wu, NUMERIC_FIELDS.weightKg.min)), wMax = Math.floor(kgTo(wu, NUMERIC_FIELDS.weightKg.max));
  out.weightKg = keepOriginal('weight', 'weightKg') ?? num('weight', v.weight, NUMERIC_FIELDS.weightKg, { conv: x => toKg(wu, x), unit: wu, min: wMin, max: wMax });
  const cMin = Math.ceil(cmTo(lu, NUMERIC_FIELDS.waistCm.min)), cMax = Math.floor(cmTo(lu, NUMERIC_FIELDS.waistCm.max));
  out.waistCm = keepOriginal('waist', 'waistCm') ?? num('waist', v.waist, NUMERIC_FIELDS.waistCm, { conv: x => toCm(lu, x), unit: lu, min: cMin, max: cMax });
  out.caloriesKcal = num('calories', v.calories, NUMERIC_FIELDS.caloriesKcal, { unit: 'kcal' });
  out.proteinG = num('protein', v.protein, NUMERIC_FIELDS.proteinG, { unit: 'g' });
  out.steps = num('steps', v.steps, NUMERIC_FIELDS.steps);
  const h = num('sleep', v.sleepH, { min: 0, max: 24, integer: true }, { unit: 'hours' });
  const m = num('sleep', v.sleepM, { min: 0, max: 59, integer: true }, { unit: 'minutes' });
  out.sleepMinutes = h === null && m === null ? null : (h ?? 0) * 60 + (m ?? 0);
  if (out.sleepMinutes !== null && out.sleepMinutes > 1440) { errors.sleep = 'Sleep cannot exceed 24 hours.'; out.sleepMinutes = null; }
  out.sleepQuality = v.sleepQuality;
  out.exercised = v.exercised;
  out.exerciseTypes = v.exercised === false ? [] : v.exerciseTypes;
  out.exerciseMinutes = v.exercised === false ? null : num('exerciseMinutes', v.exerciseMinutes, NUMERIC_FIELDS.exerciseMinutes, { unit: 'minutes' });
  out.resistanceTraining = v.exercised === false ? false : v.resistance;
  out.waterL = num('water', v.water, NUMERIC_FIELDS.waterL, { unit: 'L' });
  out.energy = v.energy; out.hunger = v.hunger; out.stress = v.stress;
  out.notes = v.notes.trim();
  if (v.exercised === null && (v.exerciseTypes.length || parseNumber(v.exerciseMinutes) || v.resistance === true)) {
    errors.exercised = 'You entered exercise details. Select "Yes" above to confirm.';
  }
  return { fields: out, errors };
}

// ---------------------------------------------------------------- render
export async function renderCheckin(root, dateParam) {
  const today = state.today;
  let date = isValidISO(dateParam) ? dateParam : today;
  if (date > today) date = today;
  const existing = state.byDate.get(date) || null;
  let draft = null;
  try { draft = await getDraft(); } catch { /* draft is a convenience only */ }
  const initial = fromRecord(existing);
  let v = structuredClone(initial), draftRestored = false;
  if (draft && draft.checkInDate === date && (draft.baseId ?? null) === (existing?.id ?? null) &&
      (!existing || draft.baseUpdatedAt === existing.updatedAt) && draft.v && !same(draft.v, initial)) {
    v = { ...EMPTY(), ...draft.v }; draftRestored = draft.savedAt;
  }
  ctx = { date, existing, editId: existing?.id ?? null, initial, v, movedFrom: null };
  draw(root, draftRestored);
}

function seg(name, options, value, label) {
  return `<div class="seg" role="radiogroup" aria-label="${esc(label)}" data-seg="${name}">${options.map(([val, text]) =>
    `<button type="button" role="radio" aria-checked="${value === val}" data-val='${JSON.stringify(val)}'>${esc(text)}</button>`).join('')}</div>`;
}
const RATING = [1, 2, 3, 4, 5].map(n => [n, String(n)]);

function field({ id, name, label, unit, mode = 'decimal', placeholder = '', optional = true, value }) {
  return `<div class="field">
    <label for="${id}" class="field-label">${esc(label)}${optional ? ' <span class="opt">optional</span>' : ''}</label>
    <div class="input-wrap"><input id="${id}" name="${name}" type="text" inputmode="${mode}" ${mode === 'numeric' ? 'pattern="[0-9]*"' : ''} autocomplete="off" enterkeyhint="next" placeholder="${esc(placeholder)}" value="${esc(value)}" aria-describedby="${id}-info ${id}-err">${unit ? `<span class="unit">${esc(unit)}</span>` : ''}</div>
    <p class="info" id="${id}-info" data-info="${name}"></p>
    <p class="err" id="${id}-err" data-err="${name}" role="alert"></p>
  </div>`;
}

function draw(root, draftRestored) {
  const { date, existing, v } = ctx;
  const s = state.settings, today = state.today;
  const life = addDays(date, -1);
  const isToday = date === today;
  const modeBanner = existing && !ctx.movedFrom
    ? `<div class="banner info">You are editing the saved check-in for ${esc(formatLong(date))}. Saving will update that record.</div>`
    : '';
  root.innerHTML = `
  <form id="checkin-form" class="stack" novalidate>
    <div class="card date-card">
      <div class="row between">
        <div>
          <div class="eyebrow">Check-in date</div>
          <div class="date-big" id="ci-date-label">${esc(formatFull(date))}${isToday ? ' <span class="pill">Today</span>' : ''}</div>
        </div>
        <button type="button" class="btn ghost sm" id="ci-change-date" aria-expanded="false">Change date</button>
      </div>
      <div id="ci-date-picker" class="date-picker" hidden>
        <label for="ci-date" class="field-label">Morning of the check-in</label>
        <input type="date" id="ci-date" value="${date}" max="${today}">
        <p class="hint">Weight and waist are recorded for this date. Calories, protein, steps and exercise are recorded for the day before. Sleep is recorded for the night in between.</p>
      </div>
      <div id="ci-banners">${modeBanner}${draftRestored ? `<div class="banner warn row between"><span>Unsaved changes from ${esc(new Date(draftRestored).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))} were restored.</span><button type="button" class="link" id="ci-discard">Discard</button></div>` : ''}${ctx.movedFrom ? `<div class="banner warn">Saving will move this check-in from ${esc(formatLong(ctx.movedFrom))} to ${esc(formatLong(date))}.</div>` : ''}</div>
    </div>

    <fieldset class="card section">
      <legend class="section-title"><span class="eyebrow">Section A</span>This morning — ${esc(formatLong(date))}</legend>
      ${field({ id: 'f-weight', name: 'weight', label: 'Morning weight', optional: false, unit: s.weightUnit, placeholder: s.weightUnit === 'kg' ? 'e.g. 108.4' : 'e.g. 239.0', value: v.weight })}
      ${field({ id: 'f-waist', name: 'waist', label: 'Waist circumference', unit: s.lengthUnit, value: v.waist })}
    </fieldset>

    <fieldset class="card section">
      <legend class="section-title"><span class="eyebrow">Section B</span>${isToday ? 'Yesterday' : 'Previous day'} — ${esc(formatFull(life))}</legend>
      <p class="hint">Leave any field blank to skip it. Blank fields are stored as "not recorded", never as zero.</p>
      ${field({ id: 'f-calories', name: 'calories', label: 'Total calories consumed', unit: 'kcal', mode: 'numeric', value: v.calories })}
      ${field({ id: 'f-protein', name: 'protein', label: 'Total protein consumed', unit: 'g', value: v.protein })}
      ${field({ id: 'f-steps', name: 'steps', label: 'Total steps', unit: 'steps', mode: 'numeric', value: v.steps })}

      <div class="field">
        <span class="field-label" id="sleep-label">Sleep duration <span class="opt">optional</span></span>
        <p class="hint tight">Time actually asleep on the night of ${esc(formatWeekdayDayMonth(life))} → ${esc(formatWeekdayDayMonth(date))}, not time in bed.</p>
        <div class="row gap" role="group" aria-labelledby="sleep-label">
          <div class="input-wrap narrow"><input id="f-sleepH" name="sleepH" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="—" value="${esc(v.sleepH)}" aria-label="Sleep hours"><span class="unit">h</span></div>
          <div class="input-wrap narrow"><input id="f-sleepM" name="sleepM" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="—" value="${esc(v.sleepM)}" aria-label="Sleep minutes"><span class="unit">min</span></div>
        </div>
        <p class="info" data-info="sleep"></p><p class="err" data-err="sleep" role="alert"></p>
        <span class="field-label sub">Sleep quality <span class="opt">1 = poor, 5 = excellent</span></span>
        ${seg('sleepQuality', RATING, v.sleepQuality, 'Sleep quality')}
      </div>

      <div class="field">
        <span class="field-label">Did you exercise? <span class="opt">optional</span></span>
        ${seg('exercised', [[true, 'Yes'], [false, 'No']], v.exercised, 'Exercised')}
        <p class="err" data-err="exercised" role="alert"></p>
        <div id="exercise-details" class="sub-fields" ${v.exercised === false ? 'hidden' : ''}>
          <span class="field-label sub">Type <span class="opt">select all that apply</span></span>
          <div class="chips" role="group" aria-label="Exercise type">${EXERCISE_TYPES.map(t =>
            `<button type="button" class="chip" aria-pressed="${v.exerciseTypes.includes(t.id)}" data-chip="${t.id}">${esc(t.label)}</button>`).join('')}</div>
          ${field({ id: 'f-exmin', name: 'exerciseMinutes', label: 'Duration', unit: 'min', mode: 'numeric', value: v.exerciseMinutes })}
          <span class="field-label sub">Included resistance training?</span>
          ${seg('resistance', [[true, 'Yes'], [false, 'No']], v.resistance, 'Resistance training')}
        </div>
      </div>
    </fieldset>

    <details class="card section" id="additional" ${(v.water || v.energy || v.hunger || v.stress || v.notes) ? 'open' : ''}>
      <summary class="section-title">Additional metrics <span class="opt">optional</span></summary>
      <p class="hint">Ratings refer to ${esc(isToday ? 'yesterday' : formatWeekdayDayMonth(life))}. Tap a selected rating again to clear it.</p>
      ${field({ id: 'f-water', name: 'water', label: 'Water intake', unit: 'L', value: v.water })}
      <span class="field-label sub">Energy level</span>${seg('energy', RATING, v.energy, 'Energy level')}
      <span class="field-label sub">Hunger level</span>${seg('hunger', RATING, v.hunger, 'Hunger level')}
      <span class="field-label sub">Stress level</span>${seg('stress', RATING, v.stress, 'Stress level')}
      <div class="field">
        <label for="f-notes" class="field-label">Notes</label>
        <textarea id="f-notes" name="notes" rows="3" maxlength="4000" placeholder="Travel, illness, eating out, anything unusual">${esc(v.notes)}</textarea>
      </div>
    </details>

    <div class="save-bar">
      <p class="draft-status muted small" id="draft-status" aria-live="polite"></p>
      <button type="submit" class="btn primary block lg" id="ci-save">${existing ? 'Update Check-In' : 'Save Check-In'}</button>
    </div>
  </form>`;
  bind(root);
  updateInfo(root);
}

// ---------------------------------------------------------------- behaviour
const persistDraft = debounce(async () => {
  if (!ctx) return;
  const dirty = !same(ctx.v, ctx.initial) || ctx.movedFrom;
  try {
    if (!dirty) { await clearDraft(); $('#draft-status') && ($('#draft-status').textContent = ''); return; }
    await setDraft({ checkInDate: ctx.date, baseId: ctx.editId, baseUpdatedAt: ctx.existing?.updatedAt ?? null, v: ctx.v, savedAt: new Date().toISOString() });
    const st = $('#draft-status'); if (st) st.textContent = 'Draft saved on this device';
  } catch { const st = $('#draft-status'); if (st) st.textContent = 'Draft could not be saved'; }
}, 500);

function bind(root) {
  const form = $('#checkin-form', root);
  form.addEventListener('input', e => {
    const n = e.target.name;
    if (n && n in ctx.v) { ctx.v[n] = e.target.value; clearErr(root, n === 'sleepH' || n === 'sleepM' ? 'sleep' : n); updateInfo(root); persistDraft(); }
  });
  form.addEventListener('click', e => {
    const segBtn = e.target.closest('.seg button');
    if (segBtn) {
      const name = segBtn.parentElement.dataset.seg;
      const val = JSON.parse(segBtn.dataset.val);
      ctx.v[name] = ctx.v[name] === val ? null : val; // tap again to clear
      $$('button', segBtn.parentElement).forEach(b => b.setAttribute('aria-checked', String(JSON.parse(b.dataset.val) === ctx.v[name])));
      if (name === 'exercised') { $('#exercise-details', root).hidden = ctx.v.exercised === false; clearErr(root, 'exercised'); }
      updateInfo(root); persistDraft(); return;
    }
    const chip = e.target.closest('[data-chip]');
    if (chip) {
      const id = chip.dataset.chip, set = new Set(ctx.v.exerciseTypes);
      set.has(id) ? set.delete(id) : set.add(id);
      ctx.v.exerciseTypes = EXERCISE_TYPES.map(t => t.id).filter(t => set.has(t));
      chip.setAttribute('aria-pressed', String(set.has(id)));
      if (set.size && ctx.v.exercised === null) { // picking a type implies exercise
        ctx.v.exercised = true;
        $$('[data-seg="exercised"] button', root).forEach(b => b.setAttribute('aria-checked', String(JSON.parse(b.dataset.val) === true)));
      }
      persistDraft();
    }
  });
  $('#ci-change-date', root).addEventListener('click', e => {
    const p = $('#ci-date-picker', root); p.hidden = !p.hidden; e.currentTarget.setAttribute('aria-expanded', String(!p.hidden));
    if (!p.hidden) $('#ci-date', root).focus();
  });
  $('#ci-date', root).addEventListener('change', e => changeDate(root, e.target.value));
  $('#ci-discard', root)?.addEventListener('click', async () => {
    await clearDraft(); ctx.v = structuredClone(ctx.initial); draw(root, false); toast('Unsaved changes discarded.');
  });
  form.addEventListener('submit', e => { e.preventDefault(); save(root); });
}

let changingDate = false;
async function changeDate(root, newDate) {
  if (changingDate) return;
  changingDate = true;
  try { await changeDateInner(root, newDate); } finally { changingDate = false; }
}

async function changeDateInner(root, newDate) {
  if (!isValidISO(newDate) || newDate === ctx.date) return;
  if (newDate > state.today) { toast('A check-in cannot be dated in the future.', 'error'); $('#ci-date', root).value = ctx.date; return; }
  const target = state.byDate.get(newDate);
  const dirty = !same(ctx.v, ctx.initial);
  if (target && target.id !== ctx.editId) {
    const choice = await dialog({
      title: 'A check-in already exists for this date',
      body: `<p>There is already a saved check-in for <strong>${esc(formatFull(newDate))}</strong>.</p>${dirty ? '<p>Opening it will discard the values you have typed here.</p>' : ''}`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Open saved check-in', value: 'open', kind: 'primary' }],
    });
    if (choice === 'open') { await clearDraft().catch(() => {}); location.hash = `#/checkin/${newDate}`; }
    else $('#ci-date', root).value = ctx.date;
    return;
  }
  if (!dirty && !ctx.movedFrom) { location.hash = `#/checkin/${newDate}`; return; }
  if (ctx.existing && !ctx.movedFrom) {
    const choice = await dialog({
      title: 'Move this check-in?',
      body: `<p>You have unsaved changes to the check-in for <strong>${esc(formatFull(ctx.date))}</strong>.</p><p>You can move this check-in to ${esc(formatFull(newDate))}, or discard your changes and open that date instead.</p>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Discard and open', value: 'open' }, { label: 'Move check-in', value: 'move', kind: 'primary' }],
    });
    if (choice === 'open') { await clearDraft().catch(() => {}); location.hash = `#/checkin/${newDate}`; return; }
    if (choice !== 'move') { $('#ci-date', root).value = ctx.date; return; }
  }
  // Keep the typed values and re-date them (a correction before saving).
  if (ctx.existing && !ctx.movedFrom) ctx.movedFrom = ctx.date;
  if (ctx.movedFrom === newDate) ctx.movedFrom = null;
  ctx.date = newDate;
  history.replaceState(null, '', `#/checkin/${newDate}`);
  draw(root, false);
  persistDraft();
}

function clearErr(root, name) { const el = $(`[data-err="${name}"]`, root); if (el) el.textContent = ''; }

function updateInfo(root) {
  const f = state.fmt, s = state.settings, v = ctx.v;
  const set = (name, html) => { const el = $(`[data-info="${name}"]`, root); if (el) el.innerHTML = html; };
  const life = addDays(ctx.date, -1);
  const others = state.records.filter(r => r.id !== ctx.editId && r.checkInDate !== ctx.date);

  // Weight: previous recorded weight and difference
  const prev = previousWeight(others, ctx.date);
  const w = parseNumber(v.weight);
  if (prev) {
    let txt = `Previous: <strong>${f.weight(prev.kg)}</strong> on ${esc(formatDayMonth(prev.date))}`;
    if (w !== null && !Number.isNaN(w)) txt += ` · Change <strong>${f.weightDiff(toKg(s.weightUnit, w) - prev.kg)}</strong>`;
    set('weight', txt);
  } else set('weight', 'No earlier weight recorded.');

  // Calories: target difference and 7-day average (including this entry)
  const cal = parseNumber(v.calories);
  const calOk = cal !== null && !Number.isNaN(cal);
  const win = others.filter(r => r.lifestyleDate >= addDays(life, -6) && r.lifestyleDate <= life && r.caloriesKcal !== null);
  const calVals = win.map(r => r.caloriesKcal).concat(calOk ? [cal] : []);
  let ct = '';
  if (s.calorieTarget !== null) {
    ct += `Target ${f.kcal(s.calorieTarget)}`;
    if (calOk) { const d = cal - s.calorieTarget; ct += ` · <strong>${f.int(Math.abs(d))} kcal ${d > 0 ? 'over' : d < 0 ? 'under' : 'on target'}</strong>`.replace(' kcal on target', ' on target'); }
  } else ct += 'No calorie target set';
  ct += calVals.length ? ` · 7-day average <strong>${f.kcal(calVals.reduce((a, b) => a + b, 0) / calVals.length)}</strong> (${calVals.length} day${calVals.length === 1 ? '' : 's'})` : '';
  set('calories', ct);

  const p = parseNumber(v.protein), pOk = p !== null && !Number.isNaN(p);
  if (s.proteinTarget !== null) {
    set('protein', pOk
      ? `${f.grams(p)} of ${f.grams(s.proteinTarget)} · ${p >= s.proteinTarget ? 'target reached' : `${f.grams(Math.round((s.proteinTarget - p) * 10) / 10)} remaining`} · <strong>${f.pct((p / s.proteinTarget) * 100)}</strong> of target`
      : `Target ${f.grams(s.proteinTarget)}`);
  } else set('protein', 'No protein target set');

  const st = parseNumber(v.steps), stOk = st !== null && !Number.isNaN(st);
  if (s.stepTarget !== null) set('steps', stOk ? `<strong>${f.pct((st / s.stepTarget) * 100)}</strong> of your ${f.steps(s.stepTarget)}-step target` : `Target ${f.steps(s.stepTarget)} steps`);
  else set('steps', 'No step target set');

  const sh = parseNumber(v.sleepH), sm = parseNumber(v.sleepM);
  if (s.sleepGoalMinutes !== null) {
    const ok = !Number.isNaN(sh) && !Number.isNaN(sm) && (sh !== null || sm !== null);
    set('sleep', ok ? `${f.sleep((sh ?? 0) * 60 + (sm ?? 0))} of your ${f.sleep(s.sleepGoalMinutes)} goal` : `Goal ${f.sleep(s.sleepGoalMinutes)}`);
  } else set('sleep', '');
}

async function save(root) {
  if (saving) return;
  const { fields, errors } = toFields(ctx.v);
  $$('[data-err]', root).forEach(el => { el.textContent = errors[el.dataset.err] || ''; });
  if (Object.keys(errors).length) {
    const first = $(`[data-err="${Object.keys(errors)[0]}"]`, root);
    first?.closest('.field, fieldset, details')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (first?.closest('details')) first.closest('details').open = true;
    toast('Please correct the highlighted fields.', 'error');
    return;
  }
  const now = new Date().toISOString();
  const { record, errors: recErrors } = normalizeRecord({
    ...fields, id: ctx.editId || newId(), checkInDate: ctx.date,
    createdAt: ctx.existing?.createdAt || now, updatedAt: now,
  }, { today: state.today });
  if (recErrors.length) { toast(recErrors[0].message, 'error'); return; }
  if (!hasAnyData(record)) { toast('Nothing to save yet. Enter at least one value.', 'error'); return; }
  if (ctx.existing && !ctx.movedFrom && sameData(ctx.existing, record)) { toast('No changes to save.'); return; }

  saving = true; $('#ci-save', root).disabled = true;
  try {
    try { await saveRecord(record); }
    catch (e) {
      if (!(e instanceof DuplicateDateError)) throw e;
      const choice = await dialog({
        title: 'A check-in already exists for this date',
        body: `<p>A different check-in is already saved for <strong>${esc(formatFull(record.checkInDate))}</strong> (last updated ${esc(formatMedium(e.existing.updatedAt.slice(0, 10)))}).</p><p>Choose whether to replace it with what you have entered, or open the saved one instead.</p>`,
        buttons: [{ label: 'Cancel', value: null }, { label: 'Open saved', value: 'open' }, { label: 'Replace saved', value: 'replace', kind: 'danger' }],
      });
      if (choice === 'open') { location.hash = `#/checkin/${record.checkInDate}`; return; }
      if (choice !== 'replace') return;
      await saveRecord(record, { replaceConflicting: true });
    }
    persistDraft.cancel();
    await clearDraft().catch(() => {});
    ctx = null;
    toast(`Check-in saved for ${formatLong(record.checkInDate)}.`);
    location.hash = `#/home?saved=${record.checkInDate}`;
  } catch (e) {
    toast(e.message || 'Could not save. Your entry is kept as a draft.', 'error', 6000);
  } finally {
    saving = false; const b = $('#ci-save'); if (b) b.disabled = false;
  }
}

export function isFormDirty() { return !!ctx && (!same(ctx.v, ctx.initial) || !!ctx.movedFrom); }
export function currentFormDate() { return ctx?.date; }
