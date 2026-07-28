const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");

const storeSource = fs.readFileSync(
  require("node:path").join(__dirname, "..", "firebase-store-v4.js"),
  "utf8"
);

const initialUsers = [
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
    schemaVersion: 3,
    users: clone(initialUsers),
    tables: [],
    logs: [],
    rolesByUid: {}
  }
};

const accounts = {
  "recep@argestokkontrol.app": {
    uid: "uid-recep",
    displayName: "Recep İç"
  },
  "ali@argestokkontrol.app": {
    uid: "uid-ali",
    displayName: "Ali"
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function valueAtPath(path) {
  return path.split("/").filter(Boolean).reduce(function (value, key) {
    return value && value[key];
  }, sharedDatabase);
}

function writeAtPath(path, value) {
  const keys = path.split("/").filter(Boolean);
  let target = sharedDatabase;
  keys.slice(0, -1).forEach(function (key) {
    if (!target[key]) target[key] = {};
    target = target[key];
  });
  target[keys.at(-1)] = clone(value);
}

function createClient() {
  let currentUser = null;
  const localValues = new Map();
  const listeners = [];

  const auth = {
    currentUser: null,
    async signInWithEmailAndPassword(email) {
      const account = accounts[email];
      if (!account) throw new Error("Kullanıcı bulunamadı.");
      currentUser = {
        uid: account.uid,
        displayName: account.displayName,
        async updateProfile(profile) {
          this.displayName = profile.displayName;
        }
      };
      auth.currentUser = currentUser;
      return { user: currentUser };
    },
    async createUserWithEmailAndPassword(email) {
      return auth.signInWithEmailAndPassword(email);
    },
    async signOut() {
      auth.currentUser = null;
    }
  };

  const reference = {
    async once() {
      return { val: function () { return clone(sharedDatabase.appState); } };
    },
    async update(updates) {
      Object.keys(updates).forEach(function (path) {
        writeAtPath("appState/" + path, updates[path]);
      });
      listeners.forEach(function (listener) {
        listener({ val: function () { return clone(sharedDatabase.appState); } });
      });
    },
    on(eventName, listener) {
      listeners.push(listener);
      return listener;
    },
    off() {}
  };

  const window = {
    firebase: {
      apps: [],
      initializeApp() {
        this.apps.push({});
      },
      auth: function () { return auth; },
      database: function () {
        return { ref: function () { return reference; } };
      }
    },
    DepoFirebaseConfig: {},
    DepoData: {
      createInitialState: function () {
        return {
          schemaVersion: 3,
          users: clone(initialUsers),
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
      getItem(key) { return localValues.get(key) || null; },
      setItem(key, value) { localValues.set(key, value); }
    },
    dispatchEvent() {}
  };

  vm.runInNewContext(storeSource, {
    window: window,
    console: console,
    CustomEvent: class CustomEvent {}
  });
  return window.DepoStore;
}

(async function () {
  const memberClient = createClient();
  await memberClient.initialize();
  const memberState = await memberClient.register("ali", "demo123", "Ali");

  assert.equal(
    memberState.users.find(function (user) { return user.username === "ali"; }).role,
    "member"
  );

  // Eski sürümün listeyi yalnızca ikinci kullanıcıyla ezdiği bozuk durumu
  // taklit ederiz. Yeni sürüm başlangıç yöneticisini yine bulabilmelidir.
  sharedDatabase.appState.users = [
    {
      id: "user-uid-ali",
      username: "ali",
      name: "Ali",
      authUid: "uid-ali",
      role: "admin"
    }
  ];
  sharedDatabase.appState.userDirectory["uid-ali"].role = "admin";
  sharedDatabase.appState.rolesByUid["uid-ali"] = "admin";

  const administratorClient = createClient();
  await administratorClient.initialize();
  const administratorState = await administratorClient.signIn("recep", "demo123");

  assert.equal(
    administratorState.users.find(function (user) { return user.username === "recep"; }).role,
    "admin"
  );

  const freshMemberClient = createClient();
  await freshMemberClient.initialize();
  const freshMemberState = await freshMemberClient.signIn("ali", "demo123");
  const visibleUsers = freshMemberState.users.filter(function (user) {
    return Boolean(user.authUid);
  });

  assert.deepEqual(
    visibleUsers.map(function (user) { return user.username; }).sort(),
    ["ali", "recep"]
  );
  assert.equal(Object.keys(valueAtPath("appState/userDirectory")).length, 2);
  console.log("OK: İki temiz tarayıcı ortak kullanıcı dizinini görüyor.");
}()).catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
