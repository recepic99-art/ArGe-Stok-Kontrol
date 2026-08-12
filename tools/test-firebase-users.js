const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const storeSource = fs.readFileSync(
  path.join(__dirname, "..", "firebase-store-v4.js"),
  "utf8"
);
const catalogSource = fs.readFileSync(
  path.join(__dirname, "..", "assets", "js", "catalog.js"),
  "utf8"
);

const legacyUsers = [
  {
    id: "u-recep",
    username: "recep",
    name: "Recep İç",
    authUid: "",
    role: "admin"
  }
];

const sharedDatabase = {
  appState: {
    schemaVersion: 4,
    users: clone(legacyUsers),
    tables: [],
    logs: [],
    rolesByUid: {}
  }
};

const accounts = {
  "recepic@argestokkontrol.app": {
    uid: "uid-recepic",
    displayName: "Recep İç"
  },
  "ali@argestokkontrol.app": {
    uid: "uid-ali",
    displayName: "Ali"
  }
};

const cloudListeners = [];

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function pathParts(value) {
  return String(value || "").split("/").filter(Boolean);
}

function valueAtPath(value) {
  return pathParts(value).reduce(function (current, key) {
    return current == null ? undefined : current[key];
  }, sharedDatabase);
}

function writeAtPath(value, nextValue) {
  const keys = pathParts(value);
  let target = sharedDatabase;
  keys.slice(0, -1).forEach(function (key) {
    if (!target[key] || typeof target[key] !== "object") target[key] = {};
    target = target[key];
  });
  target[keys.at(-1)] = clone(nextValue);
}

function snapshot(value) {
  return {
    val: function () {
      return clone(value);
    }
  };
}

function notifyCloudListeners() {
  cloudListeners.forEach(function (listener) {
    listener(snapshot(sharedDatabase.appState));
  });
}

function createReference(referencePath) {
  return {
    child(key) {
      return createReference(referencePath + "/" + key);
    },
    async once() {
      return snapshot(valueAtPath(referencePath));
    },
    async set(value) {
      writeAtPath(referencePath, value);
      notifyCloudListeners();
    },
    async update(updates) {
      Object.keys(updates).forEach(function (relativePath) {
        writeAtPath(referencePath + "/" + relativePath, updates[relativePath]);
      });
      notifyCloudListeners();
    },
    async transaction(updater) {
      const nextValue = updater(clone(valueAtPath(referencePath)));
      writeAtPath(referencePath, nextValue);
      notifyCloudListeners();
      return {
        committed: true,
        snapshot: snapshot(nextValue)
      };
    },
    on(eventName, listener) {
      cloudListeners.push(listener);
      return listener;
    },
    off() {}
  };
}

function createClient(navigationType) {
  const localValues = new Map();
  const document = {};
  let persistence = "";
  const auth = {
    currentUser: null,
    async setPersistence(value) {
      persistence = value;
    },
    onAuthStateChanged(listener) {
      Promise.resolve().then(function () {
        listener(auth.currentUser);
      });
      return function () {};
    },
    async signInWithEmailAndPassword(email) {
      const account = accounts[email];
      if (!account) throw new Error("Kullanıcı bulunamadı.");
      const user = {
        uid: account.uid,
        displayName: account.displayName,
        async updateProfile(profile) {
          this.displayName = profile.displayName;
        },
        async delete() {}
      };
      auth.currentUser = user;
      return { user: user };
    },
    async createUserWithEmailAndPassword(email) {
      return auth.signInWithEmailAndPassword(email);
    },
    async signOut() {
      auth.currentUser = null;
    }
  };

  function firebaseAuth() {
    return auth;
  }
  firebaseAuth.Auth = {
    Persistence: {
      SESSION: "SESSION"
    }
  };

  const window = {
    firebase: {
      apps: [],
      initializeApp() {
        this.apps.push({});
      },
      auth: firebaseAuth,
      database: function () {
        return {
          ref: function (referencePath) {
            return createReference(referencePath);
          }
        };
      }
    },
    DepoFirebaseConfig: {},
    DepoData: {
      createInitialState: function () {
        return {
          schemaVersion: 4,
          users: clone(legacyUsers),
          tables: [],
          logs: [],
          session: {
            currentUserId: null,
            activeTableId: "",
            openTableIds: []
          },
          settings: {
            theme: "light",
            visibleColumns: [],
            columnOrder: []
          }
        };
      }
    },
    localStorage: {
      getItem(key) {
        return localValues.get(key) || null;
      },
      setItem(key, value) {
        localValues.set(key, value);
      }
    },
    performance: {
      getEntriesByType: function () {
        return [{ type: navigationType || "navigate" }];
      }
    },
    dispatchEvent() {}
  };

  const context = {
    window: window,
    document: document,
    console: console,
    CustomEvent: class CustomEvent {}
  };
  vm.runInNewContext(catalogSource, context);
  vm.runInNewContext(storeSource, context);
  window.DepoStore.testPersistence = function () {
    return persistence;
  };
  return window.DepoStore;
}

