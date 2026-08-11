(async function () {
  "use strict";

  let state = window.DepoData.createInitialState();

  // Yalnızca o anki ekranda gereken geçici bilgiler ana JSON dosyasına yazılmaz.
  const ui = {
    authMode: "login",
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
    definitionCategoryId: "",
    definitionDraftFootprints: new Set()
  };

  let categoryCombo = null;
  let footprintCombo = null;

  const $ = function (id) {
    return document.getElementById(id);
  };

  const columnMap = new Map(
    window.DepoData.columnDefinitions.map(function (column) {
      return [column.key, column];
    })
  );

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

  function currentUser() {
    return state.users.find(function (user) {
      return user.id === state.session.currentUserId;
    }) || null;
  }

  function currentUserIsAdmin() {
    const user = currentUser();
    return Boolean(user && user.role === "admin");
  }

  function requireAdministrator() {
    if (currentUserIsAdmin()) return true;
    showToast("Bu işlem yalnızca yöneticiler tarafından yapılabilir.", true);
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

  function categoryDefinitions() {
    return state.definitions && Array.isArray(state.definitions.categories)
      ? state.definitions.categories
      : [];
  }

  function categoryDefinition(name) {
    return window.DepoCatalog.categoryByName(state.definitions, name);
  }

  function allDefinedFootprints() {
    return window.DepoCatalog.allFootprints(state.definitions);
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
  }

  // ---------------------------------------------------------------------------
  // Giriş ve kayıt
  // ---------------------------------------------------------------------------

  function setAuthMode(mode) {
    ui.authMode = mode;
    document.querySelectorAll("[data-auth-mode]").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.authMode === mode);
    });
    $("auth-name-field").hidden = mode !== "register";
    $("auth-submit").textContent = mode === "register" ? "Hesap Oluştur" : "Giriş Yap";
    $("auth-password").autocomplete = "off";
    $("auth-error").hidden = true;
  }

  function showAuthError(message) {
    $("auth-error").textContent = message;
    $("auth-error").hidden = false;
  }

  function showAuthLoading() {
    $("auth-title").textContent = "Bağlantı kuruluyor";
    $("auth-subtitle").textContent = "Oturumunuz kontrol ediliyor";
    $("auth-loading").hidden = false;
    $("auth-controls").hidden = true;
    $("auth-error").hidden = true;
  }

  function showAuthControls() {
    $("auth-title").textContent = "Hoş geldiniz";
    $("auth-subtitle").textContent = "Hesabınızla devam edin";
    $("auth-loading").hidden = true;
    $("auth-controls").hidden = false;
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
    // Firebase oturumu açıksa kullanıcı kimliği korunur ve sayfa yenilenince devam edilir.
    ui.activeItemId = null;
    ui.checkedIds.clear();
    ui.formItemId = null;
    ensureValidSession();
    applySettings();
    updateFileStatus();
    $("auth-error").hidden = true;
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    const username = $("auth-username").value.trim();
    const password = $("auth-password").value;

    if (!username || !password) {
      showAuthError("Kullanıcı adı ve şifre zorunludur.");
      return;
    }

    const submitButton = $("auth-submit");
    submitButton.disabled = true;
    submitButton.textContent = "Bağlanıyor...";
    $("auth-error").hidden = true;

    try {
      if (ui.authMode === "login") {
        state = await window.DepoStore.signIn(username, password);
      } else {
        const name = $("auth-name").value.trim();
        if (!name) {
          showAuthError("Ad soyad alanı zorunludur.");
          return;
        }
        state = await window.DepoStore.register(username, password, name);
      }
      openApplication();
    } catch (error) {
      showAuthError(friendlyErrorMessage(error, "Firebase bağlantısı kurulamadı."));
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = ui.authMode === "register" ? "Hesap Oluştur" : "Giriş Yap";
    }
  }

  function openApplication() {
    ensureValidSession();
    $("auth-overlay").hidden = true;
    $("app").setAttribute("aria-hidden", "false");
    applySettings();
    renderAll(true);
    window.DepoStore.watch(function (cloudState) {
      const currentUserId = state.session.currentUserId;
      cloudState.session.currentUserId = currentUserId;
      state = cloudState;
      ensureValidSession();
      renderAll(false);
    });
  }

  function signOut() {
    openFormModal({
      title: "Oturumu kapat",
      message: "Oturumu kapatmak istiyor musunuz?",
      submitLabel: "Çıkış Yap",
      submitStyle: "danger",
      onSubmit: async function () {
        await window.DepoStore.signOut();
        state.session.currentUserId = null;
        saveState();
        $("app").setAttribute("aria-hidden", "true");
        $("auth-overlay").hidden = false;
        $("auth-password").value = "";
        setAuthMode("login");
        showAuthControls();
        return true;
      }
    });
  }

  function editCurrentAccount() {
    const user = currentUser();
    if (!user) return;

    openFormModal({
      title: "Hesap bilgileri",
      message: "Kullanıcı adını değiştiriyorsanız mevcut şifrenizi de yazın.",
      fields: [
        { name: "name", label: "Ad Soyad", value: user.name, required: true },
        { name: "username", label: "Kullanıcı adı", value: user.username, required: true },
        {
          name: "currentPassword",
          label: "Mevcut şifre",
          type: "password",
          autocomplete: "current-password",
          placeholder: "Yalnızca kullanıcı adı değişecekse gerekli"
        }
      ],
      submitLabel: "Bilgileri Kaydet",
      onSubmit: async function (values) {
        const updated = await window.DepoStore.updateCurrentUserProfile({
          name: values.name,
          username: values.username,
          currentPassword: values.currentPassword
        });
        Object.assign(user, updated);
        $("auth-username").value = updated.username;
        renderAll(false);
        showToast("Hesap bilgileri güncellendi.");
        return true;
      }
    });
  }

  function changeCurrentPassword() {
    openFormModal({
      title: "Şifreyi değiştir",
      fields: [
        {
          name: "currentPassword",
          label: "Mevcut şifre",
          type: "password",
          autocomplete: "current-password",
          required: true
        },
        {
          name: "newPassword",
          label: "Yeni şifre",
          type: "password",
          autocomplete: "new-password",
          required: true
        },
        {
          name: "confirmPassword",
          label: "Yeni şifre tekrar",
          type: "password",
          autocomplete: "new-password",
          required: true
        }
      ],
      submitLabel: "Şifreyi Değiştir",
      onSubmit: async function (values) {
        if (values.newPassword !== values.confirmPassword) {
          throw new Error("Yeni şifreler birbiriyle aynı değil.");
        }
        await window.DepoStore.changeCurrentUserPassword(
          values.currentPassword,
          values.newPassword
        );
        showToast("Şifreniz değiştirildi.");
        return true;
      }
    });
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
      ["Kullanıcılar", renderUsersPanel],
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
    const user = currentUser();
    const active = activeTableReference();
    const fileName = window.DepoStore.fileName() || "JSON bağlı değil";
    const context = fileName + (active ? " / " + active.table.name : "");
    $("header-context").textContent = context;
    $("current-user-button").textContent = user
      ? user.name + (user.role === "admin" ? " · Yönetici" : " · Üye")
      : "Kullanıcı";
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

  function renderUsersPanel() {
    if (!currentUserIsAdmin()) {
      $("users-summary").textContent = "";
      $("user-list").innerHTML = "";
      return;
    }
    const signedUpUsers = state.users.filter(function (user) {
      return Boolean(user.authUid);
    });
    $("users-summary").textContent = signedUpUsers.length + " kayıtlı kullanıcı";
    $("user-list").innerHTML = signedUpUsers.map(function (user) {
      const isCurrent = user.id === state.session.currentUserId;
      return '<div class="user-list-item">' +
        '<span class="user-avatar">' + escapeHtml((user.name || user.username).slice(0, 1).toUpperCase()) + '</span>' +
        '<span class="user-identity"><strong>' + escapeHtml(user.name || user.username) + '</strong>' +
        '<small>@' + escapeHtml(user.username) + (isCurrent ? " · Siz" : "") + '</small></span>' +
        '<select class="user-role-select" data-user-role-id="' + escapeHtml(user.id) + '"' +
        ' aria-label="Kullanıcı yetkisi">' +
        '<option value="member"' + (user.role !== "admin" ? " selected" : "") + '>Üye</option>' +
        '<option value="admin"' + (user.role === "admin" ? " selected" : "") + '>Yönetici</option>' +
        '</select></div>';
    }).join("");
  }

  async function changeUserRole(userId, role) {
    if (!requireAdministrator()) return;
    const user = state.users.find(function (entry) { return entry.id === userId; });
    if (!user || !["admin", "member"].includes(role)) return;

    const previousRole = user.role;
    user.role = role;
    renderUsersPanel();

    try {
      await window.DepoStore.setUserRole(userId, role);
      showToast(user.name + " artık " + (role === "admin" ? "yönetici." : "üye."));
    } catch (error) {
      user.role = previousRole;
      renderUsersPanel();
      showToast(friendlyErrorMessage(error, "Kullanıcı yetkisi değiştirilemedi."), true);
    }
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
    const widths = group === "history"
      ? state.settings.historyColumnWidths
      : state.settings.columnWidths;
    const fallback = group === "history"
      ? defaultHistoryColumnWidths[key]
      : defaultColumnWidths[key];
    return Math.max(55, Number(widths[key]) || fallback || 100);
  }

  function columnWidthStyle(group, key) {
    const width = savedColumnWidth(group, key);
    return "width:" + width + "px;min-width:" + width + "px;max-width:" + width + "px";
  }

  function orderedVisibleColumns() {
    const visible = new Set(state.settings.visibleColumns);
    return state.settings.columnOrder
      .filter(function (key) { return visible.has(key) && columnMap.has(key); })
      .map(function (key) { return columnMap.get(key); });
  }

  function fuzzyMatch(query, item) {
    if (!query) return true;
    const normalizedQuery = normalizeText(query);
    const fields = [
      item.id, item.name, item.category, item.footprint,
      item.box, item.description
    ].map(normalizeText);
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
    const query = $("stock-search").value.trim();
    const criticalOnly = $("critical-only").checked;
    const items = active.table.items.filter(function (item) {
      const isCritical = Number(item.quantity) <= Number(item.critical);
      return (!criticalOnly || isCritical) && fuzzyMatch(query, item);
    });
    const direction = ui.sortDirection === "asc" ? 1 : -1;
    return items.sort(function (left, right) {
      const leftValue = left[ui.sortKey];
      const rightValue = right[ui.sortKey];
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return (leftValue - rightValue) * direction;
      }
      return String(leftValue || "").localeCompare(String(rightValue || ""), "tr", {
        numeric: true,
        sensitivity: "base"
      }) * direction;
    });
  }

  function stockClass(item) {
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
    const allVisibleChecked = visibleItems.length > 0 && visibleItems.every(function (item) {
      return ui.checkedIds.has(item.id);
    });

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
          return '<td data-stock-column="' + escapeHtml(column.key) + '" style="' +
            columnWidthStyle("stock", column.key) + '" title="' +
            escapeHtml(item[column.key]) + '">' +
            escapeHtml(item[column.key]) + "</td>";
        }).join("") + "</tr>";
    }).join("");

    $("stock-count").textContent = active.table.items.length + " malzeme / " + ui.checkedIds.size + " seçili";
  }

  function sortByColumn(key) {
    if (!columnMap.has(key)) return;
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
    const order = state.settings.columnOrder.filter(function (key) { return key !== draggedKey; });
    let targetIndex = order.indexOf(targetKey);
    if (targetIndex < 0) return;
    if (placeAfter) targetIndex += 1;
    order.splice(targetIndex, 0, draggedKey);
    state.settings.columnOrder = order;
    saveState();
    renderStockTable();
  }

  function renderColumnsModal() {
    const visible = new Set(state.settings.visibleColumns);
    $("columns-list").innerHTML = state.settings.columnOrder.map(function (key) {
      const column = columnMap.get(key);
      if (!column) return "";
      return '<label class="column-option"><input type="checkbox" data-column-key="' +
        escapeHtml(key) + '"' + (visible.has(key) ? " checked" : "") + ">" +
        escapeHtml(column.label) + "</label>";
    }).join("");
  }

  // ---------------------------------------------------------------------------
  // Stok kartı ve giriş/çıkış
  // ---------------------------------------------------------------------------

  function generatedItemId() {
    const active = activeTableReference();
    if (!active) return "NUM0001";
    let number = active.table.items.length + 1;
    let candidate = "NUM" + String(number).padStart(4, "0");
    while (active.table.items.some(function (item) { return item.id === candidate; })) {
      number += 1;
      candidate = "NUM" + String(number).padStart(4, "0");
    }
    return candidate;
  }

  function categoryComboOptions() {
    return categoryDefinitions().map(function (category) {
      return category.name;
    });
  }

  function footprintComboOptions() {
    const category = categoryDefinition($("item-category").value);
    const preferred = category ? category.footprints || [] : [];
    const preferredSet = new Set(preferred);
    return preferred.map(function (footprint) {
      return { value: footprint, group: "Önerilen" };
    }).concat(allDefinedFootprints().filter(function (footprint) {
      return !preferredSet.has(footprint);
    }).map(function (footprint) {
      return { value: footprint, group: "Diğer kılıflar" };
    }));
  }

  function syncFootprintField(clearWhenHidden) {
    const category = categoryDefinition($("item-category").value);
    const mode = category ? category.footprintMode : "optional";
    const hidden = mode === "hidden";
    const input = $("item-footprint");
    const toggle = $("item-footprint-toggle");

    $("item-footprint-label").hidden = hidden;
    input.disabled = hidden;
    toggle.disabled = hidden;
    input.required = mode === "required";
    input.placeholder = mode === "required" ? "Kılıf seçin (zorunlu)" : "Kılıf seçin (isteğe bağlı)";
    if (hidden && clearWhenHidden) input.value = "";
    if (footprintCombo) footprintCombo.refresh();
  }

  function setStockForm(item) {
    $("item-id").value = item ? item.id : generatedItemId();
    $("item-name").value = item ? item.name : "";
    $("item-category").value = item ? item.category : "";
    $("item-footprint").value = item ? item.footprint : "";
    $("item-box").value = item ? item.box : "";
    $("item-quantity").value = item ? item.quantity : 0;
    $("item-unit").value = item && ["adet", "gram", "metre", "litre"].includes(item.unit) ? item.unit : "adet";
    $("item-critical").value = item ? item.critical : 0;
    $("item-description").value = item ? item.description : "";
    syncFootprintField(false);
    if (categoryCombo) categoryCombo.refresh();
    if (footprintCombo) footprintCombo.refresh();
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
    if (!requireAdministrator()) return;
    const active = activeTableReference();
    if (!active) {
      showToast("Önce bir tablo açın.", true);
      return;
    }
    ui.formMode = "new";
    ui.formItemId = "";
    ui.activeItemId = null;
    // Seri kart girişinde mevcut bilgiler korunur; yalnızca yeni ve benzersiz ID hazırlanır.
    $("item-id").value = generatedItemId();
    setRightTab("stock-card");
    renderStockTable();
    $("item-name").focus();
  }

  function readStockForm() {
    return {
      id: $("item-id").value.trim(),
      name: $("item-name").value.trim(),
      category: $("item-category").value.trim(),
      footprint: $("item-footprint").value.trim(),
      box: $("item-box").value.trim(),
      quantity: integerValue($("item-quantity"), NaN),
      unit: $("item-unit").value,
      critical: integerValue($("item-critical"), NaN),
      description: $("item-description").value.trim(),
      updatedAt: nowText()
    };
  }

  function saveStockCard(event) {
    event.preventDefault();
    if (!requireAdministrator()) return;
    const active = activeTableReference();
    if (!active) {
      showToast("Önce bir liste açın.", true);
      return;
    }
    const values = readStockForm();
    if (!values.name) {
      showToast("Malzeme adı boş bırakılamaz.", true);
      $("item-name").focus();
      return;
    }
    const category = categoryDefinition(values.category);
    if (!category) {
      showToast("Geçerli bir kategori seçin.", true);
      $("item-category").focus();
      return;
    }
    if (!Number.isInteger(values.quantity) || values.quantity < 0) {
      showToast("Miktar sıfır veya daha büyük bir tam sayı olmalıdır.", true);
      $("item-quantity").focus();
      return;
    }
    if (!Number.isInteger(values.critical) || values.critical < 0) {
      showToast("Kritik seviye sıfır veya daha büyük bir tam sayı olmalıdır.", true);
      $("item-critical").focus();
      return;
    }
    if (category.footprintMode === "hidden") values.footprint = "";
    if (category.footprintMode === "required" && !values.footprint) {
      showToast("Bu kategori için kılıf seçimi zorunludur.", true);
      $("item-footprint").focus();
      return;
    }
    if (values.footprint && !allDefinedFootprints().includes(values.footprint)) {
      showToast("Kılıfı tanımlı seçeneklerden seçin.", true);
      $("item-footprint").focus();
      return;
    }

    if (ui.formMode === "new") {
      active.table.items.push(values);
      ui.activeItemId = values.id;
      ui.formMode = "existing";
      ui.formItemId = values.id;
      showToast("Yeni stok kartı eklendi.");
    } else {
      const item = activeItem();
      if (!item) {
        showToast("Düzenlenecek stok kartını seçin.", true);
        return;
      }
      Object.assign(item, values, { id: item.id });
      showToast("Stok kartı kaydedildi.");
    }
    saveState();
    renderAll(true);
  }

  function deleteSelectedCards() {
    if (!requireAdministrator()) return;
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
    const user = currentUser();
    const targets = movementTargetItems();
    const entryOption = Array.from($("movement-type").options).find(function (option) {
      return option.value === "Giriş";
    });
    const entryAllowed = currentUserIsAdmin();
    if (entryOption) {
      entryOption.hidden = !entryAllowed;
      entryOption.disabled = !entryAllowed;
    }
    if (!entryAllowed && $("movement-type").value === "Giriş") {
      $("movement-type").value = "Çıkış";
    }
    $("movement-user").textContent = user ? user.name : "";
    $("movement-selection").textContent = targets.length
      ? (targets.length === 1 ? targets[0].name : targets.length + " malzeme seçili")
      : "Seçim yok";
    const isExit = $("movement-type").value === "Çıkış";
    $("movement-purpose-label").hidden = !isExit;
    $("movement-purpose").hidden = !isExit;
  }

  function processMovement(event) {
    event.preventDefault();
    const active = activeTableReference();
    const targets = movementTargetItems();
    const quantity = integerValue($("movement-quantity"), NaN);
    const type = $("movement-type").value;
    const purpose = $("movement-purpose").value.trim();
    const note = $("movement-note").value.trim();
    const user = currentUser();

    if (type === "Giriş" && !currentUserIsAdmin()) {
      showToast("Üyeler yalnızca stok çıkışı yapabilir.", true);
      $("movement-type").value = "Çıkış";
      syncMovementForm();
      return;
    }
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
      showToast("Yetersiz stok: " + insufficient.map(function (item) { return item.name; }).join(", "), true);
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
        itemName: item.name,
        date: nowText(),
        type: type,
        quantity: quantity,
        purpose: type === "Çıkış" ? purpose : "",
        user: user ? user.name : "",
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
    const isAdministrator = currentUserIsAdmin();
    const mayManage = Boolean(active && isAdministrator);
    const stockTab = document.querySelector('[data-right-tab="stock-card"]');
    const usersTab = document.querySelector('[data-left-tab="users"]');
    const usersMenuItem = document.querySelector('[data-action="show-panel-users"]');
    if (stockTab) stockTab.hidden = !isAdministrator;
    if (usersTab) usersTab.hidden = !isAdministrator;
    if (usersMenuItem) usersMenuItem.hidden = !isAdministrator;
    if (window.DepoDock) window.DepoDock.setPanelAllowed("stock-card", isAdministrator);
    if (window.DepoDock) window.DepoDock.setPanelAllowed("users", isAdministrator);
    if (!isAdministrator && ui.leftTab === "users") setLeftTab("lists");
    if (!mayManage && ui.rightTab === "stock-card") setRightTab("movement");
    document.querySelectorAll('[data-action="new-card"], [data-action="delete-card"]').forEach(function (button) {
      button.disabled = !mayManage;
    });
    const newTableButton = $("new-table-button");
    if (newTableButton) newTableButton.disabled = !isAdministrator;
    const importButton = document.querySelector('[data-action="import-json"]');
    if (importButton) importButton.hidden = !isAdministrator;
    const definitionsButton = document.querySelector('[data-action="open-definitions"]');
    if (definitionsButton) definitionsButton.hidden = !isAdministrator;
  }

  // ---------------------------------------------------------------------------
  // Hareket geçmişi
  // ---------------------------------------------------------------------------

  function historyItemName(log) {
    if (log.itemName) return log.itemName;
    const table = tableById(log.tableId);
    if (!table) return "";
    const item = table.items.find(function (entry) { return entry.id === log.itemId; });
    return item ? item.name : "";
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
    if (!requireAdministrator()) return;
    openFormModal({
      title: "Yeni liste",
      fields: [
        { name: "name", label: "Liste adı", required: true }
      ],
      submitLabel: "Oluştur",
      onSubmit: function (values) {
        const name = values.name.trim();
        if (!name) throw new Error("Liste adı zorunludur.");
        const duplicate = state.tables.some(function (table) {
          return normalizeText(table.name) === normalizeText(name);
        });
        if (duplicate) throw new Error("Bu isimde bir liste zaten var.");
        const table = { id: uid("table"), name: name, items: [] };
        state.tables.push(table);
        openTable(table.id);
        showToast("Yeni liste oluşturuldu.");
        return true;
      }
    });
  }

  function openTableContextMenu(tableId, clientX, clientY) {
    if (!requireAdministrator()) return;
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
    if (!requireAdministrator()) return;
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
    if (!requireAdministrator()) return;
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
  // Kategori ve kılıf tanımları
  // ---------------------------------------------------------------------------

  function categoryUsageCount(name) {
    const key = window.DepoCatalog.normalizeText(name);
    return state.tables.reduce(function (total, table) {
      return total + table.items.filter(function (item) {
        return window.DepoCatalog.normalizeText(item.category) === key;
      }).length;
    }, 0);
  }

  function selectedDefinition() {
    return categoryDefinitions().find(function (category) {
      return category.id === ui.definitionCategoryId;
    }) || null;
  }

  function showDefinitionError(message) {
    $("definition-error").textContent = message;
    $("definition-error").hidden = !message;
  }

  function renderDefinitionCategoryList() {
    const query = normalizeText($("definition-search").value);
    $("definition-category-list").innerHTML = categoryDefinitions().filter(function (category) {
      return !query || normalizeText(category.name).includes(query);
    }).map(function (category) {
      return '<button type="button" class="definition-category-button' +
        (category.id === ui.definitionCategoryId ? " is-active" : "") +
        '" data-definition-category="' + escapeHtml(category.id) + '">' +
        '<span>' + escapeHtml(category.name) + '</span><small>' +
        categoryUsageCount(category.name) + "</small></button>";
    }).join("");
  }

  function renderDefinitionFootprints() {
    const query = normalizeText($("definition-footprint-search").value);
    const values = window.DepoCatalog.uniqueSorted(
      allDefinedFootprints().concat(Array.from(ui.definitionDraftFootprints))
    ).filter(function (footprint) {
      return !query || normalizeText(footprint).includes(query);
    });

    $("definition-footprint-list").innerHTML = values.length
      ? values.map(function (footprint) {
        return '<label class="definition-footprint-option"><input type="checkbox" ' +
          'data-definition-footprint="' + escapeHtml(footprint) + '"' +
          (ui.definitionDraftFootprints.has(footprint) ? " checked" : "") + "><span>" +
          escapeHtml(footprint) + "</span></label>";
      }).join("")
      : '<div class="combo-empty">Tanımlı kılıf yok</div>';
  }

  function loadDefinitionEditor(categoryId) {
    const category = categoryDefinitions().find(function (entry) {
      return entry.id === categoryId;
    }) || null;
    ui.definitionCategoryId = category ? category.id : "";
    ui.definitionDraftFootprints = new Set(category ? category.footprints : []);
    $("definition-id").value = category ? category.id : "";
    $("definition-name").value = category ? category.name : "";
    $("definition-footprint-mode").value = category ? category.footprintMode : "optional";
    $("delete-definition").hidden = !category;
    $("definition-new-footprint").value = "";
    $("definition-footprint-search").value = "";
    showDefinitionError("");
    renderDefinitionCategoryList();
    renderDefinitionFootprints();
    $("definition-footprints-section").hidden = $("definition-footprint-mode").value === "hidden";
    window.setTimeout(function () { $("definition-name").focus(); }, 0);
  }

  function openDefinitions() {
    if (!requireAdministrator()) return;
    state.definitions = window.DepoCatalog.normalizeDefinitions(state.definitions, state.tables);
    $("definitions-modal").hidden = false;
    $("definition-search").value = "";
    const first = categoryDefinitions()[0];
    loadDefinitionEditor(first ? first.id : "");
  }

  function closeDefinitions() {
    $("definitions-modal").hidden = true;
    ui.definitionCategoryId = "";
    ui.definitionDraftFootprints.clear();
  }

  function addDefinitionFootprint() {
    const value = $("definition-new-footprint").value.trim();
    if (!value) {
      $("definition-new-footprint").focus();
      return;
    }
    const existing = allDefinedFootprints().find(function (footprint) {
      return normalizeText(footprint) === normalizeText(value);
    });
    ui.definitionDraftFootprints.add(existing || value);
    $("definition-new-footprint").value = "";
    renderDefinitionFootprints();
  }

  function saveDefinition(event) {
    event.preventDefault();
    if (!requireAdministrator()) return;
    const id = $("definition-id").value;
    const name = $("definition-name").value.trim();
    const mode = $("definition-footprint-mode").value;
    const current = selectedDefinition();

    if (!name) {
      showDefinitionError("Kategori adı zorunludur.");
      return;
    }
    const duplicate = categoryDefinitions().some(function (category) {
      return category.id !== id && normalizeText(category.name) === normalizeText(name);
    });
    if (duplicate) {
      showDefinitionError("Bu isimde bir kategori zaten var.");
      return;
    }

    const definition = {
      id: id || uid("category"),
      name: name,
      footprintMode: ["required", "optional", "hidden"].includes(mode) ? mode : "optional",
      footprints: mode === "hidden"
        ? []
        : window.DepoCatalog.uniqueSorted(Array.from(ui.definitionDraftFootprints))
    };

    if (current) {
      if (current.name !== name) {
        state.tables.forEach(function (table) {
          table.items.forEach(function (item) {
            if (normalizeText(item.category) === normalizeText(current.name)) item.category = name;
          });
        });
      }
      Object.assign(current, definition);
    } else {
      state.definitions.categories.push(definition);
    }

    state.definitions = window.DepoCatalog.normalizeDefinitions(state.definitions, state.tables);
    saveState();
    renderAll(true);
    loadDefinitionEditor(definition.id);
    showToast("Kategori tanımı kaydedildi.");
  }

  function deleteDefinition() {
    if (!requireAdministrator()) return;
    const category = selectedDefinition();
    if (!category) return;
    const usage = categoryUsageCount(category.name);
    if (usage) {
      showDefinitionError("Bu kategori " + usage + " stok kartında kullanılıyor. Önce kartları başka kategoriye taşıyın.");
      return;
    }
    state.definitions.categories = categoryDefinitions().filter(function (entry) {
      return entry.id !== category.id;
    });
    saveState();
    const first = categoryDefinitions()[0];
    loadDefinitionEditor(first ? first.id : "");
    renderAll(false);
    showToast("Kategori tanımı silindi.");
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
    if (!requireAdministrator()) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const imported = JSON.parse(reader.result);
        openFormModal({
          title: "JSON yedeğini içe aktar",
          message: "Firebase'deki mevcut listeler ve hareketler bu yedekle değiştirilecek.",
          submitLabel: "İçe Aktar",
          submitStyle: "danger",
          onSubmit: function () {
            const signedInUser = currentUser();
            state = window.DepoStore.replace(imported);
            if (signedInUser) {
              let importedUser = state.users.find(function (user) {
                return normalizeText(user.username) === normalizeText(signedInUser.username);
              });
              if (!importedUser) {
                importedUser = window.DepoStore.clone(signedInUser);
                state.users.push(importedUser);
              }
              state.session.currentUserId = importedUser.id;
              saveState();
            }
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
    const columns = window.DepoData.columnDefinitions;
    const lines = [
      columns.map(function (column) { return csvCell(column.label); }).join(";")
    ];
    active.table.items.forEach(function (item) {
      lines.push(columns.map(function (column) {
        return csvCell(item[column.key]);
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
    if (!activeTableReference()) {
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
    const nameText = normalizeText(item.name);
    if (!nameText) return 0;
    if (descriptionText === nameText) return 100;
    if (descriptionText.includes(nameText)) return Math.min(99, 72 + Math.round(nameText.length / 4));
    const code = normalizeText(item.name.split(/\s+/)[0]);
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
      const details = [item.name, item.footprint, item.box].filter(Boolean).join(" / ");
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
    const user = currentUser();
    selectedRows.forEach(function (row) {
      const item = active.table.items.find(function (entry) { return entry.id === row.matchId; });
      const before = Number(item.quantity);
      item.quantity = before - row.quantity;
      item.updatedAt = nowText();
      state.logs.unshift({
        id: uid("log"),
        tableId: active.table.id,
        itemId: item.id,
        itemName: item.name,
        date: nowText(),
        type: "Çıkış",
        quantity: row.quantity,
        purpose: purpose,
        user: user ? user.name : "",
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
      widths[key] = Math.max(55, Math.min(600, Math.round(width)));
      document.querySelectorAll("[" + attribute + '="' + key + '"]').forEach(function (cell) {
        cell.style.width = widths[key] + "px";
        cell.style.minWidth = widths[key] + "px";
        cell.style.maxWidth = widths[key] + "px";
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
        if (requireAdministrator()) $("json-file-input").click();
      },
      "export-json": exportJson,
      "export-csv": exportActiveTableCsv,
      "open-bom": openBom,
      "edit-account": editCurrentAccount,
      "change-password": changeCurrentPassword,
      "sign-out": signOut,
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
      "new-definition": function () { loadDefinitionEditor(""); },
      "add-definition-footprint": addDefinitionFootprint,
      "delete-definition": deleteDefinition,
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
      "show-panel-users": function () {
        if (currentUserIsAdmin()) window.DepoDock.togglePanel("users");
      },
      "show-panel-stock": function () { window.DepoDock.togglePanel("stock"); },
      "show-panel-stock-card": function () {
        if (currentUserIsAdmin()) window.DepoDock.togglePanel("stock-card");
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
        window.alert("Ar-Ge Numune Depo\n\nKullanıcılar, listeler ve hareketler Firebase ortak verisinde tutulur.");
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
        state.settings.visibleColumns = window.DepoData.columnDefinitions.map(function (column) { return column.key; });
        state.settings.columnOrder = state.settings.visibleColumns.slice();
        state.settings.columnWidths = Object.assign({}, defaultColumnWidths);
        state.settings.historyColumnWidths = Object.assign({}, defaultHistoryColumnWidths);
        saveState();
        renderColumnsModal();
        renderStockTable();
        renderHistory();
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

  document.querySelectorAll("[data-auth-mode]").forEach(function (button) {
    button.addEventListener("click", function () {
      setAuthMode(button.dataset.authMode);
    });
  });
  $("auth-form").addEventListener("submit", handleAuthSubmit);
  $("show-password").addEventListener("change", function () {
    $("auth-password").type = this.checked ? "text" : "password";
  });
  $("json-file-button").addEventListener("click", function () {
    showToast("Veriler Firebase Realtime Database ile ortak kullanılıyor.");
  });
  document.querySelectorAll("[data-left-tab]").forEach(function (button) {
    button.addEventListener("click", function () {
      if (button.dataset.leftTab === "users" && !currentUserIsAdmin()) return;
      setLeftTab(button.dataset.leftTab);
    });
  });
  $("user-list").addEventListener("change", function (event) {
    const select = event.target.closest("[data-user-role-id]");
    if (select) changeUserRole(select.dataset.userRoleId, select.value);
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
  $("item-category").addEventListener("change", function () {
    syncFootprintField(true);
  });
  $("movement-panel").addEventListener("submit", processMovement);
  $("movement-type").addEventListener("change", syncMovementForm);
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
    const key = checkbox.dataset.columnKey;
    const visible = new Set(state.settings.visibleColumns);
    if (checkbox.checked) visible.add(key);
    else visible.delete(key);
    state.settings.visibleColumns = state.settings.columnOrder.filter(function (columnKey) {
      return visible.has(columnKey);
    });
    saveState();
    renderStockTable();
  });

  $("definition-form").addEventListener("submit", saveDefinition);
  $("definition-search").addEventListener("input", renderDefinitionCategoryList);
  $("definition-category-list").addEventListener("click", function (event) {
    const button = event.target.closest("[data-definition-category]");
    if (button) loadDefinitionEditor(button.dataset.definitionCategory);
  });
  $("definition-footprint-mode").addEventListener("change", function () {
    $("definition-footprints-section").hidden = this.value === "hidden";
  });
  $("definition-footprint-search").addEventListener("input", renderDefinitionFootprints);
  $("definition-footprint-list").addEventListener("change", function (event) {
    const checkbox = event.target.closest("[data-definition-footprint]");
    if (!checkbox) return;
    if (checkbox.checked) ui.definitionDraftFootprints.add(checkbox.dataset.definitionFootprint);
    else ui.definitionDraftFootprints.delete(checkbox.dataset.definitionFootprint);
  });
  $("definition-new-footprint").addEventListener("keydown", function (event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addDefinitionFootprint();
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

  categoryCombo = window.DepoCombo.attach(
    $("item-category"),
    $("item-category-toggle"),
    categoryComboOptions
  );
  footprintCombo = window.DepoCombo.attach(
    $("item-footprint"),
    $("item-footprint-toggle"),
    footprintComboOptions
  );

  showAuthLoading();
  window.DepoDock.initialize();

  try {
    const restoredState = await window.DepoStore.initialize();
    if (restoredState) useLoadedState(restoredState);
    ensureValidSession();
    applySettings();
    updateFileStatus();
    setAuthMode("login");
    $("auth-json-status").textContent = "Firebase ortak veri";
    if (state.session.currentUserId) {
      openApplication();
    } else {
      showAuthControls();
    }
  } catch (error) {
    $("auth-json-status").textContent = "Firebase bağlantı hatası";
    showAuthControls();
    showAuthError(friendlyErrorMessage(error, "Firebase başlatılamadı."));
  }
}());
