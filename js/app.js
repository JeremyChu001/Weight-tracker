import { state, reload, onChange, refreshToday } from './state.js';
import { formatFull, formatShort } from './dates.js';
import { requestPersistence } from './db.js';
import { renderHome, resetHomeWeek } from './home.js';
import { renderCheckin, isFormDirty, currentFormDate } from './checkin.js';
import { renderProgress } from './progress.js';
import { renderHistory } from './history.js';
import { renderSettings } from './settings.js';
import { renderRestore } from './restore.js';
import { $, $$, toast } from './ui.js';

const VIEWS = {
  home: { title: 'Today', render: renderHome },
  checkin: { title: 'Morning Check-In', render: renderCheckin },
  progress: { title: 'Progress', render: renderProgress },
  history: { title: 'History', render: renderHistory },
  settings: { title: 'Settings', render: renderSettings },
  restore: { title: 'Restore Backup', render: renderRestore },
};
let current = null;

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const [view, arg] = path.split('/');
  return { view: VIEWS[view] ? view : null, arg, params: new URLSearchParams(query) };
}

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

async function route() {
  let { view, arg, params } = parseRoute();
  if (!view) {
    // Default: go straight to the check-in until today's is done.
    view = state.byDate.has(state.today) ? 'home' : 'checkin';
    history.replaceState(null, '', `#/${view}`);
  }
  current = { view, arg, params };
  for (const k of Object.keys(VIEWS)) $(`#view-${k}`).hidden = k !== view;
  $$('.tabbar a').forEach(a => a.setAttribute('aria-current', a.dataset.tab === view || (view === 'restore' && a.dataset.tab === 'settings') ? 'page' : 'false'));
  $('#view-title').textContent = VIEWS[view].title;
  $('#today-label').textContent = formatShort(state.today); $('#today-label').title = formatFull(state.today);
  await VIEWS[view].render($(`#view-${view}`), view === 'checkin' ? arg : params);
  if (!params?.get?.('backup')) window.scrollTo(0, 0);
}

function rerender(reason) {
  applyTheme();
  $('#today-label').textContent = formatShort(state.today); $('#today-label').title = formatFull(state.today);
  if (!current) return;
  if (current.view === 'restore') return;               // restore flow manages its own screens
  if (current.view === 'checkin') {
    if (isFormDirty()) {                                  // never wipe what the user is typing
      if (reason === 'other-tab') toast('Records changed in another window. Save or reload to see them.');
      return;
    }
    if (reason === 'day-changed' && currentFormDate() && !current.arg) { route(); return; }
    if (reason === 'save') return;                        // save navigates by itself
  }
  const { view, arg, params } = current;
  VIEWS[view].render($(`#view-${view}`), view === 'checkin' ? arg : params);
}

async function start() {
  try {
    await reload('init');
  } catch (e) {
    const b = $('#storage-banner');
    b.hidden = false;
    b.textContent = `${e.message} Nothing you enter can be saved until this is resolved.`;
    state.storageOk = false;
  }
  $('#loading').remove();
  applyTheme();
  onChange(rerender);
  window.addEventListener('hashchange', () => { if (parseRoute().view === 'home') resetHomeWeek(); route(); });
  await route();

  // Keep "today" correct across midnight and when returning to the app.
  setInterval(refreshToday, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshToday(); });

  if (state.storageOk && state.records.length) requestPersistence();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable; app still works online */ });
  }
}

start();
