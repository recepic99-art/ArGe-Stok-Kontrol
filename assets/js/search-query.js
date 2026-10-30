(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DepoSearchQuery = api;
}(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function normalize(value) {
    return String(value || "")
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .replace(/[^a-z0-9]+/g, "");
  }

  // Operatörler yalnızca tırnakların dışında anlam taşır. Böylece kullanıcı
  // URL veya ";;" gibi özel karakterleri tırnak içinde normal metin olarak arayabilir.
  function tokenIndexes(text, token) {
    const indexes = [];
    let quoted = false;
    let escaped = false;
    for (let index = 0; index <= text.length - token.length; index += 1) {
      const character = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\" && quoted) {
        escaped = true;
        continue;
      }
      if (character === '"') {
        quoted = !quoted;
        continue;
      }
      if (!quoted && text.slice(index, index + token.length) === token) {
        indexes.push(index);
        index += token.length - 1;
      }
    }
    return indexes;
  }

  function clauseRanges(text) {
    const source = String(text || "");
    const separators = tokenIndexes(source, ";;");
    const ranges = [];
    let start = 0;
    separators.forEach(function (separator) {
      ranges.push({ start: start, end: separator, text: source.slice(start, separator) });
      start = separator + 2;
    });
    ranges.push({ start: start, end: source.length, text: source.slice(start) });
    return ranges;
  }

  function searchTerms(text) {
    const terms = [];
    let buffer = "";
    let quoted = false;
    let escaped = false;

    function flush() {
      const value = buffer.trim();
      if (value) terms.push(value);
      buffer = "";
    }

    String(text || "").split("").forEach(function (character) {
      if (escaped) {
        buffer += character;
        escaped = false;
        return;
      }
      if (character === "\\" && quoted) {
        escaped = true;
        return;
      }
      if (character === '"') {
        if (quoted) flush();
        else flush();
        quoted = !quoted;
        return;
      }
      if (!quoted && /\s/.test(character)) {
        flush();
        return;
      }
      buffer += character;
    });
    flush();
    return terms;
  }

  function matchingColumns(columns, value) {
    const query = normalize(value);
    return (columns || []).filter(function (column) {
      const label = normalize(column.label);
      const key = normalize(column.key);
      return !query || label.includes(query) || key.includes(query);
    });
  }

  function exactColumn(columns, value) {
    const query = normalize(value);
    if (!query) return null;
    return (columns || []).find(function (column) {
      return normalize(column.label) === query || normalize(column.key) === query;
    }) || null;
  }

  function parse(query, columns) {
    return clauseRanges(query).map(function (range) {
      const raw = range.text.trim();
      if (!raw) return null;
      const operators = tokenIndexes(raw, "//");
      if (!operators.length) {
        return { text: raw, terms: searchTerms(raw), columnKey: null, pending: false };
      }

      const operator = operators[operators.length - 1];
      const value = raw.slice(0, operator).trim();
      const columnText = raw.slice(operator + 2).trim();
      const column = exactColumn(columns, columnText);
      if (column) {
        return {
          text: value,
          terms: searchTerms(value),
          columnKey: column.key,
          columnLabel: column.label,
          pending: false
        };
      }

      // Kullanıcı sütun adını yazarken tablo sonuçları kaybolmasın. Sağ taraf
      // mevcut sütunlardan biriyle eşleşebiliyorsa henüz tamamlanmamış kabul edilir.
      if (matchingColumns(columns, columnText).length) {
        return { text: value, terms: searchTerms(value), columnKey: null, pending: true };
      }

      // Örneğin bir URL içindeki // işaretinden sonra sütun adı gelmiyorsa bütün
      // ifade sıradan arama metnidir; yanlışlıkla operatöre dönüşmez.
      return { text: raw, terms: searchTerms(raw), columnKey: null, pending: false };
    }).filter(Boolean);
  }

  function suggestionContext(query, caretPosition, columns) {
    const source = String(query || "");
    const caret = Math.max(0, Math.min(Number(caretPosition), source.length));
    const range = clauseRanges(source).find(function (entry) {
      return caret >= entry.start && caret <= entry.end;
    });
    if (!range) return null;

    const beforeCaret = source.slice(range.start, caret);
    const operators = tokenIndexes(beforeCaret, "//");
    if (!operators.length) return null;
    const operator = operators[operators.length - 1];
    const typed = beforeCaret.slice(operator + 2).trim();
    const options = matchingColumns(columns, typed);
    if (!options.length) return null;

    return {
      operatorStart: range.start + operator,
      replacementStart: range.start + operator + 2,
      replacementEnd: range.end,
      typed: typed,
      options: options
    };
  }

  function applySuggestion(query, context, columnLabel) {
    if (!context) return String(query || "");
    const source = String(query || "");
    return source.slice(0, context.replacementStart) +
      String(columnLabel || "") + source.slice(context.replacementEnd);
  }

  return {
    normalize: normalize,
    parse: parse,
    searchTerms: searchTerms,
    suggestionContext: suggestionContext,
    applySuggestion: applySuggestion
  };
}));
