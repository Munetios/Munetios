/*
 * Munetios Meals features on Munetios UI v4.
 * Uses the Meals globals (state, saveMeal, readAllMeals, renderApp, openModal,
 * getMealById, setMealType, getTranslation, getLocale, MEAL_TYPES, ...).
 * Extra fields are stored on each meal in the existing IndexedDB store.
 */
(() => {
  "use strict";

  const STR = window.MealsFeatureStrings || { en: {} };
  const H = window.MealsHooks || (window.MealsHooks = {});
  const UI = () => window.MunetiosUI;
  const locale = () => { try { return getLocale(); } catch { return "en-US"; } };
  const lang = () => {
    const code = (window.MunetiosLocales && window.MunetiosLocales.resolve(locale())) || "en-US";
    return STR[code] ? code : "en-US";
  };
  function t(key, vars) {
    let value = (STR[lang()] && STR[lang()][key]) ?? (STR["en-US"] || STR.en)[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) value = value.split("{" + k + "}").join(String(v));
    return value;
  }
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  function h(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) node.append(c);
    return node;
  }
  const icon = (name, extra = "") => h("span", { class: "mu-icon " + extra, "aria-hidden": "true", text: name });
  const iconBtn = (name, label, onclick, extra = "") => h("button", { type: "button", class: "mu-icon-btn " + extra, "aria-label": label, title: label, onclick }, [icon(name)]);
  const toast = (msg, type = "success") => showToast(msg, type);
  const nmAn = (text) => String(text).replace(/\b[Aa]\.?\s?[Mm]\.?(?=$|[\s,)])/g, "NM").replace(/\b[Pp]\.?\s?[Mm]\.?(?=$|[\s,)])/g, "AN");
  const fmtTime = (d) => nmAn(d.toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" }));
  const fmtDay = (d, opts) => new Intl.DateTimeFormat(locale(), opts).format(d);
  const pad = (n) => String(n).padStart(2, "0");
  const isoDay = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const toPicker = (d) => isoDay(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };

  /* ------------------------------------------------------------ settings */
  const PREFS_KEY = "munetios-meals-features";
  const DEFAULTS = { sort: "newest", diet: "all", calorieGoal: 2000, shoppingRange: "week", checked: {}, extraItems: [], weekOffset: 0 };
  let prefs = { ...DEFAULTS };
  try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch {}
  const savePrefs = (patch) => { prefs = { ...prefs, ...patch }; try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} document.dispatchEvent(new CustomEvent("meals-settings-changed")); };
  // Synced settings from another device replace these in place.
  window.MealsFeaturesPrefs = { reload() { try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch { prefs = { ...DEFAULTS }; } } };

  const DIETS = [
    ["vegetarian", "dietVegetarian", "eco"], ["vegan", "dietVegan", "spa"], ["glutenFree", "dietGlutenFree", "grain"],
    ["dairyFree", "dietDairyFree", "water_drop"], ["highProtein", "dietHighProtein", "fitness_center"],
    ["lowCarb", "dietLowCarb", "monitoring"], ["nutFree", "dietNutFree", "do_not_disturb_on"],
  ];
  const SLOT_HOURS = { Breakfast: [8, 0], Lunch: [12, 30], Dinner: [18, 30], Snack: [15, 30] };
  const typeLabel = (type) => { try { return getMealTypeLabel(type); } catch { return type; } };

  /* ------------------------------------------------------------ meal helpers */
  const nutrition = (meal) => (meal && meal.nutrition && typeof meal.nutrition === "object" ? meal.nutrition : {});
  const kcalOf = (meal) => num(nutrition(meal).kcal);
  const mealDate = (meal) => new Date(meal.createdAt);
  async function persist(meal) {
    await window.saveMeal(meal);
    state.meals = await readAllMeals();
    renderApp();
  }

  /* ------------------------------------------------------------ filtering + sorting */
  const baseFiltered = window.getFilteredMeals;
  const SORTS = {
    newest: (a, b) => mealDate(b) - mealDate(a),
    oldest: (a, b) => mealDate(a) - mealDate(b),
    name: (a, b) => String(a.name).localeCompare(String(b.name), locale(), { sensitivity: "base" }),
    rating: (a, b) => num(b.rating) - num(a.rating) || SORTS.newest(a, b),
    calories: (a, b) => kcalOf(a) - kcalOf(b) || SORTS.newest(a, b),
  };
  window.getFilteredMeals = function () {
    let list = baseFiltered();
    if (prefs.diet !== "all") list = list.filter((m) => Array.isArray(m.diet) && m.diet.includes(prefs.diet));
    return [...list].sort(SORTS[prefs.sort] || SORTS.newest);
  };

  /* ------------------------------------------------------------ meal form extras */
  let formWhen = null;
  let pending = null;
  function mountForm() {
    const grid = $("#mealForm .meal-form-grid");
    if (!grid || $("#mfWhenBtn")) return;
    const field = (labelKey, control, span) => h("div", { class: "field" + (span ? " field-span-2" : "") }, [h("label", { for: control.id || undefined, "data-mf": labelKey, text: t(labelKey) }), control]);
    const numberInput = (id, placeholder) => h("input", { id, type: "number", min: "0", step: "1", inputmode: "numeric", placeholder });
    const whenBtn = h("button", { type: "button", id: "mfWhenBtn", class: "select-trigger mf-when", onclick: () => {
      UI().pickDateTime({ value: toPicker(formWhen || new Date()), anchor: whenBtn, onPick: (value) => { if (value) { formWhen = new Date(value); paintWhen(); } } });
    } }, [h("span", { id: "mfWhenLabel" }), icon("event")]);
    const diets = h("div", { class: "mu-chip-grid mf-diet-chips", id: "mfDietChips", role: "group", "aria-label": t("dietaryTags") }, DIETS.map(([value, key, ic]) =>
      h("button", { type: "button", class: "mu-chip", "data-diet": value, "aria-pressed": "false", onclick: (e) => { const b = e.currentTarget; b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); } }, [icon(ic), h("span", { "data-mf": key, text: t(key) })])));
    const nodes = [
      field("when", whenBtn),
      field("servings", numberInput("mfServings", "2")),
      field("prepTime", numberInput("mfPrep", "10")),
      field("cookTime", numberInput("mfCook", "20")),
      h("div", { class: "field field-span-2 mf-nutrition" }, [
        h("div", { class: "mf-field-title", "data-mf": "nutrition", text: t("nutrition") }),
        h("div", { class: "mf-nutrition-grid" }, [
          field("calories", numberInput("mfKcal", "450")),
          field("protein", numberInput("mfProtein", "30")),
          field("carbs", numberInput("mfCarbs", "50")),
          field("fat", numberInput("mfFat", "15")),
        ]),
      ]),
      h("div", { class: "field field-span-2" }, [h("div", { class: "mf-field-title", "data-mf": "dietaryTags", text: t("dietaryTags") }), diets]),
      field("steps", h("textarea", { id: "mfSteps", rows: "4", placeholder: t("stepsPlaceholder"), "data-mf-placeholder": "stepsPlaceholder" }), true),
    ];
    const notes = $("#mealNotesInput")?.closest(".field");
    nodes.forEach((node) => grid.insertBefore(node, notes || null));
    // Read the extra fields right before the original submit handler runs.
    document.addEventListener("submit", (e) => {
      if (e.target.id !== "mealForm") return;
      pending = {
        createdAt: (formWhen || new Date()).toISOString(),
        servings: num($("#mfServings").value) || null,
        prepMin: num($("#mfPrep").value) || null,
        cookMin: num($("#mfCook").value) || null,
        nutrition: { kcal: num($("#mfKcal").value), protein: num($("#mfProtein").value), carbs: num($("#mfCarbs").value), fat: num($("#mfFat").value) },
        diet: $$("#mfDietChips [data-diet]").filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.diet),
        steps: $("#mfSteps").value.split("\n").map((s) => s.trim()).filter(Boolean),
      };
      setTimeout(() => { pending = null; }, 3000);
    }, true);
  }
  function paintWhen() {
    const label = $("#mfWhenLabel");
    if (label && formWhen) label.textContent = fmtDay(formWhen, { weekday: "short", month: "short", day: "numeric" }) + " · " + fmtTime(formWhen);
  }
  function fillForm(meal, preset) {
    if (!$("#mfWhenBtn")) return;
    formWhen = meal ? mealDate(meal) : preset?.when || new Date();
    paintWhen();
    $("#mfServings").value = meal?.servings || "";
    $("#mfPrep").value = meal?.prepMin || "";
    $("#mfCook").value = meal?.cookMin || "";
    const n = nutrition(meal);
    $("#mfKcal").value = n.kcal || "";
    $("#mfProtein").value = n.protein || "";
    $("#mfCarbs").value = n.carbs || "";
    $("#mfFat").value = n.fat || "";
    $$("#mfDietChips [data-diet]").forEach((b) => b.setAttribute("aria-pressed", String(Array.isArray(meal?.diet) && meal.diet.includes(b.dataset.diet))));
    $("#mfSteps").value = Array.isArray(meal?.steps) ? meal.steps.join("\n") : "";
  }
  let nextPreset = null;
  const baseOpenModal = window.openModal;
  window.openModal = function (mode = "create", mealId = null) {
    const result = baseOpenModal(mode, mealId);
    const preset = nextPreset;
    nextPreset = null;
    fillForm(mode === "edit" && mealId ? getMealById(mealId) : null, preset);
    if (preset?.type) { try { setMealType(preset.type); } catch {} }
    return result;
  };
  const baseSaveMeal = window.saveMeal;
  window.saveMeal = async function (meal) {
    if (pending) { meal = { ...meal, ...pending }; pending = null; }
    return baseSaveMeal(meal);
  };

  /* ------------------------------------------------------------ cards */
  function decorateCards() {
    $$("#mealsList .meal-card").forEach((card) => {
      const id = card.querySelector("[data-id]")?.dataset.id;
      const meal = id && getMealById(id);
      if (!meal || card.dataset.mfDone) return;
      card.dataset.mfDone = "1";
      const info = card.querySelector(".meal-info");
      const meta = card.querySelector(".meal-meta");
      if (meta) {
        const timeSpan = h("span", { text: fmtTime(mealDate(meal)) });
        meta.append(timeSpan);
      }
      const n = nutrition(meal);
      const badges = h("div", { class: "mf-badges" });
      if (n.kcal) badges.append(h("span", { class: "mf-badge is-kcal" }, [icon("local_fire_department"), h("span", { text: t("kcalValue", { value: Math.round(n.kcal) }) })]));
      if (n.protein) badges.append(h("span", { class: "mf-badge" }, [h("span", { text: t("proteinShort", { value: Math.round(n.protein) }) })]));
      if (n.carbs) badges.append(h("span", { class: "mf-badge" }, [h("span", { text: t("carbsShort", { value: Math.round(n.carbs) }) })]));
      if (n.fat) badges.append(h("span", { class: "mf-badge" }, [h("span", { text: t("fatShort", { value: Math.round(n.fat) }) })]));
      const total = num(meal.prepMin) + num(meal.cookMin);
      if (total) badges.append(h("span", { class: "mf-badge" }, [icon("timer"), h("span", { text: t("minutesValue", { value: total }) })]));
      if (meal.servings) badges.append(h("span", { class: "mf-badge" }, [icon("group"), h("span", { text: t("servingsValue", { value: meal.servings }) })]));
      (Array.isArray(meal.diet) ? meal.diet : []).forEach((d) => {
        const diet = DIETS.find(([v]) => v === d);
        if (diet) badges.append(h("span", { class: "mf-badge is-diet" }, [icon(diet[2]), h("span", { text: t(diet[1]) })]));
      });
      if (badges.childElementCount) info?.append(badges);
      const rating = h("div", { class: "mf-rating", role: "group", "aria-label": t("rating") });
      for (let i = 1; i <= 5; i++) {
        const on = num(meal.rating) >= i;
        rating.append(h("button", { type: "button", class: "mf-star" + (on ? " is-on" : ""), "aria-label": t("rateStars", { count: i }), "aria-pressed": String(num(meal.rating) === i), onclick: async () => {
          const current = getMealById(id);
          await persist({ ...current, rating: num(current.rating) === i ? 0 : i });
        } }, [icon("star", on ? "mu-icon-filled" : "")]));
      }
      info?.append(rating);
      const actions = card.querySelector(".meal-actions");
      if (actions) {
        actions.prepend(
          h("button", { type: "button", class: "meal-action-btn", "aria-label": t("viewRecipe"), title: t("viewRecipe"), onclick: () => openRecipe(id) }, [h("span", { class: "material-symbols-rounded", text: "menu_book" })]),
          h("button", { type: "button", class: "meal-action-btn", "aria-label": t("planAgain"), title: t("planAgain"), onclick: (e) => planAgain(id, e.currentTarget) }, [h("span", { class: "material-symbols-rounded", text: "event_repeat" })]),
        );
        actions.querySelectorAll(".meal-action-btn").forEach((b) => { if (!b.title) b.title = b.getAttribute("aria-label") || ""; });
      }
    });
  }

  function planAgain(id, anchor) {
    const meal = getMealById(id);
    if (!meal) return;
    const next = addDays(mealDate(meal), 7);
    UI().pickDateTime({ value: toPicker(next), anchor, onPick: async (value) => {
      if (!value) return;
      const copy = { ...meal, id: crypto.randomUUID(), createdAt: new Date(value).toISOString(), bookmarked: false };
      await persist(copy);
      (window.showSyncedToast || toast)(t("planned", { date: fmtDay(new Date(value), { weekday: "short", month: "short", day: "numeric" }) }));
    } });
  }

  /* ------------------------------------------------------------ recipe view + scaling */
  function scaleText(text, factor) {
    if (factor === 1) return text;
    const fractions = { "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75 };
    return String(text).replace(/^(\d+(?:[.,]\d+)?(?:\s+\d\/\d)?|\d\/\d|[½⅓⅔¼¾])/, (match) => {
      let value = 0;
      for (const part of match.trim().split(/\s+/)) {
        if (fractions[part]) value += fractions[part];
        else if (part.includes("/")) { const [a, b] = part.split("/").map(Number); value += b ? a / b : 0; }
        else value += Number(part.replace(",", "."));
      }
      const scaled = Math.round(value * factor * 100) / 100;
      return new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(scaled);
    });
  }
  function openRecipe(id) {
    const meal = getMealById(id);
    if (!meal) return;
    $("#mfRecipe")?.remove();
    const base = num(meal.servings) || 1;
    let servings = base;
    const ingredients = h("ul", { class: "mf-ingredients" });
    const servingsLabel = h("output", { class: "mf-servings-value", "aria-live": "polite" });
    const paint = () => {
      const factor = servings / base;
      servingsLabel.textContent = String(servings);
      ingredients.replaceChildren(...(meal.ingredients.length ? meal.ingredients.map((x) => h("li", {}, [icon("check_small"), h("span", { text: scaleText(x, factor) })])) : [h("li", { class: "mu-muted", text: t("noIngredients") })]));
    };
    const n = nutrition(meal);
    const imageUrl = meal.imageBlob ? URL.createObjectURL(meal.imageBlob) : "";
    const modal = h("div", { class: "mu-modal", id: "mfRecipe", hidden: true }, [
      h("div", { class: "mu-dialog mu-dialog-lg mf-recipe", role: "dialog", "aria-modal": "true", "aria-labelledby": "mfRecipeTitle" }, [
        h("div", { class: "mu-dialog-header" }, [
          h("div", { class: "mu-dialog-heading" }, [h("span", { class: "mu-icon-circle" }, [icon("menu_book")]), h("h2", { id: "mfRecipeTitle", text: meal.name })]),
          h("button", { type: "button", class: "mu-icon-btn mu-icon-btn-soft", "aria-label": t("close"), "data-mu-close": "" }, [icon("close")]),
        ]),
        imageUrl ? h("img", { class: "mf-recipe-image", src: imageUrl, alt: meal.name }) : null,
        h("div", { class: "mf-recipe-facts" }, [
          h("span", { class: "mf-badge" }, [icon("restaurant"), h("span", { text: typeLabel(meal.type) })]),
          h("span", { class: "mf-badge" }, [icon("event"), h("span", { text: fmtDay(mealDate(meal), { weekday: "short", month: "short", day: "numeric" }) + " · " + fmtTime(mealDate(meal)) })]),
          meal.prepMin ? h("span", { class: "mf-badge" }, [icon("timer"), h("span", { text: t("prepValue", { value: meal.prepMin }) })]) : null,
          meal.cookMin ? h("span", { class: "mf-badge" }, [icon("skillet"), h("span", { text: t("cookValue", { value: meal.cookMin }) })]) : null,
          n.kcal ? h("span", { class: "mf-badge is-kcal" }, [icon("local_fire_department"), h("span", { text: t("kcalValue", { value: Math.round(n.kcal) }) })]) : null,
        ]),
        h("div", { class: "mf-servings" }, [
          h("span", { "data-mf": "servings", text: t("servings") }),
          h("div", { class: "mf-stepper" }, [
            iconBtn("remove", t("fewerServings"), () => { if (servings > 1) { servings--; paint(); } }, "mu-icon-btn-soft"),
            servingsLabel,
            iconBtn("add", t("moreServings"), () => { servings++; paint(); }, "mu-icon-btn-soft"),
          ]),
        ]),
        h("section", { class: "mf-recipe-section" }, [h("h3", { class: "mu-h-title", text: t("ingredients") }), ingredients]),
        h("section", { class: "mf-recipe-section" }, [
          h("h3", { class: "mu-h-title", text: t("steps") }),
          Array.isArray(meal.steps) && meal.steps.length ? h("ol", { class: "mf-steps" }, meal.steps.map((s) => h("li", { text: s }))) : h("p", { class: "mu-muted", text: t("noSteps") }),
        ]),
        meal.notes ? h("section", { class: "mf-recipe-section" }, [h("h3", { class: "mu-h-title", text: t("notes") }), h("p", { text: meal.notes })]) : null,
        h("div", { class: "mu-dialog-actions" }, [
          h("button", { type: "button", class: "mu-btn", onclick: () => window.print() }, [icon("print"), h("span", { text: t("print") })]),
          h("button", { type: "button", class: "mu-btn mu-btn-primary", onclick: () => { UI().closeModal("mfRecipe"); window.openModal("edit", id); } }, [icon("edit"), h("span", { text: t("edit") })]),
        ]),
      ]),
    ]);
    document.body.append(modal);
    paint();
    UI().openModal("mfRecipe");
    if (imageUrl) setTimeout(() => URL.revokeObjectURL(imageUrl), 60000);
  }

  /* ------------------------------------------------------------ toolbar + today summary */
  function mountToolbar() {
    const list = $("#mealsList");
    if (!list || $("#mfToolbar")) return;
    const sort = h("select", { id: "mfSort", class: "mu-select", "aria-label": t("sortBy") }, [["newest", "sortNewest"], ["oldest", "sortOldest"], ["name", "sortName"], ["rating", "sortRating"], ["calories", "sortCalories"]].map(([v, k]) => h("option", { value: v, text: t(k), "data-mf": k })));
    sort.value = prefs.sort;
    sort.addEventListener("change", () => { savePrefs({ sort: sort.value }); renderApp(); });
    const chips = h("div", { class: "mu-chip-grid mf-filter-chips", role: "group", "aria-label": t("filterDiet") }, [
      h("button", { type: "button", class: "mu-chip", "data-filter": "all" }, [h("span", { "data-mf": "allMeals", text: t("allMeals") })]),
      ...DIETS.map(([value, key, ic]) => h("button", { type: "button", class: "mu-chip", "data-filter": value }, [icon(ic), h("span", { "data-mf": key, text: t(key) })])),
    ]);
    chips.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-filter]");
      if (!chip) return;
      savePrefs({ diet: chip.dataset.filter });
      renderApp();
    });
    const bar = h("div", { id: "mfToolbar", class: "mf-toolbar" }, [
      h("div", { class: "mf-toolbar-row" }, [h("div", { class: "mf-sort" }, [icon("sort"), sort])]),
      chips,
    ]);
    list.before(h("div", { id: "mfToday" }), bar);
  }
  function syncToolbar() {
    const sort = $("#mfSort");
    if (!sort) return;
    if (sort.value !== prefs.sort) sort.value = prefs.sort;
    UI()?.refreshSelect?.(sort);
    $$("#mfToolbar [data-filter]").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.filter === prefs.diet)));
    const today = $("#mfToday");
    const showToday = state.activeCategory === "all";
    today.hidden = !showToday;
    if (!showToday) return;
    const now = new Date();
    const meals = state.meals.filter((m) => isoDay(mealDate(m)) === isoDay(now));
    const sum = (k) => meals.reduce((s, m) => s + num(nutrition(m)[k]), 0);
    const kcal = sum("kcal");
    const goal = Math.max(1, num(prefs.calorieGoal) || 2000);
    const pct = Math.min(100, Math.round((kcal / goal) * 100));
    today.className = "mf-today mu-glass";
    today.replaceChildren(
      h("div", { class: "mu-ring", style: "--mu-value:" + pct, role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": t("calorieGoal") }, [h("span", { text: pct + "%" })]),
      h("div", { class: "mf-today-text" }, [
        h("span", { class: "mu-h-title", text: t("todayCalories", { kcal: Math.round(kcal), goal }) }),
        h("span", { class: "mu-muted", text: kcal > goal ? t("overGoal", { value: Math.round(kcal - goal) }) : t("leftToGoal", { value: Math.round(goal - kcal) }) }),
      ]),
      h("div", { class: "mf-macros" }, [
        h("span", { class: "mf-badge" }, [h("span", { text: t("proteinShort", { value: Math.round(sum("protein")) }) })]),
        h("span", { class: "mf-badge" }, [h("span", { text: t("carbsShort", { value: Math.round(sum("carbs")) }) })]),
        h("span", { class: "mf-badge" }, [h("span", { text: t("fatShort", { value: Math.round(sum("fat")) }) })]),
      ]),
    );
  }

  /* ------------------------------------------------------------ week planner */
  function weekStart(offset) {
    const today = startOfDay(new Date());
    const first = (new Intl.Locale(locale()).weekInfo?.firstDay ?? (locale() === "en-US" ? 7 : 1)) % 7;
    const diff = (today.getDay() - first + 7) % 7;
    return addDays(today, -diff + offset * 7);
  }
  function renderWeek() {
    const root = $("#weekPlanner");
    if (!root) return;
    const start = weekStart(prefs.weekOffset || 0);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const end = addDays(start, 6);
    const head = h("div", { class: "mf-week-head" }, [
      iconBtn("chevron_left", t("previousWeek"), () => { savePrefs({ weekOffset: (prefs.weekOffset || 0) - 1 }); renderWeek(); }),
      h("h2", { class: "mu-h-title", text: fmtDay(start, { month: "short", day: "numeric" }) + " – " + fmtDay(end, { month: "short", day: "numeric", year: "numeric" }) }),
      iconBtn("chevron_right", t("nextWeek"), () => { savePrefs({ weekOffset: (prefs.weekOffset || 0) + 1 }); renderWeek(); }),
      h("button", { type: "button", class: "mu-btn", onclick: () => { savePrefs({ weekOffset: 0 }); renderWeek(); } }, [icon("today"), h("span", { text: t("thisWeek") })]),
    ]);
    const grid = h("div", { class: "mf-week-grid" });
    const todayKey = isoDay(new Date());
    days.forEach((day) => {
      const key = isoDay(day);
      const dayMeals = state.meals.filter((m) => isoDay(mealDate(m)) === key);
      const kcal = dayMeals.reduce((s, m) => s + kcalOf(m), 0);
      const col = h("section", { class: "mf-day mu-glass" + (key === todayKey ? " is-today" : ""), "aria-label": fmtDay(day, { weekday: "long", month: "long", day: "numeric" }) }, [
        h("header", { class: "mf-day-head" }, [
          h("span", { class: "mf-day-name", text: fmtDay(day, { weekday: "short" }) }),
          h("span", { class: "mf-day-num", text: String(day.getDate()) }),
          kcal ? h("span", { class: "mf-badge is-kcal" }, [h("span", { text: t("kcalValue", { value: Math.round(kcal) }) })]) : null,
        ]),
      ]);
      MEAL_TYPES.forEach((type) => {
        const slot = dayMeals.filter((m) => m.type === type).sort((a, b) => mealDate(a) - mealDate(b));
        const cell = h("div", { class: "mf-slot" }, [h("div", { class: "mf-slot-label", text: typeLabel(type) })]);
        slot.forEach((m) => cell.append(h("button", { type: "button", class: "mf-slot-meal", onclick: () => openRecipe(m.id) }, [h("span", { class: "mf-slot-name", text: m.name }), h("span", { class: "mu-muted", text: fmtTime(mealDate(m)) })])));
        cell.append(h("button", { type: "button", class: "mf-slot-add", "aria-label": t("addMealTo", { type: typeLabel(type), day: fmtDay(day, { weekday: "long" }) }), onclick: () => {
          const when = new Date(day);
          when.setHours(...SLOT_HOURS[type], 0, 0);
          nextPreset = { when, type };
          window.openModal("create");
        } }, [icon("add")]));
        col.append(cell);
      });
      grid.append(col);
    });
    root.replaceChildren(head, grid);
  }

  /* ------------------------------------------------------------ shopping list */
  function shoppingItems() {
    const now = startOfDay(new Date());
    const limit = prefs.shoppingRange === "week" ? addDays(now, 7) : null;
    const meals = state.meals.filter((m) => mealDate(m) >= now && (!limit || mealDate(m) < limit));
    const map = new Map();
    meals.forEach((m) => (m.ingredients || []).forEach((raw) => {
      const name = String(raw).trim();
      if (!name) return;
      const key = name.toLocaleLowerCase(locale());
      if (!map.has(key)) map.set(key, { key, name, count: 0, meals: new Set() });
      const item = map.get(key);
      item.count++;
      item.meals.add(m.name);
    }));
    (prefs.extraItems || []).forEach((name) => {
      const key = "extra:" + name.toLocaleLowerCase(locale());
      if (!map.has(key)) map.set(key, { key, name, count: 1, meals: new Set(), extra: true });
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, locale(), { sensitivity: "base" }));
  }
  function renderShopping() {
    const root = $("#shoppingList");
    if (!root) return;
    const items = shoppingItems();
    const checked = prefs.checked || {};
    const range = h("div", { class: "mu-segmented", role: "group", "aria-label": t("range") }, [
      h("button", { type: "button", "aria-pressed": String(prefs.shoppingRange === "week"), onclick: () => { savePrefs({ shoppingRange: "week" }); renderShopping(); } }, [t("next7Days")]),
      h("button", { type: "button", "aria-pressed": String(prefs.shoppingRange !== "week"), onclick: () => { savePrefs({ shoppingRange: "all" }); renderShopping(); } }, [t("allUpcoming")]),
    ]);
    const input = h("input", { class: "mu-input", type: "text", placeholder: t("addItemPlaceholder"), "aria-label": t("addItem") });
    const addForm = h("form", { class: "mf-shop-add", onsubmit: (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      savePrefs({ extraItems: [...new Set([...(prefs.extraItems || []), name])] });
      renderShopping();
      $(".mf-shop-add input")?.focus();
    } }, [input, h("button", { type: "submit", class: "mu-btn mu-btn-primary" }, [icon("add"), h("span", { text: t("addItem") })])]);
    const textList = () => items.map((i) => "- [" + (checked[i.key] ? "x" : " ") + "] " + i.name + (i.count > 1 ? " ×" + i.count : "")).join("\n");
    const actions = h("div", { class: "mf-shop-actions" }, [
      h("button", { type: "button", class: "mu-btn", onclick: async () => { try { await navigator.clipboard.writeText(textList()); toast(t("copied")); } catch { toast(t("copyFailed"), "error"); } } }, [icon("content_copy"), h("span", { text: t("copyList") })]),
      h("button", { type: "button", class: "mu-btn", onclick: () => {
        const url = URL.createObjectURL(new Blob([t("shoppingList") + "\n\n" + textList() + "\n"], { type: "text/plain;charset=utf-8" }));
        const a = h("a", { href: url, download: "munetios-meals-shopping-" + isoDay(new Date()) + ".txt" });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } }, [icon("download"), h("span", { text: t("download") })]),
      h("button", { type: "button", class: "mu-btn mu-btn-ghost", onclick: () => {
        const keep = { ...checked };
        const extras = (prefs.extraItems || []).filter((name) => !keep["extra:" + name.toLocaleLowerCase(locale())]);
        Object.keys(keep).forEach((k) => delete keep[k]);
        savePrefs({ checked: keep, extraItems: extras });
        renderShopping();
      } }, [icon("remove_done"), h("span", { text: t("clearChecked") })]),
    ]);
    const list = h("div", { class: "mf-shop-list" });
    if (!items.length) list.append(h("div", { class: "mu-empty" }, [h("span", { class: "mu-icon-circle" }, [icon("shopping_cart")]), h("span", { text: t("shoppingEmpty") })]));
    items.forEach((item) => {
      const box = h("input", { type: "checkbox" });
      box.checked = Boolean(checked[item.key]);
      box.addEventListener("change", () => { savePrefs({ checked: { ...prefs.checked, [item.key]: box.checked } }); row.classList.toggle("is-done", box.checked); });
      const row = h("label", { class: "mf-shop-item mu-check" + (box.checked ? " is-done" : "") }, [
        box,
        h("span", { class: "mf-shop-name", text: item.name }),
        item.count > 1 ? h("span", { class: "mu-badge", text: "×" + item.count }) : null,
        item.meals.size ? h("span", { class: "mf-shop-meals mu-muted", text: [...item.meals].join(", ") }) : null,
        item.extra ? h("button", { type: "button", class: "mu-icon-btn mu-icon-btn-sm", "aria-label": t("removeItem"), onclick: (e) => { e.preventDefault(); savePrefs({ extraItems: prefs.extraItems.filter((x) => x !== item.name) }); renderShopping(); } }, [icon("close")]) : null,
      ]);
      list.append(row);
    });
    root.replaceChildren(h("div", { class: "mf-shop-top" }, [range, actions]), addForm, list);
  }

  /* ------------------------------------------------------------ settings */
  function mountSettings() {
    const advanced = $("#advancedSectionTitle")?.closest(".settings-section");
    if (!advanced || $("#mfGoalInput")) return;
    const input = h("input", { id: "mfGoalInput", type: "number", min: "1", step: "50", inputmode: "numeric", value: String(prefs.calorieGoal) });
    input.addEventListener("change", () => { const v = Math.max(1, Math.round(num(input.value)) || 2000); input.value = v; savePrefs({ calorieGoal: v }); renderApp(); });
    advanced.before(h("div", { class: "settings-section liquid-glass" }, [
      h("h3", { "data-mf": "nutrition", text: t("nutrition") }),
      h("div", { class: "field" }, [h("label", { for: "mfGoalInput", "data-mf": "dailyCalorieGoal", text: t("dailyCalorieGoal") }), input, h("div", { class: "helper-text", "data-mf": "dailyCalorieGoalHelp", text: t("dailyCalorieGoalHelp") })]),
    ]));
  }

  /* ------------------------------------------------------------ app hook + translation */
  function translate() {
    $$("[data-mf]").forEach((n) => { const v = t(n.dataset.mf); if (n.textContent !== v) n.textContent = v; });
    $$("[data-mf-placeholder]").forEach((n) => n.setAttribute("placeholder", t(n.dataset.mfPlaceholder)));
    $$('.sidebar-item[data-page="week"]').forEach((n) => n.setAttribute("aria-label", t("week")));
    $$('.sidebar-item[data-page="shopping"]').forEach((n) => n.setAttribute("aria-label", t("shoppingList")));
  }
  H.afterRenderApp = (page) => {
    const week = $("#weekPage");
    const shop = $("#shoppingPage");
    if (week) { week.classList.toggle("active", page === "week"); week.setAttribute("aria-hidden", String(page !== "week")); }
    if (shop) { shop.classList.toggle("active", page === "shopping"); shop.setAttribute("aria-hidden", String(page !== "shopping")); }
    decorateCards();
    syncToolbar();
    if (page === "week") renderWeek();
    if (page === "shopping") renderShopping();
    paintWhen();
    translate();
  };

  function start() {
    const template = $("#mfPagesTemplate");
    const pages = $(".content-pages");
    if (template && pages && !$("#weekPage")) pages.append(template.content.cloneNode(true));
    mountForm();
    mountToolbar();
    mountSettings();
    translate();
    try { renderApp(); } catch {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
