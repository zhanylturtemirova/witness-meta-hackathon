// Minimal in-memory stand-in for the IndexedDB API surface used by web/media-store.js.
// Test support only: it proves our IndexedDB-branch wiring (open/upgrade/request/
// transaction event flow), not real browser behavior. Real-browser verification
// uses scripts/idb-check.mjs against a genuine browser engine.
export function createFakeIndexedDB({failOpen = false, blocked = false} = {}) {
  const databases = new Map();
  const dbState = name => {
    if (!databases.has(name)) databases.set(name, {version: 0, stores: new Map()});
    return databases.get(name);
  };
  const fire = fn => queueMicrotask(() => { try { fn(); } catch {} });
  function storeApi(store, tx) {
    const done = () => { if (tx.oncomplete) fire(() => tx.oncomplete({target: tx})); };
    return {
      put(record) {
        const rq = {result: null, onerror: null};
        fire(() => {
          try { store.records.set(record[store.keyPath], record); rq.result = record[store.keyPath]; done(); }
          catch (err) { tx.error = err; if (tx.onerror) tx.onerror({target: tx}); }
        });
        return rq;
      },
      get(id) {
        const rq = {result: null, onsuccess: null, onerror: null};
        fire(() => { rq.result = store.records.has(id) ? store.records.get(id) : undefined; if (rq.onsuccess) rq.onsuccess({target: rq}); });
        return rq;
      },
      delete(id) {
        const rq = {result: null, onerror: null};
        fire(() => { store.records.delete(id); done(); });
        return rq;
      }
    };
  }
  function open(name, version) {
    const request = {result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null};
    fire(() => {
      if (failOpen) { request.error = Error('open failed'); if (request.onerror) request.onerror({target: request}); return; }
      if (blocked) { if (request.onblocked) request.onblocked({target: request}); return; }
      const state = dbState(name);
      const db = {
        objectStoreNames: {contains: n => state.stores.has(n)},
        createObjectStore(n, {keyPath} = {}) { if (!state.stores.has(n)) state.stores.set(n, {keyPath, records: new Map()}); },
        transaction(storeName) {
          const store = state.stores.get(storeName);
          if (!store) throw Error('no such store: ' + storeName);
          const tx = {error: null, oncomplete: null, onerror: null, onabort: null};
          tx.objectStore = () => storeApi(store, tx);
          return tx;
        }
      };
      request.result = db;
      if (version > state.version) {
        state.version = version;
        if (request.onupgradeneeded) request.onupgradeneeded({target: request});
      }
      if (request.onsuccess) request.onsuccess({target: request});
    });
    return request;
  }
  return {open, _state: dbState};
}
