// Pure calculations. Missing values are always excluded, never treated as 0.
import { addDays, diffDays, mondayOf, rangeDates } from './dates.js';

const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** Weight measurements sorted by measurement date: [{ date, kg }]. */
export function weightSeries(records) {
  return records.filter(r => isNum(r.weightKg))
    .map(r => ({ date: r.measurementDate, kg: r.weightKg }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Latest weight measured on or before `onOrBefore` (inclusive). */
export function latestWeight(records, onOrBefore = null) {
  const s = weightSeries(records).filter(w => !onOrBefore || w.date <= onOrBefore);
  return s.length ? s[s.length - 1] : null;
}

/** Latest weight measured strictly before `date`. */
export function previousWeight(records, date) {
  const s = weightSeries(records).filter(w => w.date < date);
  return s.length ? s[s.length - 1] : null;
}

export function firstWeight(records) {
  const s = weightSeries(records);
  return s.length ? s[0] : null;
}

function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }

/** Values of `field` for records whose `dateKey` falls in [start, end]. */
export function valuesInWindow(records, field, dateKey, start, end) {
  return records.filter(r => r[dateKey] >= start && r[dateKey] <= end && isNum(r[field])).map(r => r[field]);
}

/** { avg, n, sum, start, end } over the window; avg null when nothing recorded. */
export function windowStats(records, field, dateKey, start, end) {
  const v = valuesInWindow(records, field, dateKey, start, end);
  return { avg: mean(v), n: v.length, sum: v.reduce((a, b) => a + b, 0), start, end, days: diffDays(start, end) + 1 };
}

export const MIN_ROLLING = 3; // measurements required for a 7-day average to be shown

/** Seven-calendar-day average of weight ending on `endDate`. */
export function weightAverage(records, endDate, days = 7) {
  return windowStats(records, 'weightKg', 'measurementDate', addDays(endDate, -(days - 1)), endDate);
}

/**
 * Rolling 7-calendar-day average, evaluated on each date that has a
 * measurement. Points with fewer than `minCount` measurements in their
 * window are omitted rather than shown on thin evidence.
 */
export function rollingAverage(weights, days = 7, minCount = MIN_ROLLING) {
  const out = [];
  for (const w of weights) {
    const start = addDays(w.date, -(days - 1));
    const inWin = weights.filter(x => x.date >= start && x.date <= w.date);
    if (inWin.length >= minCount) out.push({ date: w.date, kg: mean(inWin.map(x => x.kg)), n: inWin.length });
  }
  return out;
}

/** Count of days in the lifestyle window where exercise was recorded as yes / any answer. */
export function exerciseStats(records, start, end) {
  const inWin = records.filter(r => r.lifestyleDate >= start && r.lifestyleDate <= end);
  return {
    workouts: inWin.filter(r => r.exercised === true).length,
    resistance: inWin.filter(r => r.resistanceTraining === true).length,
    answered: inWin.filter(r => r.exercised === true || r.exercised === false).length,
    start, end,
  };
}

/** Standard dashboard windows relative to `today`. */
export function windows(today) {
  return {
    // Morning measurements and the sleep that ended this morning.
    morning: { start: addDays(today, -6), end: today },
    // Lifestyle days: yesterday is the most recent day that can be logged.
    lifestyle: { start: addDays(today, -7), end: addDays(today, -1) },
    prevMorning: { start: addDays(today, -13), end: addDays(today, -7) },
    prevLifestyle: { start: addDays(today, -14), end: addDays(today, -8) },
  };
}

/** Least-squares slope of weight vs. time, in kg per week. */
export function weeklyTrend(weights, { minPoints = 4, minSpanDays = 14 } = {}) {
  if (weights.length < minPoints) return null;
  const t0 = weights[0].date;
  const xs = weights.map(w => diffDays(t0, w.date));
  const span = xs[xs.length - 1] - xs[0];
  if (span < minSpanDays) return null;
  const mx = mean(xs), my = mean(weights.map(w => w.kg));
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (weights[i].kg - my); den += (x - mx) ** 2; });
  if (den === 0) return null;
  return { kgPerWeek: (num / den) * 7, n: weights.length, spanDays: span, start: weights[0].date, end: weights[weights.length - 1].date };
}

/**
 * Goal countdown. All inputs in kg / ISO dates.
 * Returns a plain object; UI decides wording.
 */
