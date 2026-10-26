// Record schema, normalisation and validation.
// A check-in record is keyed by its check-in (morning) date. The lifestyle
// metrics in the same record belong to the previous calendar day, and the
// sleep belongs to the night between those two days. All three dates are
// stored explicitly so no consumer ever has to guess.
import { isValidISO, addDays } from './dates.js';

export const EXERCISE_TYPES = [
  { id: 'strength', label: 'Strength' },
  { id: 'cardio', label: 'Cardio' },
  { id: 'walking', label: 'Walking' },
  { id: 'sports', label: 'Sports' },
  { id: 'other', label: 'Other' },
];

// Canonical units: kg, cm, kcal, g, steps, minutes, litres.
export const NUMERIC_FIELDS = {
  weightKg:        { label: 'Morning weight', min: 20, max: 400, decimals: 3 },
  waistCm:         { label: 'Waist circumference', min: 30, max: 250, decimals: 2 },
  caloriesKcal:    { label: 'Calories', min: 0, max: 20000, integer: true },
  proteinG:        { label: 'Protein', min: 0, max: 1000, decimals: 1 },
  steps:           { label: 'Steps', min: 0, max: 150000, integer: true },
  sleepMinutes:    { label: 'Sleep duration', min: 0, max: 1440, integer: true },
  sleepQuality:    { label: 'Sleep quality', min: 1, max: 5, integer: true },
  exerciseMinutes: { label: 'Exercise duration', min: 0, max: 1440, integer: true },
  waterL:          { label: 'Water intake', min: 0, max: 20, decimals: 2 },
  energy:          { label: 'Energy level', min: 1, max: 5, integer: true },
  hunger:          { label: 'Hunger level', min: 1, max: 5, integer: true },
  stress:          { label: 'Stress level', min: 1, max: 5, integer: true },
};
export const BOOL_FIELDS = { exercised: 'Exercised', resistanceTraining: 'Resistance training' };
export const NOTES_MAX = 4000;

/** Fields that make up a "complete" morning check-in (for the incomplete indicator). */
export const CORE_FIELDS = [
  ['weightKg', 'weight'], ['caloriesKcal', 'calories'], ['proteinG', 'protein'],
  ['steps', 'steps'], ['sleepMinutes', 'sleep'], ['exercised', 'exercise'],
];

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Dates that a check-in on `checkInDate` refers to. */
export function derivedDates(checkInDate) {
  return {
    measurementDate: checkInDate,
    lifestyleDate: addDays(checkInDate, -1),
    sleepNightStart: addDays(checkInDate, -1),
    sleepNightEnd: checkInDate,
  };
}

/**
 * Parse a user-entered number. Blank -> null (missing), never 0.
 * Accepts a comma as decimal separator. Returns NaN for garbage.
 */
export function parseNumber(text) {
  if (text === null || text === undefined) return null;
  const s = String(text).trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return NaN;
  return Number(s);
}

function roundTo(v, decimals) { const f = 10 ** decimals; return Math.round(v * f) / f; }

/**
 * Validate and normalise a record (from the form or from a backup).
 * Returns { record, errors } where errors is a list of { field, message }.
 */
export function normalizeRecord(raw, { requireId = false, today = null } = {}) {
  const errors = [];
  const r = {};
  if (!raw || typeof raw !== 'object') return { record: null, errors: [{ field: '', message: 'Record is not an object.' }] };

  if (!isValidISO(raw.checkInDate)) {
    errors.push({ field: 'checkInDate', message: `Invalid check-in date "${raw.checkInDate}".` });
    return { record: null, errors };
  }
  r.checkInDate = raw.checkInDate;
  if (today && r.checkInDate > today) errors.push({ field: 'checkInDate', message: 'Check-in date is in the future.' });
  const d = derivedDates(r.checkInDate);
  for (const k of Object.keys(d)) {
    if (raw[k] !== undefined && raw[k] !== d[k]) {
      errors.push({ field: k, message: `${k} "${raw[k]}" is inconsistent with check-in date ${r.checkInDate} (expected ${d[k]}).` });
    }
  }
  Object.assign(r, d);

  if (raw.id !== undefined && (typeof raw.id !== 'string' || !raw.id || raw.id.length > 100)) {
    errors.push({ field: 'id', message: 'Invalid record ID.' });
  }
  if (requireId && !raw.id) errors.push({ field: 'id', message: 'Missing record ID.' });
  r.id = typeof raw.id === 'string' && raw.id ? raw.id : newId();

  for (const [key, spec] of Object.entries(NUMERIC_FIELDS)) {
    const v = raw[key];
    if (v === null || v === undefined || v === '') { r[key] = null; continue; }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push({ field: key, message: `${spec.label} must be a number.` }); r[key] = null; continue;
    }
    if (v < spec.min || v > spec.max) {
      errors.push({ field: key, message: `${spec.label} must be between ${spec.min} and ${spec.max}.` }); r[key] = null; continue;
    }
    if (spec.integer && !Number.isInteger(v)) {
      errors.push({ field: key, message: `${spec.label} must be a whole number.` }); r[key] = null; continue;
    }
    r[key] = spec.decimals !== undefined ? roundTo(v, spec.decimals) : v;
  }

  for (const [key, label] of Object.entries(BOOL_FIELDS)) {
    const v = raw[key];
    if (v === null || v === undefined) r[key] = null;
    else if (typeof v === 'boolean') r[key] = v;
    else { errors.push({ field: key, message: `${label} must be yes, no or blank.` }); r[key] = null; }
  }

  const valid = new Set(EXERCISE_TYPES.map(t => t.id));
  if (raw.exerciseTypes === undefined || raw.exerciseTypes === null) r.exerciseTypes = [];
  else if (!Array.isArray(raw.exerciseTypes) || raw.exerciseTypes.some(t => !valid.has(t))) {
    errors.push({ field: 'exerciseTypes', message: 'Unknown exercise type.' }); r.exerciseTypes = [];
  } else r.exerciseTypes = [...new Set(raw.exerciseTypes)];

  if (raw.notes === undefined || raw.notes === null) r.notes = '';
  else if (typeof raw.notes !== 'string') { errors.push({ field: 'notes', message: 'Notes must be text.' }); r.notes = ''; }
  else if (raw.notes.length > NOTES_MAX) { errors.push({ field: 'notes', message: `Notes are limited to ${NOTES_MAX} characters.` }); r.notes = raw.notes.slice(0, NOTES_MAX); }
  else r.notes = raw.notes;

  // Logical consistency: exercise details imply exercise.
  if (r.exercised === false && (r.exerciseTypes.length || r.exerciseMinutes || r.resistanceTraining)) {
    errors.push({ field: 'exercised', message: 'Exercise details are filled in, but "Exercised" is set to No.' });
  }

  for (const k of ['createdAt', 'updatedAt']) {
    r[k] = typeof raw[k] === 'string' && !Number.isNaN(Date.parse(raw[k])) ? raw[k] : new Date().toISOString();
  }
  return { record: r, errors };
}

