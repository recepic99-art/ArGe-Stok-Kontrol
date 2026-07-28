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
      return JSON.parse(JSON.stringify(window.DepoSeedState));
    }

    const columns = columnDefinitions.map(function (column) {
      return column.key;
    });

    return {
      schemaVersion: 2,
      users: [
        { id: "u-recep", username: "recep", name: "Recep İç" }
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
        columnOrder: columns.slice()
      }
    };
  }

  window.DepoData = {
    columnDefinitions: columnDefinitions,
    createInitialState: createInitialState
  };
}());
