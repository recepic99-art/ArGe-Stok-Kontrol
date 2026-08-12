(function () {
  "use strict";

  const columnDefinitions = [
    { key: "id", label: "ID" },
    { key: "name", label: "Malzeme Adı" },
    { key: "category", label: "Cins/Kategori" },
    { key: "footprint", label: "Kılıf" },
    { key: "box", label: "Kutu" },
    { key: "quantity", label: "Miktar", numeric: true },
    { key: "unit", label: "Birim" },
    { key: "critical", label: "Kritik Seviye", numeric: true },
    { key: "description", label: "Açıklama" },
    { key: "updatedAt", label: "Son Güncelleme" }
  ];

  // Yeni bir JSON dosyası oluşturulduğunda yalnızca gerçek kullanıcı ve boş ana liste gelir.
  function createInitialState() {
    if (window.DepoSeedState) {
      const seed = JSON.parse(JSON.stringify(window.DepoSeedState));
      seed.definitions = window.DepoCatalog.normalizeDefinitions(seed.definitions, seed.tables);
      return seed;
    }

    const columns = columnDefinitions.map(function (column) {
      return column.key;
    });

    const initialState = {
      schemaVersion: 7,
      users: [
        { id: "u-recep", username: "recep", name: "Recep İç", role: "admin" }
      ],
      tables: [
        { id: "t-main", name: "Numune Malzemeler Listesi", items: [] }
      ],
      logs: [],
      session: {
        currentUserId: null,
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
    initialState.definitions = window.DepoCatalog.normalizeDefinitions(null, initialState.tables);
    return initialState;
  }

  window.DepoData = {
    columnDefinitions: columnDefinitions,
    createInitialState: createInitialState
  };
}());
