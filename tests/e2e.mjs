// End-to-end acceptance tests. Requires the app served at BASE (default
// http://localhost:8080) and Playwright with Chromium available.
//   python3 -m http.server 8080 &   node tests/e2e.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8080/';
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mwt-e2e-'));
let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; results.push(`  ✓ ${name}`); }
  else { failed++; results.push(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const section = t => results.push(`\n${t}`);

const browser = await chromium.launch();
process.on('uncaughtException', e => { console.log(results.join('\n')); console.log('\nABORTED:', e.message.split('\n')[0]); process.exit(2); });
process.on('unhandledRejection', e => { console.log(results.join('\n')); console.log('\nABORTED:', String(e?.message || e).split('\n')[0]); process.exit(2); });
const errors = [];

async function newPage({ tz = 'Europe/London', time = '2026-10-26T07:30:00', ctx: existingCtx } = {}) {
  const ctx = existingCtx || await browser.newContext({ ...devices['iPhone 13'], timezoneId: tz, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.clock.setFixedTime(localTime(time, tz));
  return { ctx, page };
}
// Interpret "YYYY-MM-DDTHH:mm:ss" as wall-clock time in tz.
function localTime(s, tz) {
  const guess = new Date(s + 'Z');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(guess);
  const g = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const asUTC = Date.UTC(+g.year, +g.month - 1, +g.day, +g.hour, +g.minute, +g.second);
  return new Date(guess.getTime() - (asUTC - guess.getTime()));
}
const go = async (page, hash = '') => { if (page.url() === BASE + hash) await page.reload(); else await page.goto(BASE + hash); await page.waitForSelector('#loading', { state: 'detached' }); await page.waitForTimeout(150); };
const setDay = async (page, time, tz = 'Europe/London') => {
  await page.clock.setFixedTime(localTime(time, tz));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(150);
};
const dbRecords = page => page.evaluate(async () => (await import('/js/db.js')).getAllCheckins());
const seed = async (page, recs) => {
  await page.evaluate(async recs => {
    const m = await import('/js/model.js'); const db = await import('/js/db.js');
    for (const r of recs) { const n = m.normalizeRecord(r); if (n.errors.length) throw new Error(JSON.stringify(n.errors)); await db.saveCheckin(n.record, { replaceConflicting: true }); }
    await (await import('/js/state.js')).reload();
  }, recs);
};
const text = (page, sel) => page.textContent(sel).then(t => (t || '').replace(/\s+/g, ' ').trim()).catch(() => '');
const fill = async (page, sel, v) => { await page.fill(sel, ''); await page.type(sel, String(v)); };
async function saveForm(page) { await page.click('#ci-save'); await page.waitForTimeout(400); }
async function noHScroll(page) { return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1); }

// ---------------------------------------------------------------------------
section('1–3. Single-form check-in, date association, incomplete entries');
let { ctx, page } = await newPage();
await go(page);
check('Opens directly on the Morning Check-In when today is not done', page.url().includes('#/checkin'));
check('Section B shows exact date being logged', (await text(page, 'fieldset:nth-of-type(2) legend')).includes('Yesterday — Sunday, 25 October 2026'));
check('Sleep labelled with the night before this morning', (await text(page, '#checkin-form')).includes('night of Sunday, 25 October → Monday, 26 October'));
check('Weight field uses decimal keypad', (await page.getAttribute('#f-weight', 'inputmode')) === 'decimal');
check('Steps field uses numeric keypad', (await page.getAttribute('#f-steps', 'inputmode')) === 'numeric');
await fill(page, '#f-weight', '108,5');           // comma decimal accepted
await fill(page, '#f-waist', '112');
await fill(page, '#f-calories', '2100');
await fill(page, '#f-protein', '140');
await fill(page, '#f-steps', '8000');
await fill(page, '#f-sleepH', '7'); await fill(page, '#f-sleepM', '20');
await page.click('[data-seg="sleepQuality"] button[data-val="4"]');
await page.click('[data-seg="exercised"] button[data-val="true"]');
await page.click('[data-chip="strength"]');
await fill(page, '#f-exmin', '45');
await page.click('[data-seg="resistance"] button[data-val="true"]');
await page.click('#additional summary');
await fill(page, '#f-water', '2.5');
await fill(page, '#f-notes', 'Ate out, "big" dinner');
await page.waitForTimeout(700);
const draft = await page.evaluate(async () => (await import('/js/db.js')).getMeta('draft'));
check('Draft is auto-saved while typing', draft?.v?.weight === '108,5' && draft.checkInDate === '2026-10-26');
await saveForm(page);
check('Save navigates to dashboard with confirmation', page.url().includes('#/home') && (await text(page, '#view-home .banner.ok')).includes('Check-in saved'));
let recs = await dbRecords(page);
let r = recs[0];
check('Exactly one record stored', recs.length === 1);
check('Weight & waist dated 26 Oct', r.measurementDate === '2026-10-26' && r.checkInDate === '2026-10-26' && r.weightKg === 108.5 && r.waistCm === 112);
check('Calories/protein/steps/exercise dated 25 Oct', r.lifestyleDate === '2026-10-25' && r.caloriesKcal === 2100 && r.proteinG === 140 && r.steps === 8000 && r.exercised === true && r.exerciseTypes[0] === 'strength' && r.exerciseMinutes === 45 && r.resistanceTraining === true);
check('Sleep = night 25→26 Oct, 440 minutes', r.sleepNightStart === '2026-10-25' && r.sleepNightEnd === '2026-10-26' && r.sleepMinutes === 440 && r.sleepQuality === 4);
check('Unanswered optional fields stored as null, not 0', r.energy === null && r.hunger === null && r.stress === null);
check('Draft cleared after save', (await page.evaluate(async () => (await import('/js/db.js')).getMeta('draft'))) === undefined);

await go(page, '#/checkin/2026-10-25');
check('Previous recorded weight is not shown when none exists before 25 Oct', (await text(page, '[data-info="weight"]')).includes('No earlier weight'));
await fill(page, '#f-weight', '109.4');
await saveForm(page);
recs = await dbRecords(page);
r = recs.find(x => x.checkInDate === '2026-10-25');
check('Incomplete check-in saved (weight only)', !!r && r.weightKg === 109.4);
check('Missing calories/steps/sleep stay null', r.caloriesKcal === null && r.steps === null && r.sleepMinutes === null && r.exercised === null);
await go(page, '#/checkin');
check('Today form opens saved record in edit mode', (await text(page, '#ci-banners')).includes('editing the saved check-in'));
check('Previous weight & difference displayed', (await text(page, '[data-info="weight"]')).includes('Previous: 109.4 kg on 25 Oct · Change −0.9 kg'));

section('5–6. Editing, recalculation, charts update');
await go(page, '#/home');
check('Latest weight card', (await text(page, '[data-stat="latest"]')).includes('108.5 kg'));
check('Goal: 8.5 kg to goal', (await text(page, '[data-goal="remaining"]')) === '8.5 kg to goal');
check('Goal: 81 days, 11.6 weeks', (await text(page, '[data-goal="days"]')) === '81 days' && (await text(page, '[data-goal="weeks"]')).startsWith('11.6 weeks'));
check('Goal: required rate 0.73 kg/week', (await text(page, '[data-goal="rate"]')) === '0.73 kg/week', await text(page, '[data-goal="rate"]'));
const dots0 = await page.locator('#home-weight-chart circle.dot').count();
check('Weight chart shows 2 measurement dots', dots0 === 2, String(dots0));
// Edit latest weight to 103.2
await go(page, '#/checkin/2026-10-26');
await fill(page, '#f-weight', '103.2'); await saveForm(page);
check('Edited weight updates remaining: 3.2 kg to goal', (await text(page, '[data-goal="remaining"]')) === '3.2 kg to goal');
check('Required rate recalculated', (await text(page, '[data-goal="rate"]')) === `${(3.2 / (81 / 7)).toFixed(2)} kg/week`);
check('Change-since-start uses first weigh-in when no start set', (await text(page, '[data-stat="change"]')).includes('−6.2 kg'));
recs = await dbRecords(page);
check('Edit updated in place (no duplicate)', recs.length === 2 && recs.find(x => x.checkInDate === '2026-10-26').weightKg === 103.2 && recs.find(x => x.checkInDate === '2026-10-26').caloriesKcal === 2100);
await go(page, '#/checkin/2026-10-26');
await fill(page, '#f-weight', '99.5'); await saveForm(page);
check('Reached goal shows congratulation, no positive remaining', (await text(page, '[data-goal="remaining"]')) === 'Goal weight reached' && (await text(page, '#goal-card')).includes('0.5 kg below') && (await text(page, '[data-goal="rate"]')) === 'Goal reached');
// Progress bar from starting weight using "use first recorded weight"
await page.click('#use-first'); await page.waitForTimeout(300);
const pb = await page.getAttribute('.progress', 'aria-valuenow');
check('Progress bar capped at 100% when goal passed', pb === '100');
check('Progress % above 100 shown', (await text(page, '.progress-wrap')).includes('105% of the way'), await text(page, '.progress-wrap'));

section('4. Persistence across reload and browser restart');
await page.reload(); await page.waitForSelector('#loading', { state: 'detached' });
check('Records present after reload', (await dbRecords(page)).length === 2 && (await text(page, '[data-stat="latest"]')).includes('99.5 kg'));
await ctx.close();
// Persistent profile: close the browser entirely and reopen.
const profile = path.join(TMP, 'profile');
let pctx = await chromium.launchPersistentContext(profile, { ...devices['iPhone 13'], timezoneId: 'Europe/London' });
let pp = pctx.pages()[0] || await pctx.newPage();
await pp.clock.setFixedTime(localTime('2026-10-26T07:30:00', 'Europe/London'));
await go(pp, '#/checkin');
await fill(pp, '#f-weight', '107.7'); await fill(pp, '#f-calories', '0'); await saveForm(pp);
await pp.evaluate(async () => (await import('/js/state.js')).saveSettings({ calorieTarget: 2000 }));
await pctx.close();
pctx = await chromium.launchPersistentContext(profile, { ...devices['iPhone 13'], timezoneId: 'Europe/London' });
pp = pctx.pages()[0] || await pctx.newPage();
await pp.clock.setFixedTime(localTime('2026-10-27T07:30:00', 'Europe/London'));
await go(pp, '#/home');
const pr = await dbRecords(pp);
check('Record survives full browser restart', pr.length === 1 && pr[0].weightKg === 107.7);
check('Recorded zero calories kept as 0 (not missing)', pr[0].caloriesKcal === 0);
check('Settings survive restart', (await pp.evaluate(async () => (await import('/js/db.js')).getMeta('settings'))).calorieTarget === 2000);
check('Countdown advanced with the local date (80 days)', (await text(pp, '[data-goal="days"]')) === '80 days');
check('Default route after restart is check-in when today not done', (await (async () => { await go(pp); return pp.url().includes('#/checkin'); })()));
await pctx.close();

section('7 & 12. Missing data, invalid input, duplicates');
({ ctx, page } = await newPage());
await go(page, '#/home');
check('Missing weight: goal shows "No weight recorded yet"', (await text(page, '#goal-card')).includes('No weight recorded yet'));
check('Missing data: averages show — not 0', (await text(page, '[data-stat="cal"] .stat-value')) === '—' && (await text(page, '[data-stat="avg7"] .stat-value')) === '—');
check('Key numbers with no data show — not 0', (await text(page, '[data-stat="key-cal"] .stat-value')) === '—' && (await text(page, '[data-stat="key-thiswk"] .stat-value')) === '—' && (await text(page, '[data-stat="key-lastwk"] .stat-value')) === '—');
check('Weeks to target date shown without weight data (81 days = 11.6 weeks)', (await text(page, '[data-stat="key-weeks"] .stat-value')) === '11.6 weeks' && (await text(page, '[data-stat="key-weeks"]')).includes('81 days to 15 Jan'));
check('No calorie data message', (await text(page, '[data-week="empty"]')) === 'No calorie data logged this week.');
await go(page, '#/checkin');
await fill(page, '#f-weight', 'abc'); await fill(page, '#f-steps', '-5'); await fill(page, '#f-calories', '12.5');
await saveForm(page);
check('Invalid weight rejected with message', (await text(page, '[data-err="weight"]')).length > 0);
check('Negative steps rejected', (await text(page, '[data-err="steps"]')) === 'Cannot be negative.');
check('Non-integer calories rejected', (await text(page, '[data-err="calories"]')) === 'Enter a whole number.');
await fill(page, '#f-weight', '900'); await saveForm(page);
check('Unrealistic weight rejected', (await text(page, '[data-err="weight"]')).startsWith('Enter a value between'));
check('Nothing saved after invalid input', (await dbRecords(page)).length === 0);
await page.fill('#f-weight', ''); await page.fill('#f-steps', ''); await page.fill('#f-calories', '');
await page.evaluate(() => { const el = document.querySelector('#f-weight'); el.dispatchEvent(new Event('input', { bubbles: true })); });
await saveForm(page);
check('Empty form refuses to save', (await dbRecords(page)).length === 0);
// Duplicate from another tab: page A open (new) for 24 Oct, page B saves 24 Oct first.
await go(page, '#/checkin/2026-10-24');
await fill(page, '#f-weight', '110');
const pageB = await ctx.newPage();
await pageB.clock.setFixedTime(localTime('2026-10-26T07:30:00', 'Europe/London'));
await go(pageB, '#/checkin/2026-10-24');
await fill(pageB, '#f-weight', '111'); await saveForm(pageB);
await page.click('#ci-save'); await page.waitForSelector('.dlg');
check('Duplicate date triggers explicit choice dialog', (await text(page, '.dlg')).includes('already saved for'));
await page.click('.dlg button:has-text("Cancel")');
recs = await dbRecords(page);
check('Cancel keeps the existing record, no duplicate', recs.length === 1 && recs[0].weightKg === 111);
await page.click('#ci-save'); await page.waitForSelector('.dlg');
await page.click('.dlg button:has-text("Replace saved")'); await page.waitForTimeout(400);
recs = await dbRecords(page);
check('Explicit replace overwrites the single record', recs.length === 1 && recs[0].weightKg === 110);
await pageB.close();
// Future date not allowed; date change onto existing date asks
await go(page, '#/checkin/2026-10-27');
check('Future date clamps to today', (await text(page, '#ci-date-label')).startsWith('Monday, 26 October 2026'));
await fill(page, '#f-weight', '108');
await page.click('#ci-change-date');
await page.fill('#ci-date', '2026-10-24');
await page.waitForSelector('.dlg');
check('Changing date onto existing check-in asks first', (await text(page, '.dlg')).includes('already exists'));
await page.click('.dlg button:has-text("Cancel")');
await page.fill('#ci-date', '2026-10-23'); await page.waitForTimeout(300);
check('Date correction before saving re-labels both sections', (await text(page, '#checkin-form')).includes('This morning — 23 October 2026') && (await text(page, '#checkin-form')).includes('Thursday, 22 October 2026'));
check('Typed values kept after date correction', (await page.inputValue('#f-weight')) === '108');
await saveForm(page);
recs = await dbRecords(page);
check('Corrected-date entry saved to 23 Oct with lifestyle 22 Oct', !!recs.find(x => x.checkInDate === '2026-10-23' && x.lifestyleDate === '2026-10-22' && x.weightKg === 108));

section('9. History: incomplete indicator, detail, delete with confirmation');
await go(page, '#/history');
check('History lists records', (await page.locator('.day-row').count()) === 2);
check('Incomplete indicator shown', (await text(page, '.day-row .badge')).includes('Incomplete'));
await page.click('.day-row[data-open="2026-10-23"]'); await page.waitForSelector('.dlg');
check('Detail view shows explicit dates', (await text(page, '.dlg')).includes('Habits on Thursday, 22 October 2026'));
await page.click('.dlg button:has-text("Delete")'); await page.waitForTimeout(150);
check('Delete asks for confirmation', (await text(page, '.dlg')).includes('Delete this check-in?'));
await page.click('.dlg button:has-text("Cancel")'); await page.waitForTimeout(150);
check('Cancelled delete keeps record', (await dbRecords(page)).length === 2);
await page.click('.day-row[data-open="2026-10-23"]'); await page.waitForSelector('.dlg');
await page.click('.dlg button:has-text("Delete")'); await page.waitForTimeout(150);
await page.click('.dlg button:has-text("Delete check-in")'); await page.waitForTimeout(400);
check('Confirmed delete removes record and list updates', (await dbRecords(page)).length === 1 && (await page.locator('.day-row').count()) === 1);
await page.fill('#h-q', 'nomatch'); await page.waitForTimeout(100);
check('Search filter works', (await text(page, '#h-list')).includes('No check-ins match'));
await ctx.close();

// ---------------------------------------------------------------------------
section('17/18. Weekly calorie tracker (Mon–Sun) and goal edge cases');
({ ctx, page } = await newPage({ time: '2026-10-30T08:00:00' })); // Friday
await go(page, '#/home');
await seed(page, [
  { checkInDate: '2026-10-26', caloriesKcal: 2500, weightKg: 109 },   // Sun 25 Oct intake -> previous week
  { checkInDate: '2026-10-27', caloriesKcal: 2000, weightKg: 108.8 }, // Mon 26 Oct
  { checkInDate: '2026-10-28', caloriesKcal: 2400 },                  // Tue 27 Oct
  /* Wed 28 Oct missing */
  { checkInDate: '2026-10-30', caloriesKcal: 0, weightKg: 108.2 },    // Thu 29 Oct recorded zero
]);
await page.evaluate(async () => (await import('/js/state.js')).saveSettings({ calorieTarget: 2000 }));
await go(page, '#/home');
check('Week label uses explicit Monday–Sunday dates', (await text(page, '[data-week="label"]')) === 'Current week: Monday, 26 October – Sunday, 1 November');
check('Running average excludes missing day, includes recorded zero: 1,467', (await text(page, '[data-week="avg"]')) === '1,467', await text(page, '[data-week="avg"]'));
check('Total so far 4,400 kcal', (await text(page, '[data-week="total"]')) === '4,400');
check('Logged days 3 of 5 elapsed', (await text(page, '[data-week="n"]')) === '3' && (await text(page, '#weekly-card')).includes('of 5 days elapsed'));
check('Overall calorie average uses logged days only (6,900 / 4 = 1,725)', (await text(page, '[data-stat="key-cal"] .stat-value')) === '1,725 kcal' && (await text(page, '[data-stat="key-cal"]')).includes('4 logged days since 25 Oct'));
check("This week's running weight average (Mon–Fri, 3 weigh-ins = 108.7)", (await text(page, '[data-stat="key-thiswk"] .stat-value')) === '108.7 kg' && (await text(page, '[data-stat="key-thiswk"]')).includes('3 weigh-ins'));
check('Last week average blank when last week had no weigh-ins', (await text(page, '[data-stat="key-lastwk"] .stat-value')) === '—' && (await text(page, '[data-stat="key-lastwk"]')).includes('No weigh-ins · 19 Oct–25 Oct'));
check('Weeks to target date from Fri 30 Oct (77 days = 11.0 weeks)', (await text(page, '[data-stat="key-weeks"] .stat-value')) === '11.0 weeks');
check('Target comparison shown', (await text(page, '#weekly-card')).includes('533 kcal below'));
check('Weekly chart: 3 bars (zero drawn as baseline mark), future days empty', (await page.locator('#week-chart path.bar').count()) === 3 && (await page.locator('#week-chart line.zero-mark').count()) === 1);
// Edit a previous day's calories -> correct historical week
await go(page, '#/checkin/2026-10-28');
await fill(page, '#f-calories', '1400'); await saveForm(page);
check('Editing Tue intake updates the current week (1,133)', (await text(page, '[data-week="avg"]')) === '1,133');
check('Editing a calorie entry updates the overall average (5,900 / 4 = 1,475)', (await text(page, '[data-stat="key-cal"] .stat-value')) === '1,475 kcal');
await page.click('#wk-prev'); await page.waitForTimeout(100);
check('Previous week unaffected by edit (2,500, 1 day)', (await text(page, '[data-week="avg"]')) === '2,500' && (await text(page, '[data-week="label"]')).startsWith('Week: Monday, 19 October'));
// Sunday then Monday rollover
await seed(page, [{ checkInDate: '2026-11-02', caloriesKcal: 1800 }]); // Sun 1 Nov intake, logged Mon
await setDay(page, '2026-11-01T09:00:00');
await go(page, '#/home');
check('Sunday: full week covers Mon–Sun', (await text(page, '[data-week="label"]')) === 'Current week: Monday, 26 October – Sunday, 1 November');
await setDay(page, '2026-11-02T07:00:00');
await go(page, '#/home');
check('Monday starts a new week automatically', (await text(page, '[data-week="label"]')) === 'Current week: Monday, 2 November – Sunday, 8 November');
check('New week has no data yet on Monday morning', (await text(page, '[data-week="empty"]')) === 'No calorie data logged this week.');
check("Monday: last week's weight average rolls over (26 Oct–1 Nov = 108.7)", (await text(page, '[data-stat="key-lastwk"] .stat-value')) === '108.7 kg' && (await text(page, '[data-stat="key-lastwk"]')).includes('26 Oct–1 Nov'));
check("Monday: this week's running average starts empty", (await text(page, '[data-stat="key-thiswk"] .stat-value')) === '—');
check('Monday note explains Sunday intake belongs to last week', (await text(page, '#weekly-card')).includes("belongs to last week"));
await page.click('#wk-prev'); await page.waitForTimeout(100);
check("Sunday's week remains available after Monday: 4 days, total 5,200", (await text(page, '[data-week="total"]')) === '5,200' && (await text(page, '[data-week="n"]')) === '4');
await go(page, '#/history'); await page.click('[data-tab="weeks"]'); await page.waitForTimeout(100);
check('History weeks list shows completed weeks', (await text(page, '#hist-body')).includes('Monday, 26 October – Sunday, 1 November') && (await text(page, '#hist-body')).includes('5,200 kcal total · 4 days logged'));
// Target date edit
await go(page, '#/settings');
await page.fill('#s-target-date', '2027-02-15');
await page.click('#goals-form button[type="submit"]'); await page.waitForTimeout(300);
await go(page, '#/home');
check('Target date editable in Settings; countdown follows', (await text(page, '[data-goal="days"]')) === '105 days' && (await text(page, '#goal-card')).includes('by 15 February 2027'));
// Passed deadline
await setDay(page, '2027-02-20T08:00:00'); await go(page, '#/home');
check('Passed deadline: "Target date passed", no negative countdown', (await text(page, '[data-goal="days"]')) === 'Target date passed' && (await text(page, '[data-goal="rate"]')) === 'Not calculated');
check('Passed deadline: weeks tile says Passed, no negative weeks', (await text(page, '[data-stat="key-weeks"] .stat-value')) === 'Passed');
check('Goal uses latest recorded weight, with age shown', (await text(page, '#goal-card')).includes('108.2 kg on 30 Oct'));
await ctx.close();

section('18.12 Year-boundary week and month boundary');
({ ctx, page } = await newPage({ time: '2027-01-02T08:00:00' })); // Saturday
await go(page);
await seed(page, [
  { checkInDate: '2026-12-29', caloriesKcal: 2100 }, // Mon 28 Dec
  { checkInDate: '2027-01-01', caloriesKcal: 1900 }, // Thu 31 Dec
  { checkInDate: '2027-01-02', caloriesKcal: 2300 }, // Fri 1 Jan
]);
await go(page, '#/home');
check('Week crosses year end: Mon 28 Dec – Sun 3 Jan', (await text(page, '[data-week="label"]')) === 'Current week: Monday, 28 December – Sunday, 3 January');
check('Year-boundary totals correct (6,300 / 3 days / 2,100)', (await text(page, '[data-week="total"]')) === '6,300' && (await text(page, '[data-week="avg"]')) === '2,100');
await go(page, '#/checkin');
check('Check-in on 2 Jan logs habits for 1 Jan 2027', (await text(page, 'fieldset:nth-of-type(2) legend')).includes('Friday, 1 January 2027'));
await go(page, '#/checkin/2027-01-01');
check('Check-in on 1 Jan logs habits for 31 Dec 2026', (await text(page, 'fieldset:nth-of-type(2) legend')).includes('Thursday, 31 December 2026'));
await ctx.close();

section('4. Time zones and DST (no date shift)');
for (const [tz, time, expect] of [['Pacific/Auckland', '2026-10-26T00:30:00', '2026-10-26'], ['America/Los_Angeles', '2026-10-26T23:45:00', '2026-10-26'], ['America/New_York', '2026-11-01T01:30:00', '2026-11-01'], ['Europe/London', '2026-10-25T01:30:00', '2026-10-25']]) {
  ({ ctx, page } = await newPage({ tz, time }));
  await go(page, '#/checkin');
  await fill(page, '#f-weight', '100.1'); await saveForm(page);
  const rr = (await dbRecords(page))[0];
  check(`${tz} at ${time.slice(11, 16)} local saves check-in for ${expect}`, rr?.checkInDate === expect, rr?.checkInDate);
  await ctx.close();
}
// Records keep their dates after the device time zone changes
{
  const prof = path.join(TMP, 'tzprofile');
  let c = await chromium.launchPersistentContext(prof, { timezoneId: 'Europe/London' });
  let p = c.pages()[0]; await p.clock.setFixedTime(localTime('2026-10-26T07:00:00', 'Europe/London'));
  await go(p, '#/checkin'); await fill(p, '#f-weight', '101'); await saveForm(p); await c.close();
  c = await chromium.launchPersistentContext(prof, { timezoneId: 'America/Los_Angeles' });
  p = c.pages()[0]; await p.clock.setFixedTime(localTime('2026-10-26T07:00:00', 'Europe/London'));
  await go(p, '#/history');
  const rr = (await dbRecords(p))[0];
  check('Stored dates unchanged after moving to another time zone', rr.checkInDate === '2026-10-26' && rr.lifestyleDate === '2026-10-25' && (await text(p, '.day-row')).includes('Mon 26 Oct'));
  await c.close();
}

// ---------------------------------------------------------------------------
section('8–10. Backup, CSV and restore');
({ ctx, page } = await newPage());
await go(page);
await seed(page, [
  { checkInDate: '2026-10-20', weightKg: 110.2, caloriesKcal: 2200, steps: 6000, notes: '=cmd() travel, "hotel"' },
  { checkInDate: '2026-10-21', weightKg: 109.9, proteinG: 150, exercised: true, exerciseTypes: ['cardio', 'walking'] },
  { checkInDate: '2026-10-22', weightKg: 109.6, sleepMinutes: 400 },
]);
await page.evaluate(async () => (await import('/js/state.js')).saveSettings({ calorieTarget: 2100, proteinTarget: 160, startWeightKg: 112 }));
await go(page, '#/settings');
let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#b-json')]);
await page.waitForTimeout(400);
const backupPath = path.join(TMP, dl.suggestedFilename()); await dl.saveAs(backupPath);
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
check('JSON backup downloaded with dated filename', dl.suggestedFilename() === 'weight-tracker-backup-2026-10-26.json');
check('Backup has format version, timestamp, settings, all records', backup.formatVersion === 1 && !!backup.exportedAt && backup.settings.calorieTarget === 2100 && backup.checkIns.length === 3 && backup.recordCount === 3);
check('Backup records carry stable IDs and explicit dates', backup.checkIns.every(c => c.id && c.lifestyleDate && c.sleepNightEnd));
check('Backup result message does not over-claim', (await text(page, '#b-result')).includes('passed to your browser to download'));
check('Last backup date recorded', !(await text(page, '#backup-section')).includes('Never'));
[dl] = await Promise.all([page.waitForEvent('download'), page.click('#b-csv')]);
const csvPath = path.join(TMP, 'out.csv'); await dl.saveAs(csvPath);
const csv = fs.readFileSync(csvPath, 'utf8');
const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
check('CSV export: header + 3 rows', lines.length === 4 && lines[0].startsWith('check_in_date,weight_date,weight_kg'));
check('CSV blanks for missing values, explicit lifestyle date', lines[3].startsWith('2026-10-22,2026-10-22,109.6,,2026-10-21,2026-10-22,6.67,,2026-10-21,,,,'), lines[3]);
check('CSV escapes quotes and neutralises formulas', csv.includes(`"'=cmd() travel, ""hotel"""`));

// Restore into a fresh, empty installation
const fresh = await newPage();
await go(fresh.page, '#/restore');
await fresh.page.setInputFiles('#r-file', backupPath); await fresh.page.waitForTimeout(200);
check('Restore preview: 3 valid, 0 invalid, 3 new', (await text(fresh.page, '[data-r="valid"]')) === '3' && (await text(fresh.page, '[data-r="invalid"]')) === '0' && (await text(fresh.page, '[data-r="added"]')) === '3');
await fresh.page.click('#r-settings');
await fresh.page.click('#r-apply'); await fresh.page.waitForSelector('.dlg');
await fresh.page.click('.dlg button:has-text("Merge")'); await fresh.page.waitForTimeout(500);
check('Restore verified by reading back', (await text(fresh.page, '[data-r="verified"]')) === 'Verified: 3 check-in(s) are now stored on this device.');
const restored = await dbRecords(fresh.page);
check('Restored data identical to original (IDs, values, dates)', JSON.stringify(restored.map(x => [x.id, x.checkInDate, x.weightKg, x.caloriesKcal, x.notes]).sort()) === JSON.stringify(backup.checkIns.map(x => [x.id, x.checkInDate, x.weightKg, x.caloriesKcal, x.notes]).sort()));
await go(fresh.page, '#/home');
check('Restored settings applied', (await text(fresh.page, '[data-stat="change"]')).includes('from 112.0 kg'));
await fresh.ctx.close();

// Merge with conflicts
await seed(page, [{ checkInDate: '2026-10-22', weightKg: 109.0, sleepMinutes: 400 }, { checkInDate: '2026-10-23', weightKg: 109.1 }]);
const idBefore = (await dbRecords(page)).find(x => x.checkInDate === '2026-10-22').id;
await go(page, '#/restore');
await page.setInputFiles('#r-file', backupPath); await page.waitForTimeout(200);
check('Conflict detected for 22 Oct with field-level comparison', (await text(page, '[data-r="conflicts"]')) === '1' && (await text(page, '#r-conflicts')).includes('Morning weight') && (await text(page, '#r-conflicts')).includes('109.60 kg'));
await page.click('[data-conflict="2026-10-22"] button[data-val="backup"]');
await page.click('#r-apply'); await page.waitForSelector('.dlg');
await page.click('.dlg button:has-text("Merge")'); await page.waitForTimeout(500);
recs = await dbRecords(page);
const c22 = recs.find(x => x.checkInDate === '2026-10-22');
check('Merge with "use backup" updated only that date, kept record ID', c22.weightKg === 109.6 && c22.id === idBefore);
check('Merge kept records not in the backup', recs.length === 4 && !!recs.find(x => x.checkInDate === '2026-10-23'));
// Replace
await go(page, '#/restore');
await page.setInputFiles('#r-file', backupPath); await page.waitForTimeout(200);
await page.click('input[value="replace"]');
await page.click('#r-apply'); await page.waitForSelector('.dlg');
check('Replace requires explicit confirmation stating deletion', (await text(page, '.dlg')).includes('This deletes all 4 check-in(s)'));
const [safety] = await Promise.all([page.waitForEvent('download'), page.click('.dlg button:has-text("Replace everything")')]);
await page.waitForTimeout(500);
check('Safety backup downloaded before replace', safety.suggestedFilename().includes('before-restore'));
check('Replace leaves exactly the backup contents', (await dbRecords(page)).length === 3 && (await text(page, '[data-r="verified"]')).startsWith('Verified: 3'));
// Invalid / incompatible files
const bad = path.join(TMP, 'bad.json'); fs.writeFileSync(bad, '{"hello": 1}');
await go(page, '#/restore'); await page.setInputFiles('#r-file', bad); await page.waitForTimeout(200);
check('Incompatible file refused with explanation', (await text(page, '#view-restore .banner.error')).includes('not created by the Morning Weight Tracker'));
const tampered = JSON.parse(JSON.stringify(backup)); tampered.checkIns[0].checkInDate = '2026-02-30'; tampered.checkIns[1].steps = -40;
const tp = path.join(TMP, 'tampered.json'); fs.writeFileSync(tp, JSON.stringify(tampered));
await page.setInputFiles('#r-file', tp); await page.waitForTimeout(200);
check('Invalid dates/values identified and skipped', (await text(page, '[data-r="valid"]')) === '1' && (await text(page, '[data-r="invalid"]')) === '2');
const newer = path.join(TMP, 'newer.json'); fs.writeFileSync(newer, JSON.stringify({ ...backup, formatVersion: 7 }));
await go(page, '#/restore'); await page.setInputFiles('#r-file', newer); await page.waitForTimeout(200);
check('Newer-format backup refused', (await text(page, '#view-restore .banner.error')).includes('newer than this app supports'));
check('Nothing changed by refused restores', (await dbRecords(page)).length === 3);

section('11. Mobile layout');
for (const v of ['home', 'checkin', 'progress', 'history', 'settings', 'restore']) {
  await go(page, '#/' + v);
  check(`No horizontal scroll on ${v} (390px)`, await noHScroll(page));
}
const smallCtx = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/London' });
const small = await smallCtx.newPage(); await small.clock.setFixedTime(localTime('2026-10-26T07:30:00', 'Europe/London'));
for (const v of ['home', 'checkin', 'progress', 'history', 'settings']) { await go(small, '#/' + v); check(`No horizontal scroll on ${v} (320px)`, await noHScroll(small)); }
const tooSmall = await small.evaluate(() => [...document.querySelectorAll('#view-settings button, .tabbar a')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 36).length);
check('Touch targets at least 36px high', tooSmall === 0, String(tooSmall));
await smallCtx.close();

section('Progress page and charts');
await go(page, '#/progress');
check('Progress statistics rendered', (await text(page, '#view-progress')).includes('Starting weight') && (await text(page, '#view-progress')).includes('Highest'));
for (const rg of ['7', '30', '90', 'all']) { await page.click(`[data-range="${rg}"]`); await page.waitForTimeout(100); }
check('Range switching works without errors', (await page.getAttribute('[data-range="all"]', 'aria-checked')) === 'true');
check('Habit charts render (calories target line present)', (await page.locator('#pg-cal line.ref').count()) === 1);
await page.hover('#pg-weight rect.hit', { position: { x: 200, y: 50 } }).catch(() => {});
check('Insights never claim causation (disclaimer present)', (await text(page, '#view-progress')).includes('does not mean one caused the other'));
await ctx.close();

section('13. Offline use (service worker)');
({ ctx, page } = await newPage());
await go(page, '#/home');
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload(); await page.waitForTimeout(500);
await ctx.setOffline(true);
await page.reload(); await page.waitForSelector('#loading', { state: 'detached' });
await go(page, '#/checkin');
await fill(page, '#f-weight', '104.4'); await saveForm(page);
check('App loads and saves a check-in while offline', (await dbRecords(page)).length === 1);
await ctx.close();

section('14. Fresh install does not imply recoverable data');
({ ctx, page } = await newPage());
await go(page, '#/settings');
const st = await text(page, '#backup-section');
check('Fresh install shows 0 check-ins and "Never" backed up', st.includes('Check-ins stored0') && st.includes('Last backupNever'));
check('Explains data is only recoverable from a backup file', st.includes('can be recovered only from a backup file'));
await ctx.close();

await browser.close();
console.log(results.join('\n'));
const realErrors = errors.filter(e => !/net::ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
console.log(`\nConsole/page errors: ${realErrors.length}${realErrors.length ? '\n  ' + [...new Set(realErrors)].join('\n  ') : ''}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed || realErrors.length ? 1 : 0);
