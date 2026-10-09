// A document ID in the URL survives reload, history, and restoring a closed tab.
// IndexedDB stores each document separately, without a shared text handoff.
const ViewerDrafts = (() => {
  let database;
  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open("farsify-documents", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("documents");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { database = null; reject(request.error); };
    });
    return database;
  }
  async function save(id, document) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("documents", "readwrite");
      transaction.objectStore("documents").put({ ...document, updatedAt: Date.now() }, id);
      transaction.oncomplete = () => resolve(id);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("ذخیره لغو شد."));
    });
  }
  async function load(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction("documents").objectStore("documents").get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function newId() { return crypto.randomUUID(); }
  async function create(document) {
    const id = newId();
    await save(id, document);
    return chrome.runtime.getURL("viewer.html") + "?draft=" + encodeURIComponent(id);
  }
  function recovery(id) {
    try { return JSON.parse(localStorage.getItem("farsify-recovery:" + id)); }
    catch { return null; }
  }
  function journal(id, document) {
    try {
      // File handles live in IndexedDB. Keep a synchronous text backup for a
      // refresh/close that happens before queued IndexedDB writes finish.
      const source = { ...document.source };
      delete source.fileHandle;
      const serialized = JSON.stringify({ ...document, source });
      localStorage.setItem("farsify-recovery:" + id, serialized);
      return serialized;
    } catch { return null; }
  }
  function clearJournal(id, serialized) {
    try {
      const key = "farsify-recovery:" + id;
      if (serialized && localStorage.getItem(key) === serialized) localStorage.removeItem(key);
    } catch { /* IndexedDB is still the primary store. */ }
  }
  return { save, load, newId, create, recovery, journal, clearJournal };
})();
