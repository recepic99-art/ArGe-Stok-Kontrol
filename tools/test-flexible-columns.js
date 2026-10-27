"use strict";

// Firebase'e bağlanmadan, sütun şeması değişikliklerinin bulut yamasına
// gerçekten girdiğini doğrulayan küçük regresyon testi.
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

const cloud = {
  appState: {
    schemaVersion: 7,
    tables: [{
      id: "table-1",
      name: "Test Listesi",
      kind: "quality",
      columns: [
        { key: "materialName", label: "Malzeme Adı", fieldType: "text" },
        { key: "oldCustom", label: "Eski Alan", fieldType: "text", system: false }
      ],
      items: [{ id: "record-1", materialName: "Röle", oldCustom: "silinecek" }]
    }],
    logs: [],
    definitions: { categories: [], footprints: [] }
  }
};

function valueAt(path) {
  return path.reduce(function (value, key) {
    return value == null ? undefined : value[key];
  }, cloud);
}

function setAt(path, value) {
  let target = cloud;
  path.slice(0, -1).forEach(function (key) {
    if (!target[key]) target[key] = {};
    target = target[key];
  });
  target[path[path.length - 1]] = clone(value);
}

class FakeReference {
  constructor(path) {
    this.path = path;
  }

  child(key) {
    return new FakeReference(this.path.concat(key));
  }

  once() {
    const value = clone(valueAt(this.path));
    return Promise.resolve({ val: function () { return value; } });
  }

  set(value) {
    setAt(this.path, value);
    return Promise.resolve();
  }

  update(values) {
    const current = clone(valueAt(this.path)) || {};
    setAt(this.path, Object.assign(current, clone(values)));
    return Promise.resolve();
  }

  transaction(updater) {
    const next = updater(clone(valueAt(this.path)));
    setAt(this.path, next);
    const snapshotValue = clone(next);
    return Promise.resolve({ snapshot: { val: function () { return snapshotValue; } } });
  }

  on() {
    return function () {};
  }

  off() {}
}

const auth = {
  currentUser: null,
  setPersistence: function () { return Promise.resolve(); },
  onAuthStateChanged: function (callback) {
    callback(this.currentUser);
    return function () {};
  },
  signInAnonymously: function () {
    this.currentUser = { uid: "anonymous-test", isAnonymous: true, email: null };
    return Promise.resolve({ user: this.currentUser });
  },
  signInWithEmailAndPassword: function () {
    this.currentUser = {
      uid: "test-uid",
      email: "recepic@argestokkontrol.app",
      isAnonymous: false,
      displayName: "Test Yönetici",
      updateProfile: function () { return Promise.resolve(); }
    };
    return Promise.resolve({ user: this.currentUser });
  },
  signOut: function () {
    this.currentUser = null;
    return Promise.resolve();
  }
};

function firebaseAuth() {
  return auth;
}
firebaseAuth.Auth = { Persistence: { SESSION: "session" } };

const localValues = {};
const initialState = {
  schemaVersion: 11,
  tables: [],
  logs: [],
  definitions: { categories: [], footprints: [] },
  session: { operatorName: "Test", activeTableId: "", openTableIds: [] },
  settings: { columnWidths: {}, historyColumnWidths: {} }
};

const windowObject = {
  firebase: {
    apps: [],
    initializeApp: function () { this.apps.push({}); },
    auth: firebaseAuth,
    database: function () {
      return { ref: function (path) { return new FakeReference([path]); } };
    }
  },
  DepoFirebaseConfig: {},
  DepoAccessConfig: {
    administratorEmail: "recepic@argestokkontrol.app",
    administratorMinutes: 15
  },
  DepoData: {
    createInitialState: function () { return clone(initialState); },
    migrateLegacyState: function (state) {
      delete state.definitions;
      return state;
    }
  },
  localStorage: {
    getItem: function (key) { return localValues[key] || null; },
    setItem: function (key, value) { localValues[key] = value; }
  },
  sessionStorage: {
    getItem: function (key) { return localValues[key] || null; },
    setItem: function (key, value) { localValues[key] = value; },
    removeItem: function (key) { delete localValues[key]; }
  },
  performance: { getEntriesByType: function () { return [{ type: "navigate" }]; } },
  dispatchEvent: function () {}
};

const context = vm.createContext({
  window: windowObject,
  console: console,
  CustomEvent: function CustomEvent(type, options) {
    this.type = type;
    this.detail = options && options.detail;
  }
});

vm.runInContext(
  fs.readFileSync(require("path").join(__dirname, "..", "firebase-store-v4.js"), "utf8"),
  context
);

(async function () {
  const state = await windowObject.DepoStore.initialize();
  const table = state.tables[0];

  table.columns = [
    { key: "materialName", label: "Malzeme Adı", fieldType: "text", system: true },
    {
      key: "customResult",
      label: "Kontrol Sonucu",
      fieldType: "select",
      options: ["Uygun", "Uygun Değil"],
      system: false
    }
  ];
  table.deletedColumnKeys = ["oldCustom"];
  delete table.items[0].oldCustom;
  table.items[0].customResult = "Uygun";

  windowObject.DepoStore.save(state);
  await windowObject.DepoStore.flush();

  const savedTable = cloud.appState.tables[0];
  assert.deepStrictEqual(savedTable.deletedColumnKeys, ["oldCustom"]);
  assert.strictEqual(savedTable.columns[1].fieldType, "select");
  assert.deepStrictEqual(savedTable.columns[1].options, ["Uygun", "Uygun Değil"]);
  assert.strictEqual(savedTable.items[0].oldCustom, undefined);
  assert.strictEqual(savedTable.items[0].customResult, "Uygun");
  console.log("Esnek sütun Firebase yama testi başarılı.");
}()).catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
