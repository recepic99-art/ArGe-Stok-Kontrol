(function () {
  "use strict";

  const stockColumnDefinitions = [
    { key: "id", label: "ID", fieldType: "text", editable: false },
    { key: "name", label: "Malzeme Adı", fieldType: "text" },
    { key: "category", label: "Cins/Kategori", fieldType: "select" },
    { key: "footprint", label: "Kılıf", fieldType: "select" },
    { key: "box", label: "Kutu", fieldType: "text" },
    { key: "quantity", label: "Miktar", fieldType: "number", integer: true, numeric: true },
    {
      key: "unit",
      label: "Birim",
      fieldType: "select",
      options: ["adet", "gram", "metre", "litre"]
    },
    { key: "critical", label: "Kritik Seviye", fieldType: "number", integer: true, numeric: true },
    { key: "description", label: "Açıklama", fieldType: "multiline" },
    { key: "updatedAt", label: "Son Güncelleme", fieldType: "text", editable: false }
  ];

  const qualityColumnDefinitions = [
    { key: "materialName", label: "Malzeme Adı", fieldType: "text" },
    { key: "supplier", label: "Geldiği Yer", fieldType: "text" },
    { key: "incomingQuantity", label: "Gelen Adet", fieldType: "number", integer: true, numeric: true },
    { key: "sampleQuantity", label: "Numune Adedi", fieldType: "number", integer: true, numeric: true },
    { key: "controlMethod", label: "Kontrol Yöntemi", fieldType: "multiline" },
    {
      key: "approvalStatus",
      label: "Onay Durumu",
      fieldType: "select",
      options: ["Beklemede", "Onaylandı", "Şartlı Onay", "Red"]
    },
    { key: "checkedBy", label: "Kontrol Eden", fieldType: "text" },
    { key: "checkedAt", label: "Kontrol Tarihi", fieldType: "date" },
    { key: "description", label: "Açıklama", fieldType: "multiline" },
    { key: "updatedAt", label: "Son Güncelleme", fieldType: "text", editable: false }
  ];

  function migrateLegacyState(state) {
    const migrated = window.DepoCatalog.migrateLegacyState(state, {
      stock: stockColumnDefinitions,
      quality: qualityColumnDefinitions
    });
    migrated.schemaVersion = 11;
    migrated.session = migrated.session || {};
    delete migrated.users;
    delete migrated.session.currentUserId;
    if (typeof migrated.session.operatorName !== "string") {
      migrated.session.operatorName = "";
    }
    return migrated;
  }

  // Yeni bir kurulumda üyelik hesabı oluşturulmaz. Firebase kimliği arka planda
  // anonim açılır; operatör adı yalnızca hareket kaydında görünmek için yerelde tutulur.
  function createInitialState() {
    if (window.DepoSeedState) {
      const seed = JSON.parse(JSON.stringify(window.DepoSeedState));
      return migrateLegacyState(seed);
    }

    const columns = stockColumnDefinitions.map(function (column) {
      return column.key;
    });

    const initialState = {
      schemaVersion: 11,
      tables: [
        { id: "t-main", name: "Numune Malzemeler Listesi", kind: "stock", items: [] }
      ],
      logs: [],
      session: {
        operatorName: "",
        activeTableId: "t-main",
        openTableIds: ["t-main"]
      },
      settings: {
        theme: "light",
        leftWidth: 250,
        rightWidth: 330,
        historyHeight: 38,
        leftCollapsed: false,
        rightCollapsed: false,
        visibleColumns: columns.slice(),
        columnOrder: columns.slice(),
        columnWidths: {
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
        },
        historyColumnWidths: {
          date: 145,
          itemName: 180,
          type: 80,
          quantity: 75,
          purpose: 210,
          user: 120,
          note: 180,
          before: 75,
          after: 75
        }
      }
    };
    return migrateLegacyState(initialState);
  }

  window.DepoData = {
    stockColumnDefinitions: stockColumnDefinitions,
    qualityColumnDefinitions: qualityColumnDefinitions,
    migrateLegacyState: migrateLegacyState,
    createInitialState: createInitialState
  };
}());
