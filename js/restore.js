// Restore flow: choose file -> validate -> preview -> merge or replace -> verify.
import { state, applyRestore } from './state.js';
import { formatLong, formatFull } from './dates.js';
import { parseBackup, planMerge, mergeOps, buildBackup, backupFileName, FIELD_LABELS } from './backup.js';
import { EXERCISE_TYPES } from './model.js';
import { getAllCheckins } from './db.js';
import { $, $$, esc, toast, confirmDialog, downloadFile } from './ui.js';

let rs = null; // { fileName, parsed, plan, mode, choices, restoreSettings, safety }

export function renderRestore(root) {
  if (!rs) return renderPick(root);
  renderPreview(root);
}

function renderPick(root, error = '') {
  root.innerHTML = `<div class="card stack">
    <h2 class="h3">Restore Backup</h2>
    <p>Select a <strong>.json</strong> backup file created with "Backup My Data". The file is checked before anything changes, and you choose how it is combined with your current records.</p>
    <label class="btn primary block lg file-btn">Choose backup file<input type="file" id="r-file" accept="application/json,.json" hidden></label>
    ${error ? `<div class="banner error" role="alert">${error}</div>` : ''}
    <p class="hint">CSV exports cannot be restored. They are for spreadsheets only.</p>
    <a href="#/settings" class="link">Back to Settings</a>
  </div>`;
  $('#r-file', root).addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { renderPick(root, 'This file is too large to be a backup from this app.'); return; }
    let text;
    try { text = await file.text(); } catch { renderPick(root, 'The file could not be read.'); return; }
    const parsed = parseBackup(text, state.today);
    if (parsed.fatal.length) { renderPick(root, `<strong>This file cannot be restored.</strong><br>${parsed.fatal.map(esc).join('<br>')}`); return; }
    rs = { fileName: file.name, parsed, plan: planMerge(state.records, parsed.records), mode: 'merge', choices: {}, restoreSettings: false, safety: state.records.length > 0 };
    renderPreview(root);
  });
}

const show = (k, v) => {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'exerciseTypes') return v.length ? v.map(id => EXERCISE_TYPES.find(t => t.id === id)?.label).join(', ') : '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (k === 'weightKg') return state.fmt.weight(v, 2);
  if (k === 'sleepMinutes') return state.fmt.sleep(v);
  return String(v);
};

