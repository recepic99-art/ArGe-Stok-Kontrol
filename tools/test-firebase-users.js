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

const sharedDatabase = {
  appState: {
    schemaVersion: 11,
    tables: [],
    logs: []
  }
};

const accounts = {
  "recepic@argestokkontrol.app": {
    uid: "uid-recepic",
    displayName: "Recep İç",
    password: "demo123"
  }
};

const cloudListeners = [];
let anonymousSequence = 0;

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
  const sessionValues = new Map();
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
    async signInAnonymously() {
      anonymousSequence += 1;
      const user = {
        uid: "anonymous-" + anonymousSequence,
        email: null,
        displayName: "",
        isAnonymous: true
      };
      auth.currentUser = user;
      return { user: user };
    },
    async signInWithEmailAndPassword(email, password) {
      const account = accounts[email];
      if (!account || account.password !== password) {
        const error = new Error("Parola hatalı.");
        error.code = "auth/wrong-password";
        throw error;
      }
      const user = {
        uid: account.uid,
        email: email,
        displayName: account.displayName,
        isAnonymous: false
      };
      auth.currentUser = user;
      return { user: user };
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
    DepoAccessConfig: {
      administratorEmail: "recepic@argestokkontrol.app",
      administratorMinutes: 15
    },
    DepoData: {
      stockColumnDefinitions: [
        { key: "id", label: "ID", fieldType: "text", editable: false },
        { key: "name", label: "Malzeme Adı", fieldType: "text" },
        { key: "category", label: "Cins/Kategori", fieldType: "select" },
        { key: "footprint", label: "Kılıf", fieldType: "select" }
      ],
      qualityColumnDefinitions: [],
      migrateLegacyState: function (state) {
        return window.DepoCatalog.migrateLegacyState(state, {
          stock: this.stockColumnDefinitions,
          quality: this.qualityColumnDefinitions
        });
      },
      createInitialState: function () {
        return {
          schemaVersion: 11,
          tables: [],
          logs: [],
          session: {
            operatorName: "",
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
    sessionStorage: {
      getItem(key) {
        return sessionValues.get(key) || null;
      },
      setItem(key, value) {
        sessionValues.set(key, value);
      },
      removeItem(key) {
        sessionValues.delete(key);
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
  window.DepoStore.testAuthUser = function () {
    return clone(auth.currentUser);
  };
  return window.DepoStore;
}

(async function () {
  const accessClient = createClient("reload");
  const anonymousState = await accessClient.initialize();
  assert.equal(accessClient.testPersistence(), "SESSION");
  assert.equal(accessClient.testAuthUser().isAnonymous, true);
  assert.equal(accessClient.isAdministrator(), false);
  assert.equal(Object.prototype.hasOwnProperty.call(anonymousState, "users"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(anonymousState.session, "currentUserId"), false);

  await assert.rejects(
    accessClient.enterAdministrator("yanlis-parola"),
    /Yönetici parolası hatalı/
  );
  assert.equal(accessClient.testAuthUser().isAnonymous, true);

  const administratorState = await accessClient.enterAdministrator("demo123");
  assert.equal(accessClient.testAuthUser().email, "recepic@argestokkontrol.app");
  assert.equal(accessClient.isAdministrator(), true);
  assert.equal(Object.prototype.hasOwnProperty.call(administratorState, "users"), false);

  // Aynı sekmede F5 benzeri yeniden başlatma yönetici süresini korur.
  await accessClient.initialize();
  assert.equal(accessClient.isAdministrator(), true);

  // Yönetici modu kapatıldığında görünmeyen anonim hesaba geri dönülür.
  await accessClient.exitAdministrator();
  assert.equal(accessClient.isAdministrator(), false);
  assert.equal(accessClient.testAuthUser().isAnonymous, true);

  const setupClient = createClient();
  const setupState = await setupClient.initialize();
  setupState.tables.push({ id: "table-test", name: "Test", items: [] });
  setupClient.save(setupState);
  await setupClient.flush();

  // İki bilgisayar aynı anda liste oluşturduğunda son yazan ilk listeyi ezmemelidir.
  const firstInventoryClient = createClient();
  const secondInventoryClient = createClient();
  await firstInventoryClient.initialize();
  await secondInventoryClient.initialize();
  const firstInventoryState = await firstInventoryClient.initialize();
  const secondInventoryState = await secondInventoryClient.initialize();

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
  const firstItemState = await firstItemClient.initialize();
  const secondItemState = await secondItemClient.initialize();
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
  const seedState = await seedClient.initialize();
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
  const firstMovementState = await firstMovementClient.initialize();
  const secondMovementState = await secondMovementClient.initialize();
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
  const rapidState = await rapidClient.initialize();
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
  const deletionSeedState = await deletionSeedClient.initialize();
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
  const deletingState = await deletingClient.initialize();
  const staleState = await staleClient.initialize();
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
  const emptyTableState = await emptyTableClient.initialize();
  assert.deepEqual(
    emptyTableState.tables.find(function (table) {
      return table.id === "table-empty-from-firebase";
    }).items,
    []
  );

  // Eski Firebase verisi yalnız bellekte dönüşmemeli; ilk girişte kategori ve
  // kılıf seçenekleri tablo şemasına kalıcı olarak yazılmalıdır.
  sharedDatabase.appState.tables.push({
    id: "table-legacy-catalog",
    name: "Eski Stok",
    kind: "stock",
    items: [{ id: "legacy-item", category: "Analog IC", footprint: "SOIC-8" }]
  });
  sharedDatabase.appState.definitions = {
    categories: [{ id: "category-analog", name: "Analog IC" }],
    footprints: ["SOIC-8"]
  };
  const legacyMigrationClient = createClient();
  await legacyMigrationClient.initialize();
  const legacyMigrationState = await legacyMigrationClient.initialize();
  assert.equal(Object.prototype.hasOwnProperty.call(legacyMigrationState, "definitions"), false);
  const migratedCloudTable = valueAtPath("appState/tables").find(function (table) {
    return table.id === "table-legacy-catalog";
  });
  assert.deepEqual(
    migratedCloudTable.columns.find(function (column) { return column.key === "category"; }).options,
    ["Analog IC"]
  );
  assert.deepEqual(
    migratedCloudTable.columns.find(function (column) { return column.key === "footprint"; }).options,
    ["SOIC-8"]
  );

  // Eski JSON içe aktarması ayrı kategori/kılıf kataloglarını bir kez gerçek
  // combobox sütunlarına taşımalı ve kayıt ancak Firebase yazısı bitince dönmelidir.
  const importClient = createClient();
  await importClient.initialize();
  const importSession = await importClient.initialize();
  const importedState = await importClient.replace({
    schemaVersion: 7,
    tables: [{ id: "table-import", name: "İçe Aktarılan", kind: "stock", items: [] }],
    logs: [],
    definitions: {
      categories: [{
        id: "category-import",
        name: "İçe aktarma kategorisi"
      }],
      footprints: ["TEST-8", "TEST-16"]
    },
    session: importSession.session,
    settings: importSession.settings
  });
  assert.equal(importedState.tables[0].id, "table-import");
  assert.equal(Object.prototype.hasOwnProperty.call(importedState, "definitions"), false);
  const importedCloudTable = valueAtPath("appState/tables").find(function (table) {
    return table.id === "table-import";
  });
  assert.deepEqual(
    importedCloudTable.columns.find(function (column) { return column.key === "category"; }).options,
    ["İçe aktarma kategorisi"]
  );
  assert.deepEqual(
    importedCloudTable.columns.find(function (column) { return column.key === "footprint"; }).options,
    ["TEST-8", "TEST-16"]
  );

  console.log("OK: Anonim erişim, yönetici kilidi, eski JSON geçişi ve eşzamanlı stok kayıtları kararlı.");
}()).catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
