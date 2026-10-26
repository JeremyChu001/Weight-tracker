// IndexedDB persistence. Schema changes must only ever ADD stores/indexes in
// onupgradeneeded; existing user data is never cleared by an app update.
const DB_NAME = 'morning-weight-tracker';
const DB_VERSION = 1;
let dbPromise = null;

export class StorageError extends Error {
  constructor(message, cause) { super(message); this.name = 'StorageError'; this.cause = cause; }
}
export class DuplicateDateError extends Error {
  constructor(existing) { super('A check-in already exists for this date.'); this.name = 'DuplicateDateError'; this.existing = existing; }
}

function describe(err) {
  if (!err) return 'Unknown storage error.';
  if (err.name === 'QuotaExceededError') return 'The device has run out of storage space for this app. Free up space or export a backup.';
  if (err.name === 'InvalidStateError') return 'Browser storage is unavailable (this can happen in private browsing mode).';
  return `Storage error: ${err.message || err.name}`;
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new StorageError('This browser does not support IndexedDB, so records cannot be saved.')); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(new StorageError(describe(e), e)); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('checkins')) {
        const s = db.createObjectStore('checkins', { keyPath: 'id' });
        s.createIndex('checkInDate', 'checkInDate', { unique: true });
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    req.onerror = () => reject(new StorageError(describe(req.error), req.error));
    req.onblocked = () => reject(new StorageError('The database is open in an older version of this app in another tab. Close other tabs and reload.'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function run(storeNames, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    let tx, result;
    try { tx = db.transaction(storeNames, mode); } catch (e) { reject(new StorageError(describe(e), e)); return; }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error instanceof Error && tx.error.name === 'DuplicateDateError' ? tx.error : new StorageError(describe(tx.error), tx.error));
    tx.onabort = () => reject(tx._appError || new StorageError(describe(tx.error), tx.error));
    try {
      const out = fn(tx, v => { result = v; });
      if (out !== undefined) result = out;
    } catch (e) { tx._appError = e; tx.abort(); }
  }));
}

// Callback (not promise) so the transaction is guaranteed to still be active.
const onOk = (r, cb) => { r.onsuccess = () => cb(r.result); };

export function getAllCheckins() {
  return run(['checkins'], 'readonly', (tx, set) => { onOk(tx.objectStore('checkins').getAll(), set); });
}

/**
 * Insert or update one check-in. If a *different* record already exists for
 * the same check-in date, the transaction is aborted with DuplicateDateError
 * unless `replaceConflicting` is true, in which case that record is removed.
 */
export function saveCheckin(record, { replaceConflicting = false } = {}) {
  return run(['checkins'], 'readwrite', (tx, set) => {
    const store = tx.objectStore('checkins');
    onOk(store.index('checkInDate').get(record.checkInDate), existing => {
      if (existing && existing.id !== record.id) {
        if (!replaceConflicting) { tx._appError = new DuplicateDateError(existing); tx.abort(); return; }
        store.delete(existing.id);
      }
      store.put(record);
      set(record);
    });
  });
}

export function deleteCheckin(id) {
  return run(['checkins'], 'readwrite', tx => { tx.objectStore('checkins').delete(id); });
}

export function getMeta(key) {
  return run(['meta'], 'readonly', (tx, set) => { onOk(tx.objectStore('meta').get(key), set); });
}
export function setMeta(key, value) {
  return run(['meta'], 'readwrite', tx => { tx.objectStore('meta').put(value, key); });
}
export function deleteMeta(key) {
  return run(['meta'], 'readwrite', tx => { tx.objectStore('meta').delete(key); });
}

/** Atomically apply a restore: delete ids, then put records; optionally settings. */
export function applyRestore({ clearAll = false, deleteIds = [], put = [], settings = null }) {
  return run(['checkins', 'meta'], 'readwrite', tx => {
    const store = tx.objectStore('checkins');
    if (clearAll) store.clear();
    for (const id of deleteIds) store.delete(id);
    for (const r of put) store.put(r);
    if (settings) tx.objectStore('meta').put(settings, 'settings');
  });
}

/** Ask the browser not to evict this origin's storage under pressure. */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return { supported: false };
    const already = await navigator.storage.persisted();
    const persisted = already || await navigator.storage.persist();
    return { supported: true, persisted };
  } catch { return { supported: false }; }
}

export async function storageEstimate() {
  try { return navigator.storage?.estimate ? await navigator.storage.estimate() : null; } catch { return null; }
}