function renderPreview(root) {
  const { parsed, plan } = rs;
  const n = state.records.length;
  const exported = parsed.meta.exportedAt && !Number.isNaN(Date.parse(parsed.meta.exportedAt)) ? new Date(parsed.meta.exportedAt).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' }) : 'unknown';
  root.innerHTML = `
  <div class="card stack">
    <h2 class="h3">Backup check</h2>
    <dl class="kv">
      <dt>File</dt><dd>${esc(rs.fileName)}</dd>
      <dt>Created</dt><dd>${esc(exported)}</dd>
      <dt>Valid check-ins</dt><dd data-r="valid">${parsed.records.length}</dd>
      <dt>Invalid (will be skipped)</dt><dd data-r="invalid">${parsed.invalid.length}</dd>
      <dt>Check-ins on this device now</dt><dd>${n}</dd>
    </dl>
    ${parsed.warnings.length ? `<div class="banner warn">${parsed.warnings.map(esc).join('<br>')}</div>` : ''}
    ${parsed.invalid.length ? `<details><summary>Show the ${parsed.invalid.length} invalid record(s)</summary><ul class="small">${parsed.invalid.slice(0, 100).map(i => `<li>Record ${i.index + 1}${i.date ? ` (${esc(i.date)})` : ''}: ${esc(i.errors.join(' '))}</li>`).join('')}</ul></details>` : ''}
  </div>

  <div class="card stack">
    <h2 class="h3">How should the backup be restored?</h2>
    <label class="choice"><input type="radio" name="r-mode" value="merge" ${rs.mode === 'merge' ? 'checked' : ''}>
      <span><strong>Merge with my existing records</strong> (recommended)<br><span class="small muted">Existing records are kept. <b data-r="added">${plan.added.length}</b> new date(s) will be added, <b>${plan.identical.length}</b> are already identical, and <b data-r="conflicts">${plan.conflicts.length}</b> date(s) differ. You choose which version to keep for each. Records are matched by check-in date.</span></span></label>
    <label class="choice"><input type="radio" name="r-mode" value="replace" ${rs.mode === 'replace' ? 'checked' : ''}>
      <span><strong>Replace all existing data</strong><br><span class="small muted">Deletes the ${n} check-in(s) and settings on this device and replaces them with the ${parsed.records.length} valid check-in(s) and settings from the backup.</span></span></label>
    <div id="r-mode-opts"></div>
  </div>
  <div id="r-conflicts"></div>
  <div class="card stack">
    <button type="button" class="btn primary block lg" id="r-apply">Restore</button>
    <button type="button" class="btn ghost block" id="r-cancel">Cancel</button>
  </div>`;

  const drawOpts = () => {
    $('#r-mode-opts', root).innerHTML = rs.mode === 'merge'
      ? `<label class="check"><input type="checkbox" id="r-settings" ${rs.restoreSettings ? 'checked' : ''}> Also replace my goals and settings with those in the backup</label>`
      : `${n ? `<label class="check"><input type="checkbox" id="r-safety" ${rs.safety ? 'checked' : ''}> Download a backup of my current data first (recommended)</label>` : ''}`;
    $('#r-settings', root)?.addEventListener('change', e => { rs.restoreSettings = e.target.checked; });
    $('#r-safety', root)?.addEventListener('change', e => { rs.safety = e.target.checked; });
    drawConflicts();
  };
  const drawConflicts = () => {
    const el = $('#r-conflicts', root);
    if (rs.mode !== 'merge' || !plan.conflicts.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="card stack"><h2 class="h3">Dates with different values (${plan.conflicts.length})</h2>
      <p class="small">These dates exist both on this device and in the backup, with different values. By default your current version is kept.</p>
      <div class="row gap"><button type="button" class="btn ghost sm" id="r-all-existing">Keep all current</button><button type="button" class="btn ghost sm" id="r-all-backup">Use all from backup</button></div>
      ${plan.conflicts.map(c => `<div class="conflict">
        <div class="conflict-title">${esc(formatFull(c.date))}</div>
        <table class="data-table"><thead><tr><th scope="col">Field</th><th scope="col">On this device</th><th scope="col">In backup</th></tr></thead><tbody>
          ${c.fields.map(k => `<tr><td>${esc(FIELD_LABELS[k] || k)}</td><td>${esc(show(k, c.existing[k]))}</td><td>${esc(show(k, c.incoming[k]))}</td></tr>`).join('')}
        </tbody></table>
        <div class="seg" role="radiogroup" aria-label="Version to keep for ${esc(formatLong(c.date))}" data-conflict="${c.date}">
          <button type="button" role="radio" data-val="existing" aria-checked="${rs.choices[c.date] !== 'backup'}">Keep current</button>
          <button type="button" role="radio" data-val="backup" aria-checked="${rs.choices[c.date] === 'backup'}">Use backup</button>
        </div></div>`).join('')}</div>`;
    $$('[data-conflict]', el).forEach(g => g.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      rs.choices[g.dataset.conflict] = b.dataset.val; drawConflicts();
    }));
    $('#r-all-existing', el).addEventListener('click', () => { plan.conflicts.forEach(c => { rs.choices[c.date] = 'existing'; }); drawConflicts(); });
    $('#r-all-backup', el).addEventListener('click', () => { plan.conflicts.forEach(c => { rs.choices[c.date] = 'backup'; }); drawConflicts(); });
  };
  $$('input[name="r-mode"]', root).forEach(r => r.addEventListener('change', e => { rs.mode = e.target.value; drawOpts(); }));
  drawOpts();
  $('#r-cancel', root).addEventListener('click', () => { rs = null; location.hash = '#/settings'; });
  $('#r-apply', root).addEventListener('click', () => apply(root));
}

async function apply(root) {
  const { parsed, plan } = rs;
  const before = state.records.length;
  let ops, expected, summary;
  if (rs.mode === 'merge') {
    const mo = mergeOps(state.records, plan, rs.choices);
    const replaced = plan.conflicts.filter(c => rs.choices[c.date] === 'backup').length;
    if (!mo.put.length && !rs.restoreSettings) { toast('Nothing to change: the backup adds no new records.'); return; }
    const ok = await confirmDialog('Merge backup?', `<p>${plan.added.length} check-in(s) will be added and ${replaced} will be updated from the backup. ${plan.conflicts.length - replaced} conflicting date(s) keep your current values. No other records are changed.${rs.restoreSettings ? ' Your goals and settings will be replaced by the backup\'s.' : ''}</p>`, 'Merge');
    if (!ok) return;
    ops = { put: mo.put, deleteIds: mo.deleteIds, settings: rs.restoreSettings ? { ...parsed.settings, lastBackupAt: state.settings.lastBackupAt } : null };
    expected = before + plan.added.length;
    summary = `Added ${plan.added.length}, updated ${replaced}, kept ${plan.identical.length + plan.conflicts.length - replaced} unchanged.`;
  } else {
    const ok = await confirmDialog('Replace all data?', `<p><strong>This deletes all ${before} check-in(s) currently on this device</strong> and your settings, and replaces them with the ${parsed.records.length} check-in(s) from the backup.</p>${rs.safety && before ? '<p>A backup of your current data will be downloaded first.</p>' : '<p>Your current data will not be saved anywhere first.</p>'}`, 'Replace everything', true);
    if (!ok) return;
    if (rs.safety && before) {
      downloadFile(backupFileName(state.today).replace('.json', '-before-restore.json'), 'application/json', JSON.stringify(buildBackup(state.records, state.settings, state.today), null, 2));
    }
    ops = { clearAll: true, put: parsed.records, settings: parsed.settings };
    expected = parsed.records.length;
    summary = `Replaced ${before} check-in(s) with ${parsed.records.length} from the backup.`;
  }
  try {
    await applyRestore(ops);
    const after = (await getAllCheckins()).length; // verify by reading back
    rs = null;
    root.innerHTML = `<div class="card stack"><h2 class="h3">Restore complete</h2>
      <p data-r="summary">${esc(summary)}</p>
      <p class="${after === expected ? '' : 'err'}" data-r="verified">${after === expected ? `Verified: ${after} check-in(s) are now stored on this device.` : `Warning: expected ${expected} check-ins but found ${after}. Please check your history.`}</p>
      <a class="btn primary block" href="#/home">Go to dashboard</a></div>`;
  } catch (e) {
    toast(`Restore failed. No changes were made. ${e.message}`, 'error', 8000);
  }
}
