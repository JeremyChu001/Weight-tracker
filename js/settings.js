import { state, saveSettings, applyRestore, reload } from './state.js';
import { formatLong, formatDayMonth, isValidISO } from './dates.js';
import { parseNumber, toKg, kgTo, SETTINGS_SPEC } from './model.js';
import { firstWeight } from './calc.js';
import { buildBackup, buildCSV, backupFileName } from './backup.js';
import { requestPersistence, storageEstimate } from './db.js';
import { inputValue } from './format.js';
import { $, $$, esc, toast, dialog, downloadFile, shareFile } from './ui.js';

export let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });

const seg = (name, opts, val) => `<div class="seg" role="radiogroup" data-setting="${name}">${opts.map(([v, l]) =>
  `<button type="button" role="radio" aria-checked="${val === v}" data-val="${v}">${l}</button>`).join('')}</div>`;

export function renderSettings(root, params) {
  const s = state.settings, f = state.fmt, wu = s.weightUnit;
  const first = firstWeight(state.records);
  const sleepH = s.sleepGoalMinutes !== null ? Math.floor(s.sleepGoalMinutes / 60) : '';
  const sleepM = s.sleepGoalMinutes !== null ? s.sleepGoalMinutes % 60 : '';
  const inp = (id, label, value, unit, mode = 'decimal', hint = '') => `<div class="field">
    <label class="field-label" for="${id}">${label}</label>
    <div class="input-wrap"><input id="${id}" type="text" inputmode="${mode}" autocomplete="off" value="${esc(value)}" placeholder="Not set">${unit ? `<span class="unit">${unit}</span>` : ''}</div>
    ${hint ? `<p class="hint">${hint}</p>` : ''}<p class="err" data-err="${id}"></p></div>`;
  const lastBackup = s.lastBackupAt ? new Date(s.lastBackupAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';

  root.innerHTML = `
  <form class="card stack" id="goals-form" novalidate>
    <h2 class="h3">Goals and targets</h2>
    <p class="hint">All targets are optional and are your own choices. The app does not suggest calorie or protein targets. Changing a target never alters recorded measurements.</p>
    ${inp('s-start', 'Starting weight', inputValue(kgTo(wu, s.startWeightKg), wu === 'kg' ? 2 : 1), wu, 'decimal', first ? `<button type="button" class="link" id="s-use-first">Use first recorded weight (${f.weight(first.kg)} on ${esc(formatDayMonth(first.date))})</button>` : '')}
    <div class="field"><label class="field-label" for="s-start-date">Start date <span class="opt">optional</span></label><input id="s-start-date" type="date" value="${s.startDate || ''}"></div>
    ${inp('s-target', 'Target weight', inputValue(kgTo(wu, s.targetWeightKg), wu === 'kg' ? 2 : 1), wu)}
    <div class="field"><label class="field-label" for="s-target-date">Target date</label><input id="s-target-date" type="date" value="${s.targetDate || ''}"><p class="err" data-err="s-target-date"></p></div>
    ${inp('s-cal', 'Daily calorie target', inputValue(s.calorieTarget, 0), 'kcal', 'numeric')}
    ${inp('s-pro', 'Daily protein target', inputValue(s.proteinTarget, 1), 'g')}
    ${inp('s-steps', 'Daily step target', inputValue(s.stepTarget, 0), 'steps', 'numeric')}
    <div class="field"><span class="field-label">Sleep-duration goal</span><div class="row gap">
      <div class="input-wrap narrow"><input id="s-sleep-h" type="text" inputmode="numeric" value="${sleepH}" placeholder="—" aria-label="Sleep goal hours"><span class="unit">h</span></div>
      <div class="input-wrap narrow"><input id="s-sleep-m" type="text" inputmode="numeric" value="${sleepM}" placeholder="—" aria-label="Sleep goal minutes"><span class="unit">min</span></div>
    </div><p class="err" data-err="s-sleep"></p></div>
    <button type="submit" class="btn primary block">Save goals</button>
  </form>

  <div class="card stack">
    <h2 class="h3">Units and appearance</h2>
    <span class="field-label">Weight unit</span>${seg('weightUnit', [['kg', 'Kilograms (kg)'], ['lb', 'Pounds (lb)']], s.weightUnit)}
    <span class="field-label">Circumference unit</span>${seg('lengthUnit', [['cm', 'Centimetres (cm)'], ['in', 'Inches (in)']], s.lengthUnit)}
    <span class="field-label">Theme</span>${seg('theme', [['light', 'Light'], ['dark', 'Dark'], ['system', 'Match device']], s.theme)}
    <p class="hint">Records are always stored in kilograms and centimetres; changing the unit only changes how they are shown and entered.</p>
  </div>

  <div class="card stack" id="backup-section">
    <h2 class="h3">Backup and restore</h2>
    <dl class="kv">
      <dt>Check-ins stored</dt><dd data-count>${state.records.length}</dd>
      <dt>Last backup</dt><dd>${esc(lastBackup)}</dd>
      <dt>Storage protection</dt><dd id="persist-status">Checking…</dd>
      <dt>Space used</dt><dd id="usage">—</dd>
    </dl>
    <button type="button" class="btn primary block lg" id="b-json">Backup My Data</button>
    <button type="button" class="btn ghost block" id="b-share" hidden>Share backup file…</button>
    <p class="result" id="b-result" role="status" aria-live="polite"></p>
    <button type="button" class="btn ghost block" id="b-csv">Export CSV (Excel / Google Sheets)</button>
    <a class="btn ghost block" href="#/restore">Restore Backup</a>
    <details class="explain"><summary>Where is my data stored?</summary>
      <p>Everything is stored only on this device, inside this browser's storage for this web address (IndexedDB). Nothing is sent to any server, and there is no account or cloud copy.</p>
      <p><strong>You can lose your data</strong> if you clear this browser's website data, uninstall the app or browser, use private browsing, lose or reset the device, or open the app from a different web address. Installing the app to your home screen does <strong>not</strong> back it up. Installing only adds a shortcut that opens the app full-screen and works offline. The only protection against loss is a backup file kept somewhere else, such as cloud drive, email to yourself or a computer.</p>
      <p>A fresh install, a new phone or cleared storage starts empty. Your old records can be recovered only from a backup file you created earlier.</p>
      <p>Create a backup at least weekly. The Home screen reminds you after 7 days.</p>
    </details>
  </div>

  <div class="card stack">
    <h2 class="h3">Install on your phone</h2>
    <button type="button" class="btn ghost block" id="install-btn" ${installPrompt ? '' : 'hidden'}>Install app</button>
    <p class="small"><strong>iPhone / iPad (Safari):</strong> tap the Share button, then <em>Add to Home Screen</em>.</p>
    <p class="small"><strong>Android (Chrome):</strong> open the ⋮ menu, then <em>Install app</em> or <em>Add to Home screen</em>.</p>
    <p class="hint">On iPhone, data stored in Safari and data stored in the home-screen app are kept separately. Choose one and use it consistently, or move data between them with Backup and Restore.</p>
  </div>

  <div class="card stack">
    <h2 class="h3">Privacy</h2>
    <p class="small">The app has no analytics, advertising, tracking or external fonts. It is technically blocked from contacting any server other than the one it was loaded from, and it sends your records nowhere. Backups and CSV exports contain only your check-ins and settings.</p>
  </div>

  <div class="card stack danger-zone">
    <h2 class="h3">Delete all data</h2>
    <p class="small">Permanently removes every check-in and setting from this device.</p>
    <button type="button" class="btn danger-ghost block" id="wipe">Delete all data…</button>
  </div>
  <p class="fineprint center">Morning Weight Tracker 1.0 · data format v1</p>`;

  bindSettings(root);
  if (params?.get?.('backup')) setTimeout(() => $('#backup-section', root)?.scrollIntoView({ behavior: 'smooth' }), 50);
  if (navigator.canShare?.({ files: [new File(['x'], 'x.json', { type: 'application/json' })] })) $('#b-share', root).hidden = false;
  requestPersistence().then(p => {
    const el = $('#persist-status', root); if (!el) return;
    el.textContent = !p.supported ? 'Not reported by this browser' : p.persisted ? 'Persistent (protected from automatic clean-up)' : 'Best-effort (the browser may clear it if the device runs low on space)';
  });
  storageEstimate().then(e => { const el = $('#usage', root); if (el && e?.usage !== undefined) el.textContent = `${(e.usage / 1024).toFixed(0)} KB`; });
}

function bindSettings(root) {
  const s = state.settings;
  $('#s-use-first', root)?.addEventListener('click', () => {
    const fw = firstWeight(state.records);
    $('#s-start', root).value = inputValue(kgTo(s.weightUnit, fw.kg), s.weightUnit === 'kg' ? 2 : 1);
    $('#s-start-date', root).value = fw.date;
  });

  $('#goals-form', root).addEventListener('submit', async e => {
    e.preventDefault();
    const errs = {};
    const read = (id, spec, conv = x => x, unitLabel = '') => {
      const n = parseNumber($(`#${id}`, root).value);
      if (n === null) return null;
      if (Number.isNaN(n) || n < 0) { errs[id] = 'Enter a positive number, or leave blank.'; return undefined; }
      const v = conv(n);
      if (v < spec.min || v > spec.max || (spec.integer && !Number.isInteger(v))) { errs[id] = `Enter a ${spec.integer ? 'whole number' : 'value'} in a realistic range${unitLabel}.`; return undefined; }
      return v;
    };
    const wu = s.weightUnit;
    const patch = {
      startWeightKg: read('s-start', SETTINGS_SPEC.startWeightKg, x => toKg(wu, x)),
      targetWeightKg: read('s-target', SETTINGS_SPEC.targetWeightKg, x => toKg(wu, x)),
      calorieTarget: read('s-cal', SETTINGS_SPEC.calorieTarget),
      proteinTarget: read('s-pro', SETTINGS_SPEC.proteinTarget),
      stepTarget: read('s-steps', SETTINGS_SPEC.stepTarget),
    };
    const h = parseNumber($('#s-sleep-h', root).value), m = parseNumber($('#s-sleep-m', root).value);
    if ([h, m].some(x => Number.isNaN(x) || (x !== null && (x < 0 || !Number.isInteger(x)))) || (m !== null && m > 59) || (h ?? 0) * 60 + (m ?? 0) > 1440) errs['s-sleep'] = 'Enter whole hours (0–24) and minutes (0–59).';
    else patch.sleepGoalMinutes = h === null && m === null ? null : (h ?? 0) * 60 + (m ?? 0);
    const sd = $('#s-start-date', root).value, td = $('#s-target-date', root).value;
    patch.startDate = isValidISO(sd) ? sd : null;
    patch.targetDate = isValidISO(td) ? td : null;
    $$('[data-err]', root).forEach(el => { el.textContent = errs[el.dataset.err] || ''; });
    if (Object.keys(errs).length) { toast('Please correct the highlighted fields.', 'error'); return; }
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
    // Round converted weights to avoid float noise from unit conversion.
    for (const k of ['startWeightKg', 'targetWeightKg']) if (patch[k] !== null && patch[k] !== undefined) patch[k] = Math.round(patch[k] * 1000) / 1000;
    try { await saveSettings(patch); toast('Goals saved.'); } catch (err) { toast(err.message, 'error'); }
  });

  $$('[data-setting]', root).forEach(g => g.addEventListener('click', async e => {
    const b = e.target.closest('button[data-val]'); if (!b) return;
    try { await saveSettings({ [g.dataset.setting]: b.dataset.val }); } catch (err) { toast(err.message, 'error'); }
  }));

  const result = $('#b-result', root);
  $('#b-json', root).addEventListener('click', async () => {
    try {
      const text = JSON.stringify(buildBackup(state.records, state.settings, state.today), null, 2);
      const name = backupFileName(state.today);
      const bytes = downloadFile(name, 'application/json', text);
      await saveSettings({ lastBackupAt: new Date().toISOString() });
      const out = $('#b-result');
      if (out) out.innerHTML = `Backup file <strong>${esc(name)}</strong> created (${state.records.length} check-ins, ${(bytes / 1024).toFixed(1)} KB) and passed to your browser to download. Check your Downloads folder (on iPhone: the Files app → Downloads) to confirm it was saved, then keep a copy somewhere other than this phone.`;
    } catch (err) { result.textContent = `Backup failed: ${err.message}`; }
  });
  $('#b-share', root).addEventListener('click', async () => {
    const text = JSON.stringify(buildBackup(state.records, state.settings, state.today), null, 2);
    const r = await shareFile(backupFileName(state.today), 'application/json', text);
    if (r.shared) { await saveSettings({ lastBackupAt: new Date().toISOString() }); toast('Backup file shared.'); }
    else if (r.aborted) toast('Sharing cancelled. No backup was made.');
    else toast('Sharing is not available. Use "Backup My Data" instead.', 'error');
  });
  $('#b-csv', root).addEventListener('click', () => {
    const name = backupFileName(state.today, 'csv');
    const bytes = downloadFile(name, 'text/csv;charset=utf-8', buildCSV(state.records));
    result.innerHTML = `CSV file <strong>${esc(name)}</strong> created (${state.records.length} rows, ${(bytes / 1024).toFixed(1)} KB). CSV is for analysis only and cannot be restored. Use the JSON backup for restoring.`;
  });
  $('#install-btn', root).addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null; $('#install-btn', root).hidden = true;
  });
  $('#wipe', root).addEventListener('click', async () => {
    const ok = await dialog({
      title: 'Delete all data?',
      body: `<p>This permanently deletes <strong>${state.records.length} check-ins</strong> and all settings from this device. It cannot be undone without a backup file.</p><label class="field-label" for="wipe-confirm">Type DELETE to confirm</label><input id="wipe-confirm" type="text" autocomplete="off" autocapitalize="characters">`,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Delete everything', kind: 'danger', value: d => d.querySelector('#wipe-confirm').value.trim().toUpperCase() === 'DELETE', validate: d => d.querySelector('#wipe-confirm').value.trim().toUpperCase() === 'DELETE' || (toast('Type DELETE to confirm.', 'error'), false) }],
    });
    if (!ok) return;
    try { await applyRestore({ clearAll: true, settings: { ...(await import('./model.js')).DEFAULT_SETTINGS } }); await reload(); toast('All data deleted.'); }
    catch (err) { toast(err.message, 'error'); }
  });
}
