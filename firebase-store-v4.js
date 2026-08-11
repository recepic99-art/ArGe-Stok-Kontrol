(function () {
  "use strict";

  // Firebase ortak veri katmanı - v8.
  const LOCAL_UI_KEY = "arge-numune-depo-ui-v1";
  const CLOUD_PATH = "appState";
  const SCHEMA_VERSION = 6;

  let database = null;
  let auth = null;
  let cloudReference = null;
  let usersReference = null;
  let rolesReference = null;
  let stopWatching = null;
  let lastCloudInventory = null;
  let watchCallback = null;
  let pendingWriteCount = 0;
  let writeQueue = Promise.resolve();

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
        return normalized;
      });
  }

  function normalizeUsername(value) {
    return String(value || "")
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .replace(/[^a-z0-9]/g, "");
  }

  // Firebase Authentication e-posta bekler. Kullanıcı yine yalnızca kullanıcı adı görür.
  function usernameEmail(username) {
    return normalizeUsername(username) + "@argestokkontrol.app";
  }

  function isValidState(value) {
    return Boolean(
      value &&
      Array.isArray(value.users) &&
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

    normalized.schemaVersion = SCHEMA_VERSION;
    normalized.users = toArray(normalized.users).map(function (user) {
      return {
        id: user.id,
        authUid: user.authUid || "",
        username: user.username,
        name: user.name,
        role: user.role === "admin" ? "admin" : "member"
      };
    });
    normalized.tables = normalizeTables(normalized.tables);
    normalized.logs = toArray(normalized.logs);
    normalized.definitions = window.DepoCatalog.normalizeDefinitions(
      normalized.definitions,
      normalized.tables
    );
    normalized.session = Object.assign(
      {},
      defaults.session,
      localUi.session || {},
      normalized.session || {}
    );
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

  // Kullanıcı profili ile yetki ayrı tutulur. Yetkinin iki yerde saklanması,
  // eski tarayıcıların güncel rolü yanlışlıkla ezmesine neden oluyordu.
  function userRecord(user) {
    return {
      id: user.id,
      authUid: user.authUid,
      username: user.username,
      name: user.name
    };
  }

  function usersFromCloud(cloudState) {
    const users = [];
    const directory = cloudState.userDirectory || {};
    const roles = cloudState.rolesByUid || {};

    function mergeUser(record) {
      if (!record || !record.authUid) return;
      const existing = users.find(function (user) {
        return user.authUid === record.authUid;
      });

      if (existing) {
        Object.assign(existing, record);
      } else {
        users.push(record);
      }
    }

    // Yeni yapıda UID anahtarlı kullanıcı dizini tek gerçek kaynaktır.
    Object.keys(directory).forEach(function (uid) {
      mergeUser(Object.assign({}, directory[uid], { authUid: uid }));
    });

    // Eski JSON'dan yalnızca gerçek Firebase UID'si bulunan kayıtları alırız.
    // UID'siz başlangıç kullanıcısı artık yönetici hesabı sayılmaz.
    toArray(cloudState.users).forEach(function (user) {
      mergeUser(clone(user));
    });

    users.forEach(function (user) {
      user.role = roles[user.authUid] === "admin" ? "admin" : "member";
    });
    return users;
  }

  // Normal kaydetme yalnızca stok ve hareket verisini yazar. Kullanıcı ve rol
  // kayıtları kendi küçük fonksiyonlarıyla güncellenir.
  function inventoryPayload(state) {
    return {
      schemaVersion: SCHEMA_VERSION,
      tables: normalizeTables(state.tables),
      logs: toArray(state.logs),
      definitions: window.DepoCatalog.normalizeDefinitions(
        state.definitions,
        normalizeTables(state.tables)
      )
    };
  }

  function mergeCloudWithLocal(cloudState) {
    const defaults = window.DepoData.createInitialState();
    const localUi = readLocalUi();
    const merged = normalizeState({
      schemaVersion: SCHEMA_VERSION,
      users: usersFromCloud(cloudState),
      tables: normalizeTables(cloudState.tables),
      logs: toArray(cloudState.logs),
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
      Object.keys(item).forEach(function (key) {
        if (key === "id" || key === "quantity") return;
        if (JSON.stringify(oldItem[key]) !== JSON.stringify(item[key])) {
          fields[key] = clone(item[key]);
        }
      });

      const oldQuantity = Number(oldItem.quantity);
      const newQuantity = Number(item.quantity);
      const quantityChanged = JSON.stringify(oldItem.quantity) !== JSON.stringify(item.quantity);
      const hasQuantityDelta = Number.isFinite(oldQuantity) && Number.isFinite(newQuantity) &&
        oldQuantity !== newQuantity;
      const hasQuantitySet = quantityChanged && !hasQuantityDelta;
      if (hasQuantityDelta || hasQuantitySet || Object.keys(fields).length) {
        changes.push({
          id: id,
          fields: fields,
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
      if (Object.prototype.hasOwnProperty.call(change, "quantitySet") &&
          change.quantitySet !== undefined) {
        item.quantity = clone(change.quantitySet);
      } else if (change.quantityDelta) {
        item.quantity = Number(item.quantity || 0) + change.quantityDelta;
      }
    });
    return items;
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
      const nameChanged = oldTable.name !== table.name;
      if (nameChanged || items.changes.length || items.removedIds.length) {
        changes.push({
          id: id,
          nameChanged: nameChanged,
          name: table.name,
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
      if (change.nameChanged) table.name = change.name;
      table.items = applyItemPatch(table.items, change.items);
    });
    return tables;
  }

  function inventoryPatch(before, after) {
    const base = before || { tables: [], logs: [], definitions: { categories: [] } };
    return {
      tables: tablePatch(base.tables, after.tables),
      logs: recordPatch(base.logs, after.logs),
      categories: recordPatch(
        base.definitions && base.definitions.categories,
        after.definitions && after.definitions.categories
      )
    };
  }

  function patchIsEmpty(patch) {
    return (
      !patch.tables.changes.length &&
      !patch.tables.removedIds.length &&
      !patch.logs.upserts.length &&
      !patch.logs.removedIds.length &&
      !patch.categories.upserts.length &&
      !patch.categories.removedIds.length
    );
  }

  async function writeInventoryPatch(patch) {
    await cloudReference.child("tables").transaction(function (tables) {
      return applyTablePatch(tables, patch.tables);
    });
    await cloudReference.child("logs").transaction(function (logs) {
      return applyRecordPatch(logs, patch.logs);
    });
    if (patch.categories.upserts.length || patch.categories.removedIds.length) {
      await cloudReference.child("definitions/categories").transaction(function (categories) {
        return applyRecordPatch(categories, patch.categories);
      });
    }
    await cloudReference.child("schemaVersion").set(SCHEMA_VERSION);
  }

  async function refreshAfterWrites() {
    if (pendingWriteCount) return;
    const snapshot = await cloudReference.once("value");
    const cloudState = snapshot.val();
    if (!cloudState) return;
    lastCloudInventory = inventoryPayload({
      tables: cloudState.tables || [],
      logs: cloudState.logs || [],
      definitions: cloudState.definitions
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

  async function writeCurrentUser(user) {
    if (!user || !user.authUid) return;
    await usersReference.child(user.authUid).set(userRecord(user));
  }

  // İlk gerçek hesap yönetici olur; sonraki hesaplar üye olarak eklenir.
  // İşlem tüm rol listesi üzerinde transaction olduğu için iki kişi aynı anda
  // kaydolsa bile yalnızca biri ilk yönetici olabilir.
  async function ensureCurrentUserRole(uid) {
    const userRoleReference = rolesReference.child(uid);
    const currentRoleSnapshot = await userRoleReference.once("value");
    const currentRole = currentRoleSnapshot.val();

    if (currentRole === "admin" || currentRole === "member") {
      return currentRole;
    }

    // Rol listesinin tamamını yazmak diğer kullanıcıların yetkilerini silebilirdi.
    // Önce yönetici var mı diye bakıp yalnızca giriş yapan kişinin rolünü oluştururuz.
    const rolesSnapshot = await rolesReference.once("value");
    const roles = rolesSnapshot.val() || {};
    const hasAdministrator = Object.keys(roles).some(function (key) {
      return roles[key] === "admin";
    });
    const firstRole = hasAdministrator ? "member" : "admin";
    let result;
    try {
      result = await userRoleReference.transaction(function (role) {
        return role === "admin" || role === "member" ? role : firstRole;
      });
    } catch (error) {
      // İki kişi ilk kez aynı anda kaydolursa yalnızca biri ilk yönetici olabilir.
      // İkinci kayıt, güvenlik kuralına takılmak yerine normal üye olarak tamamlanır.
      if (firstRole !== "admin") throw error;
      result = await userRoleReference.transaction(function (role) {
        return role === "admin" || role === "member" ? role : "member";
      });
    }
    const savedRole = result.snapshot.val();
    return savedRole === "admin" ? "admin" : "member";
  }

  function firebaseErrorMessage(error) {
    const code = error && error.code || "";
    if (code.includes("invalid-credential") || code.includes("wrong-password") ||
        code.includes("user-not-found")) {
      return "Kullanıcı adı veya şifre hatalı.";
    }
    if (code.includes("email-already-in-use")) {
      return "Bu kullanıcı adı kullanılıyor. Daha özgün bir ad seçin.";
    }
    if (code.includes("weak-password")) {
      return "Şifre en az 6 karakter olmalıdır.";
    }
    if (code.includes("requires-recent-login")) {
      return "Güvenlik için mevcut şifrenizle yeniden doğrulama yapın.";
    }
    if (code.includes("invalid-email")) {
      return "Geçerli bir kullanıcı adı yazın.";
    }
    if (code.includes("operation-not-allowed")) {
      return "Firebase'de E-posta/Şifre girişi henüz etkinleştirilmemiş.";
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

  function pageWasReloaded() {
    const navigation = window.performance &&
      window.performance.getEntriesByType &&
      window.performance.getEntriesByType("navigation")[0];
    return Boolean(navigation && navigation.type === "reload");
  }

  // Firebase tarayicida oturumu saklar. Sayfa yenilendiginde bu kimligi ortak
  // kullanici kaydi ve guncel yetkiyle yeniden birlestiririz.
  async function restoreAuthenticatedSession(firebaseUser) {
    const role = await ensureCurrentUserRole(firebaseUser.uid);
    const loaded = await loadCloudState();
    let user = loaded.users.find(function (entry) {
      return entry.authUid === firebaseUser.uid;
    });

    if (!user) {
      const emailUsername = String(firebaseUser.email || "").split("@")[0];
      const username = emailUsername || firebaseUser.uid.slice(0, 8);
      user = {
        id: "user-" + firebaseUser.uid,
        authUid: firebaseUser.uid,
        username: username,
        name: firebaseUser.displayName || username,
        role: "member"
      };
      loaded.users.push(user);
    }

    user.role = role;
    loaded.session.currentUserId = user.id;
    await writeCurrentUser(user);
    writeLocalUi(loaded);
    return loaded;
  }

  async function initialize() {
    if (!window.firebase || !window.DepoFirebaseConfig) {
      throw new Error("Firebase kitaplığı veya yapılandırması yüklenemedi.");
    }

    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(window.DepoFirebaseConfig);
    }
    auth = window.firebase.auth();
    database = window.firebase.database();
    cloudReference = database.ref(CLOUD_PATH);
    usersReference = cloudReference.child("userDirectory");
    rolesReference = cloudReference.child("rolesByUid");

    // SESSION kaliciligi sayfa yenilemesinde kimligi korur. Tarayici oturumu
    // sona erdiginde Firebase kimligi otomatik olarak temizlenir.
    await auth.setPersistence(window.firebase.auth.Auth.Persistence.SESSION);
    const firebaseUser = await waitForInitialAuthState();
    if (firebaseUser) {
      // Chrome kapatilan sekmeleri geri yuklerken sessionStorage verisini de
      // geri getirebilir. Yalnizca gercek F5 yenilemesinde oturumu surdururuz.
      if (pageWasReloaded()) return restoreAuthenticatedSession(firebaseUser);
      await auth.signOut();
    }

    // Giris yokken yalnizca yerel gorunum ayarlari hazirlanir.
    const initialState = normalizeState(window.DepoData.createInitialState());
    initialState.session.currentUserId = null;
    return initialState;
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

    lastCloudInventory = inventoryPayload({
      tables: cloudState.tables || [],
      logs: cloudState.logs || [],
      definitions: cloudState.definitions
    });
    return mergeCloudWithLocal(cloudState);
  }

  async function signIn(username, password) {
    try {
      const credential = await auth.signInWithEmailAndPassword(usernameEmail(username), password);
      const role = await ensureCurrentUserRole(credential.user.uid);
      const loaded = await loadCloudState();
      let user = loaded.users.find(function (entry) {
        return entry.authUid === credential.user.uid;
      });

      // Eski JSON'daki kullanıcı ilk Firebase girişinde kimliğiyle eşleştirilir.
      if (!user) {
        user = loaded.users.find(function (entry) {
          return normalizeUsername(entry.username) === normalizeUsername(username);
        });
      }
      if (!user) {
        user = {
          id: "user-" + credential.user.uid,
          authUid: credential.user.uid,
          username: username,
          name: credential.user.displayName || username,
          role: "member"
        };
        loaded.users.push(user);
      }

      user.role = role;
      loaded.session.currentUserId = user.id;
      await writeCurrentUser(user);
      writeLocalUi(loaded);
      return loaded;
    } catch (error) {
      throw new Error(firebaseErrorMessage(error));
    }
  }

  async function register(username, password, name) {
    try {
      const credential = await auth.createUserWithEmailAndPassword(usernameEmail(username), password);
      await credential.user.updateProfile({ displayName: name });
      const role = await ensureCurrentUserRole(credential.user.uid);
      const loaded = await loadCloudState();
      let user = loaded.users.find(function (entry) {
        return normalizeUsername(entry.username) === normalizeUsername(username);
      });

      if (user && user.authUid && user.authUid !== credential.user.uid) {
        await credential.user.delete();
        throw new Error("Bu kullanıcı adı kullanılıyor. Daha özgün bir ad seçin.");
      }
      if (!user) {
        user = {
          id: "user-" + credential.user.uid,
          username: username,
          name: name,
          role: "member"
        };
        loaded.users.push(user);
      }
      user.authUid = credential.user.uid;
      user.name = name;
      user.role = role;
      loaded.session.currentUserId = user.id;
      await writeCurrentUser(user);
      writeLocalUi(loaded);
      return loaded;
    } catch (error) {
      if (error.message && !error.code) throw error;
      throw new Error(firebaseErrorMessage(error));
    }
  }

  async function signOut() {
    if (stopWatching) {
      stopWatching();
      stopWatching = null;
    }
    await auth.signOut();
  }

  async function reauthenticateCurrentUser(password) {
    if (!auth || !auth.currentUser) {
      throw new Error("Hesap işlemi için giriş yapmalısınız.");
    }
    if (!password) {
      throw new Error("Bu değişiklik için mevcut şifrenizi yazın.");
    }
    const credential = window.firebase.auth.EmailAuthProvider.credential(
      auth.currentUser.email,
      password
    );
    await auth.currentUser.reauthenticateWithCredential(credential);
  }

  async function updateCurrentUserProfile(changes) {
    if (!auth || !auth.currentUser) {
      throw new Error("Hesap bilgilerini değiştirmek için giriş yapmalısınız.");
    }

    const uid = auth.currentUser.uid;
    const snapshot = await usersReference.child(uid).once("value");
    const current = snapshot.val();
    if (!current) throw new Error("Kullanıcı kaydı bulunamadı.");

    const username = String(changes.username || "").trim();
    const name = String(changes.name || "").trim();
    if (!normalizeUsername(username)) throw new Error("Geçerli bir kullanıcı adı yazın.");
    if (!name) throw new Error("Ad soyad alanı zorunludur.");

    const usernameChanged =
      normalizeUsername(username) !== normalizeUsername(current.username);
    if (usernameChanged) {
      await reauthenticateCurrentUser(changes.currentPassword);
      await auth.currentUser.updateEmail(usernameEmail(username));
    }
    if (name !== current.name) {
      await auth.currentUser.updateProfile({ displayName: name });
    }

    const updated = {
      id: current.id || "user-" + uid,
      authUid: uid,
      username: username,
      name: name
    };
    await usersReference.child(uid).set(updated);
    updated.role = (await rolesReference.child(uid).once("value")).val() === "admin"
      ? "admin"
      : "member";
    return updated;
  }

  async function changeCurrentUserPassword(currentPassword, newPassword) {
    if (String(newPassword || "").length < 6) {
      throw new Error("Yeni şifre en az 6 karakter olmalıdır.");
    }
    await reauthenticateCurrentUser(currentPassword);
    await auth.currentUser.updatePassword(newPassword);
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
        logs: cloudState.logs || [],
        definitions: cloudState.definitions
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

  async function setUserRole(userId, role) {
    if (!auth || !auth.currentUser) {
      throw new Error("Yetki değiştirmek için giriş yapmalısınız.");
    }
    if (role !== "admin" && role !== "member") {
      throw new Error("Geçersiz kullanıcı yetkisi.");
    }

    const cloudState = (await cloudReference.once("value")).val() || {};
    const currentRole = (cloudState.rolesByUid || {})[auth.currentUser.uid];
    if (currentRole !== "admin") {
      throw new Error("Bu işlem yalnızca yöneticiler tarafından yapılabilir.");
    }

    const users = usersFromCloud(cloudState);
    const user = users.find(function (entry) {
      return entry.id === userId;
    });
    if (!user || !user.authUid) {
      throw new Error("Kullanıcı kaydı bulunamadı.");
    }

    const roles = cloudState.rolesByUid || {};
    const administratorCount = Object.keys(roles).filter(function (uid) {
      return roles[uid] === "admin";
    }).length;
    if (roles[user.authUid] === "admin" && role === "member" && administratorCount <= 1) {
      throw new Error("Sistemde en az bir yönetici kalmalıdır.");
    }

    await rolesReference.child(user.authUid).set(role);
    return role;
  }

  function replace(imported) {
    const normalized = normalizeState(imported);
    writeLocalUi(normalized);
    const payload = inventoryPayload(normalized);
    lastCloudInventory = clone(payload);
    queueInventoryWrite(function () {
      return writeInventory(payload);
    });
    return normalized;
  }

  window.DepoStore = {
    clone: clone,
    initialize: initialize,
    signIn: signIn,
    register: register,
    signOut: signOut,
    updateCurrentUserProfile: updateCurrentUserProfile,
    changeCurrentUserPassword: changeCurrentUserPassword,
    watch: watch,
    setUserRole: setUserRole,
    replace: replace,
    save: save,
    flush: function () { return writeQueue; },
    hasFile: function () { return true; },
    fileName: function () { return "Firebase ortak veri"; },
    isLocalMode: function () { return false; },
    supportsFileAccess: function () { return false; }
  };
}());
