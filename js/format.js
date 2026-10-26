// Display formatting in the user's preferred units. Missing values render as "—".
import { kgTo, cmTo } from './model.js';

export const DASH = '—';
const nf = new Map();
const num = (v, d = 0) => {
  const k = d;
  if (!nf.has(k)) nf.set(k, new Intl.NumberFormat('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }));
  return nf.get(k).format(v);
};
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const MINUS = '−';

export function makeFormat(settings) {
  const wu = settings.weightUnit || 'kg', lu = settings.lengthUnit || 'cm';
  const f = {
    wu, lu,
    num: (v, d = 0) => (isNum(v) ? num(v, d).replace('-', MINUS) : DASH),
    weightVal: kg => (isNum(kg) ? kgTo(wu, kg) : null),
    weight: (kg, d = 1) => (isNum(kg) ? `${num(kgTo(wu, kg), d)} ${wu}` : DASH),
    weightNum: (kg, d = 1) => (isNum(kg) ? num(kgTo(wu, kg), d) : DASH),
    /** Signed difference, e.g. "−0.4 kg" / "+0.2 kg" / "0.0 kg" */
    weightDiff: (kg, d = 1) => {
      if (!isNum(kg)) return DASH;
      const v = kgTo(wu, kg), r = Number(v.toFixed(d));
      return `${r > 0 ? '+' : r < 0 ? MINUS : ''}${num(Math.abs(r), d)} ${wu}`;
    },
    length: (cm, d = 1) => (isNum(cm) ? `${num(cmTo(lu, cm), d)} ${lu}` : DASH),
    kcal: v => (isNum(v) ? `${num(v)} kcal` : DASH),
    grams: v => (isNum(v) ? `${num(v, Number.isInteger(v) ? 0 : 1)} g` : DASH),
    steps: v => (isNum(v) ? num(v) : DASH),
    int: v => (isNum(v) ? num(v) : DASH),
    pct: (v, d = 0) => (isNum(v) ? `${num(v, d).replace('-', MINUS)}%` : DASH),
    sleep: mins => (isNum(mins) ? `${Math.floor(Math.round(mins) / 60)} h ${String(Math.round(mins) % 60).padStart(2, '0')} min` : DASH),
    sleepShort: mins => (isNum(mins) ? `${(mins / 60).toFixed(1)} h` : DASH),
    litres: v => (isNum(v) ? `${num(v, 1)} L` : DASH),
    signedInt: (v, unit = '') => (isNum(v) ? `${v > 0 ? '+' : v < 0 ? MINUS : ''}${num(Math.abs(v))}${unit}` : DASH),
  };
  return f;
}

/** Value for an <input>, in display units; '' when missing. Avoids float noise. */
export function inputValue(v, decimals) {
  if (!isNum(v)) return '';
  return String(Number(v.toFixed(decimals)));
}