export function goalCountdown({ latest, startKg, targetKg, targetDate, today }) {
  const g = { hasTarget: isNum(targetKg), hasDate: !!targetDate, hasLatest: !!latest, targetKg, targetDate };
  if (g.hasDate) {
    const days = diffDays(today, targetDate);
    g.daysRemaining = days;
    g.datePassed = days < 0;
    g.dateIsToday = days === 0;
    g.weeksRemaining = days > 0 ? days / 7 : 0;
  }
  if (g.hasTarget && latest) {
    g.currentKg = latest.kg;
    g.latestDate = latest.date;
    g.remainingKg = latest.kg - targetKg;          // positive = still to lose
    g.reached = latest.kg <= targetKg;
    if (g.hasDate && !g.reached && g.daysRemaining > 0) {
      g.requiredKgPerWeek = g.remainingKg / (g.daysRemaining / 7);
      g.requiredPctPerWeek = (g.requiredKgPerWeek / latest.kg) * 100;
      g.aggressive = g.requiredPctPerWeek > 1; // > 1 % of body weight per week
    }
  }
  if (g.hasTarget && isNum(startKg)) {
    g.startKg = startKg;
    if (startKg <= targetKg) g.progressInvalid = true;
    else if (latest) {
      g.progressPct = ((startKg - latest.kg) / (startKg - targetKg)) * 100;
      g.progressBar = Math.max(0, Math.min(100, g.progressPct));
    }
  }
  return g;
}

/**
 * Monday-to-Sunday summary of a lifestyle field (by intake date).
 * `today` limits the "elapsed" part of the current week.
 */
export function weekSummary(records, monday, today, field = 'caloriesKcal') {
  const sunday = addDays(monday, 6);
  const byDate = new Map(records.filter(r => r.lifestyleDate >= monday && r.lifestyleDate <= sunday).map(r => [r.lifestyleDate, r]));
  const days = rangeDates(monday, sunday).map(date => {
    const r = byDate.get(date);
    const future = date > today;
    return { date, value: !future && r && isNum(r[field]) ? r[field] : null, future };
  });
  const logged = days.filter(d => d.value !== null);
  const total = logged.reduce((a, d) => a + d.value, 0);
  const elapsedEnd = today < sunday ? today : sunday;
  return {
    monday, sunday, days, total, n: logged.length,
    avg: logged.length ? total / logged.length : null,
    elapsedDays: today < monday ? 0 : diffDays(monday, elapsedEnd) + 1,
    isCurrent: monday === mondayOf(today),
    complete: today > sunday,
  };
}

/** All Monday dates (descending) that contain any lifestyle record. */
export function weeksWithData(records) {
  return [...new Set(records.map(r => mondayOf(r.lifestyleDate)))].sort().reverse();
}

/** Exercise days per Monday-week over [start, end] (by lifestyle date). */
export function weeklyExercise(records, start, end) {
  const out = [];
  for (let m = mondayOf(start); m <= end; m = addDays(m, 7)) {
    const s = exerciseStats(records, m, addDays(m, 6));
    out.push({ monday: m, ...s });
  }
  return out;
}

export function progressStats(records, today, startKgSetting) {
  const ws = weightSeries(records);
  if (!ws.length) return { hasWeights: false };
  const first = ws[0], latest = ws[ws.length - 1];
  const startKg = isNum(startKgSetting) ? startKgSetting : first.kg;
  const max = ws.reduce((a, b) => (b.kg > a.kg ? b : a));
  const min = ws.reduce((a, b) => (b.kg < a.kg ? b : a));
  return {
    hasWeights: true, first, latest, startKg, startFromSetting: isNum(startKgSetting),
    changeKg: latest.kg - startKg,
    changePct: ((latest.kg - startKg) / startKg) * 100,
    max, min, count: ws.length,
    avg7: weightAverage(records, today, 7),
    avg30: weightAverage(records, today, 30),
    trendAll: weeklyTrend(ws),
    trend28: weeklyTrend(ws.filter(w => w.date >= addDays(today, -27))),
  };
}

const fmt0 = v => Math.round(v).toLocaleString('en-GB');
const fmtHM = mins => `${Math.floor(mins / 60)} h ${String(Math.round(mins % 60)).padStart(2, '0')} min`;

/**
 * Descriptive observations from actual records. Each compares like-for-like
 * windows and requires enough data; none claims causation.
 * `wfmt(kg)` formats a weight difference in the user's unit.
 */
