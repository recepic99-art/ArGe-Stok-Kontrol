(function () {
  "use strict";

  const DATABASE_NAME = "arge-numune-depo-web";
  const STORE_NAME = "file-handles";
  const HANDLE_KEY = "main-json";
  const LOCAL_STATE_KEY = "arge-numune-depo-local-state-v2";
  let fileHandle = null;
  let localMode = false;
  let writeQueue = Promise.resolve();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isValidState(value) {
    return Boolean(
      value &&
      Array.isArray(value.users) &&
      Array.isArray(value.tables) &&
      Array.isArray(value.logs) &&
      value.session &&
      value.settings
    );
  }

  // Eski çalışma alanlı JSON yedekleri içe aktarılırsa tablolar tek listeye çevrilir.
  function migrateOldState(value) {
    if (!value || !Array.isArray(value.workspaces) || Array.isArray(value.tables)) return value;
    const tableIds = new Set();
    const tables = [];
    value.workspaces.forEach(function (workspace) {
      (workspace.tables || []).forEach(function (table) {
        let id = table.id;
        while (tableIds.has(id)) id = id + "-copy";
        tableIds.add(id);
        tables.push(Object.assign({}, table, { id: id }));
      });
    });
    const openTableIds = (value.session && value.session.openTables || [])
      .map(function (reference) { return reference.tableId; })
      .filter(function (id, index, list) { return id && list.indexOf(id) === index; });
    const activeTableId = value.session && value.session.activeTableKey
      ? String(value.session.activeTableKey).split(":").pop()
      : (openTableIds[0] || (tables[0] && tables[0].id) || "");
    return {
      schemaVersion: 2,
      users: value.users || [],
      tables: tables,
      logs: (value.logs || []).map(function (log) {
        const copy = Object.assign({}, log);
        delete copy.workspaceId;
        return copy;
      }),
      session: {
        currentUserId: value.session && value.session.currentUserId || null,
        activeTableId: activeTableId,
        openTableIds: openTableIds.length ? openTableIds : (activeTableId ? [activeTableId] : [])
      },
      settings: value.settings || {}
    };
  }

  function normalizeState(value) {
    const migrated = migrateOldState(clone(value));
    if (!isValidState(migrated)) {
      throw new Error("Dosya geçerli bir Ar-Ge Numune Depo JSON dosyası değil.");
    }
    const defaults = window.DepoData.createInitialState();
    migrated.schemaVersion = 2;
    migrated.settings = Object.assign({}, defaults.settings, migrated.settings || {});
    migrated.session = Object.assign({}, defaults.session, migrated.session || {});
    if (!Array.isArray(migrated.session.openTableIds)) {
      migrated.session.openTableIds = [];
    }
    return migrated;
  }

  function supportsFileAccess() {
    // file:// ile açılışta tarayıcı izinleri tutarsızdır; bu durumda yerel moda geçilir.
    if (window.location.protocol === "file:") return false;
    return typeof window.showOpenFilePicker === "function" &&
      typeof window.showSaveFilePicker === "function";
  }

  function readLocalState() {
    try {
      const saved = window.localStorage.getItem(LOCAL_STATE_KEY);
      return saved ? normalizeState(JSON.parse(saved)) : window.DepoData.createInitialState();
    } catch (error) {
      return window.DepoData.createInitialState();
    }
  }

  function writeLocalState(state) {
    try {
      window.localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      return false;
    }
  }

  function openHandleDatabase() {
    return new Promise(function (resolve, reject) {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  async function rememberHandle(handle) {
    try {
      const database = await openHandleDatabase();
      await new Promise(function (resolve, reject) {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
        transaction.oncomplete = resolve;
        transaction.onerror = function () { reject(transaction.error); };
      });
      database.close();
    } catch (error) {
      console.warn("JSON dosya bağlantısı hatırlanamadı.", error);
    }
  }

  async function rememberedHandle() {
    try {
      const database = await openHandleDatabase();
      const handle = await new Promise(function (resolve, reject) {
        const request = database.transaction(STORE_NAME, "readonly")
          .objectStore(STORE_NAME)
          .get(HANDLE_KEY);
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { reject(request.error); };
      });
      database.close();
      return handle;
    } catch (error) {
      return null;
    }
  }

  async function readFromHandle(handle) {
    const file = await handle.getFile();
    const text = await file.text();
    if (!text.trim()) return window.DepoData.createInitialState();
    return normalizeState(JSON.parse(text));
  }

  async function writeToHandle(handle, state) {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(state, null, 2));
    await writable.close();
  }

  async function initialize() {
    if (!supportsFileAccess()) {
      localMode = true;
      return readLocalState();
    }
    const handle = await rememberedHandle();
    if (!handle) {
      localMode = true;
      return readLocalState();
    }
    try {
      const permission = await handle.queryPermission({ mode: "readwrite" });
      if (permission !== "granted") {
        fileHandle = handle;
        localMode = true;
        return readLocalState();
      }
      fileHandle = handle;
      return await readFromHandle(handle);
    } catch (error) {
      fileHandle = null;
      localMode = true;
      return readLocalState();
    }
  }

  async function reconnect() {
    if (!fileHandle) return null;
    const permission = await fileHandle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") return null;
    return readFromHandle(fileHandle);
  }

  async function openFile() {
    if (!supportsFileAccess()) {
      localMode = true;
      return readLocalState();
    }
    const handles = await window.showOpenFilePicker({
      multiple: false,
      types: [{
        description: "Ar-Ge Numune Depo JSON",
        accept: { "application/json": [".json"] }
      }]
    });
    fileHandle = handles[0];
    localMode = false;
    const loaded = await readFromHandle(fileHandle);
    await rememberHandle(fileHandle);
    return loaded;
  }

  async function createFile(initialState) {
    if (!supportsFileAccess()) {
      localMode = true;
      const normalizedLocalState = normalizeState(initialState);
      writeLocalState(normalizedLocalState);
      return normalizedLocalState;
    }
    fileHandle = await window.showSaveFilePicker({
      suggestedName: "arge-numune-depo.json",
      types: [{
        description: "Ar-Ge Numune Depo JSON",
        accept: { "application/json": [".json"] }
      }]
    });
    localMode = false;
    const normalized = normalizeState(initialState);
    await writeToHandle(fileHandle, normalized);
    await rememberHandle(fileHandle);
    return normalized;
  }

  function save(state) {
    if (localMode) return writeLocalState(clone(state));
    if (!fileHandle) return false;
    const snapshot = clone(state);
    writeQueue = writeQueue
      .then(function () { return writeToHandle(fileHandle, snapshot); })
      .catch(function (error) {
        window.dispatchEvent(new CustomEvent("depo-file-error", {
          detail: error.message || "JSON dosyasına yazılamadı."
        }));
      });
    return true;
  }

  function replace(imported) {
    const normalized = normalizeState(imported);
    save(normalized);
    return normalized;
  }

  function hasFile() {
    return localMode || Boolean(fileHandle);
  }

  function fileName() {
    if (localMode) return "Tarayıcı verisi (yerel)";
    return fileHandle ? fileHandle.name : "";
  }

  function isLocalMode() {
    return localMode;
  }

  window.DepoStore = {
    clone: clone,
    initialize: initialize,
    reconnect: reconnect,
    openFile: openFile,
    createFile: createFile,
    replace: replace,
    save: save,
    hasFile: hasFile,
    fileName: fileName,
    isLocalMode: isLocalMode,
    supportsFileAccess: supportsFileAccess
  };
}());
