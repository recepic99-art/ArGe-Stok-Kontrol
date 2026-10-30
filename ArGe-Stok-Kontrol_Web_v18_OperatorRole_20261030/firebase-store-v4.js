(function () {
  "use strict";

  // Firebase ortak veri katmanı - v11.
  const LOCAL_UI_KEY = "arge-numune-depo-ui-v1";
  const ADMIN_SESSION_KEY = "arge-numune-depo-admin-session-v1";
  const CLOUD_PATH = "appState";
  const SCHEMA_VERSION = 11;

  let database = null;
  let auth = null;
  let cloudReference = null;
  let stopWatching = null;
  let lastCloudInventory = null;
  let watchCallback = null;
  let pendingWriteCount = 0;
  let writeQueue = Promise.resolve();
  let memoryAdministratorExpiry = 0;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function toArray(value) {
    if (Array.isArray(value)) return clone(value);
    if (!value || typeof value !== "object") return [];
    return Object.keys(value).map(function (key) {
      return clone(value[key]);
    });
  }

  function normalizeTables(value) {
    return toArray(value)
      .filter(function (table) {
        return table && table.id;
      })
      .map(function (table) {
        const normalized = clone(table);
        // Firebase boş dizileri saklamaz. Yeni ve henüz boş bir liste buluttan
        // `items` alanı olmadan dönebileceği için burada tekrar boş dizi veririz.
        normalized.items = toArray(table.items);
        if (Object.prototype.hasOwnProperty.call(table, "columns")) {
          normalized.columns = toArray(table.columns);
        }
        if (Object.prototype.hasOwnProperty.call(table, "deletedColumnKeys")) {
          normalized.deletedColumnKeys = toArray(table.deletedColumnKeys).map(String);
        }
        return normalized;
      });
  }

  function accessConfig() {
    return window.DepoAccessConfig || {};
  }

  function administratorEmail() {
    return String(accessConfig().administratorEmail || "").trim().toLocaleLowerCase("tr-TR");
  }

  function administratorDurationMs() {
    const minutes = Number(accessConfig().administratorMinutes || 15);
    return Math.max(1, minutes) * 60 * 1000;
  }

  function isAdministratorIdentity(user) {
    return Boolean(
      user &&
      !user.isAnonymous &&
      administratorEmail() &&
      String(user.email || "").toLocaleLowerCase("tr-TR") === administratorEmail()
    );
  }

  function administratorExpiresAt() {
    const stored = window.sessionStorage
      ? window.sessionStorage.getItem(ADMIN_SESSION_KEY)
      : memoryAdministratorExpiry;
    const value = Number(stored);
    return Number.isFinite(value) ? value : 0;
  }

  function clearAdministratorSession() {
    memoryAdministratorExpiry = 0;
    if (window.sessionStorage) window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
  }

  function touchAdministratorSession() {
    if (!isAdministratorIdentity(auth && auth.currentUser)) return false;
    memoryAdministratorExpiry = Date.now() + administratorDurationMs();
    if (window.sessionStorage) {
      window.sessionStorage.setItem(ADMIN_SESSION_KEY, String(memoryAdministratorExpiry));
    }
    return true;
  }

  function isAdministrator() {
    return isAdministratorIdentity(auth && auth.currentUser) &&
      administratorExpiresAt() > Date.now();
  }

  function isValidState(value) {
    return Boolean(
      value &&
      Array.isArray(value.tables) &&
      Array.isArray(value.logs)
    );
  }

  function readLocalUi() {
    try {
      return JSON.parse(window.localStorage.getItem(LOCAL_UI_KEY) || "{}");
    } catch (error) {
      return {};
    }
  }

  function writeLocalUi(state) {
    try {
      window.localStorage.setItem(LOCAL_UI_KEY, JSON.stringify({
        session: state.session,
        settings: state.settings
      }));
    } catch (error) {
      console.warn("Yerel görünüm ayarları kaydedilemedi.", error);
    }
  }

  function normalizeState(value) {
    if (!isValidState(value)) {
      throw new Error("Veri geçerli bir Ar-Ge Numune Depo kaydı değil.");
    }

    const defaults = window.DepoData.createInitialState();
    const localUi = readLocalUi();
    const normalized = clone(value);
    const legacyUsers = toArray(normalized.users);
    const legacyCurrentUserId = (localUi.session || {}).currentUserId ||
      (normalized.session || {}).currentUserId;
    const legacyCurrentUser = legacyUsers.find(function (user) {
      return user && user.id === legacyCurrentUserId;
    });

    normalized.schemaVersion = SCHEMA_VERSION;
    delete normalized.users;
    normalized.tables = normalizeTables(normalized.tables);
    normalized.logs = toArray(normalized.logs);
    window.DepoData.migrateLegacyState(normalized);
    normalized.session = Object.assign(
      {},
      defaults.session,
      normalized.session || {},
      localUi.session || {}
    );
    delete normalized.session.currentUserId;
    normalized.session.operatorName = String(
      normalized.session.operatorName ||
      (legacyCurrentUser && legacyCurrentUser.name) ||
      ""
    ).trim();
    normalized.settings = Object.assign(
      {},
      defaults.settings,
      localUi.settings || {},
      normalized.settings || {}
    );
    normalized.settings.columnWidths = Object.assign(
      {},
      defaults.settings.columnWidths || {},
      normalized.settings.columnWidths || {}
    );
    normalized.settings.historyColumnWidths = Object.assign(
      {},
      defaults.settings.historyColumnWidths || {},
      normalized.settings.historyColumnWidths || {}
    );
    if (!Array.isArray(normalized.session.openTableIds)) {
      normalized.session.openTableIds = [];
    }
    return normalized;
  }

  // Üyelik verisi ortak durumun parçası değildir. Firebase Authentication yalnızca
  // görünmeyen anonim erişim ve geçici yönetici doğrulaması için kullanılır.
  function inventoryPayload(state) {
    return {
      schemaVersion: SCHEMA_VERSION,
      tables: normalizeTables(state.tables),
      logs: toArray(state.logs)
    };
  }

  function mergeCloudWithLocal(cloudState) {
    const defaults = window.DepoData.createInitialState();
    const localUi = readLocalUi();
    const merged = normalizeState({
      schemaVersion: SCHEMA_VERSION,
      tables: normalizeTables(cloudState.tables),
      logs: toArray(cloudState.logs),
      // Eski kurulumlarda bulunabilir; normalizeState bunu sütun seçeneklerine
      // taşıdıktan sonra aktif durumdan kaldırır.
      definitions: cloudState.definitions,
      session: Object.assign({}, defaults.session, localUi.session || {}),
      settings: Object.assign({}, defaults.settings, localUi.settings || {})
    });
    return merged;
  }

  function writeInventory(payload) {
    return cloudReference.update(payload);
  }

  function recordsById(records) {
    const result = new Map();
    toArray(records).forEach(function (record) {
      if (record && record.id) result.set(record.id, record);
    });
    return result;
  }

  // İki kullanıcının aynı anda yaptığı bağımsız değişiklikler birbirini ezmesin
  // diye yalnızca yerelde gerçekten değişen kayıtları buluruz.
  function recordPatch(beforeRecords, afterRecords) {
    const before = recordsById(beforeRecords);
    const after = recordsById(afterRecords);
    const upserts = [];
    const removedIds = [];

    after.forEach(function (record, id) {
      const oldRecord = before.get(id);
      if (!oldRecord || JSON.stringify(oldRecord) !== JSON.stringify(record)) {
        upserts.push(clone(record));
      }
    });
    before.forEach(function (_record, id) {
      if (!after.has(id)) removedIds.push(id);
    });
    return { upserts: upserts, removedIds: removedIds };
  }

  function applyRecordPatch(currentRecords, patch) {
    const records = toArray(currentRecords);
    const removed = new Set(patch.removedIds);
    const result = records.filter(function (record) {
      return record && record.id && !removed.has(record.id);
    });

    patch.upserts.forEach(function (record) {
      const index = result.findIndex(function (entry) {
        return entry.id === record.id;
      });
      if (index >= 0) result[index] = clone(record);
      else result.push(clone(record));
    });
    return result;
  }

  function itemPatch(beforeItems, afterItems) {
    const before = recordsById(beforeItems);
    const after = recordsById(afterItems);
    const changes = [];
    const removedIds = [];

    after.forEach(function (item, id) {
      const oldItem = before.get(id);
      if (!oldItem) {
        changes.push({ id: id, added: clone(item) });
        return;
      }

      const fields = {};
      const removedFields = Object.keys(oldItem).filter(function (key) {
        return key !== "id" && !Object.prototype.hasOwnProperty.call(item, key);
      });
      Object.keys(item).forEach(function (key) {
        if (key === "id" || key === "quantity") return;
        if (JSON.stringify(oldItem[key]) !== JSON.stringify(item[key])) {
          fields[key] = clone(item[key]);
        }
      });

      const hasQuantity = Object.prototype.hasOwnProperty.call(item, "quantity");
      const oldQuantity = Number(oldItem.quantity);
      const newQuantity = Number(item.quantity);
      const quantityChanged = hasQuantity &&
        JSON.stringify(oldItem.quantity) !== JSON.stringify(item.quantity);
      const hasQuantityDelta = Number.isFinite(oldQuantity) && Number.isFinite(newQuantity) &&
        oldQuantity !== newQuantity;
      const hasQuantitySet = quantityChanged && !hasQuantityDelta;
      if (hasQuantityDelta || hasQuantitySet || Object.keys(fields).length || removedFields.length) {
        changes.push({
          id: id,
          fields: fields,
          removedFields: removedFields,
          quantityDelta: hasQuantityDelta ? newQuantity - oldQuantity : 0,
          quantitySet: hasQuantitySet ? clone(item.quantity) : undefined,
          fallback: clone(item)
        });
      }
    });
    before.forEach(function (_item, id) {
      if (!after.has(id)) removedIds.push(id);
    });
    return { changes: changes, removedIds: removedIds };
  }

  function applyItemPatch(currentItems, patch) {
    const removed = new Set(patch.removedIds);
    const items = toArray(currentItems).filter(function (item) {
      return item && item.id && !removed.has(item.id);
    });

    patch.changes.forEach(function (change) {
      let item = items.find(function (entry) {
        return entry.id === change.id;
      });
      if (change.added) {
        if (!item) items.push(clone(change.added));
        return;
      }
      if (!item) {
        // Başka bir kullanıcı kartı sildiyse eski ekrandan gelen düzenleme,
        // silinmiş kartı yeniden oluşturmamalıdır.
        return;
      }
      Object.assign(item, clone(change.fields));
      (change.removedFields || []).forEach(function (key) {
        delete item[key];
      });
      if (Object.prototype.hasOwnProperty.call(change, "quantitySet") &&
          change.quantitySet !== undefined) {
        item.quantity = clone(change.quantitySet);
      } else if (change.quantityDelta) {
        item.quantity = Number(item.quantity || 0) + change.quantityDelta;
      }
    });
    return items;
  }

  function tableMetadata(table) {
    return {
      name: table.name || "",
      kind: table.kind || "",
      columns: toArray(table.columns),
      deletedColumnKeys: toArray(table.deletedColumnKeys).map(String)
    };
  }

  function tablePatch(beforeTables, afterTables) {
    const before = recordsById(beforeTables);
    const after = recordsById(afterTables);
    const changes = [];
    const removedIds = [];

    after.forEach(function (table, id) {
      const oldTable = before.get(id);
      if (!oldTable) {
        changes.push({ id: id, added: clone(table) });
        return;
      }

      const items = itemPatch(oldTable.items, table.items);
      const metadata = tableMetadata(table);
      const metadataChanged = JSON.stringify(tableMetadata(oldTable)) !== JSON.stringify(metadata);
      if (metadataChanged || items.changes.length || items.removedIds.length) {
        changes.push({
          id: id,
          metadata: metadataChanged ? metadata : null,
          items: items
        });
      }
    });
    before.forEach(function (_table, id) {
      if (!after.has(id)) removedIds.push(id);
    });
    return { changes: changes, removedIds: removedIds };
  }

  function applyTablePatch(currentTables, patch) {
    const removed = new Set(patch.removedIds);
    const tables = toArray(currentTables).filter(function (table) {
      return table && table.id && !removed.has(table.id);
    });

    patch.changes.forEach(function (change) {
      let table = tables.find(function (entry) {
        return entry.id === change.id;
      });
      if (change.added) {
        if (!table) tables.push(clone(change.added));
        return;
      }
      if (!table) {
        // Başka bir kullanıcı listeyi sildiyse eski ekrandan gelen değişiklik,
        // silinmiş listeyi yeniden oluşturmamalıdır.
        return;
      }
      if (change.metadata) {
        table.name = change.metadata.name;
        table.kind = change.metadata.kind;
        table.columns = toArray(change.metadata.columns);
        table.deletedColumnKeys = toArray(change.metadata.deletedColumnKeys).map(String);
      }
      table.items = applyItemPatch(table.items, change.items);
    });
    return tables;
  }

  function inventoryPatch(before, after) {
    const base = before || { tables: [], logs: [] };
    return {
      tables: tablePatch(base.tables, after.tables),
      logs: recordPatch(base.logs, after.logs)
    };
  }

  function patchIsEmpty(patch) {
    return (
      !patch.tables.changes.length &&
      !patch.tables.removedIds.length &&
      !patch.logs.upserts.length &&
      !patch.logs.removedIds.length
    );
  }

  async function writeInventoryPatch(patch) {
    await cloudReference.child("tables").transaction(function (tables) {
      return applyTablePatch(tables, patch.tables);
    });
    await cloudReference.child("logs").transaction(function (logs) {
      return applyRecordPatch(logs, patch.logs);
    });
    await cloudReference.child("schemaVersion").set(SCHEMA_VERSION);
  }

  async function refreshAfterWrites() {
    if (pendingWriteCount) return;
    const snapshot = await cloudReference.once("value");
    const cloudState = snapshot.val();
    if (!cloudState) return;
    lastCloudInventory = inventoryPayload({
      tables: cloudState.tables || [],
      logs: cloudState.logs || []
    });
    if (watchCallback) watchCallback(mergeCloudWithLocal(cloudState));
  }

  function queueInventoryWrite(task) {
    pendingWriteCount += 1;
    writeQueue = writeQueue
      .then(task)
      .then(function () {
        pendingWriteCount -= 1;
        return refreshAfterWrites();
      })
      .catch(function (error) {
        pendingWriteCount = Math.max(0, pendingWriteCount - 1);
        window.dispatchEvent(new CustomEvent("depo-file-error", {
          detail: firebaseErrorMessage(error)
        }));
        return refreshAfterWrites();
      });
  }

  function firebaseErrorMessage(error) {
    const code = error && error.code || "";
    const message = String(error && error.message || "");
    if (code.includes("permission-denied") || /permission.denied/i.test(message)) {
      return "Firebase yazma izni vermedi. Yönetici hesabını ve Firebase Database Rules ayarlarını kontrol edin.";
    }
    if (code.includes("invalid-credential") || code.includes("wrong-password") ||
        code.includes("user-not-found")) {
      return "Yönetici parolası hatalı.";
    }
    if (code.includes("operation-not-allowed") || code.includes("admin-restricted-operation")) {
      return "Firebase Authentication içinde Anonim ve E-posta/Şifre girişlerini etkinleştirin.";
    }
    if (code.includes("network-request-failed")) {
      return "Firebase bağlantısı kurulamadı. İnternet bağlantısını kontrol edin.";
    }
    return error && error.message || "Firebase işlemi tamamlanamadı.";
  }

  function waitForInitialAuthState() {
    return new Promise(function (resolve, reject) {
      let unsubscribe = null;
      unsubscribe = auth.onAuthStateChanged(
        function (firebaseUser) {
          if (unsubscribe) unsubscribe();
          resolve(firebaseUser);
        },
        function (error) {
          if (unsubscribe) unsubscribe();
          reject(error);
        }
      );
    });
  }

  async function ensureAnonymousIdentity() {
    if (auth.currentUser && auth.currentUser.isAnonymous) return auth.currentUser;
    if (auth.currentUser) await auth.signOut();
    clearAdministratorSession();
    const credential = await auth.signInAnonymously();
    return credential.user;
  }

  async function initialize() {
    if (!window.firebase || !window.DepoFirebaseConfig) {
      throw new Error("Firebase kitaplığı veya yapılandırması yüklenemedi.");
    }

    try {
      if (!window.firebase.apps.length) {
        window.firebase.initializeApp(window.DepoFirebaseConfig);
      }
      auth = window.firebase.auth();
      database = window.firebase.database();
      cloudReference = database.ref(CLOUD_PATH);

      // SESSION kalıcılığı F5 yenilemesinde anonim kimliği ve geçici yönetici
      // modunu korur. Yönetici süresi ayrıca sessionStorage ile sınırlandırılır.
      await auth.setPersistence(window.firebase.auth.Auth.Persistence.SESSION);
      const firebaseUser = await waitForInitialAuthState();
      if (isAdministratorIdentity(firebaseUser)) {
        if (!isAdministrator()) await ensureAnonymousIdentity();
      } else if (!firebaseUser || !firebaseUser.isAnonymous) {
        await ensureAnonymousIdentity();
      }
      return await loadCloudState();
    } catch (error) {
      throw new Error(firebaseErrorMessage(error));
    }
  }

  async function loadCloudState() {
    const snapshot = await cloudReference.once("value");
    let cloudState = snapshot.val();

    // İlk kullanıcı ilk kez bağlandığında Excel'den üretilen başlangıç verisi yüklenir.
    if (!cloudState) {
      const initialState = window.DepoData.createInitialState();
      cloudState = inventoryPayload(initialState);
      await writeInventory(cloudState);
    }

    const cloudInventory = inventoryPayload({
      tables: cloudState.tables || [],
      logs: cloudState.logs || []
    });
    const merged = mergeCloudWithLocal(cloudState);
    const migratedInventory = inventoryPayload(merged);
    const migrationPatch = inventoryPatch(cloudInventory, migratedInventory);

    // Eski ayrı kataloglar bellekte doğru görünmekle kalmasın; ilk başarılı
    // girişte somut sütun seçenekleri Firebase'e de bir kez yazılsın.
    if (!patchIsEmpty(migrationPatch)) {
      await writeInventoryPatch(migrationPatch);
    } else if (Number(cloudState.schemaVersion) !== SCHEMA_VERSION) {
      await cloudReference.child("schemaVersion").set(SCHEMA_VERSION);
    }
    lastCloudInventory = clone(migratedInventory);
    return merged;
  }

  async function enterAdministrator(password) {
    if (!administratorEmail()) {
      throw new Error("Yönetici hesabı yapılandırılmamış.");
    }
    if (!password) throw new Error("Yönetici parolasını yazın.");

    try {
      const credential = await auth.signInWithEmailAndPassword(administratorEmail(), password);
      if (!isAdministratorIdentity(credential.user)) {
        await ensureAnonymousIdentity();
        throw new Error("Bu hesap yönetici hesabı olarak yapılandırılmamış.");
      }
      touchAdministratorSession();
      const loaded = await loadCloudState();
      writeLocalUi(loaded);
      return loaded;
    } catch (error) {
      if (!auth.currentUser) await ensureAnonymousIdentity();
      if (error.message && !error.code) throw error;
      throw new Error(firebaseErrorMessage(error));
    }
  }

  async function exitAdministrator() {
    clearAdministratorSession();
    await auth.signOut();
    await ensureAnonymousIdentity();
    const loaded = await loadCloudState();
    writeLocalUi(loaded);
    return loaded;
  }

  function watch(onChange) {
    if (stopWatching) stopWatching();
    watchCallback = onChange;
    const listener = cloudReference.on("value", function (snapshot) {
      const cloudState = snapshot.val();
      if (!cloudState) return;
      if (pendingWriteCount) return;
      lastCloudInventory = inventoryPayload({
        tables: cloudState.tables || [],
        logs: cloudState.logs || []
      });
      onChange(mergeCloudWithLocal(cloudState));
    });
    stopWatching = function () {
      cloudReference.off("value", listener);
      watchCallback = null;
    };
  }

  function save(state) {
    writeLocalUi(state);
    if (!auth || !auth.currentUser) return true;

    const payload = inventoryPayload(state);
    const patch = inventoryPatch(lastCloudInventory, payload);
    if (patchIsEmpty(patch)) return true;
    // Aynı istemcide arka arkaya yapılan kayıtlar, önceki yerel değişikliği tekrar
    // fark olarak hesaplamasın. Bulut yazıları sırayla çalışırken karşılaştırma
    // tabanını hemen son yerel duruma ilerletiriz.
    lastCloudInventory = clone(payload);
    queueInventoryWrite(function () {
      return writeInventoryPatch(patch);
    });
    return true;
  }

  async function replace(imported) {
    const normalized = normalizeState(imported);
    writeLocalUi(normalized);
    const payload = inventoryPayload(normalized);

    // JSON içe aktarma toplu ve geri dönüşü önemli bir işlemdir. Normal küçük
    // kayıt kuyruğunun aksine burada Firebase cevabını bekleriz; yazma başarısızsa
    // arayüz yanlışlıkla "içe aktarıldı" mesajı göstermez.
    await writeQueue;
    pendingWriteCount += 1;
    try {
      await writeInventory(payload);
      lastCloudInventory = clone(payload);
      return normalized;
    } catch (error) {
      throw new Error(firebaseErrorMessage(error));
    } finally {
      pendingWriteCount = Math.max(0, pendingWriteCount - 1);
    }
  }

  window.DepoStore = {
    clone: clone,
    initialize: initialize,
    enterAdministrator: enterAdministrator,
    exitAdministrator: exitAdministrator,
    isAdministrator: isAdministrator,
    hasAdministratorIdentity: function () {
      return isAdministratorIdentity(auth && auth.currentUser);
    },
    touchAdministratorSession: touchAdministratorSession,
    administratorExpiresAt: administratorExpiresAt,
    watch: watch,
    replace: replace,
    save: save,
    flush: function () { return writeQueue; },
    hasFile: function () { return true; },
    fileName: function () { return "Firebase ortak veri"; },
    isLocalMode: function () { return false; },
    supportsFileAccess: function () { return false; }
  };
}());
