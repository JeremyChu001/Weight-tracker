// Application state. IndexedDB is the source of truth: after every write the
// records are re-read from the database so every view reflects what is stored.
import * as db from './db.js';
import { DEFAULT_SETTINGS, normalizeSettings } from './model.js';
import { todayISO } from './dates.js';
import { makeFormat } from './format.js';

export const state = {
  records: [],
  byDate: new Map(),
  settings: { ...DEFAULT_SETTINGS },
  fmt: makeFormat(DEFAULT_SETTINGS),
  today: todayISO(),
  storageOk: true,
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); }
function emit(reason) { for (const fn of listeners) fn(reason); }

const channel = 'BroadcastChannel' in globalThis ? new BroadcastChannel('mwt-sync') : null;
channel?.addEventListener('message', () => reload('other-tab'));

export async function reload(reason = 'reload') {
  const [records, rawSettings] = await Promise.all([db.getAllCheckins(), db.getMeta('settings')]);
  state.records = records.sort((a, b) => (a.checkInDate < b.checkInDate ? -1 : 1));
  state.byDate = new Map(state.records.map(r => [r.checkInDate, r]));
  state.settings = rawSettings ? normalizeSettings(rawSettings).settings : { ...DEFAULT_SETTINGS };
  state.fmt = makeFormat(state.settings);
  emit(reason);
}

async function afterWrite(reason) {
  await reload(reason);
  channel?.postMessage(reason);
}

export async function saveRecord(record, opts) { await db.saveCheckin(record, opts); await afterWrite('save'); }
export async function deleteRecord(id) { await db.deleteCheckin(id); await afterWrite('delete'); }
export async function saveSettings(patch) {
  const next = { ...state.settings, ...patch };
  await db.setMeta('settings', next);
  await afterWrite('settings');
}
export async function applyRestore(ops) { await db.applyRestore(ops); await afterWrite('restore'); }
export const getDraft = () => db.getMeta('draft');
export const setDraft = d => db.setMeta('draft', d);
export const clearDraft = () => db.deleteMeta('draft');

export function refreshToday() {
  const t = todayISO();
  if (t !== state.today) { state.today = t; emit('day-changed'); return true; }
  return false;
}
