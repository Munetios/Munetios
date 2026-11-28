(() => {
  const root = document.documentElement;
  const trigger = document.getElementById("customThemeButton");
  const ui = window.MunetiosUI;
  if (!trigger || !ui) return;

  const keys = [
    "customTheme", "themeName", "accentColor", "padding", "roundness", "preview",
    "standard", "condensed", "wide", "hex", "hue", "area", "eyedropper", "done", "saveFailed", "fontStyle",
  ];
  const catalog = {
    en: ["Custom theme", "Theme name", "Accent color", "Padding", "Roundness", "Preview", "Standard", "Condensed", "Wide", "Hex color", "Hue", "Saturation and brightness", "Pick a color from the screen", "Done", "Failed to save the theme.", "Font style"],
    es: ["Tema personalizado", "Nombre del tema", "Color de énfasis", "Espaciado interno", "Redondez", "Vista previa", "Estándar", "Condensada", "Ancha", "Color hexadecimal", "Tono", "Saturación y brillo", "Seleccionar un color de la pantalla", "Listo", "No se pudo guardar el tema.", "Estilo de fuente"],
    fr: ["Thème personnalisé", "Nom du thème", "Couleur d’accentuation", "Marge interne", "Arrondi", "Aperçu", "Standard", "Condensée", "Large", "Couleur hexadécimale", "Teinte", "Saturation et luminosité", "Prélever une couleur à l’écran", "Terminé", "Échec de l’enregistrement du thème.", "Style de police"],
    de: ["Eigenes Design", "Designname", "Akzentfarbe", "Innenabstand", "Rundung", "Vorschau", "Standard", "Schmal", "Breit", "Hex-Farbe", "Farbton", "Sättigung und Helligkeit", "Farbe vom Bildschirm auswählen", "Fertig", "Das Design konnte nicht gespeichert werden.", "Schriftstil"],
    it: ["Tema personalizzato", "Nome del tema", "Colore di accento", "Spaziatura interna", "Arrotondamento", "Anteprima", "Standard", "Condensato", "Largo", "Colore esadecimale", "Tonalità", "Saturazione e luminosità", "Preleva un colore dallo schermo", "Fine", "Impossibile salvare il tema.", "Stile del carattere"],
    "pt-br": ["Tema personalizado", "Nome do tema", "Cor de destaque", "Espaçamento interno", "Arredondamento", "Prévia", "Padrão", "Condensada", "Larga", "Cor hexadecimal", "Matiz", "Saturação e brilho", "Selecionar uma cor da tela", "Concluir", "Falha ao salvar o tema.", "Estilo da fonte"],
    pt: ["Tema personalizado", "Nome do tema", "Cor de destaque", "Espaçamento interior", "Arredondamento", "Pré-visualização", "Normal", "Condensada", "Larga", "Cor hexadecimal", "Matiz", "Saturação e luminosidade", "Selecionar uma cor do ecrã", "Concluir", "Não foi possível guardar o tema.", "Estilo do tipo de letra"],
    zh: ["自定义主题", "主题名称", "强调色", "内边距", "圆角", "预览", "标准", "紧凑", "宽体", "十六进制颜色", "色相", "饱和度和亮度", "从屏幕上取色", "完成", "无法保存主题。", "字体样式"],
    "zh-tw": ["自訂主題", "主題名稱", "強調色", "內距", "圓角", "預覽", "標準", "窄體", "寬體", "十六進位色碼", "色相", "飽和度和亮度", "從螢幕取色", "完成", "無法儲存主題。", "字型樣式"],
    ko: ["맞춤 테마", "테마 이름", "강조 색상", "안쪽 여백", "모서리 둥글기", "미리 보기", "표준", "좁게", "넓게", "16진수 색상", "색조", "채도 및 밝기", "화면에서 색상 선택", "완료", "테마를 저장하지 못했습니다.", "글꼴 스타일"],
    ar: ["مظهر مخصص", "اسم المظهر", "لون التمييز", "التباعد الداخلي", "استدارة الزوايا", "معاينة", "قياسي", "ضيّق", "عريض", "رمز اللون السداسي", "تدرّج اللون", "التشبّع والسطوع", "اختيار لون من الشاشة", "تم", "تعذّر حفظ المظهر.", "نمط الخط"],
    hi: ["कस्टम थीम", "थीम का नाम", "उभार का रंग", "अंदरूनी अंतर", "कोनों की गोलाई", "पूर्वावलोकन", "मानक", "संकरी", "चौड़ी", "हेक्स रंग", "वर्ण", "संतृप्ति और चमक", "स्क्रीन से रंग चुनें", "हो गया", "थीम सहेजी नहीं जा सकी।", "फ़ॉन्ट शैली"],
    co: ["Tema persunalizatu", "Nome di u tema", "Culore d’accentu", "Spaziu internu", "Arrotondamentu", "Anteprima", "Nurmale", "Stretta", "Larga", "Culore esadecimale", "Tinta", "Saturazione è luminosità", "Sceglie un culore da u screnu", "Fattu", "Ùn si hè pussutu salvà u tema.", "Stile di u caratteru"],
    ja: ["カスタムテーマ", "テーマ名", "アクセントカラー", "内側の余白", "角の丸み", "プレビュー", "標準", "幅狭", "幅広", "16進カラー", "色相", "彩度と明度", "画面から色を選択", "完了", "テーマを保存できませんでした。", "フォントスタイル"],
  };
  const defaults = {
    name: "", background: "#1c064e", accent: "#a96cff", text: "#ffffff",
    width: "100", padding: 14, radius: 24,
  };
  const storageKey = "munetiosCustomTheme";
  const customId = "custom-local";

  function translate(key) {
    const lang = root.lang.toLowerCase();
    const labels = catalog[lang] || catalog[lang.split("-")[0]] || catalog.en;
    const index = keys.indexOf(key);
    return index >= 0 ? labels[index] : window.getTranslation(key);
  }

  function normalize(theme) {
    const hex = (value, fallback) => /^#[\da-f]{6}$/i.test(value) ? value : fallback;
    const number = (value, fallback, min, max) =>
      Number.isInteger(Number(value)) && value !== "" && value != null
        ? Math.max(min, Math.min(max, Number(value))) : fallback;
    return {
      name: typeof theme?.name === "string" ? theme.name.trim() : defaults.name,
      background: hex(theme?.background, defaults.background),
      accent: hex(theme?.accent, defaults.accent),
      text: hex(theme?.text, defaults.text),
      width: ["85", "100", "115"].includes(theme?.width) ? theme.width : defaults.width,
      padding: number(theme?.padding, defaults.padding, 6, 26),
      radius: number(theme?.radius, defaults.radius, 12, 32),
    };
  }

  function savedTheme() {
    try {
      return normalize(JSON.parse(localStorage.getItem(storageKey)));
    } catch {
      return { ...defaults };
    }
  }

  function styleTheme(element, theme) {
    for (const key of ["background", "accent", "text", "width", "padding", "radius"]) {
      const value = theme[key] + (key === "padding" || key === "radius" ? "px" : "");
      element.style.setProperty("--home-theme-" + key, value);
    }
  }

  function updateTrigger() {
    const name = savedTheme().name;
    trigger.textContent = name ? translate("customTheme") + " · " + name : translate("customTheme");
    trigger.setAttribute("aria-pressed", String(root.dataset.theme === customId));
  }

  window.munetiosApplyCustomTheme = () => {
    styleTheme(root, savedTheme());
    document.querySelectorAll("#themesGrid .theme-card").forEach((card) => {
      card.classList.remove("selected");
      card.setAttribute("aria-pressed", "false");
    });
    updateTrigger();
  };

  function colorField(key, label) {
    return `<div class="mu-field">
      <span class="mu-field-label" id="home-theme-label-${key}" data-label="${label}"></span>
      <button class="mu-picker-field" type="button" data-color="${key}" aria-labelledby="home-theme-label-${key}" aria-haspopup="dialog">
        <span class="mu-picker-swatch" aria-hidden="true"></span><span class="mu-picker-value"></span>
      </button>
    </div>`;
  }

  function rangeField(key, label, min, max) {
    return `<div class="mu-slider">
      <label class="mu-slider-head" for="home-theme-${key}">
        <span data-label="${label}"></span><output for="home-theme-${key}"></output>
      </label>
      <input class="mu-range" type="range" id="home-theme-${key}" name="${key}" min="${min}" max="${max}">
    </div>`;
  }

  const modal = document.createElement("div");
  modal.id = "homeThemeEditor";
  modal.className = "mu-modal";
  modal.hidden = true;
  modal.translate = false;
  modal.innerHTML = `
    <section class="mu-dialog liquid-glass" role="dialog" aria-modal="true" aria-labelledby="home-theme-title">
      <header class="mu-dialog-header">
        <div class="mu-dialog-heading">
          <span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">palette</span></span>
          <h2 id="home-theme-title" data-label="customTheme"></h2>
        </div>
        <button class="mu-icon-btn mu-icon-btn-soft" type="button" data-mu-close>
          <span class="mu-icon" aria-hidden="true">close</span>
        </button>
      </header>
      <form class="home-theme-form">
        <label class="mu-field">
          <span class="mu-field-label" data-label="themeName"></span>
          <input name="name" class="mu-input" type="text" required>
        </label>
        <div class="home-theme-fields">
          ${colorField("background", "bgColor")}
          ${colorField("accent", "accentColor")}
          ${colorField("text", "textColor")}
          <label class="mu-field">
            <span class="mu-field-label" data-label="fontStyle"></span>
            <select class="mu-select" name="width">
              <option value="100" data-label="standard"></option>
              <option value="85" data-label="condensed"></option>
              <option value="115" data-label="wide"></option>
            </select>
          </label>
          ${rangeField("padding", "padding", 6, 26)}
          ${rangeField("radius", "roundness", 12, 32)}
        </div>
        <div class="home-theme-preview">
          <span class="mu-icon" aria-hidden="true">search</span><span></span>
        </div>
        <div role="status" data-save-error hidden></div>
        <div class="mu-dialog-actions">
          <button class="mu-btn" type="button" data-mu-close data-label="cancel"></button>
          <button class="mu-btn mu-btn-primary" type="submit" data-label="save"></button>
        </div>
      </form>
    </section>`;
  document.body.append(modal);
  trigger.translate = false;

  const form = modal.querySelector("form");
  const preview = modal.querySelector(".home-theme-preview");
  const error = modal.querySelector("[data-save-error]");
  const colorFields = [...form.querySelectorAll("[data-color]")];
  let draft;

  function updatePreview() {
    for (const key of ["name", "width", "padding", "radius"]) draft[key] = form.elements[key].value;
    for (const key of ["padding", "radius"]) {
      form.querySelector(`output[for="home-theme-${key}"]`).textContent = draft[key] + " px";
    }
    styleTheme(preview, normalize(draft));
    preview.lastElementChild.textContent = draft.name.trim() || translate("preview");
  }

  function updateColor(field) {
    const value = draft[field.dataset.color];
    field.querySelector(".mu-picker-swatch").style.backgroundColor = value;
    field.querySelector(".mu-picker-value").textContent = value.toUpperCase();
  }

  for (const field of colorFields) {
    field.addEventListener("click", () => {
      const key = field.dataset.color;
      const label = field.previousElementSibling.textContent;
      ui.pickColor({
        anchor: field,
        allowReset: false,
        value: draft[key],
        labels: {
          color: label, hex: translate("hex"), hue: translate("hue"),
          area: translate("area"), eyedropper: translate("eyedropper"),
          done: translate("done"), cancel: translate("cancel"),
        },
        swatches: [defaults.background, defaults.accent, defaults.text]
          .map((color) => [color, color.toUpperCase()]),
        onPick(value) {
          draft[key] = value;
          updateColor(field);
          updatePreview();
        },
      });
    });
  }

  trigger.addEventListener("click", () => {
    if (!modal.hidden) return;
    draft = savedTheme();
    for (const element of modal.querySelectorAll("[data-label]")) {
      const label = translate(element.dataset.label);
      element.textContent = label;
    }
    modal.querySelector(".mu-icon-btn").setAttribute("aria-label", translate("close"));
    error.hidden = true;
    const fields = ["name", "width", "padding", "radius"];
    fields.forEach((key) => { form.elements[key].value = draft[key]; });
    fields.forEach((key) => {
      form.elements[key].dispatchEvent(new Event("input", { bubbles: true }));
      form.elements[key].dispatchEvent(new Event("change", { bubbles: true }));
    });
    colorFields.forEach(updateColor);
    updatePreview();
    ui.openModal(modal.id);
    form.elements.name.focus();
  });

  form.addEventListener("input", updatePreview);
  form.addEventListener("change", updatePreview);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const theme = normalize(draft);
    if (!theme.name) {
      form.elements.name.value = "";
      form.elements.name.reportValidity();
      return;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(theme));
      localStorage.setItem("munetiosTheme", customId);
      localStorage.setItem("munetiosThemeUserOverride", "true");
    } catch {
      error.textContent = translate("saveFailed");
      error.hidden = false;
      return;
    }
    window.munetiosApplyTheme(customId, true);
    ui.closeModal(modal.id);
  });

  new MutationObserver(updateTrigger).observe(root, {
    attributes: true, attributeFilter: ["lang", "data-theme"],
  });
  if (root.dataset.theme === customId) window.munetiosApplyCustomTheme();
  updateTrigger();
  trigger.hidden = false;
})();
