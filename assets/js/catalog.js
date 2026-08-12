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

  function categoryByName(definitions, name) {
    const key = normalizeText(name);
    return ((definitions && definitions.categories) || []).find(function (category) {
      return normalizeText(category.name) === key;
    }) || null;
  }

  function allFootprints(definitions) {
    return uniqueSorted((definitions && definitions.footprints) || []);
  }

  window.DepoCatalog = {
    allFootprints: allFootprints,
    categoryByName: categoryByName,
    categoryId: categoryId,
    clone: clone,
    normalizeDefinitions: normalizeDefinitions,
    normalizeText: normalizeText,
    uniqueSorted: uniqueSorted
  };
}());
