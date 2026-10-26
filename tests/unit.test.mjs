// Run: node --test tests/   (also run with TZ=America/New_York etc.)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../js/dates.js';
import * as C from '../js/calc.js';
import { normalizeRecord, parseNumber, derivedDates, missingCore } from '../js/model.js';
import { buildBackup, parseBackup, planMerge, mergeOps, buildCSV } from '../js/backup.js';

const rec = (checkInDate, fields = {}) => normalizeRecord({ checkInDate, ...fields }).record;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('date arithmetic across month, year, leap and DST boundaries', () => {
  assert.equal(D.addDays('2026-11-01', -1), '2026-10-31');
  assert.equal(D.addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(D.addDays('2028-03-01', -1), '2028-02-29'); // leap year
  assert.equal(D.addDays('2027-03-01', -1), '2027-02-28');
  // UK DST ends 25 Oct 2026; US DST ends 1 Nov 2026; EU DST starts 28 Mar 2027
  assert.equal(D.addDays('2026-10-26', -1), '2026-10-25');
  assert.equal(D.addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(D.addDays('2026-11-02', -1), '2026-11-01');
  assert.equal(D.addDays('2027-03-29', -1), '2027-03-28');
  assert.equal(D.diffDays('2026-10-26', '2027-01-15'), 81);
  assert.equal(D.diffDays('2026-03-28', '2026-03-30'), 2);
  assert.equal(D.isValidISO('2026-02-29'), false);
  assert.equal(D.isValidISO('2028-02-29'), true);
  assert.equal(D.isValidISO('2026-13-01'), false);
  assert.equal(D.isValidISO('26-10-2026'), false);
});

test('local today uses device calendar, not UTC', () => {
  // 00:30 local on 26 Oct must be 26 Oct regardless of the UTC date.
  assert.equal(D.todayISO(new Date(2026, 9, 26, 0, 30)), '2026-10-26');
  assert.equal(D.todayISO(new Date(2026, 9, 26, 23, 59)), '2026-10-26');
});

test('weekday / Monday-of', () => {
  assert.equal(D.weekdayMon0('2026-10-26'), 0); // Monday
  assert.equal(D.weekdayMon0('2026-11-01'), 6); // Sunday
  assert.equal(D.mondayOf('2026-11-01'), '2026-10-26');
  assert.equal(D.mondayOf('2027-01-03'), '2026-12-28'); // across year end
  assert.equal(D.mondayOf('2026-11-02'), '2026-11-02');
  assert.equal(D.formatWeekdayDayMonth('2026-10-26'), 'Monday, 26 October');
  assert.equal(D.formatFull('2026-10-25'), 'Sunday, 25 October 2026');
});

test('check-in date relationships (spec section 4)', () => {
  const d = derivedDates('2026-10-26');
  assert.deepEqual(d, { measurementDate: '2026-10-26', lifestyleDate: '2026-10-25', sleepNightStart: '2026-10-25', sleepNightEnd: '2026-10-26' });
  assert.equal(derivedDates('2027-01-01').lifestyleDate, '2026-12-31');
  assert.equal(derivedDates('2028-03-01').lifestyleDate, '2028-02-29');
});

test('blank is missing, zero is a value', () => {
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('  '), null);
  assert.equal(parseNumber('0'), 0);
  assert.equal(parseNumber('78,4'), 78.4);
  assert.ok(Number.isNaN(parseNumber('abc')));
  assert.ok(Number.isNaN(parseNumber('1.2.3')));
  const r = rec('2026-10-26', { caloriesKcal: 0 });
  assert.equal(r.caloriesKcal, 0);
  assert.equal(r.weightKg, null);
  assert.deepEqual(missingCore(r), ['weight', 'protein', 'steps', 'sleep', 'exercise']);
});

test('validation rejects negatives, out of range, non-integers, future dates', () => {
  const bad = normalizeRecord({ checkInDate: '2026-10-26', weightKg: -1, steps: 12.5, sleepQuality: 6, caloriesKcal: -5 });
  assert.equal(bad.errors.length, 4);
  assert.equal(normalizeRecord({ checkInDate: '2026-10-27' }, { today: '2026-10-26' }).errors.length, 1);
  assert.equal(normalizeRecord({ checkInDate: '2026-02-30' }).record, null);
  assert.equal(normalizeRecord({ checkInDate: '2026-10-26', lifestyleDate: '2026-10-26' }).errors.length, 1);
});

test('rolling average uses only actual measurements in 7 calendar days', () => {
  const recs = [rec('2026-10-01', { weightKg: 110 }), rec('2026-10-03', { weightKg: 109 }), rec('2026-10-07', { weightKg: 108 }), rec('2026-10-08', { weightKg: 107 })];
  const ra = C.rollingAverage(C.weightSeries(recs));
  // 10-01: 1 pt, 10-03: 2 pts -> omitted; 10-07: window 10-01..10-07 has 3; 10-08: window 10-02..10-08 has 3
  assert.deepEqual(ra.map(p => p.date), ['2026-10-07', '2026-10-08']);
  near(ra[0].kg, 109); near(ra[1].kg, 108); assert.equal(ra[1].n, 3);
  const w = C.weightAverage(recs, '2026-10-08');
  assert.equal(w.n, 3); near(w.avg, 108);
});

test('lifestyle averages exclude missing days', () => {
  const recs = [rec('2026-10-20', { caloriesKcal: 2000 }), rec('2026-10-21', {}), rec('2026-10-22', { caloriesKcal: 0 })];
  const s = C.windowStats(recs, 'caloriesKcal', 'lifestyleDate', '2026-10-19', '2026-10-25');
  assert.equal(s.n, 2); assert.equal(s.avg, 1000); // recorded 0 counts, missing day does not
});

test('goal countdown', () => {
  const base = { startKg: 115, targetKg: 100, targetDate: '2027-01-15', today: '2026-10-26' };
  let g = C.goalCountdown({ ...base, latest: { date: '2026-10-26', kg: 108.5 } });
  near(g.remainingKg, 8.5, 1e-9); assert.equal(g.daysRemaining, 81); near(g.weeksRemaining, 81 / 7);
  near(g.requiredKgPerWeek, 8.5 / (81 / 7)); near(g.progressPct, (6.5 / 15) * 100); assert.equal(g.aggressive, false);
  g = C.goalCountdown({ ...base, latest: { date: '2026-10-26', kg: 99.5 } });
  assert.equal(g.reached, true); assert.equal(g.requiredKgPerWeek, undefined); near(g.progressPct, (15.5 / 15) * 100); assert.equal(g.progressBar, 100);
  g = C.goalCountdown({ ...base, today: '2027-01-20', latest: { date: '2027-01-20', kg: 103 } });
  assert.equal(g.datePassed, true); assert.equal(g.requiredKgPerWeek, undefined); assert.equal(g.weeksRemaining, 0);
  g = C.goalCountdown({ ...base, today: '2027-01-15', latest: { date: '2027-01-15', kg: 103 } });
  assert.equal(g.dateIsToday, true); assert.equal(g.requiredKgPerWeek, undefined);
  g = C.goalCountdown({ ...base, latest: null });
  assert.equal(g.hasLatest, false); assert.equal(g.remainingKg, undefined); assert.equal(g.daysRemaining, 81);
  g = C.goalCountdown({ ...base, startKg: 100, latest: { date: '2026-10-26', kg: 101 } });
  assert.equal(g.progressInvalid, true); assert.equal(g.progressPct, undefined);
  g = C.goalCountdown({ ...base, latest: { date: '2026-10-26', kg: 116 } }); // gained above start
  assert.ok(g.progressPct < 0); assert.equal(g.progressBar, 0);
  g = C.goalCountdown({ ...base, today: '2027-01-08', latest: { date: '2027-01-08', kg: 105 } });
  assert.equal(g.aggressive, true); // 5 kg in 1 week
  // countdown moves with the local date
  assert.equal(C.goalCountdown({ ...base, today: '2026-10-27', latest: null }).daysRemaining, 80);
});

test('weekly calorie summary: Monday reset, logged days only, boundaries', () => {
  // Lifestyle date = check-in date - 1. Calories for Sun 1 Nov are logged Mon 2 Nov.
  const recs = [
    rec('2026-10-27', { caloriesKcal: 2000 }), // Mon 26 Oct intake
    rec('2026-10-28', { caloriesKcal: 2400 }), // Tue 27 Oct
    // Wed 28 Oct missing
    rec('2026-10-30', { caloriesKcal: 0 }),    // Thu 29 Oct recorded zero
    rec('2026-11-02', { caloriesKcal: 3000 }), // Sun 1 Nov
    rec('2026-11-03', { caloriesKcal: 1800 }), // Mon 2 Nov -> next week
  ];
  const wk = C.weekSummary(recs, '2026-10-26', '2026-10-28');
  assert.equal(wk.n, 2); assert.equal(wk.total, 4400); assert.equal(wk.avg, 2200); assert.equal(wk.elapsedDays, 3);
  assert.equal(wk.days[2].value, null); assert.equal(wk.days[3].future, true);
  const full = C.weekSummary(recs, '2026-10-26', '2026-11-03');
  assert.equal(full.n, 4); assert.equal(full.total, 7400); assert.equal(full.avg, 1850); assert.equal(full.complete, true);
  const next = C.weekSummary(recs, D.mondayOf('2026-11-03'), '2026-11-03');
  assert.equal(next.monday, '2026-11-02'); assert.equal(next.n, 1); assert.equal(next.avg, 1800);
  // Monday: new week has Monday only, and Monday's intake is not logged until Tuesday
  const mon = C.weekSummary(recs, D.mondayOf('2026-11-02'), '2026-11-02');
  assert.equal(mon.elapsedDays, 1); assert.equal(mon.isCurrent, true);
  // Year boundary week: Mon 28 Dec 2026 - Sun 3 Jan 2027
  const yr = [rec('2026-12-29', { caloriesKcal: 2100 }), rec('2027-01-02', { caloriesKcal: 1900 }), rec('2027-01-04', { caloriesKcal: 2500 })];
  const y = C.weekSummary(yr, D.mondayOf('2027-01-01'), '2027-01-05');
  assert.equal(y.monday, '2026-12-28'); assert.equal(y.sunday, '2027-01-03'); assert.equal(y.n, 3); assert.equal(y.total, 6500);
  // editing a previous day's intake changes only its own week
  yr[1].caloriesKcal = 1000;
  assert.equal(C.weekSummary(yr, '2026-12-28', '2027-01-05').total, 5600);
  assert.equal(C.weekSummary(yr, '2027-01-04', '2027-01-05').n, 0);
});

test('weekly trend needs enough data', () => {
  assert.equal(C.weeklyTrend([{ date: '2026-10-01', kg: 100 }, { date: '2026-10-02', kg: 99 }]), null);
  const ws = [0, 7, 14, 21].map((d, i) => ({ date: D.addDays('2026-10-01', d), kg: 110 - i * 0.5 }));
  near(C.weeklyTrend(ws).kgPerWeek, -0.5, 1e-9);
});

test('backup round trip, validation and merge planning', () => {
  const recs = [rec('2026-10-25', { weightKg: 108.9, caloriesKcal: 2100, notes: '=SUM(A1) "quoted", eaten out' }), rec('2026-10-26', { weightKg: 108.5 })];
  const settings = { targetWeightKg: 100, targetDate: '2027-01-15', calorieTarget: 2000 };
  const text = JSON.stringify(buildBackup(recs, settings, '2026-10-26'));
  const p = parseBackup(text, '2026-10-26');
  assert.deepEqual(p.fatal, []); assert.equal(p.records.length, 2); assert.equal(p.invalid.length, 0);
  assert.deepEqual(p.records.map(r => r.id), recs.map(r => r.id));
  assert.equal(p.settings.calorieTarget, 2000);
  assert.ok(parseBackup('{oops', '2026-10-26').fatal.length);
  assert.ok(parseBackup('{"format":"other"}', '2026-10-26').fatal.length);
  assert.ok(parseBackup(JSON.stringify({ ...JSON.parse(text), formatVersion: 99 }), '2026-10-26').fatal.length);
  const tampered = JSON.parse(text); tampered.checkIns[0].weightKg = -3; tampered.checkIns.push({ ...tampered.checkIns[1], id: 'x' });
  const pt = parseBackup(JSON.stringify(tampered), '2026-10-26');
  assert.equal(pt.records.length, 1); assert.equal(pt.invalid.length, 2);

  const existing = [{ ...recs[1], weightKg: 108.7 }, rec('2026-10-20', { weightKg: 110 })];
  const plan = planMerge(existing, p.records);
  assert.equal(plan.added.length, 1); assert.equal(plan.conflicts.length, 1); assert.deepEqual(plan.conflicts[0].fields, ['weightKg']);
  let ops = mergeOps(existing, plan, {});
  assert.equal(ops.put.length, 1); // conflict keeps existing by default
  ops = mergeOps(existing, plan, { '2026-10-26': 'backup' });
  assert.equal(ops.put.length, 2); assert.equal(ops.put[1].id, existing[0].id); assert.equal(ops.put[1].weightKg, 108.5);

  const csv = buildCSV(recs);
  assert.ok(csv.startsWith('﻿check_in_date,weight_date,weight_kg'));
  assert.ok(csv.includes(`"'=SUM(A1) ""quoted"", eaten out"`));
  assert.ok(csv.includes('2026-10-25,2026-10-25,108.9,,2026-10-24,2026-10-25,,,2026-10-24,2100'));
});
