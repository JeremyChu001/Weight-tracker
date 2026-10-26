// Small DOM helpers: escaping, toasts, modal dialogs, file download.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

let toastTimer;
export function toast(message, kind = 'ok', ms = 3200) {
  const t = $('#toast');
  t.textContent = message;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, ms);
}

/**
 * Modal dialog. buttons: [{ label, value, kind: 'primary'|'danger'|'ghost' }]
 * Resolves with the clicked button's value, or null when dismissed.
 */
export function dialog({ title, body, buttons = [{ label: 'OK', value: true, kind: 'primary' }], onOpen }) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'dlg';
    d.setAttribute('aria-labelledby', 'dlg-title');
    d.innerHTML = `<form method="dialog" class="dlg-inner">
      <h2 id="dlg-title">${esc(title)}</h2>
      <div class="dlg-body"></div>
      <div class="dlg-actions">${buttons.map((b, i) => `<button type="button" data-i="${i}" class="btn ${b.kind || 'ghost'}">${esc(b.label)}</button>`).join('')}</div>
    </form>`;
    const bodyEl = d.querySelector('.dlg-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    document.body.appendChild(d);
    let done = false;
    const finish = v => { if (done) return; done = true; d.close(); d.remove(); resolve(v); };
    d.addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (b) {
        const btn = buttons[+b.dataset.i];
        if (btn.validate && !btn.validate(d)) return;
        finish(typeof btn.value === 'function' ? btn.value(d) : btn.value);
      } else if (e.target === d) finish(null); // backdrop
    });
    d.addEventListener('cancel', e => { e.preventDefault(); finish(null); });
    d.showModal();
    onOpen?.(d);
  });
}

export function confirmDialog(title, body, confirmLabel = 'Confirm', danger = false) {
  return dialog({ title, body, buttons: [
    { label: 'Cancel', value: false, kind: 'ghost' },
    { label: confirmLabel, value: true, kind: danger ? 'danger' : 'primary' },
  ] });
}

/**
 * Hand a file to the browser for download. Returns the byte size.
 * The browser does not report whether the user actually kept the file,
 * so callers must not claim more than "file created and download started".
 */
export function downloadFile(filename, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return blob.size;
}

/** Share a file through the OS share sheet when supported (mobile). */
export async function shareFile(filename, mime, text) {
  const file = new File([text], filename, { type: mime });
  if (!navigator.canShare?.({ files: [file] })) return { supported: false };
  try { await navigator.share({ files: [file], title: filename }); return { supported: true, shared: true, bytes: file.size }; }
  catch (e) { return { supported: true, shared: false, aborted: e?.name === 'AbortError', error: e }; }
}

export function debounce(fn, ms) {
  let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.flush = (...a) => { clearTimeout(t); fn(...a); };
  f.cancel = () => clearTimeout(t);
  return f;
}
