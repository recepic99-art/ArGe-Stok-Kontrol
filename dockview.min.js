(function () {
  "use strict";

  const STORAGE_KEY = "arge-depo-dock-layout-v3";
  const panelTitles = {
    lists: "Listeler",
    users: "Kullanıcılar",
    stock: "Stok Listesi",
    "stock-card": "Stok Kartı",
    movement: "Giriş / Çıkış",
    history: "Hareket Geçmişi"
  };

  let api = null;
  let source = null;
  let saveTimer = null;
  const panelElements = new Map();
  const blockedPanels = new Set();

  function rememberPanel(id, element) {
    element.hidden = false;
    element.classList.add("dock-panel-body");
    panelElements.set(id, element);
  }

  function collectExistingPanels(workspace) {
    rememberPanel("lists", document.getElementById("lists-panel"));
    rememberPanel("users", document.getElementById("users-panel"));
    rememberPanel("stock", document.getElementById("stock-dock"));
    rememberPanel("stock-card", document.getElementById("stock-card-panel"));
    rememberPanel("movement", document.getElementById("movement-panel"));
    rememberPanel("history", workspace.querySelector(".history-dock"));
  }

  function createPanelRenderer(options) {
    const element = panelElements.get(options.name);
    return {
      element: element,
      init: function () {
        element.hidden = false;
      },
      dispose: function () {
        // Panel kapanınca içeriği silmeyiz. Görünüm menüsünden yeniden
        // açılabilmesi için görünmeyen kaynak alanına geri koyarız.
        if (source && element) source.appendChild(element);
      }
    };
  }

  function panelOptions(id) {
    const options = {
      id: id,
      component: id,
      title: panelTitles[id],
      minimumWidth: 1,
      minimumHeight: 1
    };

    if (!api || !api.panels.length) return options;

    if (id === "lists") {
      options.position = { direction: "left" };
      options.initialWidth = 250;
    } else if (id === "users" && api.getPanel("lists")) {
      options.position = { referencePanel: "lists" };
      options.inactive = true;
    } else if (id === "stock") {
      options.position = { direction: "right" };
    } else if (id === "stock-card" && api.getPanel("stock")) {
      options.position = { referencePanel: "stock", direction: "right" };
      options.initialWidth = 330;
    } else if (id === "movement" && api.getPanel("stock-card")) {
      options.position = { referencePanel: "stock-card" };
      options.inactive = true;
    } else if (id === "history" && api.getPanel("stock-card")) {
      options.position = { referencePanel: "stock-card", direction: "below" };
      options.initialHeight = 260;
    }

    return options;
  }

  function addDefaultPanels() {
    api.addPanel(panelOptions("stock"));
    api.addPanel(panelOptions("lists"));
    api.addPanel(panelOptions("users"));
    api.addPanel(panelOptions("stock-card"));
    api.addPanel(panelOptions("movement"));
    api.addPanel(panelOptions("history"));
    api.getPanel("stock").api.setActive();

    // Kütüphane ilk bölünmede alanı oransal dağıtır. Ekran çizildikten sonra
    // yalnızca varsayılan düzenin anlaşılır başlangıç ölçülerini veririz.
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        const root = document.getElementById("dockview-root");
        const lists = api.getPanel("lists");
        const stockCard = api.getPanel("stock-card");
        const history = api.getPanel("history");
        api.layout(root.clientWidth, root.clientHeight, true);
        if (lists) lists.group.api.setSize({ width: 250 });
        if (stockCard) stockCard.group.api.setSize({ width: 330 });
        if (history) history.group.api.setSize({ height: 230 });
      });
    });
  }

  function saveLayoutSoon() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      if (api) localStorage.setItem(STORAGE_KEY, JSON.stringify(api.toJSON()));
    }, 180);
  }

  function restoreLayout() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      addDefaultPanels();
      return;
    }

    try {
      api.fromJSON(JSON.parse(saved));
    } catch (error) {
      localStorage.removeItem(STORAGE_KEY);
      api.clear();
      addDefaultPanels();
    }
  }

  function initialize() {
    if (api) return;
    const workspace = document.getElementById("workspace-shell");
    if (!workspace || !window.dockview) return;

    collectExistingPanels(workspace);

    const root = document.createElement("div");
    root.id = "dockview-root";
    root.className = "dockview-root dockview-theme-light";

    source = document.createElement("div");
    source.id = "dock-panel-source";
    source.hidden = true;

    panelElements.forEach(function (element) {
      source.appendChild(element);
    });

    // Eski splitter ve sekme çubukları burada görünmeden kalır. Böylece ana
    // uygulamadaki eski olay bağlantıları hata üretmez.
    while (workspace.firstChild) source.appendChild(workspace.firstChild);
    workspace.append(root, source);

    api = window.dockview.createDockview(root, {
      createComponent: createPanelRenderer,
      singleTabMode: "fullwidth",
      floatingGroupBounds: "boundedWithinViewport"
    });

    restoreLayout();
    api.onDidLayoutChange(saveLayoutSoon);
  }

  function showPanel(id) {
    if (!api || blockedPanels.has(id)) return;
    let panel = api.getPanel(id);
    if (!panel) panel = api.addPanel(panelOptions(id));
    panel.api.setActive();
  }

  function setPanelAllowed(id, allowed) {
    if (!api) return;
    if (allowed) {
      blockedPanels.delete(id);
      return;
    }

    blockedPanels.add(id);
    const panel = api.getPanel(id);
    if (panel) api.removePanel(panel);
  }

  function setTheme(theme) {
    const root = document.getElementById("dockview-root");
    if (!root) return;
    root.classList.toggle("dockview-theme-dark", theme === "dark");
    root.classList.toggle("dockview-theme-light", theme !== "dark");
  }

  function reset() {
    if (!api) return;
    localStorage.removeItem(STORAGE_KEY);
    api.clear();
    addDefaultPanels();
    saveLayoutSoon();
  }

  window.DepoDock = {
    initialize: initialize,
    showPanel: showPanel,
    setPanelAllowed: setPanelAllowed,
    setTheme: setTheme,
    reset: reset
  };
}());
