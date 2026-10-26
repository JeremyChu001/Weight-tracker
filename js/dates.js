// Calendar-date utilities.
// All dates in the app are local calendar dates stored as "YYYY-MM-DD" strings.
// Arithmetic is done on the calendar date itself (via Date.UTC purely as a
// day counter), so daylight-saving transitions and time-zone changes can never
// shift a stored date. A local timestamp is only consulted to find "today".

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;

export function pad(n) { return String(n).padStart(2, '0'); }

export function fromParts(y, m, d) { return `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`; }

/** Today's date according to the device's local calendar. */
export function todayISO(now = new Date()) {
  return fromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function isValidISO(s) {
  if (typeof s !== 'string') return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function dayNumber(s) {
  const m = ISO_RE.exec(s);
  if (!m) throw new Error(`Invalid date: ${s}`);
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
}

function fromDayNumber(n) {
  const t = new Date(n * DAY_MS);
  return fromParts(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function addDays(s, n) { return fromDayNumber(dayNumber(s) + n); }

/** Whole calendar days from a to b (positive when b is later). */
export function diffDays(a, b) { return dayNumber(b) - dayNumber(a); }

/** 0 = Monday ... 6 = Sunday */
export function weekdayMon0(s) { return (new Date(dayNumber(s) * DAY_MS).getUTCDay() + 6) % 7; }

export function mondayOf(s) { return addDays(s, -weekdayMon0(s)); }

export function rangeDates(start, end) {
  const out = [];
  for (let n = dayNumber(start), e = dayNumber(end); n <= e; n++) out.push(fromDayNumber(n));
  return out;
}

export function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function asUTCDate(s) { return new Date(dayNumber(s) * DAY_MS); }

const fmtCache = new Map();
function fmt(opts) {
  const key = JSON.stringify(opts);
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }));
  return fmtCache.get(key);
}

/** "25 October 2026" */
export function formatLong(s) { return fmt({ day: 'numeric', month: 'long', year: 'numeric' }).format(asUTCDate(s)); }
/** "Monday, 26 October 2026" */
export function formatFull(s) { return `${fmt({ weekday: 'long' }).format(asUTCDate(s))}, ${formatLong(s)}`; }
/** "Monday, 26 October" */
export function formatWeekdayDayMonth(s) { return `${fmt({ weekday: 'long' }).format(asUTCDate(s))}, ${fmt({ day: 'numeric', month: 'long' }).format(asUTCDate(s))}`; }
/** "Mon 26 Oct" */
export function formatShort(s) { return fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(asUTCDate(s)); }
/** "26 Oct" */
export function formatDayMonth(s) { return fmt({ day: 'numeric', month: 'short' }).format(asUTCDate(s)); }
/** "26 Oct 2026" */
export function formatMedium(s) { return fmt({ day: 'numeric', month: 'short', year: 'numeric' }).format(asUTCDate(s)); }
/** "October 2026" */
export function formatMonthYear(s) { return fmt({ month: 'long', year: 'numeric' }).format(asUTCDate(s)); }
/** "Mon" */
export function formatWeekdayShort(s) { return fmt({ weekday: 'short' }).format(asUTCDate(s)); }

export function monthStart(s) { return s.slice(0, 8) + '01'; }
export function addMonths(s, n) {
  const m = ISO_RE.exec(s);
  let y = +m[1], mo = +m[2] - 1 + n;
  y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
  return fromParts(y, mo + 1, 1);
}
export function daysInMonth(s) {
  const m = ISO_RE.exec(s);
  return new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
}
