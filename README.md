# Morning Weight Tracker

A private, local-first Progressive Web App for a once-a-morning check-in. You record today's weight and waist, plus yesterday's calories, protein, steps and exercise, and last night's sleep. It includes a goal countdown, a Monday–Sunday calorie tracker, charts, history, and JSON/CSV backup.

- **No account, no server, no cloud, no analytics.** A Content-Security-Policy blocks the page from contacting any server other than the one it was loaded from.
- **No build step and no dependencies.** The app is plain HTML, CSS and JavaScript modules. Charts are hand-written SVG.
- **Works offline** once it has been loaded, through a service worker.

## Running it

Any static web server works. Locally:

```sh
cd weight-tracker
python3 -m http.server 8080      # then open http://localhost:8080
```

Opening `index.html` directly from the file system (`file://`) does **not** work, because browsers block JavaScript modules there.

### Using it on your phone

Installation and offline mode need **HTTPS** (or `localhost`). You therefore need to host the folder on an HTTPS static host. Free options include:

- **GitHub Pages:** push the folder to a repository, then enable *Settings → Pages*.
- **Cloudflare Pages** or **Netlify:** drag and drop the folder into their dashboard.

These hosts require an account for *hosting*. The app itself needs no account. The host only serves the code; your records never leave your phone.

**Keep the same web address permanently.** Browser storage belongs to one exact address (origin). If you move the app to a different URL, it opens empty there. Move your data across with Backup → Restore.

### Install to the home screen

- **iPhone (Safari):** Share → *Add to Home Screen*.
- **Android (Chrome):** ⋮ menu → *Install app*. Settings also shows an *Install app* button when Chrome offers it.

On iPhone, Safari and the installed home-screen app keep **separate** storage. Pick one and use it consistently. If you change, move your data with Backup → Restore.

## Daily use

1. Open the app. If today's check-in is not done, it opens straight on **Morning Check-In**.
2. Enter your morning weight. Fill in whatever else you have and leave the rest blank. Blank means "not recorded" and is **never** treated as zero.
3. Tap **Save Check-In**. You are taken to the dashboard with a confirmation.

While you type, a draft is saved on the device. If you leave the form and come back, your values are restored.

### How dates work

A check-in made on the morning of 26 October 2026 stores:

| Data | Date stored |
|---|---|
| Weight, waist | `measurementDate` = 26 Oct |
| Calories, protein, steps, exercise, water, ratings | `lifestyleDate` = 25 Oct |
| Sleep | `sleepNightStart` 25 Oct → `sleepNightEnd` 26 Oct |

All dates are local calendar dates (`YYYY-MM-DD` strings) taken from the device's calendar. They are not UTC timestamps, so daylight-saving changes and travel between time zones never shift a record. Use **Change date** on the form to add or correct a past day. The lifestyle date always follows as the day before the morning. You cannot enter these two dates independently, because a check-in is defined as one morning plus the preceding day.

**A consequence to be aware of:** a day's calories are logged the *next* morning. On Monday morning, the new calorie week is therefore empty, and the Sunday intake you log that morning belongs to the *previous* week. The weekly card explains this on Mondays. Use *Previous week* to see the completed week.

## Backups (please read)

Your data exists **only in this browser on this device**. It is lost if you:

- clear the browser's website data, or uninstall the browser or app;
- reset or lose the phone;
- use private browsing;
- open the app from a different web address.

Installing the app to the home screen **is not a backup.** It is only a shortcut.

- **Back up:** Settings → **Backup My Data** downloads `weight-tracker-backup-YYYY-MM-DD.json`. On phones that support it, **Share backup file…** lets you save it directly to iCloud Drive, Google Drive or email. The Home screen reminds you if 7 days pass without a backup. The browser cannot confirm that the downloaded file was kept, so check your Downloads folder or the Files app.
- **Restore:** Settings → **Restore Backup** → choose the JSON file. The file is validated first, and invalid records are listed and skipped. You then choose one of two options:
  - **Merge** (recommended): existing records are kept, and new dates are added. Where a date exists in both with different values, you see a field-by-field comparison and choose which version to keep.
  - **Replace:** deletes everything on the device and loads the backup. This requires confirmation, and by default it first downloads a safety backup of your current data.
- **CSV:** Settings → *Export CSV* produces one row per check-in with explicit date columns, for Excel or Google Sheets. CSV files cannot be restored; use the JSON backup for that.

## Calculations

- **7-day average weight:** the mean of the weigh-ins actually recorded in the last 7 calendar days. It is shown only when there are at least 3. The chart breaks lines across gaps longer than 7 days.
- **Lifestyle averages:** these use only the days that were logged. The number of logged days is always shown.
- **Goal countdown:**
  - Remaining = latest recorded weight − target.
  - Required rate = remaining ÷ (days remaining ÷ 7). The app flags the rate neutrally if it exceeds 1% of your body weight per week, and it is not calculated once the target date has passed or the goal is reached.
  - Progress = (start − current) ÷ (start − target). The bar is capped at 100%.
- **Average weekly change:** a least-squares trend. It needs at least 4 weigh-ins spanning at least 14 days.
- **Observations:** these compare equal-length windows and say nothing about causation.

## Tests

```sh
npm test                                  # unit tests (date logic, calculations, backup); no browser needed
python3 -m http.server 8080 & npm run test:e2e   # 127 end-to-end checks in mobile Chromium (needs Playwright)
```

The end-to-end suite covers both sets of acceptance criteria (sections 14 and 18). It includes:
- browser restarts with a persistent profile;
- four time zones, including times just after DST changes;
- Monday rollover and the year-end week;
- backup → restore round-trips with conflicts, and invalid or newer-format files;
- offline saving through the service worker;
- horizontal-overflow checks at 320 px and 390 px widths.

## Updating the app

- When you change any file, bump `VERSION` in `sw.js`. Installed copies then fetch the new code, which takes effect on the next launch.
- The database schema (`js/db.js`) must only ever **add** stores or indexes in `onupgradeneeded`, never delete them. User data is never cleared by an update.

## Known limitations

- **Real devices not tested.** Testing was done in headless Chromium, emulating an iPhone viewport. It was not done on a physical iPhone or Android phone, or in real Safari or Firefox. iOS Safari is the most likely place for differences, especially file download and share behaviour.
- **No sync.** Several devices cannot share data except by moving backup files manually.
- **Possible storage clean-up.** The browser may clear "best-effort" storage when the device is very low on space. The app asks for persistent storage, and Settings shows whether it was granted. Safari can also clear data for sites that have not been visited for 7 days. This does not apply to apps added to the home screen.
- **No automatic backups.** A web app cannot write files in the background.
