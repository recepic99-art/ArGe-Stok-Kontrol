(function () {
  "use strict";

  let activeCombo = null;
  let activeIndex = -1;
  const popover = document.createElement("div");
  popover.className = "combo-popover";
  popover.hidden = true;
  document.body.appendChild(popover);

  function normalize(value) {
    return String(value || "")
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i");
  }

  function positionPopover() {
    if (!activeCombo || popover.hidden) return;
    const rect = activeCombo.input.getBoundingClientRect();
    const availableBelow = window.innerHeight - rect.bottom - 8;
    const height = Math.min(280, Math.max(120, availableBelow));
    popover.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)) + "px";
    popover.style.top = rect.bottom + 4 + "px";
    popover.style.width = rect.width + "px";
    popover.style.maxHeight = height + "px";
  }

  function optionValues(combo) {
    return (combo.getOptions() || []).map(function (option) {
      return typeof option === "string" ? { value: option, group: "" } : option;
    }).filter(function (option) {
      return option && option.value;
    });
  }

  function filteredOptions(combo) {
    const query = normalize(combo.input.value.trim());
    const values = optionValues(combo);
    if (!query || combo.input.value === combo.selectedValue) return values;
    return values.filter(function (option) {
      return normalize(option.value).includes(query);
    });
  }

  function render() {
    if (!activeCombo) return;
    const options = filteredOptions(activeCombo);
    activeCombo.visibleOptions = options;
    activeIndex = options.length ? Math.min(Math.max(activeIndex, 0), options.length - 1) : -1;

    let previousGroup = null;
    let html = "";
    options.forEach(function (option, index) {
      if (option.group && option.group !== previousGroup) {
        html += '<div class="combo-group">' + escapeHtml(option.group) + "</div>";
      }
      previousGroup = option.group || previousGroup;
      html += '<button type="button" class="combo-option' +
        (index === activeIndex ? " is-active" : "") +
        '" data-combo-index="' + index + '">' + escapeHtml(option.value) + "</button>";
    });
    if (!html) html = '<div class="combo-empty">Eşleşen seçenek yok</div>';
    popover.innerHTML = html;
    positionPopover();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function open(combo, keepQuery) {
    if (combo.input.disabled) return;
    activeCombo = combo;
    activeIndex = -1;
    if (!keepQuery) combo.input.select();
    popover.hidden = false;
    combo.input.setAttribute("aria-expanded", "true");
    render();
  }

  function close(restoreInvalid) {
    if (!activeCombo) return;
    const combo = activeCombo;
    const previousValue = combo.selectedValue;
    if (restoreInvalid) {
      const exact = optionValues(combo).find(function (option) {
        return normalize(option.value) === normalize(combo.input.value.trim());
      });
      if (exact) {
        combo.input.value = exact.value;
        combo.selectedValue = exact.value;
      } else {
        combo.input.value = combo.selectedValue || "";
      }
    }
    combo.input.setAttribute("aria-expanded", "false");
    activeCombo = null;
    popover.hidden = true;
    if (restoreInvalid && combo.selectedValue !== previousValue) {
      combo.input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function selectOption(index) {
    if (!activeCombo) return;
    const option = activeCombo.visibleOptions[index];
    if (!option) return;
    const combo = activeCombo;
    combo.input.value = option.value;
    combo.selectedValue = option.value;
    close(false);
    combo.input.dispatchEvent(new Event("change", { bubbles: true }));
    combo.input.focus();
  }

  function attach(input, toggle, getOptions) {
    const combo = {
      input: input,
      toggle: toggle,
      getOptions: getOptions,
      selectedValue: input.value,
      visibleOptions: []
    };

    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.addEventListener("focus", function () {
      combo.selectedValue = input.value;
    });
    // Metin kutusuna normal tıklamak da oku kullanmakla aynı şekilde listeyi açar.
    // Önceden liste yalnızca yazı yazıldıktan sonra güvenilir biçimde açılıyordu.
    input.addEventListener("click", function () {
      if (activeCombo !== combo) open(combo, true);
      else render();
    });
    input.addEventListener("input", function () {
      if (activeCombo !== combo) open(combo, true);
      else render();
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (activeCombo !== combo) open(combo, true);
        if (!combo.visibleOptions.length) return;
        activeIndex += event.key === "ArrowDown" ? 1 : -1;
        activeIndex = (activeIndex + combo.visibleOptions.length) % combo.visibleOptions.length;
        render();
        const active = popover.querySelector(".combo-option.is-active");
        if (active) active.scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter" && activeCombo === combo && activeIndex >= 0) {
        event.preventDefault();
        selectOption(activeIndex);
      } else if (event.key === "Escape" && activeCombo === combo) {
        event.preventDefault();
        close(true);
      }
    });
    input.addEventListener("blur", function () {
      window.setTimeout(function () {
        if (activeCombo === combo && !popover.matches(":hover")) close(true);
      }, 120);
    });
    // Ok düğmesine basılırken odağın önce düğmeye geçmesi, input'un blur olayıyla
    // açılan listenin hemen kapanmasına yol açmamalıdır.
    toggle.addEventListener("mousedown", function (event) {
      event.preventDefault();
    });
    toggle.addEventListener("click", function () {
      if (activeCombo === combo) close(true);
      else {
        input.focus();
        open(combo, false);
      }
    });

    return {
      refresh: function () {
        combo.selectedValue = input.value;
        if (activeCombo === combo) render();
      },
      close: function () {
        if (activeCombo === combo) close(true);
      }
    };
  }

  popover.addEventListener("mousedown", function (event) {
    event.preventDefault();
  });
  popover.addEventListener("click", function (event) {
    const option = event.target.closest("[data-combo-index]");
    if (option) selectOption(Number(option.dataset.comboIndex));
  });
  document.addEventListener("mousedown", function (event) {
    if (!activeCombo) return;
    if (event.target === activeCombo.input || event.target === activeCombo.toggle || popover.contains(event.target)) {
      return;
    }
    close(true);
  });
  window.addEventListener("resize", positionPopover);
  document.addEventListener("scroll", positionPopover, true);

  window.DepoCombo = {
    attach: attach,
    close: function () { close(true); }
  };
}());
