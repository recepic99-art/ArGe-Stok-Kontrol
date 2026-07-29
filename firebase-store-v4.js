(function () {
  "use strict";

  // Firebase ortak veri katmanı - v7.
  const LOCAL_UI_KEY = "arge-numune-depo-ui-v1";
  const CLOUD_PATH = "appState";
  const SCHEMA_VERSION = 5;

  let database = null;
  let auth = null;
  let cloudReference = null;
  let usersReference = null;
  let rolesReference = null;
  let stopWatching = null;
  let lastInventoryJson = "";
  let writeQueue = Promise.resolve();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
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
    normalized.users = normalized.users.map(function (user) {
      return {
        id: user.id,
        authUid: user.authUid || "",
        username: user.username,
        name: user.name,
        role: user.role === "admin" ? "admin" : "member"
      };
    });
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
    (cloudState.users || []).forEach(function (user) {
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
      tables: clone(state.tables),
      logs: clone(state.logs)
    };
  }

  function mergeCloudWithLocal(cloudState) {
    const defaults = window.DepoData.createInitialState();
    const localUi = readLocalUi();
    const merged = normalizeState({
      schemaVersion: SCHEMA_VERSION,
      users: usersFromCloud(cloudState),
      tables: cloudState.tables || [],
      logs: cloudState.logs || [],
      session: Object.assign({}, defaults.session, localUi.session || {}),
      settings: Object.assign({}, defaults.settings, localUi.settings || {})
    });
    return merged;
  }

  function writeInventory(payload) {
    return cloudReference.update(payload);
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
    const result = await userRoleReference.transaction(function (role) {
      return role === "admin" || role === "member" ? role : firstRole;
    });
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
    if (code.includes("operation-not-allowed")) {
      return "Firebase'de E-posta/Şifre girişi henüz etkinleştirilmemiş.";
    }
    if (code.includes("network-request-failed")) {
      return "Firebase bağlantısı kurulamadı. İnternet bağlantısını kontrol edin.";
    }
    return error && error.message || "Firebase işlemi tamamlanamadı.";
  }

  function initialize() {
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

    // Giriş yapılmadan bulut verisi okunamaz; ekranda yalnızca yerel görünüm ayarları hazırlanır.
    return Promise.resolve(normalizeState(window.DepoData.createInitialState()));
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

    lastInventoryJson = JSON.stringify(inventoryPayload({
      tables: cloudState.tables || [],
      logs: cloudState.logs || []
    }));
    return mergeCloudWithLocal(cloudState);
  }

  async function signIn(username, password) {
    try {
      const credential = await auth.signInWithEmailAndPassword(usernameEmail(username), password);
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

      user.role = await ensureCurrentUserRole(credential.user.uid);
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
      user.role = await ensureCurrentUserRole(credential.user.uid);
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

  function watch(onChange) {
    if (stopWatching) stopWatching();
    const listener = cloudReference.on("value", function (snapshot) {
      const cloudState = snapshot.val();
      if (!cloudState) return;
      lastInventoryJson = JSON.stringify(inventoryPayload({
        tables: cloudState.tables || [],
        logs: cloudState.logs || []
      }));
      onChange(mergeCloudWithLocal(cloudState));
    });
    stopWatching = function () {
      cloudReference.off("value", listener);
    };
  }

  function save(state) {
    writeLocalUi(state);
    if (!auth || !auth.currentUser) return true;

    const payload = inventoryPayload(state);
    const json = JSON.stringify(payload);
    if (json === lastInventoryJson) return true;
    lastInventoryJson = json;

    writeQueue = writeQueue
      .then(function () {
        return writeInventory(payload);
      })
      .catch(function (error) {
        // Başarısız kayıt bir sonraki işlemde yeniden denenebilmelidir.
        lastInventoryJson = "";
        window.dispatchEvent(new CustomEvent("depo-file-error", {
          detail: firebaseErrorMessage(error)
        }));
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
    save(normalized);
    return normalized;
  }

  window.DepoStore = {
    clone: clone,
    initialize: initialize,
    signIn: signIn,
    register: register,
    signOut: signOut,
    watch: watch,
    setUserRole: setUserRole,
    replace: replace,
    save: save,
    hasFile: function () { return true; },
    fileName: function () { return "Firebase ortak veri"; },
    isLocalMode: function () { return false; },
    supportsFileAccess: function () { return false; }
  };
}());
