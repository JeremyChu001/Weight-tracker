// Backup export / validation / merge planning. No network access.
import { normalizeRecord, normalizeSettings, diffFields, newId, NUMERIC_FIELDS } from './model.js';
import { addDays } from './dates.js';

export const BACKUP_FORMAT = 'morning-weight-tracker-backup';
export const BACKUP_VERSION = 1;
export const APP_VERSION = '1.0.0';

export function buildBackup(records, settings, today) {
  const sorted = [...records].sort((a, b) => (a.checkInDate < b.checkInDate ? -1 : 1));
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    exportedOnLocalDate: today,
    storageUnits: { weight: 'kg', length: 'cm', energy: 'kcal', protein: 'g', sleep: 'minutes', water: 'litres', exercise: 'minutes' },
    dateConventions: {
      checkInDate: 'Local calendar date of the morning check-in.',
      measurementDate: 'Date of the morning weight and waist measurements (= checkInDate).',
      lifestyleDate: 'Date the calories, protein, steps and exercise occurred (= checkInDate - 1 day).',
      sleepNightStart: 'Evening the sleep began (= checkInDate - 1 day).',
      sleepNightEnd: 'Morning the sleep ended (= checkInDate).',
    },
    recordCount: sorted.length,
    settings,
    checkIns: sorted,
  };
}

export function backupFileName(today, ext = 'json') { return `weight-tracker-backup-${today}.${ext}`; }

/**
 * Parse and validate a backup file's text. Never throws.
 * { fatal: string[], warnings: string[], records, invalid: [{index, date, errors}], settings, meta }
 */
export function parseBackup(text, today) {
  const res = { fatal: [], warnings: [], records: [], invalid: [], settings: null, meta: null };
  let data;
  try { data = JSON.parse(text); } catch {
    res.fatal.push('The file is not valid JSON. It may be damaged, or it may not be a backup from this app.');
    return res;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) { res.fatal.push('The file does not contain a backup object.'); return res; }
  if (data.format !== BACKUP_FORMAT) { res.fatal.push('This file was not created by the Morning Weight Tracker backup function.'); return res; }
  if (!Number.isInteger(data.formatVersion)) { res.fatal.push('The backup has no format version.'); return res; }
  if (data.formatVersion > BACKUP_VERSION) {
    res.fatal.push(`This backup uses format version ${data.formatVersion}, which is newer than this app supports (version ${BACKUP_VERSION}). Update the app before restoring.`);
    return res;
  }
  if (!Array.isArray(data.checkIns)) { res.fatal.push('The backup does not contain a list of check-ins.'); return res; }
  res.meta = { exportedAt: data.exportedAt, appVersion: data.appVersion, formatVersion: data.formatVersion, recordCount: data.recordCount };
  if (Number.isInteger(data.recordCount) && data.recordCount !== data.checkIns.length) {
    res.warnings.push(`The backup says it contains ${data.recordCount} records but ${data.checkIns.length} were found. The file may be incomplete.`);
  }

  // Allow one day of slack for restoring on a device in an earlier time zone.
  const latestAllowed = addDays(today, 1);
  const seenDates = new Set(), seenIds = new Set();
  data.checkIns.forEach((raw, index) => {
    const { record, errors } = normalizeRecord(raw, { requireId: true, today: latestAllowed });
    const date = raw && typeof raw === 'object' ? raw.checkInDate : undefined;
    if (record && seenDates.has(record.checkInDate)) errors.push({ field: 'checkInDate', message: 'Duplicate check-in date inside the backup.' });
    if (record && seenIds.has(record.id)) errors.push({ field: 'id', message: 'Duplicate record ID inside the backup.' });
    if (errors.length || !record) { res.invalid.push({ index, date, errors: errors.map(e => e.message) }); return; }
    seenDates.add(record.checkInDate); seenIds.add(record.id);
    res.records.push(record);
  });

  const { settings, errors } = normalizeSettings(data.settings);
  res.settings = settings;
  res.warnings.push(...errors);
  if (res.invalid.length) res.warnings.push(`${res.invalid.length} record(s) failed validation and will not be imported.`);
  return res;
}

