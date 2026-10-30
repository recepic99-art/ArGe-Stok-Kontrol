(async function () {
  "use strict";

  let state = window.DepoData.createInitialState();

  // Yalnızca o anki ekranda gereken geçici bilgiler ana JSON dosyasına yazılmaz.
  const ui = {
    leftTab: "lists",
    rightTab: "stock-card",
    activeItemId: null,
    formMode: "existing",
    formItemId: null,
    checkedIds: new Set(),
    sortKey: "name",
    sortDirection: "asc",
    formModalSubmit: null,
    formModalBusy: false,
    contextTableId: null,
    bomRows: [],
    draggedColumn: null,
    isResizingColumn: false,
    suppressColumnClick: false,
    definitionTableId: "",
    definitionColumnKey: "",
    administratorFailures: 0,
    administratorLockedUntil: 0,
    accessModeChanging: false
  };

  let dynamicFieldCombos = [];

  const $ = function (id) {
    return document.getElementById(id);
  };

  const defaultColumnWidths = {
    id: 100,
    name: 180,
    category: 150,
    footprint: 100,
    box: 90,
    quantity: 90,
    unit: 85,
    critical: 110,
    description: 230,
    updatedAt: 145
  };

  const qualityDefaultColumnWidths = {
    materialName: 180,
    supplier: 150,
    incomingQuantity: 105,
    sampleQuantity: 110,
    controlMethod: 220,
    approvalStatus: 120,
    checkedBy: 130,
    checkedAt: 130,
    description: 230,
    updatedAt: 145
  };

  const columnTypeLabels = {
    text: "Metin",
    multiline: "Uzun metin",
    number: "Sayı",
    date: "Tarih",
    checkbox: "Checkbox",
    select: "Combobox"
  };

  const defaultHistoryColumnWidths = {
    date: 145,
    itemName: 180,
    type: 80,
    quantity: 75,
    purpose: 210,
    user: 120,
    note: 180,
    before: 75,
    after: 75
  };

  // ---------------------------------------------------------------------------
  // Genel yardımcılar
  // ---------------------------------------------------------------------------

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeText(value) {
    return String(value || "")
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .replace(/[^a-z0-9]+/g, "");
  }

  function uid(prefix) {
    const random = Math.random().toString(36).slice(2, 9).toUpperCase();
    return prefix + "-" + random;
  }

  function nowText() {
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date()).replace(",", "");
  }

  function saveState() {
    if (!window.DepoStore.save(state)) {
      showToast("JSON veri dosyası bağlı değil.", true);
    }
  }

  function showToast(message, isError) {
    const toast = document.createElement("div");
    toast.className = "toast" + (isError ? " is-error" : "");
    toast.textContent = message;
    $("toast-region").appendChild(toast);
    window.setTimeout(function () {
      toast.remove();
    }, 3600);
  }

  function friendlyErrorMessage(error, fallback) {
    const message = String(error && error.message || "");
    if (/permission.denied|permission_denied/i.test(message)) {
      return "Bu işlem için yetkiniz bulunmuyor.";
    }
    if (/network|failed to fetch|offline/i.test(message)) {
      return "Bağlantı kurulamadı. İnternet bağlantısını kontrol edin.";
    }
    if (/invalid-credential|wrong-password|invalid-login-credentials/i.test(message)) {
      return "Mevcut şifre hatalı.";
    }
    if (/operation-not-allowed|admin-restricted-operation/i.test(message)) {
      return "Firebase Authentication içinde Anonim giriş sağlayıcısını etkinleştirin.";
    }
    if (/email-already-in-use/i.test(message)) {
      return "Bu kullanıcı adı kullanılıyor. Daha özgün bir ad seçin.";
    }
    if (/cannot (read|set)|undefined|null|is not a function/i.test(message)) {
      return fallback || "Beklenmeyen bir arayüz hatası oluştu.";
    }
    // Bilinmeyen İngilizce geliştirici mesajlarını kullanıcıya göstermeyiz.
    // Türkçe doğrulama mesajları olduğu gibi kalır; diğerleri anlaşılır özete döner.
    if (message && /[çğıöşüÇĞİÖŞÜ]/.test(message)) return message;
    return fallback || "İşlem tamamlanamadı.";
  }

  function isTechnicalError(error) {
    return /cannot (read|set)|undefined|null|is not a function/i.test(
      String(error && error.message || "")
    );
  }

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type: type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function currentOperatorName() {
    return String(state.session.operatorName || "Kullanıcı").trim() || "Kullanıcı";
  }

  function currentUserIsAdmin() {
    return Boolean(window.DepoStore && window.DepoStore.isAdministrator());
  }

  function requireAdministrator(resume) {
    if (currentUserIsAdmin()) {
      window.DepoStore.touchAdministratorSession();
      return true;
    }
    openAdministratorPrompt(resume);
    return false;
  }

  function tableById(tableId) {
    return state.tables.find(function (table) {
      return table.id === tableId;
    }) || null;
  }

  function activeTableReference() {
    const table = tableById(state.session.activeTableId);
    return table ? { table: table } : null;
  }

  function selectedItemIds() {
    if (ui.checkedIds.size) return Array.from(ui.checkedIds);
    return ui.activeItemId ? [ui.activeItemId] : [];
  }

  function activeItem() {
    const active = activeTableReference();
    if (!active || !ui.activeItemId) return null;
    return active.table.items.find(function (item) {
      return item.id === ui.activeItemId;
    }) || null;
  }

  function tableKind(table) {
    if (!table) return "stock";
    if (table.kind) return table.kind;
    return normalizeText(table.name).includes("kalitekontrol") ? "quality" : "stock";
  }

  function normalizedColumnType(column, fallback) {
    const candidate = column && column.fieldType || fallback && fallback.fieldType;
    if (Object.prototype.hasOwnProperty.call(columnTypeLabels, candidate)) return candidate;
    if ((column && column.numeric) || (fallback && fallback.numeric)) return "number";
    return "text";
  }

  function normalizedColumnOptions(value) {
    const seen = new Set();
    return (Array.isArray(value) ? value : []).map(function (option) {
      return String(option == null ? "" : option).trim();
    }).filter(function (option) {
      const key = normalizeText(option);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function itemOptionsForColumn(key) {
    return normalizedColumnOptions(state.tables.flatMap(function (table) {
      return (Array.isArray(table.items) ? table.items : []).map(function (item) {
        return item[key];
      });
    }));
  }

  function reusableColumnOptions(key, currentTable) {
    const sourceTable = state.tables.find(function (table) {
      if (table === currentTable || !Array.isArray(table.columns)) return false;
      return table.columns.some(function (column) {
        return column.key === key && Array.isArray(column.options) && column.options.length;
      });
    });
    if (sourceTable) {
      const sourceColumn = sourceTable.columns.find(function (column) { return column.key === key; });
      return normalizedColumnOptions(sourceColumn.options);
    }
    return itemOptionsForColumn(key);
  }

  function defaultColumnsForKind(kind, currentTable) {
    const definitions = kind === "quality"
      ? window.DepoData.qualityColumnDefinitions
      : window.DepoData.stockColumnDefinitions;
    return definitions.map(function (column) {
      let options = normalizedColumnOptions(column.options);
      if (!options.length && kind === "stock" && ["category", "footprint"].includes(column.key)) {
        options = reusableColumnOptions(column.key, currentTable);
      }
      return {
        key: column.key,
        label: column.label,
        visible: true,
        width: (kind === "quality" ? qualityDefaultColumnWidths : defaultColumnWidths)[column.key] || 120,
        system: true,
        fieldType: normalizedColumnType(column),
        options: options,
        editable: column.editable !== false,
        integer: Boolean(column.integer),
        numeric: normalizedColumnType(column) === "number"
      };
    });
  }

  function ensureTableColumns(table) {
    if (!table) return [];
    const kind = tableKind(table);
    table.kind = kind;
    const defaults = defaultColumnsForKind(kind, table);
    const deletedKeys = new Set(Array.isArray(table.deletedColumnKeys) ? table.deletedColumnKeys : []);
    const existingLooksLikeStock = kind === "quality" && Array.isArray(table.columns) &&
      table.columns.some(function (column) { return ["category", "footprint", "critical"].includes(column.key); }) &&
      !table.columns.some(function (column) { return column.key === "materialName"; });
    const hasStoredColumns = Array.isArray(table.columns) && !existingLooksLikeStock;
    const existing = hasStoredColumns
      ? table.columns.slice()
      : (kind === "stock"
        ? state.settings.columnOrder.map(function (key) {
          const column = defaults.find(function (entry) { return entry.key === key; });
          return column ? {
            key: key,
            label: column.label,
            visible: state.settings.visibleColumns.includes(key),
            width: (state.settings.columnWidths || {})[key] || defaultColumnWidths[key] || 120,
            system: true,
            fieldType: column.fieldType,
            options: normalizedColumnOptions(column.options),
            editable: column.editable,
            integer: column.integer,
            numeric: column.numeric
          } : null;
        }).filter(Boolean)
        : defaults);
    const byKey = new Map(existing.map(function (column) { return [column.key, column]; }));
    defaults.forEach(function (column) {
      if (!byKey.has(column.key) && !deletedKeys.has(column.key)) existing.push(column);
    });
    const seenKeys = new Set();
    table.columns = existing.filter(function (column) {
      if (!column || !column.key || deletedKeys.has(column.key) || seenKeys.has(column.key)) return false;
      seenKeys.add(column.key);
      return true;
    }).map(function (column) {
      const fallback = defaults.find(function (entry) { return entry.key === column.key; }) || {};
      const fieldType = normalizedColumnType(column, fallback);
      let options = normalizedColumnOptions(
        Array.isArray(column.options) ? column.options : fallback.options
      );
      if (!options.length && kind === "stock" && ["category", "footprint"].includes(column.key)) {
        options = reusableColumnOptions(column.key, table);
      }
      return {
        key: column.key,
        label: column.label || fallback.label || column.key,
        visible: column.visible !== false,
        width: Math.max(55, Number(column.width) || fallback.width || 120),
        system: column.system === true || fallback.system === true,
        fieldType: fieldType,
        options: options,
        editable: column.editable !== false && fallback.editable !== false,
        integer: Boolean(column.integer || fallback.integer),
        numeric: fieldType === "number"
      };
    });
    table.deletedColumnKeys = Array.from(deletedKeys);
    return table.columns;
  }

  function tableHasColumn(table, key) {
    return Boolean(tableColumn(table, key));
  }

  function tableColumn(table, key) {
    if (!table) return null;
    return ensureTableColumns(table).find(function (column) {
      return column.key === key;
    }) || null;
  }

  function tableHasNumberColumn(table, key) {
    const column = tableColumn(table, key);
    return Boolean(column && column.fieldType === "number");
  }

  function activeTableKind() {
    const active = activeTableReference();
    return active ? tableKind(active.table) : "stock";
  }

  function stockLikeActiveTable() {
    return activeTableKind() === "stock";
  }

  function integerValue(input, fallback) {
    const value = Number(input.value);
    return Number.isInteger(value) ? value : fallback;
  }

  function ensureValidSession() {
    state.session.openTableIds = state.session.openTableIds.filter(function (tableId) {
      return Boolean(tableById(tableId));
    });

    if (state.session.activeTableId && !state.session.openTableIds.includes(state.session.activeTableId)) {
      state.session.activeTableId = "";
    }

    state.tables.forEach(function (table) {
      ensureTableColumns(table);
    });
  }

  // ---------------------------------------------------------------------------
  // Firebase bağlantısı ve geçici yönetici modu
  // ---------------------------------------------------------------------------

  function showAuthError(message) {
    $("auth-error").textContent = message;
    $("auth-error").hidden = false;
    $("connection-retry").hidden = false;
  }

  function showAuthLoading() {
    $("auth-title").textContent = "Bağlantı kuruluyor";
    $("auth-subtitle").textContent = "Firebase ortak verisi hazırlanıyor";
    $("auth-loading").hidden = false;
    $("auth-error").hidden = true;
    $("connection-retry").hidden = true;
  }

  function hideAuthLoading() {
    $("auth-loading").hidden = true;
  }

  function updateFileStatus() {
    const fileName = window.DepoStore.fileName();
    $("auth-json-status").textContent = fileName || "Dosya seçilmedi";
    $("json-file-button").textContent = fileName || "JSON bağlı değil";
    $("json-file-button").title = fileName
      ? "Bağlı JSON dosyası: " + fileName
      : "JSON veri dosyası seçilmedi";
  }

  function useLoadedState(loaded) {
    state = loaded;
    ui.activeItemId = null;
    ui.checkedIds.clear();
    ui.formItemId = null;
    ensureValidSession();
    applySettings();
    updateFileStatus();
    $("auth-error").hidden = true;
  }

  function openApplication() {
    ensureValidSession();
    $("auth-overlay").hidden = true;
    $("app").setAttribute("aria-hidden", "false");
    applySettings();
    renderAll(true);
    window.DepoStore.watch(function (cloudState) {
      cloudState.session.operatorName = state.session.operatorName;
      state = cloudState;
      ensureValidSession();
      renderAll(false);
    });
  }

  function openAdministratorPrompt(resume) {
    const remainingLock = Math.ceil((ui.administratorLockedUntil - Date.now()) / 1000);
    if (remainingLock > 0) {
      showToast("Çok fazla hatalı deneme yapıldı. " + remainingLock + " saniye bekleyin.", true);
      return;
    }
    openFormModal({
      title: "Yönetici modu",
      message: "Bu işlem yönetici yetkisi gerektiriyor. Ortak yönetici parolasını yazın.",
      fields: [
        {
          name: "password",
          label: "Yönetici parolası",
          type: "password",
          autocomplete: "current-password",
          required: true
        }
      ],
      submitLabel: "Yönetici Moduna Geç",
      onSubmit: async function (values) {
        try {
          const loaded = await window.DepoStore.enterAdministrator(values.password);
          ui.administratorFailures = 0;
          ui.administratorLockedUntil = 0;
          useLoadedState(loaded);
          renderAll(true);
          showToast("Yönetici modu açıldı.");
          if (typeof resume === "function") {
            window.setTimeout(resume, 0);
          }
          return true;
        } catch (error) {
          ui.administratorFailures += 1;
          if (ui.administratorFailures >= 5) {
            ui.administratorFailures = 0;
            ui.administratorLockedUntil = Date.now() + 30000;
            throw new Error("Çok fazla hatalı deneme yapıldı. 30 saniye bekleyin.");
          }
          throw error;
        }
      }
    });
  }

  async function exitAdministratorMode(showMessage) {
    if (ui.accessModeChanging) return;
    ui.accessModeChanging = true;
    try {
      const loaded = await window.DepoStore.exitAdministrator();
      useLoadedState(loaded);
      renderAll(true);
      if (showMessage !== false) showToast("Yönetici modu kapatıldı.");
    } catch (error) {
      showToast(friendlyErrorMessage(error, "Normal kullanıcı moduna dönülemedi."), true);
    } finally {
      ui.accessModeChanging = false;
    }
  }

  function checkAdministratorExpiration() {
    if (ui.accessModeChanging) return;
    if (window.DepoStore.hasAdministratorIdentity() && !currentUserIsAdmin()) {
      exitAdministratorMode(false);
      showToast("Yönetici modu süre dolduğu için kapatıldı.");
    }
  }

  // ---------------------------------------------------------------------------
  // Ana ekranın çizilmesi
  // ---------------------------------------------------------------------------

  function applySettings() {
    const settings = state.settings;
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.setProperty("--left-width", settings.leftWidth + "px");
    document.documentElement.style.setProperty("--right-width", settings.rightWidth + "px");
    document.documentElement.style.setProperty("--history-height", settings.historyHeight + "%");
    $("app").classList.toggle("left-collapsed", Boolean(settings.leftCollapsed));
    $("app").classList.toggle("right-collapsed", Boolean(settings.rightCollapsed));
    const collapseLeft = $("collapse-left");
    const collapseRight = $("collapse-right");
    if (collapseLeft) collapseLeft.textContent = settings.leftCollapsed ? "›" : "‹";
    if (collapseRight) collapseRight.textContent = settings.rightCollapsed ? "‹" : "›";
    if (window.DepoDock) window.DepoDock.setTheme(settings.theme);

    document.querySelectorAll("[data-theme-check]").forEach(function (check) {
      check.textContent = check.dataset.themeCheck === settings.theme ? "✓" : "";
    });
  }

  function renderAll(forceForm) {
    ensureValidSession();
    [
      ["Üst bilgi", renderHeader],
      ["Listeler", renderListsPanel],
      ["Açık liste sekmeleri", renderOpenTableTabs],
      ["Stok tablosu", renderStockTable],
      ["Stok kartı", function () { syncStockForm(Boolean(forceForm)); }],
      ["Giriş/çıkış", syncMovementForm],
      ["Hareket geçmişi", renderHistory],
      ["Yetkiler", applyPermissionView]
    ].forEach(function (step) {
      try {
        step[1]();
      } catch (error) {
        // Dock sürüklenirken bir panel kısa süreliğine DOM dışında kalabilir.
        // Tek paneldeki çizim hatası uygulamanın kalanını kilitlememelidir.
        console.error(step[0] + " bölümü güncellenemedi.", error);
      }
    });
  }

  function renderHeader() {
    const active = activeTableReference();
    const isAdministrator = currentUserIsAdmin();
    const fileName = window.DepoStore.fileName() || "JSON bağlı değil";
    const context = fileName + (active ? " / " + active.table.name : "");
    $("header-context").textContent = context;
    const accessLabel = isAdministrator ? "Yönetici" : "Kullanıcı";
    $("current-user-button").textContent = accessLabel;
    $("current-user-button").title = "Yetki seviyesi: " + accessLabel;
    $("enter-admin-menu").hidden = isAdministrator;
    $("exit-admin-menu").hidden = !isAdministrator;
    updateFileStatus();
  }

  function renderListsPanel() {
    $("lists-summary").textContent = state.tables.length + " liste";
    $("table-list").innerHTML = state.tables.map(function (table) {
      const isActive = state.session.activeTableId === table.id;
      const itemCount = Array.isArray(table.items) ? table.items.length : 0;
      return '<button class="table-list-item' + (isActive ? " is-active" : "") +
        '" data-table-id="' + escapeHtml(table.id) + '" type="button">' +
        '<span>' + escapeHtml(table.name) + '</span>' +
        '<small class="table-count">' + itemCount + '</small></button>';
    }).join("");
  }

  function setLeftTab(tab) {
    ui.leftTab = tab;
    document.querySelectorAll("[data-left-tab]").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.leftTab === tab);
    });
    if (window.DepoDock) window.DepoDock.showPanel(tab);
  }

  function renderOpenTableTabs() {
    const validTableIds = state.session.openTableIds.filter(function (tableId) {
      return Boolean(tableById(tableId));
    });
    state.session.openTableIds = validTableIds;

    $("open-table-tabs").innerHTML = validTableIds.map(function (tableId) {
      const table = tableById(tableId);
      const activeClass = tableId === state.session.activeTableId ? " is-active" : "";
      return '<div class="table-tab' + activeClass + '" data-table-id="' + escapeHtml(tableId) +
        '" role="tab" title="' + escapeHtml(table.name) + '">' +
        '<span class="table-tab-label">' + escapeHtml(table.name) + '</span>' +
        '<button class="tab-close" data-close-table-id="' + escapeHtml(tableId) +
        '" title="Sekmeyi kapat" aria-label="Sekmeyi kapat">×</button></div>';
    }).join("");

    const hasActive = Boolean(activeTableReference());
    $("open-table-tabs").hidden = !validTableIds.length;
    $("stock-table-region").hidden = !hasActive;
    $("empty-table-state").hidden = hasActive;
  }

  function openTable(tableId) {
    if (!tableById(tableId)) return;
    if (!state.session.openTableIds.includes(tableId)) state.session.openTableIds.push(tableId);
    state.session.activeTableId = tableId;
    ui.activeItemId = null;
    ui.checkedIds.clear();
    ui.formMode = "existing";
    ui.formItemId = null;
    saveState();
    renderAll(true);
  }

  function closeTable(tableId) {
    const index = state.session.openTableIds.indexOf(tableId);
    if (index < 0) return;
    state.session.openTableIds.splice(index, 1);
    if (state.session.activeTableId === tableId) {
      const replacement = state.session.openTableIds[Math.min(index, state.session.openTableIds.length - 1)];
      state.session.activeTableId = replacement || "";
    }
    ui.activeItemId = null;
    ui.checkedIds.clear();
    ui.formItemId = null;
    saveState();
    renderAll(true);
  }

  // ---------------------------------------------------------------------------
  // Stok tablosu, sıralama ve sütunlar
  // ---------------------------------------------------------------------------

  function ensureColumnWidthSettings() {
    state.settings.columnWidths = Object.assign(
      {},
      defaultColumnWidths,
      state.settings.columnWidths || {}
    );
    state.settings.historyColumnWidths = Object.assign(
      {},
      defaultHistoryColumnWidths,
      state.settings.historyColumnWidths || {}
    );
  }

  function savedColumnWidth(group, key) {
    ensureColumnWidthSettings();
    const active = activeTableReference();
    const tableColumn = active && group !== "history"
      ? ensureTableColumns(active.table).find(function (column) { return column.key === key; })
      : null;
    const widths = group === "history"
      ? state.settings.historyColumnWidths
      : state.settings.columnWidths;
    const fallback = group === "history"
      ? defaultHistoryColumnWidths[key]
      : (activeTableKind() === "quality" ? qualityDefaultColumnWidths[key] : defaultColumnWidths[key]);
    return Math.max(55, Number(tableColumn && tableColumn.width) || Number(widths[key]) || fallback || 100);
  }

  function columnWidthStyle(group, key) {
    const width = savedColumnWidth(group, key);
    return "width:" + width + "px;min-width:" + width + "px;max-width:" + width + "px";
  }

  function orderedVisibleColumns() {
    const active = activeTableReference();
    if (!active) return [];
    return ensureTableColumns(active.table).filter(function (column) {
      return column.visible !== false;
    });
  }

  function columnOptionValues(column) {
    if (!column) return [];
    return normalizedColumnOptions(column.options);
  }

  function checkboxValue(value) {
    if (value === true || value === 1) return true;
    return ["true", "1", "evet", "var", "onaylandi", "secili"].includes(normalizeText(value));
  }

  function dateInputValue(value) {
    const text = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const turkishDate = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (!turkishDate) return "";
    return turkishDate[3] + "-" + turkishDate[2].padStart(2, "0") + "-" +
      turkishDate[1].padStart(2, "0");
  }

  function tableCellText(column, value) {
    if (column.fieldType === "checkbox") return checkboxValue(value) ? "Evet" : "Hayır";
    return String(value == null ? "" : value);
  }

  function tableCellHtml(column, value) {
    if (column.fieldType === "checkbox") {
      return '<td class="checkbox-cell" data-stock-column="' + escapeHtml(column.key) +
        '" style="' + columnWidthStyle("stock", column.key) + '" title="' +
        (checkboxValue(value) ? "Evet" : "Hayır") + '"><input type="checkbox" disabled' +
        (checkboxValue(value) ? " checked" : "") + "></td>";
    }
    const text = tableCellText(column, value);
    return '<td data-stock-column="' + escapeHtml(column.key) + '" style="' +
      columnWidthStyle("stock", column.key) + '" title="' + escapeHtml(text) + '">' +
      escapeHtml(text) + "</td>";
  }

  function fuzzyMatch(query, item) {
    if (!query) return true;
    const normalizedQuery = normalizeText(query);
    const fields = Object.keys(item).map(function (key) {
      return normalizeText(item[key]);
    });
    if (fields.some(function (field) { return field.includes(normalizedQuery); })) return true;

    // Ufak yazım hatalarında, sorgu ile alanın ortak karakter oranına bakılır.
    return fields.some(function (field) {
      if (!field || normalizedQuery.length < 3) return false;
      const windowLength = Math.min(field.length, normalizedQuery.length + 2);
      for (let index = 0; index <= field.length - windowLength; index += 1) {
        if (similarity(normalizedQuery, field.slice(index, index + windowLength)) >= 0.74) return true;
      }
      return similarity(normalizedQuery, field) >= 0.76;
    });
  }

  function levenshtein(first, second) {
    if (!first.length) return second.length;
    if (!second.length) return first.length;
    const row = Array.from({ length: second.length + 1 }, function (_, index) { return index; });
    for (let i = 1; i <= first.length; i += 1) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= second.length; j += 1) {
        const old = row[j];
        row[j] = Math.min(
          row[j] + 1,
          row[j - 1] + 1,
          previous + (first[i - 1] === second[j - 1] ? 0 : 1)
        );
        previous = old;
      }
    }
    return row[second.length];
  }

  function similarity(first, second) {
    const left = normalizeText(first);
    const right = normalizeText(second);
    const longest = Math.max(left.length, right.length);
    if (!longest) return 1;
    return 1 - (levenshtein(left, right) / longest);
  }

  function filteredSortedItems() {
    const active = activeTableReference();
    if (!active) return [];
    const activeColumns = ensureTableColumns(active.table);
    if (!activeColumns.some(function (column) { return column.key === ui.sortKey; })) {
      ui.sortKey = (activeColumns[0] && activeColumns[0].key) || "id";
      ui.sortDirection = "asc";
    }
    const query = $("stock-search").value.trim();
    const supportsCriticalStock = stockLikeActiveTable() &&
      tableHasNumberColumn(active.table, "quantity") &&
      tableHasNumberColumn(active.table, "critical");
    const criticalOnly = supportsCriticalStock && $("critical-only").checked;
    const items = active.table.items.filter(function (item) {
      const isCritical = supportsCriticalStock && Number(item.quantity) <= Number(item.critical);
      return (!criticalOnly || isCritical) && fuzzyMatch(query, item);
    });
    const direction = ui.sortDirection === "asc" ? 1 : -1;
    const sortColumn = activeColumns.find(function (column) { return column.key === ui.sortKey; }) || {};
    return items.slice().sort(function (left, right) {
      const leftValue = left[ui.sortKey];
      const rightValue = right[ui.sortKey];
      if (sortColumn.fieldType === "number") {
        return ((Number(leftValue) || 0) - (Number(rightValue) || 0)) * direction;
      }
      if (sortColumn.fieldType === "checkbox") {
        return (Number(checkboxValue(leftValue)) - Number(checkboxValue(rightValue))) * direction;
      }
      if (sortColumn.fieldType === "date") {
        const leftDate = dateInputValue(leftValue) || String(leftValue || "");
        const rightDate = dateInputValue(rightValue) || String(rightValue || "");
        return leftDate.localeCompare(rightDate) * direction;
      }
      return String(leftValue || "").localeCompare(String(rightValue || ""), "tr", {
        numeric: true,
        sensitivity: "base"
      }) * direction;
    });
  }

  function stockClass(item) {
    if (!stockLikeActiveTable()) return "";
    const active = activeTableReference();
    if (!active || !tableHasNumberColumn(active.table, "quantity") ||
        !tableHasNumberColumn(active.table, "critical")) {
      return "";
    }
    const quantity = Number(item.quantity) || 0;
    const critical = Number(item.critical) || 0;
    if (quantity <= critical) return " stock-critical";
    if (quantity <= critical * 1.2) return " stock-warning";
    return "";
  }

  function renderStockTable() {
    const active = activeTableReference();
    if (!active) {
      $("stock-table-head").innerHTML = "";
      $("stock-table-body").innerHTML = "";
      $("stock-count").textContent = "0 malzeme / 0 seçili";
      return;
    }

    const columns = orderedVisibleColumns();
    const visibleItems = filteredSortedItems();
    const activeKind = activeTableKind();
    const allVisibleChecked = visibleItems.length > 0 && visibleItems.every(function (item) {
      return ui.checkedIds.has(item.id);
    });
    const supportsCriticalStock = activeKind === "stock" &&
      tableHasNumberColumn(active.table, "quantity") &&
      tableHasNumberColumn(active.table, "critical");
    $("critical-only").closest("label").hidden = !supportsCriticalStock;
    if (!supportsCriticalStock) $("critical-only").checked = false;
    $("stock-search").placeholder = activeKind === "quality"
      ? "Kalite kontrol kayıtlarında ara"
      : "Malzeme adı, ID, kategori, açıklama ara";

    $("stock-table-head").innerHTML =
      '<th class="select-cell" data-key="select" title="Görünenlerin tümünü seç">' +
      '<input id="select-all-items" type="checkbox"' + (allVisibleChecked ? " checked" : "") + '></th>' +
      columns.map(function (column) {
        const indicator = ui.sortKey === column.key
          ? '<span class="sort-indicator">' + (ui.sortDirection === "asc" ? "↑" : "↓") + "</span>"
          : "";
        return '<th draggable="true" data-key="' + escapeHtml(column.key) +
          '" data-stock-column="' + escapeHtml(column.key) + '" style="' +
          columnWidthStyle("stock", column.key) + '">' +
          escapeHtml(column.label) + indicator +
          '<span class="column-resizer" data-resize-stock="' +
          escapeHtml(column.key) + '"></span></th>';
      }).join("") +
      '<th class="columns-button" data-action="show-columns" title="Sütunları seç">+</th>';

    $("stock-table-body").innerHTML = visibleItems.map(function (item) {
      const selected = ui.activeItemId === item.id || ui.checkedIds.has(item.id);
      return '<tr data-item-id="' + escapeHtml(item.id) + '"' +
        ' class="' + (selected ? "is-selected" : "") + stockClass(item) + '">' +
        '<td class="select-cell" data-checkbox-item="' + escapeHtml(item.id) + '">' +
        '<input type="checkbox"' + (ui.checkedIds.has(item.id) ? " checked" : "") + '></td>' +
        columns.map(function (column) {
          return tableCellHtml(column, item[column.key]);
        }).join("") + "</tr>";
    }).join("");

    $("stock-count").textContent = active.table.items.length +
      (activeKind === "quality" ? " kayıt / " : " malzeme / ") + ui.checkedIds.size + " seçili";
  }

  function sortByColumn(key) {
    if (!orderedVisibleColumns().some(function (column) { return column.key === key; })) return;
    if (ui.sortKey === key) {
      ui.sortDirection = ui.sortDirection === "asc" ? "desc" : "asc";
    } else {
      ui.sortKey = key;
      ui.sortDirection = "asc";
    }
    renderStockTable();
  }

  function moveColumn(draggedKey, targetKey, placeAfter) {
    if (draggedKey === targetKey) return;
    const active = activeTableReference();
    if (!active) return;
    const columns = ensureTableColumns(active.table);
    const dragged = columns.find(function (column) { return column.key === draggedKey; });
    if (!dragged) return;
    const order = columns.filter(function (column) { return column.key !== draggedKey; });
    let targetIndex = order.findIndex(function (column) { return column.key === targetKey; });
    if (targetIndex < 0) return;
    if (placeAfter) targetIndex += 1;
    order.splice(targetIndex, 0, dragged);
    active.table.columns = order;
    saveState();
    renderStockTable();
  }

  function renderColumnsModal() {
    const active = activeTableReference();
    if (!active) {
      $("columns-list").innerHTML = '<div class="combo-empty">Önce bir liste açın.</div>';
      return;
    }
    $("columns-list").innerHTML = ensureTableColumns(active.table).map(function (column) {
      return '<label class="column-option"><input type="checkbox" data-column-key="' +
        escapeHtml(column.key) + '"' + (column.visible !== false ? " checked" : "") +
        "> " + escapeHtml(column.label) + "</label>";
    }).join("");
  }

  function addCustomColumn(name, targetTable, configuration) {
    const table = targetTable || (activeTableReference() || {}).table;
    if (!table) return null;
    const cleanName = String(name || "").trim();
    if (!cleanName) return null;
    const columns = ensureTableColumns(table);
    const config = configuration || {};
    const key = "custom_" + normalizeText(cleanName) + "_" + Math.random().toString(36).slice(2, 6);
    const fieldType = normalizedColumnType(config);
    const column = {
      key: key,
      label: cleanName,
      visible: true,
      width: 140,
      system: false,
      fieldType: fieldType,
      options: fieldType === "select" ? normalizedColumnOptions(config.options) : [],
      editable: true,
      integer: Boolean(config.integer),
      numeric: fieldType === "number"
    };
    columns.push(column);
    table.deletedColumnKeys = (table.deletedColumnKeys || []).filter(function (entry) {
      return entry !== key;
    });
    table.items.forEach(function (item) {
      item[key] = defaultValueForColumn(column);
    });
    return column;
  }

  function valueForColumnType(value, column) {
    if (column.fieldType === "checkbox") return checkboxValue(value);
    if (column.fieldType === "number") {
      if (value === "" || value == null) return "";
      const number = Number(value);
      if (!Number.isFinite(number)) return "";
      return column.integer ? Math.trunc(number) : number;
    }
    return String(value == null ? "" : value);
  }

  function normalizeColumnItemValues(table, column) {
    table.items.forEach(function (item) {
      if (!Object.prototype.hasOwnProperty.call(item, column.key)) {
        item[column.key] = defaultValueForColumn(column);
        return;
      }
      item[column.key] = valueForColumnType(item[column.key], column);
    });
  }

  function updateColumnVisibility(key, visible) {
    const active = activeTableReference();
    if (!active) return;
    const column = ensureTableColumns(active.table).find(function (entry) { return entry.key === key; });
    if (!column) return;
    column.visible = visible;
    saveState();
    renderStockTable();
    syncStockForm(true);
  }

  function renameColumn(key, label) {
    const active = activeTableReference();
    if (!active) return;
    const column = ensureTableColumns(active.table).find(function (entry) { return entry.key === key; });
    const cleanLabel = label.trim();
    if (!column || !cleanLabel) {
      renderColumnsModal();
      return;
    }
    column.label = cleanLabel;
    saveState();
    renderStockTable();
    syncStockForm(true);
  }

  function deleteCustomColumn(key, targetTable) {
    const table = targetTable || (activeTableReference() || {}).table;
    if (!table) return;
    const column = ensureTableColumns(table).find(function (entry) { return entry.key === key; });
    if (!column) return;
    table.columns = table.columns.filter(function (entry) {
      return entry.key !== key;
    });
    table.deletedColumnKeys = Array.from(new Set((table.deletedColumnKeys || []).concat(key)));
    // Varsayılan alanların verisini içeride koruruz. Böylece yanlışlıkla silinen
    // bir sütun sıfırlanınca eski kayıtlar geri gelir; özel sütun gerçekten silinir.
    if (!column.system) {
      table.items.forEach(function (item) {
        delete item[key];
      });
    }
    saveState();
    renderColumnsModal();
    renderAll(true);
  }

  function definitionColumns() {
    const table = definitionTable();
    return table ? ensureTableColumns(table) : [];
  }

  function definitionTable() {
    return tableById(ui.definitionTableId) || (state.tables[0] || null);
  }

  function syncDefinitionTableSelect() {
    const select = $("definition-column-table");
    if (!select) return;
    const selectedTable = definitionTable();
    ui.definitionTableId = selectedTable ? selectedTable.id : "";
    select.innerHTML = state.tables.map(function (table) {
      return '<option value="' + escapeHtml(table.id) + '"' +
        (table.id === ui.definitionTableId ? " selected" : "") + ">" +
        escapeHtml(table.name) + "</option>";
    }).join("");
  }

  function selectedDefinitionColumn() {
    return definitionColumns().find(function (column) {
      return column.key === ui.definitionColumnKey;
    }) || null;
  }

  function showDefinitionColumnError(message) {
    $("definition-column-error").textContent = message;
    $("definition-column-error").hidden = !message;
  }

  function renderDefinitionColumnList() {
    syncDefinitionTableSelect();
    const table = definitionTable();
    if (!table) {
      $("definition-column-list").innerHTML = '<div class="combo-empty">Önce bir liste oluşturun.</div>';
      return;
    }
    const query = normalizeText($("definition-column-search").value);
    const columns = definitionColumns().filter(function (column) {
      return !query || normalizeText(column.label).includes(query);
    });
    $("definition-column-list").innerHTML = columns.length
      ? columns.map(function (column) {
        const meta = columnTypeLabels[column.fieldType] || "Metin";
        return '<button type="button" class="definition-list-button' +
          (column.key === ui.definitionColumnKey ? " is-active" : "") +
          '" data-definition-column="' + escapeHtml(column.key) + '"><span>' +
          escapeHtml(column.label) + '</span><small>' +
          (column.visible === false ? "gizli · " : "") + meta + "</small></button>";
      }).join("")
      : '<div class="combo-empty">Sütun bulunamadı</div>';
  }

  function loadDefinitionColumnEditor(key) {
    syncDefinitionTableSelect();
    const table = definitionTable();
    const column = table ? definitionColumns().find(function (entry) {
      return entry.key === key;
    }) || null : null;
    ui.definitionColumnKey = column ? column.key : "";
    $("definition-column-key").value = column ? column.key : "";
    $("definition-column-name").value = column ? column.label : "";
    $("definition-column-type").value = column ? column.fieldType : "text";
    $("definition-column-options").value = column ? columnOptionValues(column).join("\n") : "";
    $("definition-column-visible").checked = column ? column.visible !== false : true;
    $("definition-column-name").disabled = !table;
    $("definition-column-type").disabled = !table;
    $("definition-column-visible").disabled = !table;
    $("delete-definition-column").hidden = !column;
    $("delete-definition-column").disabled = !column;
    syncDefinitionColumnTypeFields();
    showDefinitionColumnError(table ? "" : "Önce bir liste oluşturun.");
    renderDefinitionColumnList();
    if (table) window.setTimeout(function () { $("definition-column-name").focus(); }, 0);
  }

  function syncDefinitionColumnTypeFields() {
    const type = $("definition-column-type").value;
    const optionsField = $("definition-column-options-field");
    const optionsInput = $("definition-column-options");
    optionsField.hidden = type !== "select";
    optionsInput.disabled = type !== "select";
    $("definition-column-options-help").textContent =
      "Her satıra bir seçenek yazın. Kategori ve kılıf seçenekleri de burada yönetilir.";
  }

  function usedRemovedSelectOptions(table, column, nextOptions) {
    if (!column || column.fieldType !== "select") return [];
    const allowed = new Set(nextOptions.map(normalizeText));
    const usage = new Map();
    table.items.forEach(function (item) {
      const value = String(item[column.key] == null ? "" : item[column.key]).trim();
      const normalized = normalizeText(value);
      if (!normalized || allowed.has(normalized)) return;
      const current = usage.get(normalized) || { value: value, count: 0 };
      current.count += 1;
      usage.set(normalized, current);
    });
    return Array.from(usage.values());
  }

  function saveDefinitionColumn(event) {
    event.preventDefault();
    if (!requireAdministrator(function () { saveDefinitionColumn(event); })) return;
    ui.definitionTableId = $("definition-column-table").value || ui.definitionTableId;
    const table = definitionTable();
    if (!table) {
      showDefinitionColumnError("Önce bir liste oluşturun.");
      return;
    }
    const key = $("definition-column-key").value;
    const name = $("definition-column-name").value.trim();
    const visible = $("definition-column-visible").checked;
    const fieldType = $("definition-column-type").value;
    if (!name) {
      showDefinitionColumnError("Sütun adı zorunludur.");
      return;
    }
    const columns = definitionColumns();
    const duplicate = columns.some(function (column) {
      return column.key !== key && normalizeText(column.label) === normalizeText(name);
    });
    if (duplicate) {
      showDefinitionColumnError("Bu isimde bir sütun zaten var.");
      return;
    }

    let column = columns.find(function (entry) { return entry.key === key; });
    const options = fieldType === "select"
      ? normalizedColumnOptions($("definition-column-options").value.split(/\r?\n/))
      : (column ? column.options : []);
    if (fieldType === "select" && !options.length) {
      showDefinitionColumnError("Combobox için en az bir seçenek yazın.");
      $("definition-column-options").focus();
      return;
    }
    const removedOptions = fieldType === "select"
      ? usedRemovedSelectOptions(table, column, options)
      : [];
    if (removedOptions.length) {
      const summary = removedOptions.map(function (entry) {
        return '"' + entry.value + '" (' + entry.count + " kayıt)";
      }).join(", ");
      showDefinitionColumnError(
        "Kullanılan seçenekler silinemez: " + summary +
        ". Önce ilgili kayıtları başka bir seçeneğe taşıyın."
      );
      return;
    }
    if (column) {
      column.label = name;
      column.visible = visible;
      column.fieldType = fieldType;
      column.numeric = fieldType === "number";
      column.options = fieldType === "select" ? options : [];
      normalizeColumnItemValues(table, column);
    } else {
      column = addCustomColumn(name, table, {
        fieldType: fieldType,
        options: options
      });
      if (column) column.visible = visible;
    }
    saveState();
    renderAll(true);
    loadDefinitionColumnEditor(column ? column.key : "");
    showToast("Sütun tanımı kaydedildi.");
  }

  function deleteDefinitionColumn() {
    if (!requireAdministrator(deleteDefinitionColumn)) return;
    const column = selectedDefinitionColumn();
    if (!column) return;
    const table = definitionTable();
    deleteCustomColumn(column.key, table);
    const first = definitionColumns()[0];
    loadDefinitionColumnEditor(first ? first.key : "");
    showToast("Sütun tanımı silindi.");
  }

  // ---------------------------------------------------------------------------
  // Stok kartı ve giriş/çıkış
  // ---------------------------------------------------------------------------

  function itemDisplayName(item) {
    if (!item) return "";
    if (item.name || item.materialName) return item.name || item.materialName;
    const active = activeTableReference();
    const firstValue = active && ensureTableColumns(active.table).map(function (column) {
      return item[column.key];
    }).find(function (value) {
      return value !== "" && value != null && typeof value !== "boolean";
    });
    return firstValue || item.id || "";
  }

  function generatedRecordId() {
    const active = activeTableReference();
    const prefix = activeTableKind() === "quality" ? "KK" : "NUM";
    if (!active) return prefix + "0001";
    let number = active.table.items.length + 1;
    let candidate = prefix + String(number).padStart(4, "0");
    while (active.table.items.some(function (item) { return item.id === candidate; })) {
      number += 1;
      candidate = prefix + String(number).padStart(4, "0");
    }
    return candidate;
  }

  function generatedItemId() {
    return generatedRecordId();
  }

  function setStockForm(item) {
    const isStock = stockLikeActiveTable();
    $("stock-card-panel").querySelector(".section-heading h2").textContent = isStock ? "Stok Kartı" : "Kayıt Kartı";
    const stockCardTab = document.querySelector('[data-right-tab="stock-card"]');
    if (stockCardTab) stockCardTab.textContent = isStock ? "Stok Kartı" : "Kayıt Kartı";
    document.querySelectorAll('[data-action="new-card"]').forEach(function (button) {
      button.textContent = isStock ? "Yeni Kart" : "Yeni Kayıt";
    });
    setCustomForm(item);
  }

  function customFieldInput(column, value) {
    const key = escapeHtml(column.key);
    const label = escapeHtml(column.label);
    const safeValue = escapeHtml(value == null ? "" : value);
    if (column.fieldType === "select") {
      return '<label>' + label + '<span class="combo-field">' +
        '<input class="control" data-custom-field="' + key + '" autocomplete="off" value="' +
        safeValue + '" placeholder="Seçenek ara">' +
        '<button class="combo-toggle" type="button" tabindex="-1" data-custom-combo-toggle="' +
        key + '" aria-label="' + label + ' seçeneklerini aç"></button></span></label>';
    }
    if (column.fieldType === "checkbox") {
      return '<label class="checkbox-form-field"><span>' + label + '</span>' +
        '<span class="checkbox-value"><input type="checkbox" data-custom-field="' + key + '"' +
        (checkboxValue(value) ? " checked" : "") + '><span>İşaretli</span></span></label>';
    }
    if (column.fieldType === "multiline") {
      return '<label class="form-span">' + label + '<textarea class="control" data-custom-field="' +
        key + '" rows="2">' + safeValue + '</textarea></label>';
    }
    if (column.fieldType === "number") {
      return '<label>' + label + '<input class="control" data-custom-field="' + key +
        '" type="number" step="' + (column.integer ? "1" : "any") + '" inputmode="decimal" value="' +
        safeValue + '"></label>';
    }
    const type = column.fieldType === "date" ? "date" : "text";
    const inputValue = column.fieldType === "date" ? escapeHtml(dateInputValue(value)) : safeValue;
    return '<label>' + label + '<input class="control" data-custom-field="' + key +
      '" type="' + type + '" autocomplete="off" value="' + inputValue + '"></label>';
  }

  function closeDynamicFieldCombos() {
    dynamicFieldCombos.forEach(function (combo) { combo.close(); });
    dynamicFieldCombos = [];
  }

  function attachDynamicFieldCombos(columns) {
    closeDynamicFieldCombos();
    columns.filter(function (column) {
      return column.fieldType === "select";
    }).forEach(function (column) {
      const input = $("custom-card-fields").querySelector('[data-custom-field="' + column.key + '"]');
      const toggle = $("custom-card-fields").querySelector('[data-custom-combo-toggle="' + column.key + '"]');
      if (!input || !toggle) return;
      dynamicFieldCombos.push(window.DepoCombo.attach(input, toggle, function () {
        return columnOptionValues(column);
      }));
    });
  }

  function setCustomForm(item) {
    const active = activeTableReference();
    closeDynamicFieldCombos();
    if (!active) {
      $("custom-card-fields").innerHTML = "";
      return;
    }
    const columns = ensureTableColumns(active.table).filter(function (column) {
      return column.visible !== false && column.editable !== false;
    });
    $("custom-card-fields").innerHTML = columns.map(function (column) {
      return customFieldInput(column, item ? item[column.key] : defaultValueForColumn(column));
    }).join("");
    attachDynamicFieldCombos(columns);
  }

  function defaultValueForColumn(column) {
    if (column.fieldType === "select") return columnOptionValues(column)[0] || "";
    if (column.fieldType === "checkbox") return false;
    if (column.key === "checkedBy") return currentOperatorName();
    if (column.key === "checkedAt") return new Date().toISOString().slice(0, 10);
    return column.fieldType === "number" ? 0 : "";
  }

  function syncStockForm(force) {
    const item = activeItem();
    const nextId = item ? item.id : "";
    if (ui.formMode === "new" && !force) return;
    if (!force && ui.formItemId === nextId) return;
    ui.formMode = "existing";
    ui.formItemId = nextId;
    setStockForm(item);
  }

  function startNewCard() {
    if (!requireAdministrator(startNewCard)) return;
    const active = activeTableReference();
    if (!active) {
      showToast("Önce bir tablo açın.", true);
      return;
    }
    ui.formMode = "new";
    ui.formItemId = "";
    ui.activeItemId = null;
    // Seri kart girişinde mevcut bilgiler korunur; yalnızca yeni ve benzersiz ID hazırlanır.
    if (!stockLikeActiveTable()) setCustomForm(null);
    setRightTab("stock-card");
    renderStockTable();
    const first = $("custom-card-fields").querySelector("[data-custom-field]");
    if (first) first.focus();
  }

  function readStockForm() {
    return readCustomForm();
  }

  function readColumnInput(input, column) {
    if (column.fieldType === "checkbox") return input.checked;
    if (column.fieldType === "number") {
      if (input.value.trim() === "") return "";
      return Number(input.value);
    }
    return input.value.trim();
  }

  function readCustomForm() {
    const active = activeTableReference();
    const item = activeItem();
    const isExisting = Boolean(item && ui.formMode !== "new");
    const values = isExisting ? Object.assign({}, item) : {};
    values.id = isExisting ? item.id : (stockLikeActiveTable() ? generatedItemId() : generatedRecordId());
    values.updatedAt = nowText();
    ensureTableColumns(active.table).forEach(function (column) {
      if (column.key === "id" || column.key === "updatedAt") return;
      const input = $("custom-card-fields").querySelector('[data-custom-field="' + column.key + '"]');
      if (input) values[column.key] = readColumnInput(input, column);
      else if (!isExisting && !Object.prototype.hasOwnProperty.call(values, column.key)) {
        values[column.key] = defaultValueForColumn(column);
      }
    });
    return values;
  }

  function focusCardField(key) {
    const input = $("custom-card-fields").querySelector('[data-custom-field="' + key + '"]');
    if (input) input.focus();
  }

  function editableVisibleColumn(table, key) {
    return ensureTableColumns(table).find(function (column) {
      return column.key === key && column.visible !== false && column.editable !== false;
    }) || null;
  }

  function saveStockCard(event) {
    event.preventDefault();
    if (!requireAdministrator(function () { saveStockCard(event); })) return;
    const active = activeTableReference();
    if (!active) {
      showToast("Önce bir liste açın.", true);
      return;
    }
    const values = readStockForm();
    if (stockLikeActiveTable() && editableVisibleColumn(active.table, "name") && !values.name) {
      showToast("Malzeme adı boş bırakılamaz.", true);
      focusCardField("name");
      return;
    }
    if (stockLikeActiveTable() && tableHasNumberColumn(active.table, "quantity") &&
        (!Number.isInteger(values.quantity) || values.quantity < 0)) {
      showToast("Miktar sıfır veya daha büyük bir tam sayı olmalıdır.", true);
      focusCardField("quantity");
      return;
    }
    if (stockLikeActiveTable() && tableHasNumberColumn(active.table, "critical") &&
        (!Number.isInteger(values.critical) || values.critical < 0)) {
      showToast("Kritik seviye sıfır veya daha büyük bir tam sayı olmalıdır.", true);
      focusCardField("critical");
      return;
    }
    const columns = ensureTableColumns(active.table);
    const numericError = columns.find(function (column) {
      if (column.fieldType !== "number" || values[column.key] === "") return false;
      return !Number.isFinite(values[column.key]) || (column.integer && !Number.isInteger(values[column.key]));
    });
    if (numericError) {
      showToast(numericError.label + " geçerli bir sayı olmalıdır.", true);
      focusCardField(numericError.key);
      return;
    }
    let invalidSelect = null;
    columns.some(function (column) {
      if (column.fieldType !== "select" || values[column.key] === "" || values[column.key] == null) {
        return false;
      }
      const options = columnOptionValues(column);
      const selected = options.find(function (option) {
        return normalizeText(option) === normalizeText(values[column.key]);
      });
      if (!selected) {
        invalidSelect = column;
        return true;
      }
      // Aramayla farklı büyük/küçük harf girilse bile kayıt tek yazım standardında tutulur.
      values[column.key] = selected;
      return false;
    });
    if (invalidSelect) {
      showToast(invalidSelect.label + " için tanımlı seçeneklerden birini seçin.", true);
      focusCardField(invalidSelect.key);
      return;
    }

    if (ui.formMode === "new" || !activeItem()) {
      active.table.items.push(values);
      ui.activeItemId = values.id;
      ui.formMode = "existing";
      ui.formItemId = values.id;
      showToast(stockLikeActiveTable() ? "Yeni stok kartı eklendi." : "Yeni kayıt eklendi.");
    } else {
      const item = activeItem();
      if (!item) {
        showToast("Düzenlenecek stok kartını seçin.", true);
        return;
      }
      Object.assign(item, values, { id: item.id });
      showToast(stockLikeActiveTable() ? "Stok kartı kaydedildi." : "Kayıt kaydedildi.");
    }
    saveState();
    renderAll(true);
  }

  function deleteSelectedCards() {
    if (!requireAdministrator(deleteSelectedCards)) return;
    const active = activeTableReference();
    if (!active) {
      showToast("Önce bir liste açın.", true);
      return;
    }
    const ids = selectedItemIds();
    if (!ids.length) {
      showToast("Silinecek malzemeyi seçin.", true);
      return;
    }
    openFormModal({
      title: "Stok kartlarını sil",
      message: ids.length + " stok kartı kalıcı olarak silinecek.",
      submitLabel: "Kartları Sil",
      submitStyle: "danger",
      onSubmit: function () {
        const idSet = new Set(ids);
        active.table.items = active.table.items.filter(function (item) {
          return !idSet.has(item.id);
        });
        ui.activeItemId = null;
        ui.checkedIds.clear();
        ui.formItemId = null;
        saveState();
        renderAll(true);
        showToast(ids.length + " stok kartı silindi.");
        return true;
      }
    });
  }

  function setRightTab(tab) {
    ui.rightTab = tab;
    document.querySelectorAll("[data-right-tab]").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.rightTab === tab);
    });
    if (window.DepoDock) window.DepoDock.showPanel(tab);
  }

  function movementTargetItems() {
    const active = activeTableReference();
    if (!active) return [];
    const ids = new Set(selectedItemIds());
    return active.table.items.filter(function (item) { return ids.has(item.id); });
  }

  function syncMovementForm() {
    const targets = movementTargetItems();
    const active = activeTableReference();
    const stockMode = stockLikeActiveTable() && active && tableHasNumberColumn(active.table, "quantity");
    const entryOption = Array.from($("movement-type").options).find(function (option) {
      return option.value === "Giriş";
    });
    if (entryOption) {
      entryOption.hidden = false;
      entryOption.disabled = false;
    }
    // Alan/Veren adı kullanıcıya özeldir. Firebase'deki ortak stok verisine değil,
    // bu tarayıcının yerel ayarlarına kaydedilir.
    if (document.activeElement !== $("movement-user")) {
      $("movement-user").value = currentOperatorName();
    }
    $("movement-selection").textContent = targets.length
      ? (targets.length === 1 ? itemDisplayName(targets[0]) : targets.length + " malzeme seçili")
      : (stockMode ? "Seçim yok" : "Bu liste stok hareketi kullanmaz");
    $("movement-panel").querySelector("button[type='submit']").disabled = !stockMode;
    const isExit = $("movement-type").value === "Çıkış";
    $("movement-purpose-label").hidden = !isExit;
    $("movement-purpose").hidden = !isExit;
  }

  function saveMovementUser(showMessage) {
    const input = $("movement-user");
    const name = String(input.value || "").trim();
    if (!name) {
      input.value = currentOperatorName();
      if (showMessage !== false) showToast("Alan/Veren adı boş bırakılamaz.", true);
      return false;
    }
    input.value = name;
    if (name === currentOperatorName()) return true;
    state.session.operatorName = name;
    saveState();
    if (showMessage !== false) showToast("Alan/Veren adı güncellendi.");
    return true;
  }

  function saveMovementUserWhileTyping() {
    const name = String($("movement-user").value || "").trim();
    if (!name || name === currentOperatorName()) return;
    state.session.operatorName = name;
    saveState();
  }

  function processMovement(event) {
    event.preventDefault();
    if (!saveMovementUser(false)) {
      $("movement-user").focus();
      showToast("Hareketi işlemeden önce Alan/Veren adını yazın.", true);
      return;
    }
    const active = activeTableReference();
    const targets = movementTargetItems();
    const quantity = integerValue($("movement-quantity"), NaN);
    const type = $("movement-type").value;
    const purpose = $("movement-purpose").value.trim();
    const note = $("movement-note").value.trim();

    if (!stockLikeActiveTable() || !active || !tableHasNumberColumn(active.table, "quantity")) {
      showToast("Bu listede giriş/çıkış için Miktar sütunu bulunmuyor.", true);
      return;
    }

    if (type === "Giriş" && !requireAdministrator(function () { processMovement(event); })) return;
    if (!active || !targets.length) {
      showToast("İşlem yapılacak malzemeyi seçin.", true);
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      showToast("Miktar sıfırdan büyük bir tam sayı olmalıdır.", true);
      return;
    }
    if (type === "Çıkış" && !purpose) {
      showToast("Çıkış işleminde kullanım amacı/proje zorunludur.", true);
      $("movement-purpose").focus();
      return;
    }
    const insufficient = targets.filter(function (item) {
      return type === "Çıkış" && Number(item.quantity) < quantity;
    });
    if (insufficient.length) {
      showToast("Yetersiz stok: " + insufficient.map(itemDisplayName).join(", "), true);
      return;
    }

    targets.forEach(function (item) {
      const before = Number(item.quantity);
      const after = type === "Giriş" ? before + quantity : before - quantity;
      item.quantity = after;
      item.updatedAt = nowText();
      state.logs.unshift({
        id: uid("log"),
        tableId: active.table.id,
        itemId: item.id,
        itemName: itemDisplayName(item),
        date: nowText(),
        type: type,
        quantity: quantity,
        purpose: type === "Çıkış" ? purpose : "",
        user: currentOperatorName(),
        note: note,
        before: before,
        after: after
      });
    });

    $("movement-note").value = "";
    if (type === "Çıkış") $("movement-purpose").value = "";
    saveState();
    renderAll(true);
    showToast(targets.length + " malzeme için " + type.toLocaleLowerCase("tr-TR") + " işlendi.");
  }

  function applyPermissionView() {
    const active = activeTableReference();
    const stockMode = stockLikeActiveTable() && active && tableHasNumberColumn(active.table, "quantity");
    const stockTab = document.querySelector('[data-right-tab="stock-card"]');
    const movementTab = document.querySelector('[data-right-tab="movement"]');
    if (stockTab) stockTab.hidden = false;
    if (movementTab) movementTab.hidden = !stockMode;
    if (window.DepoDock) window.DepoDock.setPanelAllowed("stock-card", true);
    if (!stockMode && ui.rightTab === "movement") setRightTab("stock-card");
    document.querySelectorAll('[data-action="new-card"], [data-action="delete-card"]').forEach(function (button) {
      button.disabled = !active;
    });
    const newTableButton = $("new-table-button");
    if (newTableButton) newTableButton.disabled = false;
    const importButton = document.querySelector('[data-action="import-json"]');
    if (importButton) importButton.hidden = false;
    const definitionsButton = document.querySelector('[data-action="open-definitions"]');
    if (definitionsButton) definitionsButton.hidden = false;
  }

  // ---------------------------------------------------------------------------
  // Hareket geçmişi
  // ---------------------------------------------------------------------------

  function historyItemName(log) {
    if (log.itemName) return log.itemName;
    const table = tableById(log.tableId);
    if (!table) return "";
    const item = table.items.find(function (entry) { return entry.id === log.itemId; });
    return item ? itemDisplayName(item) : "";
  }

  function historyTimestamp(dateText) {
    const match = String(dateText || "").match(
      /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/
    );
    if (!match) return 0;
    return new Date(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] || 0)
    ).getTime();
  }

  function historyRows() {
    const active = activeTableReference();
    const scope = $("history-scope").value;
    const query = normalizeText($("history-search").value);
    return state.logs.filter(function (log) {
      let inScope;
      if (scope === "all") inScope = true;
      else if (scope === "item") inScope = active && ui.activeItemId &&
        log.tableId === active.table.id && log.itemId === ui.activeItemId;
      else inScope = active && log.tableId === active.table.id;
      if (!inScope) return false;
      if (!query) return true;

      return [
        log.date,
        historyItemName(log),
        log.type,
        log.quantity,
        log.purpose,
        log.user,
        log.note,
        log.before,
        log.after
      ].some(function (value) {
        return normalizeText(value).includes(query);
      });
    }).map(function (log, index) {
      return { log: log, index: index };
    }).sort(function (left, right) {
      const dateDifference = historyTimestamp(right.log.date) - historyTimestamp(left.log.date);
      return dateDifference || left.index - right.index;
    }).map(function (entry) {
      return entry.log;
    });
  }

  function renderHistory() {
    const rows = historyRows();
    const scopeText = $("history-scope").selectedOptions[0]
      ? $("history-scope").selectedOptions[0].textContent
      : "Aktif tablo";
    $("history-context").textContent = scopeText + " / " + rows.length + " hareket";
    document.querySelectorAll("[data-history-column]").forEach(function (cell) {
      const key = cell.dataset.historyColumn;
      cell.style.cssText = columnWidthStyle("history", key);
    });
    $("history-table-body").innerHTML = rows.map(function (log) {
      const itemName = historyItemName(log);
      function cell(key, value) {
        return '<td data-history-column="' + key + '" style="' +
          columnWidthStyle("history", key) + '" title="' + escapeHtml(value) + '">' +
          escapeHtml(value) + "</td>";
      }
      return "<tr>" +
        cell("date", log.date) +
        cell("itemName", itemName) +
        cell("type", log.type) +
        cell("quantity", log.quantity) +
        cell("purpose", log.purpose) +
        cell("user", log.user) +
        cell("note", log.note) +
        cell("before", log.before) +
        cell("after", log.after) +
        "</tr>";
    }).join("");
  }

  // ---------------------------------------------------------------------------
  // Liste işlemleri
  // ---------------------------------------------------------------------------

  function openFormModal(options) {
    const fields = options.fields || [];
    const submitButton = $("form-modal-submit");

    $("form-modal-title").textContent = options.title;
    $("form-modal-message").textContent = options.message || "";
    $("form-modal-message").hidden = !options.message;
    submitButton.textContent = options.submitLabel || "Kaydet";
    submitButton.classList.toggle("button-primary", options.submitStyle !== "danger");
    submitButton.classList.toggle("button-danger", options.submitStyle === "danger");
    $("form-modal-error").hidden = true;
    $("form-modal-fields").innerHTML = fields.map(function (field) {
      if (field.type === "select") {
        return '<label>' + escapeHtml(field.label) +
          '<select class="control" name="' + escapeHtml(field.name) + '">' +
          (field.options || []).map(function (option) {
            return '<option value="' + escapeHtml(option.value) + '"' +
              (option.value === field.value ? " selected" : "") + ">" +
              escapeHtml(option.label) + "</option>";
          }).join("") + "</select></label>";
      }
      return '<label>' + escapeHtml(field.label) +
        '<input class="control" type="' + escapeHtml(field.type || "text") +
        '" autocomplete="' + escapeHtml(field.autocomplete || "off") +
        '" name="' + escapeHtml(field.name) + '" value="' +
        escapeHtml(field.value || "") + '" placeholder="' +
        escapeHtml(field.placeholder || "") + '"' +
        (field.required ? " required" : "") + "></label>";
    }).join("");
    ui.formModalSubmit = options.onSubmit;
    ui.formModalBusy = false;
    submitButton.disabled = false;
    $("form-modal").hidden = false;
    const firstInput = $("form-modal-fields").querySelector("input");
    if (firstInput) window.setTimeout(function () { firstInput.focus(); }, 0);
  }

  function closeFormModal() {
    $("form-modal").hidden = true;
    ui.formModalSubmit = null;
    ui.formModalBusy = false;
    $("form-modal-submit").disabled = false;
  }

  function showFormModalError(message) {
    $("form-modal-error").textContent = message;
    $("form-modal-error").hidden = false;
  }

  function createTable() {
    if (!requireAdministrator(createTable)) return;
    openFormModal({
      title: "Yeni liste",
      fields: [
        { name: "name", label: "Liste adı", required: true },
        {
          name: "kind",
          label: "Liste türü",
          type: "select",
          value: "stock",
          options: [
            { value: "stock", label: "Stok listesi" },
            { value: "quality", label: "Kalite kontrol listesi" }
          ]
        }
      ],
      submitLabel: "Oluştur",
      onSubmit: function (values) {
        const name = values.name.trim();
        if (!name) throw new Error("Liste adı zorunludur.");
        const duplicate = state.tables.some(function (table) {
          return normalizeText(table.name) === normalizeText(name);
        });
        if (duplicate) throw new Error("Bu isimde bir liste zaten var.");
        const kind = values.kind === "quality" ? "quality" : "stock";
        const table = {
          id: uid("table"),
          name: name,
          kind: kind,
          columns: defaultColumnsForKind(kind),
          items: []
        };
        state.tables.push(table);
        openTable(table.id);
        showToast("Yeni liste oluşturuldu.");
        return true;
      }
    });
  }

  function openTableContextMenu(tableId, clientX, clientY) {
    if (!requireAdministrator(function () {
      openTableContextMenu(tableId, clientX, clientY);
    })) return;
    const menu = $("table-context-menu");
    closeMenus();
    ui.contextTableId = tableId;
    menu.hidden = false;

    const left = Math.min(clientX, window.innerWidth - menu.offsetWidth - 8);
    const top = Math.min(clientY, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = Math.max(8, left) + "px";
    menu.style.top = Math.max(8, top) + "px";
  }

  function renameTable(tableId) {
    if (!requireAdministrator(function () { renameTable(tableId); })) return;
    const table = tableById(tableId);
    if (!table) return;
    openFormModal({
      title: "Listeyi yeniden adlandır",
      fields: [
        { name: "name", label: "Liste adı", value: table.name, required: true }
      ],
      submitLabel: "Kaydet",
      onSubmit: function (values) {
        const name = values.name.trim();
        if (!name) throw new Error("Liste adı zorunludur.");
        const duplicate = state.tables.some(function (entry) {
          return entry.id !== table.id && normalizeText(entry.name) === normalizeText(name);
        });
        if (duplicate) throw new Error("Bu isimde bir liste zaten var.");
        table.name = name;
        saveState();
        renderAll();
        showToast("Liste adı değiştirildi.");
        return true;
      }
    });
  }

  function confirmDeleteTable(tableId) {
    if (!requireAdministrator(function () { confirmDeleteTable(tableId); })) return;
    const table = tableById(tableId);
    if (!table) return;
    openFormModal({
      title: "Listeyi sil",
      message: "'" + table.name + "' listesi, içindeki stok kartları ve hareket kayıtları kalıcı olarak silinecek.",
      submitLabel: "Listeyi Sil",
      submitStyle: "danger",
      onSubmit: function () {
        state.tables = state.tables.filter(function (entry) {
          return entry.id !== table.id;
        });
        state.logs = state.logs.filter(function (log) {
          return log.tableId !== table.id;
        });
        closeTable(table.id);
        saveState();
        renderAll(true);
        showToast("Liste silindi.");
        return true;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Liste ve sütun tanımları
  // ---------------------------------------------------------------------------

  function openDefinitions() {
    if (!requireAdministrator(openDefinitions)) return;
    $("definitions-modal").hidden = false;
    $("definition-column-search").value = "";
    ui.definitionTableId = state.session.activeTableId || (state.tables[0] || {}).id || "";
    const firstColumn = definitionColumns()[0];
    loadDefinitionColumnEditor(firstColumn ? firstColumn.key : "");
  }

  function closeDefinitions() {
    $("definitions-modal").hidden = true;
    ui.definitionColumnKey = "";
  }

  // ---------------------------------------------------------------------------
  // Dosya aktarımı
  // ---------------------------------------------------------------------------

  function exportJson() {
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(
      "arge-numune-depo-yedek-" + date + ".json",
      JSON.stringify(state, null, 2),
      "application/json;charset=utf-8"
    );
    showToast("JSON yedeği hazırlandı.");
  }

  function importJsonFile(file) {
    if (!requireAdministrator(function () { importJsonFile(file); })) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const imported = JSON.parse(reader.result);
        openFormModal({
          title: "JSON yedeğini içe aktar",
          message: "Firebase'deki mevcut listeler ve hareketler bu yedekle değiştirilecek.",
          submitLabel: "İçe Aktar",
          submitStyle: "danger",
          onSubmit: async function () {
            const operatorName = currentOperatorName();
            state = await window.DepoStore.replace(imported);
            state.session.operatorName = operatorName;
            saveState();
            ui.activeItemId = null;
            ui.checkedIds.clear();
            ui.formItemId = null;
            ensureValidSession();
            renderAll(true);
            showToast("JSON yedeği içe aktarıldı.");
            return true;
          }
        });
      } catch (error) {
        showToast(friendlyErrorMessage(error, "JSON dosyası okunamadı."), true);
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function csvCell(value) {
    const text = String(value == null ? "" : value);
    return '"' + text.replaceAll('"', '""') + '"';
  }

  function exportActiveTableCsv() {
    const active = activeTableReference();
    if (!active) {
      showToast("Dışa aktarılacak tabloyu açın.", true);
      return;
    }
    const columns = ensureTableColumns(active.table).filter(function (column) {
      return column.visible !== false;
    });
    const lines = [
      columns.map(function (column) { return csvCell(column.label); }).join(";")
    ];
    active.table.items.forEach(function (item) {
      lines.push(columns.map(function (column) {
        return csvCell(tableCellText(column, item[column.key]));
      }).join(";"));
    });
    downloadFile(
      active.table.name.replace(/[\\/:*?"<>|]/g, "-") + ".csv",
      "\ufeff" + lines.join("\r\n"),
      "text/csv;charset=utf-8"
    );
    showToast("Aktif tablo CSV olarak hazırlandı.");
  }

  // ---------------------------------------------------------------------------
  // Geçici BOM penceresi
  // ---------------------------------------------------------------------------

  function openBom() {
    const active = activeTableReference();
    if (!active || !stockLikeActiveTable() || !tableHasNumberColumn(active.table, "quantity")) {
      showToast("BOM için önce bir stok tablosu açın.", true);
      return;
    }
    ui.bomRows = [];
    $("bom-table-body").innerHTML = "";
    $("bom-status").textContent = "Dosya bekleniyor";
    $("bom-purpose").value = "";
    $("bom-note").value = "";
    $("bom-modal").hidden = false;
  }

  function parseBomText(text) {
    const lines = text.split(/\r?\n/).filter(function (line) { return line.trim(); });
    if (!lines.length) return [];
    const first = lines[0];
    const delimiter = first.includes("\t") ? "\t" : (first.includes(";") ? ";" : ",");
    const rows = lines.map(function (line) {
      return line.split(delimiter).map(function (cell) {
        return cell.trim().replace(/^"|"$/g, "").replaceAll('""', '"');
      });
    });
    const header = rows[0].map(normalizeText);
    const descriptionIndex = header.findIndex(function (cell) {
      return cell.includes("description") || cell.includes("aciklama") || cell.includes("malzeme");
    });
    const quantityIndex = header.findIndex(function (cell) {
      return cell.includes("quantity") || cell.includes("miktar") || cell === "qty";
    });
    const startsWithHeader = descriptionIndex >= 0 || quantityIndex >= 0;
    const dataRows = startsWithHeader ? rows.slice(1) : rows;
    const descIndex = descriptionIndex >= 0 ? descriptionIndex : 0;
    const qtyIndex = quantityIndex >= 0 ? quantityIndex : 1;
    return dataRows.map(function (cells) {
      const parsedQuantity = Number(String(cells[qtyIndex] || "1").replace(",", "."));
      return {
        description: cells[descIndex] || "",
        quantity: Number.isInteger(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1
      };
    }).filter(function (row) { return row.description; });
  }

  function bomMatchScore(description, item) {
    const descriptionText = normalizeText(description);
    const nameText = normalizeText(itemDisplayName(item));
    if (!nameText) return 0;
    if (descriptionText === nameText) return 100;
    if (descriptionText.includes(nameText)) return Math.min(99, 72 + Math.round(nameText.length / 4));
    const code = normalizeText(itemDisplayName(item).split(/\s+/)[0]);
    if (code.length >= 4 && descriptionText.includes(code)) return 90;
    return Math.round(similarity(descriptionText, nameText) * 100);
  }

  function matchBomRows(rawRows) {
    const active = activeTableReference();
    const candidates = [];
    rawRows.forEach(function (row, rowIndex) {
      active.table.items.forEach(function (item) {
        candidates.push({
          rowIndex: rowIndex,
          itemId: item.id,
          score: bomMatchScore(row.description, item)
        });
      });
    });
    candidates.sort(function (left, right) { return right.score - left.score; });

    const assignedRows = new Set();
    const assignedItems = new Set();
    const assignments = new Map();
    candidates.forEach(function (candidate) {
      if (candidate.score < 48 || assignedRows.has(candidate.rowIndex) || assignedItems.has(candidate.itemId)) return;
      assignedRows.add(candidate.rowIndex);
      assignedItems.add(candidate.itemId);
      assignments.set(candidate.rowIndex, candidate);
    });

    return rawRows.map(function (row, index) {
      const assignment = assignments.get(index);
      const sameBest = assignment && candidates.filter(function (candidate) {
        return candidate.rowIndex === index && candidate.score === assignment.score;
      }).length > 1;
      return {
        description: row.description,
        quantity: row.quantity,
        selected: Boolean(assignment),
        matchId: assignment ? assignment.itemId : "",
        score: assignment ? assignment.score : 0,
        status: !assignment ? "unmatched" : (sameBest ? "ambiguous" : "matched")
      };
    });
  }

  function renderBomRows() {
    const active = activeTableReference();
    if (!active) return;
    const options = active.table.items.map(function (item) {
      const details = [itemDisplayName(item), item.footprint, item.box].filter(Boolean).join(" / ");
      return '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(details) + "</option>";
    }).join("");
    $("bom-table-body").innerHTML = ui.bomRows.map(function (row, index) {
      const item = active.table.items.find(function (entry) { return entry.id === row.matchId; });
      const className = row.status === "unmatched" ? "bom-unmatched" :
        (row.status === "ambiguous" ? "bom-ambiguous" : "");
      return '<tr class="' + className + '">' +
        '<td class="select-cell"><input type="checkbox" data-bom-select="' + index + '"' +
        (row.selected ? " checked" : "") + "></td>" +
        "<td>" + escapeHtml(row.description) + "</td>" +
        "<td>" + escapeHtml(row.quantity) + "</td>" +
        '<td><select class="small-select" data-bom-match="' + index + '">' +
        '<option value="">Eşleşme yok</option>' + options + "</select></td>" +
        "<td>" + escapeHtml(item ? item.quantity : 0) + "</td>" +
        "<td>" + escapeHtml(row.score) + "</td>" +
        "</tr>";
    }).join("");
    document.querySelectorAll("[data-bom-match]").forEach(function (select) {
      select.value = ui.bomRows[Number(select.dataset.bomMatch)].matchId;
    });
    const matched = ui.bomRows.filter(function (row) { return row.matchId; }).length;
    $("bom-status").textContent = matched + " eşleşen / " + (ui.bomRows.length - matched) + " eşleşmeyen";
  }

  function loadBomFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const rawRows = parseBomText(reader.result);
        ui.bomRows = matchBomRows(rawRows);
        renderBomRows();
        $("bom-status").textContent = file.name + " / " + $("bom-status").textContent;
      } catch (error) {
        showToast("BOM dosyası okunamadı.", true);
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function applyBom() {
    const active = activeTableReference();
    if (!active) {
      showToast("BOM çıkışı için açık bir liste bulunamadı.", true);
      return;
    }
    const purpose = $("bom-purpose").value.trim();
    const note = $("bom-note").value.trim();
    const selectedRows = ui.bomRows.filter(function (row) { return row.selected && row.matchId; });
    if (!selectedRows.length) {
      showToast("Çıkış yapılacak eşleşmeleri seçin.", true);
      return;
    }
    if (!purpose) {
      showToast("Kullanım amacı/proje zorunludur.", true);
      $("bom-purpose").focus();
      return;
    }
    const shortages = selectedRows.filter(function (row) {
      const item = active.table.items.find(function (entry) { return entry.id === row.matchId; });
      return !item || Number(item.quantity) < row.quantity;
    });
    if (shortages.length) {
      showToast("Bazı BOM satırları için stok yetersiz.", true);
      return;
    }
    selectedRows.forEach(function (row) {
      const item = active.table.items.find(function (entry) { return entry.id === row.matchId; });
      const before = Number(item.quantity);
      item.quantity = before - row.quantity;
      item.updatedAt = nowText();
      state.logs.unshift({
        id: uid("log"),
        tableId: active.table.id,
        itemId: item.id,
        itemName: itemDisplayName(item),
        date: nowText(),
        type: "Çıkış",
        quantity: row.quantity,
        purpose: purpose,
        user: currentOperatorName(),
        note: note || "BOM List",
        before: before,
        after: item.quantity
      });
    });
    saveState();
    $("bom-modal").hidden = true;
    renderAll(true);
    showToast(selectedRows.length + " BOM satırı stoktan düşüldü.");
  }

  // ---------------------------------------------------------------------------
  // Panel boyutları
  // ---------------------------------------------------------------------------

  function startColumnResize(group, key, event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    ensureColumnWidthSettings();
    const header = event.target.closest("th");
    const startX = event.clientX;
    const startWidth = header ? header.getBoundingClientRect().width : savedColumnWidth(group, key);
    const widths = group === "history"
      ? state.settings.historyColumnWidths
      : state.settings.columnWidths;
    const attribute = group === "history" ? "data-history-column" : "data-stock-column";
    const wasDraggable = header ? header.draggable : false;

    ui.isResizingColumn = true;
    ui.suppressColumnClick = true;
    if (header) header.draggable = false;
    document.body.classList.add("is-resizing-column");

    function applyWidth(width) {
      const nextWidth = Math.max(55, Math.min(600, Math.round(width)));
      widths[key] = nextWidth;
      const active = activeTableReference();
      if (active && group !== "history") {
        const column = ensureTableColumns(active.table).find(function (entry) { return entry.key === key; });
        if (column) column.width = nextWidth;
      }
      document.querySelectorAll("[" + attribute + '="' + key + '"]').forEach(function (cell) {
        cell.style.width = nextWidth + "px";
        cell.style.minWidth = nextWidth + "px";
        cell.style.maxWidth = nextWidth + "px";
      });
    }

    function move(moveEvent) {
      applyWidth(startWidth + moveEvent.clientX - startX);
    }

    function stop() {
      ui.isResizingColumn = false;
      if (header) header.draggable = wasDraggable;
      document.body.classList.remove("is-resizing-column");
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
      saveState();
      window.setTimeout(function () {
        ui.suppressColumnClick = false;
      }, 0);
    }

    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
  }

  function startResize(kind, event) {
    event.preventDefault();
    const splitter = event.currentTarget;
    splitter.classList.add("is-dragging");
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = state.settings.leftWidth;
    const startRight = state.settings.rightWidth;
    const startHistory = state.settings.historyHeight;

    function move(moveEvent) {
      if (kind === "left") {
        state.settings.leftWidth = Math.max(48, Math.min(window.innerWidth - 420, startLeft + moveEvent.clientX - startX));
        document.documentElement.style.setProperty("--left-width", state.settings.leftWidth + "px");
      } else if (kind === "right") {
        state.settings.rightWidth = Math.max(48, Math.min(window.innerWidth - 420, startRight - moveEvent.clientX + startX));
        document.documentElement.style.setProperty("--right-width", state.settings.rightWidth + "px");
      } else {
        const dockHeight = $("right-dock").clientHeight || 1;
        const deltaPercent = ((startY - moveEvent.clientY) / dockHeight) * 100;
        state.settings.historyHeight = Math.max(10, Math.min(85, startHistory + deltaPercent));
        document.documentElement.style.setProperty("--history-height", state.settings.historyHeight + "%");
      }
    }

    function stop() {
      splitter.classList.remove("is-dragging");
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
      saveState();
    }

    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
  }

  // ---------------------------------------------------------------------------
  // Menü ve olay bağlantıları
  // ---------------------------------------------------------------------------

  function closeMenus() {
    document.querySelectorAll(".menu-popover").forEach(function (menu) {
      menu.hidden = true;
    });
    ui.contextTableId = null;
    document.querySelectorAll(".menu-trigger").forEach(function (button) {
      button.classList.remove("is-open");
    });
  }

  function handleAction(action) {
    const actions = {
      "import-json": function () {
        if (requireAdministrator(function () { $("json-file-input").click(); })) {
          $("json-file-input").click();
        }
      },
      "export-json": exportJson,
      "export-csv": exportActiveTableCsv,
      "open-bom": openBom,
      "enter-admin": function () { openAdministratorPrompt(); },
      "exit-admin": function () { exitAdministratorMode(true); },
      "new-card": startNewCard,
      "delete-card": deleteSelectedCards,
      "clear-selection": function () {
        ui.checkedIds.clear();
        ui.activeItemId = null;
        ui.formItemId = null;
        renderAll(true);
      },
      "open-definitions": openDefinitions,
      "close-definitions": closeDefinitions,
      "new-definition-column": function () { loadDefinitionColumnEditor(""); },
      "delete-definition-column": deleteDefinitionColumn,
      "refresh": function () {
        ui.activeItemId = null;
        ui.formItemId = null;
        $("stock-search").value = "";
        $("history-search").value = "";
        $("critical-only").checked = false;
        renderAll(true);
        showToast("Görünüm yenilendi.");
      },
      "theme-light": function () {
        state.settings.theme = "light";
        saveState();
        applySettings();
      },
      "theme-dark": function () {
        state.settings.theme = "dark";
        saveState();
        applySettings();
      },
      "show-columns": function () {
        renderColumnsModal();
        $("columns-modal").hidden = false;
      },
      "show-panel-lists": function () { window.DepoDock.togglePanel("lists"); },
      "show-panel-stock": function () { window.DepoDock.togglePanel("stock"); },
      "show-panel-stock-card": function () {
        window.DepoDock.togglePanel("stock-card");
      },
      "show-panel-movement": function () { window.DepoDock.togglePanel("movement"); },
      "show-panel-history": function () { window.DepoDock.togglePanel("history"); },
      "reset-layout": function () {
        state.settings.leftWidth = 250;
        state.settings.rightWidth = 330;
        state.settings.historyHeight = 38;
        state.settings.leftCollapsed = false;
        state.settings.rightCollapsed = false;
        saveState();
        applySettings();
        if (window.DepoDock) window.DepoDock.reset();
      },
      "show-about": function () {
        window.alert("Ar-Ge Numune Depo\n\nListeler ve hareketler Firebase ortak verisinde tutulur. Normal erişim anonimdir; yönetici işlemleri ortak parola ile geçici olarak açılır.");
      },
      "rename-table": function () {
        const tableId = ui.contextTableId;
        if (tableId) renameTable(tableId);
      },
      "delete-table": function () {
        const tableId = ui.contextTableId;
        if (tableId) confirmDeleteTable(tableId);
      },
      "close-form-modal": closeFormModal,
      "close-columns": function () { $("columns-modal").hidden = true; },
      "reset-columns": function () {
        if (!requireAdministrator(function () { handleAction("reset-columns"); })) return;
        const active = activeTableReference();
        if (active) {
          active.table.deletedColumnKeys = [];
          active.table.columns = defaultColumnsForKind(tableKind(active.table));
        }
        state.settings.visibleColumns = window.DepoData.stockColumnDefinitions.map(function (column) { return column.key; });
        state.settings.columnOrder = state.settings.visibleColumns.slice();
        state.settings.columnWidths = Object.assign({}, defaultColumnWidths);
        state.settings.historyColumnWidths = Object.assign({}, defaultHistoryColumnWidths);
        saveState();
        renderColumnsModal();
        renderAll(true);
      },
      "close-bom": function () { $("bom-modal").hidden = true; },
      "load-bom": function () { $("bom-file-input").click(); },
      "apply-bom": applyBom
    };
    if (actions[action]) actions[action]();
  }

  document.addEventListener("click", function (event) {
    const menuTrigger = event.target.closest(".menu-trigger");
    if (menuTrigger) {
      event.stopPropagation();
      const menu = $(menuTrigger.dataset.menu);
      const willOpen = menu.hidden;
      closeMenus();
      menu.hidden = !willOpen;
      menuTrigger.classList.toggle("is-open", willOpen);
      return;
    }
    if (!event.target.closest(".menu-popover")) closeMenus();

    const actionElement = event.target.closest("[data-action]");
    if (actionElement) {
      handleAction(actionElement.dataset.action);
      closeMenus();
    }
  });

  $("connection-retry").addEventListener("click", function () {
    window.location.reload();
  });
  $("json-file-button").addEventListener("click", function () {
    showToast("Veriler Firebase Realtime Database ile ortak kullanılıyor.");
  });
  document.querySelectorAll("[data-left-tab]").forEach(function (button) {
    button.addEventListener("click", function () {
      setLeftTab(button.dataset.leftTab);
    });
  });

  document.querySelectorAll("[data-right-tab]").forEach(function (button) {
    button.addEventListener("click", function () {
      setRightTab(button.dataset.rightTab);
    });
  });

  $("new-table-button").addEventListener("click", createTable);

  $("table-list").addEventListener("click", function (event) {
    const button = event.target.closest("[data-table-id]");
    if (button) openTable(button.dataset.tableId);
  });
  $("table-list").addEventListener("contextmenu", function (event) {
    const button = event.target.closest("[data-table-id]");
    if (!button) return;
    event.preventDefault();
    openTableContextMenu(button.dataset.tableId, event.clientX, event.clientY);
  });

  $("open-table-tabs").addEventListener("click", function (event) {
    const close = event.target.closest("[data-close-table-id]");
    if (close) {
      event.stopPropagation();
      closeTable(close.dataset.closeTableId);
      return;
    }
    const tab = event.target.closest("[data-table-id]");
    if (!tab) return;
    state.session.activeTableId = tab.dataset.tableId;
    ui.activeItemId = null;
    ui.checkedIds.clear();
    ui.formItemId = null;
    saveState();
    renderAll(true);
  });

  $("stock-search").addEventListener("input", renderStockTable);
  $("critical-only").addEventListener("change", renderStockTable);
  $("stock-table-head").addEventListener("click", function (event) {
    if (ui.suppressColumnClick || event.target.closest(".column-resizer")) return;
    if (event.target.closest("[data-action]")) return;
    const heading = event.target.closest("th[data-key]");
    if (!heading) return;
    if (heading.dataset.key === "select") {
      const visibleItems = filteredSortedItems();
      const shouldSelect = !visibleItems.length || !visibleItems.every(function (item) {
        return ui.checkedIds.has(item.id);
      });
      visibleItems.forEach(function (item) {
        if (shouldSelect) ui.checkedIds.add(item.id);
        else ui.checkedIds.delete(item.id);
      });
      renderStockTable();
      syncMovementForm();
      return;
    }
    sortByColumn(heading.dataset.key);
  });

  $("stock-table-head").addEventListener("dragstart", function (event) {
    if (ui.isResizingColumn || event.target.closest(".column-resizer")) {
      event.preventDefault();
      return;
    }
    const heading = event.target.closest('th[draggable="true"]');
    if (!heading) return;
    ui.draggedColumn = heading.dataset.key;
    heading.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", ui.draggedColumn);
  });
  $("stock-table-head").addEventListener("dragover", function (event) {
    const heading = event.target.closest('th[draggable="true"]');
    if (!heading || !ui.draggedColumn) return;
    event.preventDefault();
    const rect = heading.getBoundingClientRect();
    const after = event.clientX > rect.left + rect.width / 2;
    heading.classList.toggle("drop-before", !after);
    heading.classList.toggle("drop-after", after);
  });
  $("stock-table-head").addEventListener("dragleave", function (event) {
    const heading = event.target.closest('th[draggable="true"]');
    if (heading) heading.classList.remove("drop-before", "drop-after");
  });
  $("stock-table-head").addEventListener("drop", function (event) {
    const heading = event.target.closest('th[draggable="true"]');
    if (!heading || !ui.draggedColumn) return;
    event.preventDefault();
    const rect = heading.getBoundingClientRect();
    moveColumn(ui.draggedColumn, heading.dataset.key, event.clientX > rect.left + rect.width / 2);
  });
  $("stock-table-head").addEventListener("dragend", function () {
    ui.draggedColumn = null;
    document.querySelectorAll("#stock-table-head th").forEach(function (heading) {
      heading.classList.remove("is-dragging", "drop-before", "drop-after");
    });
  });

  $("stock-table-body").addEventListener("click", function (event) {
    const checkboxCell = event.target.closest("[data-checkbox-item]");
    if (checkboxCell) {
      const itemId = checkboxCell.dataset.checkboxItem;
      if (ui.checkedIds.has(itemId)) ui.checkedIds.delete(itemId);
      else ui.checkedIds.add(itemId);
      renderStockTable();
      syncMovementForm();
      return;
    }
    const row = event.target.closest("[data-item-id]");
    if (!row) return;
    ui.activeItemId = row.dataset.itemId;
    ui.formMode = "existing";
    ui.formItemId = null;
    renderStockTable();
    syncStockForm(true);
    syncMovementForm();
    renderHistory();
  });

  $("stock-card-panel").addEventListener("submit", saveStockCard);
  $("movement-panel").addEventListener("submit", processMovement);
  $("movement-type").addEventListener("change", syncMovementForm);
  $("movement-user").addEventListener("input", saveMovementUserWhileTyping);
  $("movement-user").addEventListener("change", function () {
    saveMovementUser(true);
  });
  $("history-scope").addEventListener("change", renderHistory);
  $("history-search").addEventListener("input", renderHistory);
  $("stock-table-head").addEventListener("pointerdown", function (event) {
    const handle = event.target.closest("[data-resize-stock]");
    if (handle) startColumnResize("stock", handle.dataset.resizeStock, event);
  });
  document.querySelector(".history-table thead").addEventListener("pointerdown", function (event) {
    const handle = event.target.closest("[data-resize-history]");
    if (handle) startColumnResize("history", handle.dataset.resizeHistory, event);
  });

  $("form-modal-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!ui.formModalSubmit || ui.formModalBusy) return;
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const submitButton = $("form-modal-submit");
    ui.formModalBusy = true;
    submitButton.disabled = true;
    try {
      const shouldClose = await Promise.resolve(ui.formModalSubmit(values));
      if (shouldClose !== false) closeFormModal();
    } catch (error) {
      if (isTechnicalError(error)) {
        closeFormModal();
        showToast(friendlyErrorMessage(error, "Arayüz güncellenirken bir hata oluştu."), true);
      } else {
        showFormModalError(friendlyErrorMessage(error, "İşlem tamamlanamadı."));
      }
    } finally {
      if (!$("form-modal").hidden) {
        ui.formModalBusy = false;
        submitButton.disabled = false;
      }
    }
  });

  $("columns-list").addEventListener("change", function (event) {
    const checkbox = event.target.closest("[data-column-key]");
    if (!checkbox) return;
    updateColumnVisibility(checkbox.dataset.columnKey, checkbox.checked);
  });

  $("definition-column-form").addEventListener("submit", saveDefinitionColumn);
  $("definition-column-type").addEventListener("change", function () {
    syncDefinitionColumnTypeFields();
  });
  $("definition-column-search").addEventListener("input", renderDefinitionColumnList);
  $("definition-column-table").addEventListener("change", function () {
    ui.definitionTableId = $("definition-column-table").value;
    ui.definitionColumnKey = "";
    const firstColumn = definitionColumns()[0];
    loadDefinitionColumnEditor(firstColumn ? firstColumn.key : "");
  });
  $("definition-column-list").addEventListener("click", function (event) {
    const button = event.target.closest("[data-definition-column]");
    if (button) loadDefinitionColumnEditor(button.dataset.definitionColumn);
  });

  $("json-file-input").addEventListener("change", function () {
    if (this.files[0]) importJsonFile(this.files[0]);
    this.value = "";
  });
  $("bom-file-input").addEventListener("change", function () {
    if (this.files[0]) loadBomFile(this.files[0]);
    this.value = "";
  });
  $("bom-table-body").addEventListener("change", function (event) {
    if (event.target.matches("[data-bom-select]")) {
      ui.bomRows[Number(event.target.dataset.bomSelect)].selected = event.target.checked;
    }
    if (event.target.matches("[data-bom-match]")) {
      const row = ui.bomRows[Number(event.target.dataset.bomMatch)];
      if (event.target.value) {
        ui.bomRows.forEach(function (otherRow) {
          if (otherRow !== row && otherRow.matchId === event.target.value) {
            otherRow.matchId = "";
            otherRow.selected = false;
            otherRow.status = "unmatched";
            otherRow.score = 0;
          }
        });
      }
      row.matchId = event.target.value;
      row.selected = Boolean(row.matchId);
      row.status = row.matchId ? "matched" : "unmatched";
      row.score = row.matchId ? row.score || 100 : 0;
      renderBomRows();
    }
  });

  $("left-splitter").addEventListener("pointerdown", function (event) { startResize("left", event); });
  $("right-splitter").addEventListener("pointerdown", function (event) { startResize("right", event); });
  $("history-splitter").addEventListener("pointerdown", function (event) { startResize("history", event); });
  $("collapse-left").addEventListener("click", function () {
    state.settings.leftCollapsed = !state.settings.leftCollapsed;
    saveState();
    applySettings();
  });
  $("collapse-right").addEventListener("click", function () {
    state.settings.rightCollapsed = !state.settings.rightCollapsed;
    saveState();
    applySettings();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    closeMenus();
    if (!$("form-modal").hidden) closeFormModal();
    if (!$("columns-modal").hidden) $("columns-modal").hidden = true;
    if (!$("bom-modal").hidden) $("bom-modal").hidden = true;
    if (!$("definitions-modal").hidden) closeDefinitions();
  });
  window.addEventListener("beforeunload", function () {
    if (window.DepoStore.hasFile()) saveState();
  });
  window.addEventListener("depo-file-error", function (event) {
    showToast(event.detail || "Firebase ortak verisine yazılamadı.", true);
  });

  showAuthLoading();
  window.DepoDock.initialize();

  try {
    const restoredState = await window.DepoStore.initialize();
    if (restoredState) useLoadedState(restoredState);
    ensureValidSession();
    applySettings();
    updateFileStatus();
    $("auth-json-status").textContent = "Firebase ortak veri";
    hideAuthLoading();
    openApplication();
    window.setInterval(checkAdministratorExpiration, 15000);
  } catch (error) {
    $("auth-json-status").textContent = "Firebase bağlantı hatası";
    hideAuthLoading();
    showAuthError(friendlyErrorMessage(error, "Firebase başlatılamadı."));
  }
}());
