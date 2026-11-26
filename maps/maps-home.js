/*
 * Munetios Maps Home address.
 * The address lives in localStorage under "munetios_home". maps-workspace.js keeps it per account and
 * maps-sync.js syncs it with end-to-end encryption, so the server only ever stores ciphertext.
 * Clicking Home opens directions from your location to the saved address.
 */
(() => {
  "use strict";
  const KEY = "munetios_home";
  const api = () => window._mapsApi;
  const t = (key) => (api() ? api().t(key) : key);
  const UI = () => window.MunetiosUI;
  const signedIn = () => (window.MapsWorkspace || {}).owner && window.MapsWorkspace.owner !== "guest";

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
  const icon = (name) => h("span", { class: "mu-icon", "aria-hidden": "true", text: name });
  const toast = (msg, type = "success") => (UI()?.toast ? UI().toast(msg, { type }) : api()?.toast(msg));

  function readHome() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "null");
      return v && Number.isFinite(+v.lat) && Number.isFinite(+v.lon) ? v : null;
    } catch { return null; }
  }
  function saveHome(place) {
    const value = { address: String(place.address || "").slice(0, 300), lat: +(+place.lat).toFixed(6), lon: +(+place.lon).toFixed(6), updatedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(value));
    render();
    toast(t("home_saved"));
  }
  function removeHome() {
    localStorage.removeItem(KEY);
    render();
    toast(t("home_removed"));
  }

  /* ------------------------------------------------------------ directions home */
  function goHome() {
    const home = readHome();
    if (!home || !api()) return openEditor();
    api().openDirections(null, { name: t("home_label"), lat: home.lat, lon: home.lon });
    if (api().lastCoords()) return;
    // No position yet: openDirections started location tracking. Route as soon as it arrives.
    toast(t("home_waiting_location"), "info");
    const from = document.getElementById("dirFrom");
    const started = Date.now();
    const wait = setInterval(() => {
      if (from && from.dataset.lat) {
        clearInterval(wait);
        document.getElementById("dirGoBtn")?.click();
      } else if (Date.now() - started > 30000) clearInterval(wait);
    }, 400);
  }

  /* ------------------------------------------------------------ home panel row */
  function render() {
    const slot = document.getElementById("homeAddressSlot");
    if (!slot) return;
    const home = readHome();
    slot.replaceChildren();
    const main = h("button", { type: "button", class: "mu-row home-address-row", onclick: goHome, "aria-label": home ? t("home_label") + ": " + home.address : t("home_set") }, [
      h("span", { class: "mu-icon-circle" }, icon("home")),
      h("span", { class: "mu-row-info" }, [
        h("span", { class: "mu-row-title", text: t("home_label") }),
        h("span", { class: "mu-row-subtitle", text: home ? home.address || home.lat + ", " + home.lon : t("home_add_hint") }),
      ]),
    ]);
    slot.append(main);
    if (home) slot.append(h("button", { type: "button", class: "mu-icon-btn mu-icon-btn-soft", onclick: openEditor, "aria-label": t("home_change"), title: t("home_change") }, icon("edit")));
  }

  /* ------------------------------------------------------------ editor modal */
  let modal = null;
  let searchTimer = 0;
  let searchSeq = 0;
  function buildModal() {
    modal = h("div", { class: "mu-modal", id: "homeAddressModal", hidden: true });
    const input = h("input", { class: "mu-input", type: "search", id: "homeAddressInput", autocomplete: "street-address", enterkeyhint: "search" });
    const results = h("div", { class: "home-address-results", id: "homeAddressResults", role: "listbox", "aria-live": "polite" });
    const note = h("p", { class: "mu-muted home-address-note", id: "homeAddressNote" });
    const removeBtn = h("button", { type: "button", class: "mu-btn mu-btn-danger", id: "homeAddressRemove", onclick: () => { removeHome(); UI()?.closeModal(modal); } }, [icon("delete"), h("span", { "data-home-text": "home_remove" })]);
    const cancelBtn = h("button", { type: "button", class: "mu-btn", "data-mu-close": true, "data-home-text": "confirm_cancel" });
    modal.append(h("div", { class: "mu-dialog", role: "dialog", "aria-labelledby": "homeAddressTitle" }, [
      h("div", { class: "mu-dialog-header" }, [
        h("div", { class: "mu-dialog-heading" }, [h("span", { class: "mu-icon-circle" }, icon("home")), h("h2", { id: "homeAddressTitle", "data-home-text": "home_set" })]),
        h("button", { type: "button", class: "mu-icon-btn mu-icon-btn-soft", "data-mu-close": true, "data-home-aria": "close" }, icon("close")),
      ]),
      h("label", { class: "mu-field" }, [h("span", { class: "mu-field-label", "data-home-text": "home_search_placeholder" }), input]),
      results,
      h("p", { class: "home-address-privacy" }, [icon("lock"), note]),
      h("div", { class: "mu-dialog-actions" }, [removeBtn, cancelBtn]),
    ]));
    input.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => search(input.value), 400); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(searchTimer); search(input.value); } });
    document.body.append(modal);
  }
  function localizeModal() {
    if (!modal) return;
    modal.querySelectorAll("[data-home-text]").forEach((el) => { el.textContent = t(el.dataset.homeText); });
    modal.querySelectorAll("[data-home-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.homeAria)));
    const input = modal.querySelector("#homeAddressInput");
    input.placeholder = t("home_search_placeholder");
    modal.querySelector("#homeAddressNote").textContent = signedIn() ? t("home_privacy_account") : t("home_privacy_guest");
    const home = readHome();
    modal.querySelector("#homeAddressTitle").textContent = home ? t("home_change") : t("home_set");
    modal.querySelector("#homeAddressRemove").hidden = !home;
  }
  function openEditor() {
    if (!modal) buildModal();
    localizeModal();
    const input = modal.querySelector("#homeAddressInput");
    input.value = readHome()?.address || "";
    modal.querySelector("#homeAddressResults").replaceChildren();
    UI()?.openModal("homeAddressModal");
    setTimeout(() => { input.focus(); input.select(); }, 30);
  }
  async function search(query) {
    const list = modal.querySelector("#homeAddressResults");
    const q = String(query || "").trim();
    const seq = ++searchSeq;
    if (q.length < 3) { list.replaceChildren(); return; }
    list.replaceChildren(h("p", { class: "mu-muted", text: t("home_searching") }));
    let found = [];
    try { found = (await api().geocode(q)) || []; }
    catch { if (seq === searchSeq) list.replaceChildren(h("p", { class: "mu-muted", text: t("home_search_failed") })); return; }
    if (seq !== searchSeq) return;
    if (!found.length) { list.replaceChildren(h("p", { class: "mu-muted", text: t("home_no_results") })); return; }
    list.replaceChildren(...found.slice(0, 6).map((r) => h("button", {
      type: "button", class: "mu-row home-address-result", role: "option",
      onclick: () => { saveHome({ address: r.display_name, lat: r.lat, lon: r.lon }); UI()?.closeModal(modal); },
    }, [h("span", { class: "mu-icon-circle" }, icon("location_on")), h("span", { class: "mu-row-info" }, [h("span", { class: "mu-row-title", text: r.display_name })])])));
  }

  /* ------------------------------------------------------------ "Set as Home" on the map */
  async function setFromContextMenu() {
    const a = api();
    if (!a) return;
    const { lat, lng } = a.contextCoords();
    a.closeContextMenu();
    let address = lat.toFixed(5) + ", " + lng.toFixed(5);
    try {
      const resp = await fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=" + lat + "&lon=" + lng, { headers: { "Accept-Language": document.documentElement.lang || "en" } });
      if (resp.ok) { const data = await resp.json(); if (data && data.display_name) address = data.display_name; }
    } catch {}
    saveHome({ address, lat, lon: lng });
  }

  function start() {
    render();
    document.getElementById("ctxSetHome")?.addEventListener("click", setFromContextMenu);
    document.addEventListener("maps-sync-applied", render);
    document.addEventListener("maps-data-changed", (e) => { if (e.detail?.key === KEY) render(); });
    window.addEventListener("storage", (e) => { if (e.key === KEY) render(); });
    // applyTranslations() updates <html lang> when the language changes.
    new MutationObserver(() => { render(); localizeModal(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  }
  if (window._mapsApi) start();
  else document.addEventListener("maps-ready", start, { once: true });
})();