export function insights(records, today, settings, wfmt = kg => `${kg.toFixed(1)} kg`) {
  const out = [];
  const w = windows(today);
  const cur = weightAverage(records, w.morning.end), prev = weightAverage(records, w.prevMorning.end);
  if (cur.n >= MIN_ROLLING && prev.n >= MIN_ROLLING) {
    const d = cur.avg - prev.avg;
    if (Math.abs(d) < 0.05) out.push('Your seven-day average weight was essentially unchanged compared with the previous seven days.');
    else out.push(`Your seven-day average weight ${d < 0 ? 'decreased' : 'increased'} by ${wfmt(Math.abs(d))} compared with the previous seven days (${cur.n} and ${prev.n} weigh-ins).`);
  } else if (cur.n > 0) {
    out.push(`You recorded your weight on ${cur.n} of the last 7 days. At least ${MIN_ROLLING} weigh-ins in each of two consecutive weeks are needed for a week-on-week comparison.`);
  }

  const cmp = (field, label, format, minN = 3) => {
    const a = windowStats(records, field, 'lifestyleDate', w.lifestyle.start, w.lifestyle.end);
    const b = windowStats(records, field, 'lifestyleDate', w.prevLifestyle.start, w.prevLifestyle.end);
    if (a.n < minN) return;
    let s = `You averaged ${format(a.avg)} ${label} over the last 7 days (${a.n} day${a.n === 1 ? '' : 's'} recorded)`;
    if (b.n >= minN) {
      const rel = (a.avg - b.avg) / b.avg;
      s += Math.abs(rel) < 0.03 ? ', similar to the previous week.' : `, ${a.avg > b.avg ? 'higher' : 'lower'} than the previous week (${format(b.avg)}).`;
    } else s += '.';
    out.push(s);
  };
  cmp('steps', 'steps per day', fmt0);
  cmp('caloriesKcal', 'kcal per day', fmt0);
  cmp('proteinG', 'g of protein per day', fmt0);

  const sa = windowStats(records, 'sleepMinutes', 'sleepNightEnd', w.morning.start, w.morning.end);
  const sb = windowStats(records, 'sleepMinutes', 'sleepNightEnd', w.prevMorning.start, w.prevMorning.end);
  if (sa.n >= 3) {
    let s = `Your average sleep duration was ${fmtHM(sa.avg)} across ${sa.n} recorded night${sa.n === 1 ? '' : 's'}`;
    if (sb.n >= 3) {
      const d = sa.avg - sb.avg;
      s += Math.abs(d) < 10 ? ', similar to the previous week.' : `, ${d > 0 ? 'higher' : 'lower'} than the previous week (${fmtHM(sb.avg)}).`;
    } else s += '.';
    out.push(s);
  }

  if (isNum(settings.calorieTarget)) {
    const days = records.filter(r => r.lifestyleDate >= w.lifestyle.start && r.lifestyleDate <= w.lifestyle.end && isNum(r.caloriesKcal));
    if (days.length >= 3) {
      const within = days.filter(r => r.caloriesKcal <= settings.calorieTarget).length;
      out.push(`Calorie intake was at or below your ${fmt0(settings.calorieTarget)} kcal target on ${within} of ${days.length} logged days.`);
    }
  }
  if (isNum(settings.proteinTarget)) {
    const days = records.filter(r => r.lifestyleDate >= w.lifestyle.start && r.lifestyleDate <= w.lifestyle.end && isNum(r.proteinG));
    if (days.length >= 3) {
      const hit = days.filter(r => r.proteinG >= settings.proteinTarget).length;
      out.push(`You reached your ${fmt0(settings.proteinTarget)} g protein target on ${hit} of ${days.length} logged days.`);
    }
  }
  const ex = exerciseStats(records, w.lifestyle.start, w.lifestyle.end);
  const exPrev = exerciseStats(records, w.prevLifestyle.start, w.prevLifestyle.end);
  if (ex.answered >= 3) {
    let s = `You recorded ${ex.workouts} workout day${ex.workouts === 1 ? '' : 's'} in the last 7 days`;
    if (ex.resistance) s += `, including ${ex.resistance} with resistance training`;
    if (exPrev.answered >= 3) s += ` (previous week: ${exPrev.workouts})`;
    out.push(s + '.');
  }
  return out;
}
