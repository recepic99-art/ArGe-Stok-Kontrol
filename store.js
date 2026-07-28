(function () {
  "use strict";

  const LOCAL_UI_KEY = "arge-numune-depo-ui-v1";
  const CLOUD_PATH = "appState";

  let database = null;
  let auth = null;
  let cloudReference = null;
  let stopWatching = null;
  let lastCloudJson = "";
  let lastRolesByUid = {};
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

    normalized.schemaVersion = 3;
    const hasAdministrator = normalized.users.some(function (user) {
      return user.role === "admin";
    });
    const firstAuthenticatedIndex = normalized.users.findIndex(function (user) {
      return Boolean(user.authUid);
    });
    const defaultAdministratorIndex = firstAuthenticatedIndex >= 0 ? firstAuthenticatedIndex : 0;
    normalized.users = normalized.users.map(function (user, index) {
      return {
        id: user.id,
        authUid: user.authUid || "",
        username: user.username,
        name: user.name,
        role: user.role || (!hasAdministrator && index === defaultAdministratorIndex ? "admin" : "member")
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

  // Oturum, tema ve panel ölçüleri kullanıcıya özeldir; buluta gönderilmez.
  function cloudPayload(state) {
    const rolesByUid = {};
    state.users.forEach(function (user) {
      if (user.authUid) rolesByUid[user.authUid] = user.role || "member";
    });
    return {
      schemaVersion: 3,
      users: state.users.map(function (user) {
        return {
          id: user.id,
          authUid: user.authUid || "",
          username: user.username,
          name: user.name,
          role: user.role || "member"
        };
      }),
      rolesByUid: rolesByUid,
      tables: clone(state.tables),
      logs: clone(state.logs)
    };
  }

  function mergeCloudWithLocal(cloudState) {
    const defaults = window.DepoData.createInitialState();
    const localUi = readLocalUi();
    const merged = normalizeState({
      schemaVersion: 3,
      users: cloudState.users || [],
      tables: cloudState.tables || [],
      logs: cloudState.logs || [],
      session: Object.assign({}, defaults.session, localUi.session || {}),
      settings: Object.assign({}, defaults.settings, localUi.settings || {})
    });
    const rolesByUid = cloudState.rolesByUid || {};
    merged.users.forEach(function (user) {
      if (user.authUid && rolesByUid[user.authUid]) {
        user.role = rolesByUid[user.authUid];
      }
    });
    return merged;
  }

  // Ayrıntılı Firebase kuralları nedeniyle ana düğümü tek parça yazmak yerine
  // her veri bölümünü kendi izin yolundan güncelleriz.
  function writeCloudPayload(payload) {
    const updates = {
      schemaVersion: payload.schemaVersion,
      users: payload.users,
      tables: payload.tables,
      logs: payload.logs
    };
    Object.keys(payload.rolesByUid || {}).forEach(function (uid) {
      if (lastRolesByUid[uid] !== payload.rolesByUid[uid]) {
        updates["rolesByUid/" + uid] = payload.rolesByUid[uid];
      }
    });
    return cloudReference.update(updates).then(function () {
      lastRolesByUid = clone(payload.rolesByUid || {});
    });
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

    // Giriş yapılmadan bulut verisi okunamaz; ekranda yalnızca yerel görünüm ayarları hazırlanır.
    return Promise.resolve(normalizeState(window.DepoData.createInitialState()));
  }

  async function loadCloudState() {
    const snapshot = await cloudReference.once("value");
    let cloudState = snapshot.val();

    // İlk kullanıcı ilk kez bağlandığında Excel'den üretilen başlangıç verisi yüklenir.
    if (!cloudState) {
      const initialState = window.DepoData.createInitialState();
      cloudState = cloudPayload(initialState);
      await writeCloudPayload(cloudState);
    }

    lastCloudJson = JSON.stringify(cloudState);
    lastRolesByUid = clone(cloudState.rolesByUid || {});
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
      } else if (!user.authUid) {
        user.authUid = credential.user.uid;
      }

      loaded.session.currentUserId = user.id;
      save(loaded);
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
      const hasAuthenticatedAdministrator = loaded.users.some(function (entry) {
        return entry.id !== user.id && entry.authUid && entry.role === "admin";
      });
      if (!hasAuthenticatedAdministrator) user.role = "admin";
      loaded.session.currentUserId = user.id;
      save(loaded);
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
      const json = JSON.stringify(cloudState);
      if (json === lastCloudJson) return;
      lastCloudJson = json;
      lastRolesByUid = clone(cloudState.rolesByUid || {});
      onChange(mergeCloudWithLocal(cloudState));
    });
    stopWatching = function () {
      cloudReference.off("value", listener);
    };
  }

  function save(state) {
    writeLocalUi(state);
    if (!auth || !auth.currentUser) return true;

    const payload = cloudPayload(state);
    const json = JSON.stringify(payload);
    if (json === lastCloudJson) return true;
    lastCloudJson = json;

    writeQueue = writeQueue
      .then(function () {
        return writeCloudPayload(payload);
      })
      .catch(function (error) {
        // Başarısız kayıt bir sonraki işlemde yeniden denenebilmelidir.
        lastCloudJson = "";
        window.dispatchEvent(new CustomEvent("depo-file-error", {
          detail: firebaseErrorMessage(error)
        }));
      });
    return true;
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
    replace: replace,
    save: save,
    hasFile: function () { return true; },
    fileName: function () { return "Firebase ortak veri"; },
    isLocalMode: function () { return false; },
    supportsFileAccess: function () { return false; }
  };
}());
