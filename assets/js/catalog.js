(function () {
  "use strict";

  const STARTER_CATEGORIES = [
    "Resistor",
    "Capacitor",
    "Inductor",
    "Diode",
    "MOSFET",
    "Op-Amp",
    "Microcontroller",
    "Connector",
    "Relay",
    "Switch",
    "Other"
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function categoryId(name) {
    return "category-" + (normalizeText(name) || Math.random().toString(36).slice(2, 9));
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values.map(function (value) {
      return String(value || "").trim();
    }).filter(Boolean))).sort(function (left, right) {
      return left.localeCompare(right, "tr", { numeric: true, sensitivity: "base" });
    });
  }

  function allItems(tables) {
    return (Array.isArray(tables) ? tables : []).flatMap(function (table) {
      return Array.isArray(table.items) ? table.items : [];
    });
  }

  // Old backups may contain category-specific footprint suggestions. During
  // import they are folded into the single global footprint catalog, then the
  // obsolete relationship is discarded.
  function normalizeDefinitions(value, tables) {
    const inputCategories = value && Array.isArray(value.categories)
      ? clone(value.categories)
      : [];
    const categoriesByName = new Map();

    inputCategories.forEach(function (category) {
      const name = String(category && category.name || "").trim();
      if (!name) return;
      categoriesByName.set(normalizeText(name), {
        id: category.id || categoryId(name),
        name: name
      });
    });

    allItems(tables).forEach(function (item) {
      const name = String(item.category || "").trim();
      const key = normalizeText(name);
      if (!name || categoriesByName.has(key)) return;
      categoriesByName.set(key, { id: categoryId(name), name: name });
    });

    if (!categoriesByName.size) {
      STARTER_CATEGORIES.forEach(function (name) {
        categoriesByName.set(normalizeText(name), { id: categoryId(name), name: name });
      });
    }

    const legacyFootprints = inputCategories.flatMap(function (category) {
      return Array.isArray(category && category.footprints) ? category.footprints : [];
    });
    const inputFootprints = value && Array.isArray(value.footprints) ? value.footprints : [];
    const itemFootprints = allItems(tables).map(function (item) {
      return item.footprint;
    });

    return {
      categories: Array.from(categoriesByName.values()).sort(function (left, right) {
        return left.name.localeCompare(right.name, "tr", {
          numeric: true,
          sensitivity: "base"
        });
      }),
      footprints: uniqueSorted(inputFootprints.concat(legacyFootprints, itemFootprints))
    };
  }

  function tableKind(table) {
    if (table && table.kind) return table.kind;
    return normalizeText(table && table.name).includes("kalite-kontrol") ? "quality" : "stock";
  }

  function columnRecord(definition, legacy, visibleColumns, kind) {
    let options = uniqueSorted(definition.options || []);
    if (kind === "stock" && definition.key === "category") {
      options = legacy.categories.map(function (category) { return category.name; });
    }
    if (kind === "stock" && definition.key === "footprint") {
      options = legacy.footprints.slice();
    }
    return {
      key: definition.key,
      label: definition.label,
      visible: kind !== "stock" || !visibleColumns.length || visibleColumns.includes(definition.key),
      system: true,
      fieldType: definition.fieldType || (definition.numeric ? "number" : "text"),
      options: options,
      editable: definition.editable !== false,
      integer: Boolean(definition.integer),
      numeric: definition.fieldType === "number" || Boolean(definition.numeric)
    };
  }

  // Eski JSON/Firebase yapısındaki ayrı kategori ve kılıf kataloglarını bir kez
  // gerçek combobox sütunlarına taşır. Dönüşten sonra `definitions` alanı artık
  // tutulmaz; bütün seçeneklerin tek sahibi ilgili listenin sütun şemasıdır.
  function migrateLegacyState(state, definitionsByKind) {
    if (!state || !Array.isArray(state.tables)) return state;
    const legacy = normalizeDefinitions(state.definitions, state.tables);
    const visibleColumns = state.settings && Array.isArray(state.settings.visibleColumns)
      ? state.settings.visibleColumns
      : [];

    state.tables.forEach(function (table) {
      const kind = tableKind(table);
      table.kind = kind;
      const defaults = definitionsByKind && definitionsByKind[kind] || [];
      if (!Array.isArray(table.columns)) {
        const deletedKeys = new Set(Array.isArray(table.deletedColumnKeys)
          ? table.deletedColumnKeys.map(String)
          : []);
        table.columns = defaults.filter(function (definition) {
          return !deletedKeys.has(definition.key);
        }).map(function (definition) {
          return columnRecord(definition, legacy, visibleColumns, kind);
        });
        return;
      }

      table.columns = table.columns.map(function (source) {
        const column = clone(source);
        const oldSource = column.optionSource;
        const shouldMigrateCategory = kind === "stock" && column.key === "category" &&
          (oldSource === "categories" || !Array.isArray(column.options) || !column.options.length);
        const shouldMigrateFootprint = kind === "stock" && column.key === "footprint" &&
          (oldSource === "footprints" || !Array.isArray(column.options) || !column.options.length);
        if (shouldMigrateCategory) {
          column.options = legacy.categories.map(function (category) { return category.name; });
        } else if (shouldMigrateFootprint) {
          column.options = legacy.footprints.slice();
        }
        delete column.optionSource;
        return column;
      });
    });

    delete state.definitions;
    return state;
  }

  window.DepoCatalog = {
    migrateLegacyState: migrateLegacyState
  };
}());