function authenticatedUsers(state) {
  return state.users.filter(function (user) {
    return Boolean(user.authUid);
  });
}

(async function () {
  const refreshedSessionClient = createClient("reload");
  await refreshedSessionClient.initialize();
  await refreshedSessionClient.signIn("recepic", "demo123");
  const refreshedSessionState = await refreshedSessionClient.initialize();
  assert.equal(refreshedSessionClient.testPersistence(), "SESSION");
  assert.equal(refreshedSessionState.session.currentUserId, "user-uid-recepic");

  const reopenedBrowserClient = createClient("navigate");
  await reopenedBrowserClient.initialize();
  await reopenedBrowserClient.signIn("recepic", "demo123");
  const reopenedBrowserState = await reopenedBrowserClient.initialize();
  assert.equal(reopenedBrowserState.session.currentUserId, null);

  const administratorClient = createClient();
  await administratorClient.initialize();
  const administratorState = await administratorClient.register(
    "recepic",
    "demo123",
    "Recep İç"
  );

  assert.equal(authenticatedUsers(administratorState).length, 1);
  assert.equal(authenticatedUsers(administratorState)[0].role, "admin");
  assert.equal(valueAtPath("appState/rolesByUid/uid-recepic"), "admin");

  const memberClient = createClient();
  await memberClient.initialize();
  const memberState = await memberClient.register("ali", "demo123", "Ali");
  assert.equal(
    authenticatedUsers(memberState).find(function (user) {
      return user.username === "ali";
    }).role,
    "member"
  );

  // Eski veya eksik bir tarayıcı yalnız stok kaydederken kullanıcı dizinine
  // dokunamamalıdır.
  memberClient.save({
    users: [authenticatedUsers(memberState)[1]],
    tables: [{ id: "table-test", name: "Test", items: [] }],
    logs: [],
    session: memberState.session,
    settings: memberState.settings
  });
  await memberClient.flush();
  assert.equal(Object.keys(valueAtPath("appState/userDirectory")).length, 2);

  await assert.rejects(
    memberClient.setUserRole("user-uid-ali", "admin"),
    /yalnızca yöneticiler/
  );

  await administratorClient.setUserRole("user-uid-ali", "admin");
  assert.equal(valueAtPath("appState/rolesByUid/uid-ali"), "admin");

  const freshClient = createClient();
  await freshClient.initialize();
  const freshState = await freshClient.signIn("ali", "demo123");
  assert.deepEqual(
    authenticatedUsers(freshState).map(function (user) {
      return user.username;
    }).sort(),
    ["ali", "recepic"]
  );
  assert.equal(
    authenticatedUsers(freshState).find(function (user) {
      return user.username === "ali";
    }).role,
    "admin"
  );

  // İki bilgisayar aynı anda liste oluşturduğunda son yazan ilk listeyi ezmemelidir.
  const firstInventoryClient = createClient();
  const secondInventoryClient = createClient();
  await firstInventoryClient.initialize();
  await secondInventoryClient.initialize();
  const firstInventoryState = await firstInventoryClient.signIn("recepic", "demo123");
  const secondInventoryState = await secondInventoryClient.signIn("ali", "demo123");

  firstInventoryState.tables.push({ id: "table-first", name: "Birinci", items: [] });
  secondInventoryState.tables.push({ id: "table-second", name: "İkinci", items: [] });
  firstInventoryClient.save(firstInventoryState);
  secondInventoryClient.save(secondInventoryState);
  await Promise.all([
    firstInventoryClient.flush(),
    secondInventoryClient.flush()
  ]);

  assert.deepEqual(
    valueAtPath("appState/tables").map(function (table) { return table.id; }).sort(),
    ["table-first", "table-second", "table-test"]
  );

  // Aynı listenin farklı stok kartlarına yapılan eşzamanlı eklemeler de korunmalıdır.
  const firstItemClient = createClient();
  const secondItemClient = createClient();
  await firstItemClient.initialize();
  await secondItemClient.initialize();
  const firstItemState = await firstItemClient.signIn("recepic", "demo123");
  const secondItemState = await secondItemClient.signIn("ali", "demo123");
  firstItemState.tables.find(function (table) {
    return table.id === "table-test";
  }).items.push({ id: "item-first", name: "Birinci malzeme" });
  secondItemState.tables.find(function (table) {
    return table.id === "table-test";
  }).items.push({ id: "item-second", name: "İkinci malzeme" });

  firstItemClient.save(firstItemState);
  secondItemClient.save(secondItemState);
  await Promise.all([
    firstItemClient.flush(),
    secondItemClient.flush()
  ]);

  assert.deepEqual(
    valueAtPath("appState/tables").find(function (table) {
      return table.id === "table-test";
    }).items.map(function (item) { return item.id; }).sort(),
    ["item-first", "item-second"]
  );

  // Aynı malzemeden iki kişi aynı anda çıkış yaptığında iki eksiltme de uygulanmalıdır.
  const seedClient = createClient();
  await seedClient.initialize();
  const seedState = await seedClient.signIn("recepic", "demo123");
  seedState.tables.find(function (table) {
    return table.id === "table-test";
  }).items.find(function (item) {
    return item.id === "item-first";
  }).quantity = 10;
  seedClient.save(seedState);
  await seedClient.flush();

  const firstMovementClient = createClient();
  const secondMovementClient = createClient();
  await firstMovementClient.initialize();
  await secondMovementClient.initialize();
  const firstMovementState = await firstMovementClient.signIn("recepic", "demo123");
  const secondMovementState = await secondMovementClient.signIn("ali", "demo123");
  firstMovementState.tables.find(function (table) {
    return table.id === "table-test";
  }).items.find(function (item) {
    return item.id === "item-first";
  }).quantity -= 1;
  secondMovementState.tables.find(function (table) {
    return table.id === "table-test";
  }).items.find(function (item) {
    return item.id === "item-first";
  }).quantity -= 1;
  firstMovementState.logs.push({ id: "log-first", itemId: "item-first", quantity: 1 });
  secondMovementState.logs.push({ id: "log-second", itemId: "item-first", quantity: 1 });

  firstMovementClient.save(firstMovementState);
  secondMovementClient.save(secondMovementState);
  await Promise.all([
    firstMovementClient.flush(),
    secondMovementClient.flush()
  ]);

  assert.equal(
    valueAtPath("appState/tables").find(function (table) {
      return table.id === "table-test";
    }).items.find(function (item) {
      return item.id === "item-first";
    }).quantity,
    8
  );
  assert.deepEqual(
    valueAtPath("appState/logs").map(function (log) { return log.id; }).sort(),
    ["log-first", "log-second"]
  );

  // Bağlantı yavaşken aynı istemcinin peş peşe yaptığı işlemler tekrar sayılmamalıdır.
  const rapidClient = createClient();
  await rapidClient.initialize();
  const rapidState = await rapidClient.signIn("recepic", "demo123");
  const rapidItem = rapidState.tables.find(function (table) {
    return table.id === "table-test";
  }).items.find(function (item) {
    return item.id === "item-first";
  });
  rapidItem.quantity -= 1;
  rapidClient.save(rapidState);
  rapidItem.quantity -= 1;
  rapidClient.save(rapidState);
  await rapidClient.flush();

  assert.equal(
    valueAtPath("appState/tables").find(function (table) {
      return table.id === "table-test";
    }).items.find(function (item) {
      return item.id === "item-first";
    }).quantity,
    6
  );

  // Eski açık ekrandan gelen bir düzenleme, başka kullanıcının sildiği kaydı diriltmemelidir.
  const deletionSeedClient = createClient();
  await deletionSeedClient.initialize();
  const deletionSeedState = await deletionSeedClient.signIn("recepic", "demo123");
  deletionSeedState.tables.push({
    id: "table-delete",
    name: "Silinecek",
    items: [{ id: "item-delete", name: "Silinecek malzeme", quantity: 5 }]
  });
  deletionSeedClient.save(deletionSeedState);
  await deletionSeedClient.flush();

  const deletingClient = createClient();
  const staleClient = createClient();
  await deletingClient.initialize();
  await staleClient.initialize();
  const deletingState = await deletingClient.signIn("recepic", "demo123");
  const staleState = await staleClient.signIn("ali", "demo123");
  deletingState.tables = deletingState.tables.filter(function (table) {
    return table.id !== "table-delete";
  });
  staleState.tables.find(function (table) {
    return table.id === "table-delete";
  }).name = "Eski ekrandan değişiklik";
  deletingClient.save(deletingState);
  await deletingClient.flush();
  staleClient.save(staleState);
  await staleClient.flush();

  assert.equal(
    valueAtPath("appState/tables").some(function (table) {
      return table.id === "table-delete";
    }),
    false
  );

  // Firebase boş diziyi saklamadığı için yeni liste `items` alanı olmadan gelebilir.
  sharedDatabase.appState.tables.push({
    id: "table-empty-from-firebase",
    name: "Firebase boş liste"
  });
  const emptyTableClient = createClient();
  await emptyTableClient.initialize();
  const emptyTableState = await emptyTableClient.signIn("recepic", "demo123");
  assert.deepEqual(
    emptyTableState.tables.find(function (table) {
      return table.id === "table-empty-from-firebase";
    }).items,
    []
  );

  // İki yönetici farklı kategori tanımları eklerse ikisi de ortak listede kalmalıdır.
  const firstDefinitionClient = createClient();
  const secondDefinitionClient = createClient();
  await firstDefinitionClient.initialize();
  await secondDefinitionClient.initialize();
  const firstDefinitionState = await firstDefinitionClient.signIn("recepic", "demo123");
  const secondDefinitionState = await secondDefinitionClient.signIn("ali", "demo123");
  firstDefinitionState.definitions.categories.push({
    id: "category-first",
    name: "Birinci kategori",
    footprintMode: "optional",
    footprints: []
  });
  secondDefinitionState.definitions.categories.push({
    id: "category-second",
    name: "İkinci kategori",
    footprintMode: "required",
    footprints: ["SOIC-8"]
  });
  firstDefinitionClient.save(firstDefinitionState);
  secondDefinitionClient.save(secondDefinitionState);
  await Promise.all([
    firstDefinitionClient.flush(),
    secondDefinitionClient.flush()
  ]);
  assert.deepEqual(
    valueAtPath("appState/definitions/categories").map(function (category) {
      return category.id;
    }).sort(),
    ["category-first", "category-second"]
  );

  // Toplu JSON içe aktarma çağrısı ancak Firebase yazısı tamamlandıktan sonra
  // çözülmeli ve bağımsız kılıf kataloğunu da ortak veriye taşımalıdır.
  const importClient = createClient();
  await importClient.initialize();
  const importSession = await importClient.signIn("recepic", "demo123");
  const importedState = await importClient.replace({
    schemaVersion: 6,
    users: importSession.users,
    tables: [{ id: "table-import", name: "İçe Aktarılan", items: [] }],
    logs: [],
    definitions: {
      categories: [{
        id: "category-import",
        name: "İçe aktarma kategorisi",
        footprintMode: "optional",
        footprints: ["TEST-8"]
      }],
      footprints: ["TEST-8", "TEST-16"]
    },
    session: importSession.session,
    settings: importSession.settings
  });
  assert.equal(importedState.tables[0].id, "table-import");
  assert.deepEqual(valueAtPath("appState/definitions/footprints"), ["TEST-8", "TEST-16"]);

  console.log("OK: Kullanıcılar, yetkiler, import, katalog ve eşzamanlı stok kayıtları kararlı.");
}()).catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
