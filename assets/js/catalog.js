(function () {
  "use strict";

  const HIDDEN_FOOTPRINT_CATEGORIES = new Set([
    "Development Board",
    "Development Tool",
    "Interface Converter"
  ]);

  const OPTIONAL_FOOTPRINT_CATEGORIES = new Set([
    "Buzzer",
    "Connector",
    "LCD",
    "LED",
    "Reed Switch",
    "Relay",
    "Sensor",
    "Switch",
    "Terminal Block",
    "Trimpot",
    "Wireless Module",
    "Aluminum Electrolytic Capacitor",
    "Other"
  ]);

  const STARTER_CATEGORIES = [
    "Resistor",
    "Capacitor",
    "Aluminum Electrolytic Capacitor",
    "Inductor",
    "Ferrite Bead",
    "Diode",
    "Zener Diode",
    "Schottky Diode",
    "TVS Diode",
    "MOSFET",
    "Op-Amp",
    "Microcontroller",
    "Connector",
    "Relay",
    "Sensor",
    "Switch",
    "Development Board",
    "Development Tool",
    "Interface Converter",
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
      .replace(/ı/g, "i")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function categoryId(name) {
    return "category-" + (normalizeText(name) || Math.random().toString(36).slice(2, 9));
  }

  function defaultFootprintMode(name) {
    if (HIDDEN_FOOTPRINT_CATEGORIES.has(name)) return "hidden";
    if (OPTIONAL_FOOTPRINT_CATEGORIES.has(name)) return "optional";
    return "required";
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values.filter(Boolean))).sort(function (left, right) {
      return left.localeCompare(right, "tr", { numeric: true, sensitivity: "base" });
    });
  }

  function allItems(tables) {
    return (Array.isArray(tables) ? tables : []).flatMap(function (table) {
      return Array.isArray(table.items) ? table.items : [];
    });
  }

  // Eski JSON dosyalarında tanım listesi yoktur. Bu durumda mevcut kartlardan
  // kategori ve kılıfları toplayarak kayıpsız bir başlangıç listesi üretiriz.
  function normalizeDefinitions(value, tables) {
    const inputCategories = value && Array.isArray(value.categories)
      ? clone(value.categories)
      : [];
    const inputFootprints = value && Array.isArray(value.footprints)
      ? clone(value.footprints)
      : [];
    const categoriesByName = new Map();

    inputCategories.forEach(function (category) {
      const name = String(category && category.name || "").trim();
      if (!name) return;
      categoriesByName.set(normalizeText(name), {
        id: category.id || categoryId(name),
        name: name,
        footprintMode: ["required", "optional", "hidden"].includes(category.footprintMode)
          ? category.footprintMode
          : defaultFootprintMode(name),
        footprints: uniqueSorted(Array.isArray(category.footprints) ? category.footprints : [])
      });
    });

    allItems(tables).forEach(function (item) {
      const name = String(item.category || "").trim();
      if (!name) return;
      const key = normalizeText(name);
      let category = categoriesByName.get(key);
      if (!category) {
        category = {
          id: categoryId(name),
          name: name,
          footprintMode: defaultFootprintMode(name),
          footprints: []
        };
        categoriesByName.set(key, category);
      }
      const footprint = String(item.footprint || "").trim();
      if (footprint && !category.footprints.includes(footprint)) {
        category.footprints.push(footprint);
        category.footprints = uniqueSorted(category.footprints);
      }
    });

    // Başlangıç seçenekleri yalnızca tamamen boş yeni kurulumda oluşturulur.
    // Tanım ekranından silinen bir kategori her normalizasyonda geri gelmemelidir.
    if (!inputCategories.length && !categoriesByName.size) {
      STARTER_CATEGORIES.forEach(function (name) {
        categoriesByName.set(normalizeText(name), {
          id: categoryId(name),
          name: name,
          footprintMode: defaultFootprintMode(name),
          footprints: []
        });
      });
    }

    const categories = Array.from(categoriesByName.values()).sort(function (left, right) {
        return left.name.localeCompare(right.name, "tr", {
          numeric: true,
          sensitivity: "base"
        });
      });

    // Kılıflar kategorilerden bağımsız bir katalog olarak da tutulur. Böylece
    // henüz hiçbir kategoriye bağlanmamış yeni bir kılıf kaybolmadan saklanabilir.
    const footprints = uniqueSorted(inputFootprints.concat(
      categories.flatMap(function (category) { return category.footprints || []; }),
      allItems(tables).map(function (item) { return String(item.footprint || "").trim(); })
    ));

    return {
      categories: categories,
      footprints: footprints
    };
  }

  function categoryByName(definitions, name) {
    const key = normalizeText(name);
    return ((definitions && definitions.categories) || []).find(function (category) {
      return normalizeText(category.name) === key;
    }) || null;
  }

  function allFootprints(definitions) {
    return uniqueSorted(
      ((definitions && definitions.footprints) || []).concat(
        ((definitions && definitions.categories) || []).flatMap(function (category) {
          return category.footprints || [];
        })
      )
    );
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