const COMPARE_KEYS = [...Object.keys(NUMERIC_FIELDS), ...Object.keys(BOOL_FIELDS), 'exerciseTypes', 'notes'];

/** True if two records hold the same measurement data (ignoring id/timestamps). */
export function sameData(a, b) { return diffFields(a, b).length === 0; }

export function diffFields(a, b) {
  const out = [];
  for (const k of COMPARE_KEYS) {
    const va = k === 'exerciseTypes' ? [...(a[k] || [])].sort().join(',') : a[k] ?? null;
    const vb = k === 'exerciseTypes' ? [...(b[k] || [])].sort().join(',') : b[k] ?? null;
    if (va !== vb) out.push(k);
  }
  return out;
}

export function hasAnyData(r) {
  return COMPARE_KEYS.some(k => k === 'exerciseTypes' ? r[k]?.length : k === 'notes' ? !!r[k]?.trim() : r[k] !== null && r[k] !== undefined);
}

export function missingCore(r) {
  return CORE_FIELDS.filter(([k]) => r[k] === null || r[k] === undefined).map(([, label]) => label);
}

export const DEFAULT_SETTINGS = {
  startWeightKg: null,
  startDate: null,
  targetWeightKg: 100,
  targetDate: '2027-01-15',
  calorieTarget: null,
  proteinTarget: null,
  stepTarget: null,
  sleepGoalMinutes: null,
  weightUnit: 'kg',
  lengthUnit: 'cm',
  theme: 'light',
  lastBackupAt: null,
};

export const SETTINGS_SPEC = {
  startWeightKg: { min: 20, max: 400 },
  targetWeightKg: { min: 20, max: 400 },
  calorieTarget: { min: 0, max: 20000, integer: true },
  proteinTarget: { min: 0, max: 1000 },
  stepTarget: { min: 0, max: 150000, integer: true },
  sleepGoalMinutes: { min: 0, max: 1440, integer: true },
};

export function normalizeSettings(raw) {
  const errors = [];
  const s = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return { settings: s, errors: ['Settings missing; defaults used.'] };
  for (const [k, spec] of Object.entries(SETTINGS_SPEC)) {
    if (!(k in raw)) continue;
    const v = raw[k];
    if (v === null) { s[k] = null; continue; }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < spec.min || v > spec.max || (spec.integer && !Number.isInteger(v))) {
      errors.push(`Setting ${k} has an invalid value and was ignored.`); continue;
    }
    s[k] = v;
  }
  for (const k of ['startDate', 'targetDate']) {
    if (!(k in raw)) continue;
    if (raw[k] === null || isValidISO(raw[k])) s[k] = raw[k];
    else errors.push(`Setting ${k} is not a valid date and was ignored.`);
  }
  if ('weightUnit' in raw) { if (['kg', 'lb'].includes(raw.weightUnit)) s.weightUnit = raw.weightUnit; else errors.push('Invalid weight unit ignored.'); }
  if ('lengthUnit' in raw) { if (['cm', 'in'].includes(raw.lengthUnit)) s.lengthUnit = raw.lengthUnit; else errors.push('Invalid length unit ignored.'); }
  if ('theme' in raw && ['light', 'dark', 'system'].includes(raw.theme)) s.theme = raw.theme;
  if (typeof raw.lastBackupAt === 'string') s.lastBackupAt = raw.lastBackupAt;
  return { settings: s, errors };
}

// Unit conversion (storage is always kg / cm).
export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;
export function kgTo(unit, kg) { return kg === null || kg === undefined ? null : unit === 'lb' ? kg / KG_PER_LB : kg; }
export function toKg(unit, v) { return v === null || v === undefined || Number.isNaN(v) ? v : unit === 'lb' ? v * KG_PER_LB : v; }
export function cmTo(unit, cm) { return cm === null || cm === undefined ? null : unit === 'in' ? cm / CM_PER_IN : cm; }
export function toCm(unit, v) { return v === null || v === undefined || Number.isNaN(v) ? v : unit === 'in' ? v * CM_PER_IN : v; }