/** Compare incoming records against existing ones, matched by check-in date. */
export function planMerge(existing, incoming) {
  const byDate = new Map(existing.map(r => [r.checkInDate, r]));
  const plan = { added: [], identical: [], conflicts: [] };
  for (const inc of incoming) {
    const ex = byDate.get(inc.checkInDate);
    if (!ex) plan.added.push(inc);
    else {
      const fields = diffFields(ex, inc);
      if (fields.length) plan.conflicts.push({ date: inc.checkInDate, existing: ex, incoming: inc, fields });
      else plan.identical.push(inc);
    }
  }
  return plan;
}

/**
 * Turn a merge plan plus conflict choices ({ [date]: 'existing'|'backup' })
 * into database operations. Existing records are never removed except where
 * the user explicitly chose the backup version for that date.
 */
export function mergeOps(existing, plan, choices) {
  const usedIds = new Set(existing.map(r => r.id));
  const put = [], deleteIds = [];
  const fixId = r => (usedIds.has(r.id) ? { ...r, id: newId() } : r);
  for (const r of plan.added) { const x = fixId(r); usedIds.add(x.id); put.push(x); }
  for (const c of plan.conflicts) {
    if (choices[c.date] !== 'backup') continue;
    // Keep the existing record's stable ID; take the backup's values.
    put.push({ ...c.incoming, id: c.existing.id, createdAt: c.existing.createdAt, updatedAt: new Date().toISOString() });
  }
  return { put, deleteIds };
}

// ---- CSV ----------------------------------------------------------------
const CSV_COLUMNS = [
  ['check_in_date', r => r.checkInDate],
  ['weight_date', r => r.measurementDate],
  ['weight_kg', r => r.weightKg],
  ['waist_cm', r => r.waistCm],
  ['sleep_night_start', r => r.sleepNightStart],
  ['sleep_night_end', r => r.sleepNightEnd],
  ['sleep_hours', r => (r.sleepMinutes === null ? null : +(r.sleepMinutes / 60).toFixed(2))],
  ['sleep_quality_1_5', r => r.sleepQuality],
  ['lifestyle_date', r => r.lifestyleDate],
  ['calories_kcal', r => r.caloriesKcal],
  ['protein_g', r => r.proteinG],
  ['steps', r => r.steps],
  ['exercised', r => (r.exercised === null ? null : r.exercised ? 'yes' : 'no')],
  ['exercise_types', r => (r.exerciseTypes || []).join(';')],
  ['exercise_minutes', r => r.exerciseMinutes],
  ['resistance_training', r => (r.resistanceTraining === null ? null : r.resistanceTraining ? 'yes' : 'no')],
  ['water_l', r => r.waterL],
  ['energy_1_5', r => r.energy],
  ['hunger_1_5', r => r.hunger],
  ['stress_1_5', r => r.stress],
  ['notes', r => r.notes],
  ['record_id', r => r.id],
  ['updated_at', r => r.updatedAt],
];

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Prevent spreadsheet formula injection from free-text notes.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n;]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCSV(records) {
  const sorted = [...records].sort((a, b) => (a.checkInDate < b.checkInDate ? -1 : 1));
  const lines = [CSV_COLUMNS.map(c => c[0]).join(',')];
  for (const r of sorted) lines.push(CSV_COLUMNS.map(([, f]) => csvCell(f(r))).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n'; // BOM so Excel reads UTF-8
}

export const FIELD_LABELS = { ...Object.fromEntries(Object.entries(NUMERIC_FIELDS).map(([k, v]) => [k, v.label])), exercised: 'Exercised', resistanceTraining: 'Resistance training', exerciseTypes: 'Exercise type', notes: 'Notes' };
