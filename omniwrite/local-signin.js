(() => {
  "use strict";
  const lockName = "omniwrite-local-library";
  const intentKey = "omniwrite-signin-local-choice";
  const stores = {
    "omniwrite-db": ["documents", "folders", "images", "trashImages", "videos", "audios"],
    "omniwrite-sheets": ["books", "versions"],
    "omniwrite-sync-media-v1": ["chunks"]
  };
  const providerIds = ["omniwrite", "omniwrite-sheets", "omniwrite-media"];
  const localKeys = () => Object.keys(localStorage);
  const notesKey = key => /^omniwrite-quick-notes(?:-|$)/.test(key);
  let editorReady = Promise.resolve(), prompting = false;
  if (document.currentScript.hasAttribute("data-omni-editor") && navigator.locks) {
    let release;
    editorReady = new Promise((resolve, reject) => {
      navigator.locks.request(lockName, { mode: "shared" }, () => {
        resolve();
        return new Promise(unlock => { release = unlock; });
      }).catch(reject);
    });
    window.addEventListener("pagehide", () => release?.());
    window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
  }

  async function withStores(name, names, mode, use) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = event => { if (!event.oldVersion) request.transaction.abort(); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => request.error?.name === "AbortError" ? resolve(null) : reject(request.error);
    });
    if (!db) return [];
    try {
      const present = names.filter(store => db.objectStoreNames.contains(store));
      if (!present.length) return [];
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(present, mode);
        const requests = present.map(store => use(tx.objectStore(store)));
        tx.oncomplete = () => resolve(requests.map(request => request.result));
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  async function hasData() {
    if (window.OmniLocalSignIn.hasEditorData?.()) return true;
    if (localKeys().some(key => notesKey(key) && (JSON.parse(localStorage.getItem(key) || "[]")?.length || 0))) return true;
    const counts = await Promise.all(Object.entries(stores).map(([name, names]) => withStores(name, names, "readonly", store => store.count())));
    return counts.flat().some(Boolean);
  }

  function forgetSyncSnapshots() {
    const omniItem = key => providerIds.some(id => key.startsWith(id + ":"));
    for (const key of localKeys().filter(key => key.startsWith("munetios-sync:"))) {
      const state = JSON.parse(localStorage.getItem(key));
      for (const group of ["items", "cursor"]) {
        for (const id of Object.keys(state?.[group] || {})) {
          if (omniItem(id)) delete state[group][id];
        }
      }
      localStorage.setItem(key, JSON.stringify(state));
    }
    const key = "munetios-sync-owner";
    const owners = JSON.parse(localStorage.getItem(key) || "{}");
    providerIds.forEach(id => delete owners[id]);
    localStorage.setItem(key, JSON.stringify(owners));
  }

  async function clearData() {
    if (!navigator.locks) throw new Error("storageUnavailable");
    await navigator.locks.request(lockName, { ifAvailable: true }, async lock => {
      if (!lock) throw new Error("editorOpen");
      // Forget local sync versions before clearing, so a later sync downloads
      // the account's files instead of interpreting the empty cache as deletions.
      forgetSyncSnapshots();
      for (const [name, names] of Object.entries(stores)) {
        await withStores(name, names, "readwrite", store => store.clear());
      }
      for (const key of localKeys()) if (notesKey(key) || key === "munetios-workspace-doc-counts") localStorage.removeItem(key);
    });
  }

  function text(key) {
    const code = (document.querySelector("[data-omni-editor]") ? localStorage.getItem("omniwrite-lang") : document.documentElement.lang)
      || localStorage.getItem("munetiosLanguage") || navigator.language;
    const locale = window.MunetiosAccountStrings.resolveLocale(code);
    const copy = window.MunetiosSigninTranslations;
    // Sign-in copy uses the older codes ("en", "fr", "es-419"); account strings use the 17 global locales.
    const older = { "en-US": "en", "en-GB": "en", "fr-FR": "fr", "fr-CA": "fr", "es-US": "es-419" }[locale];
    return copy[locale]?.[key] || (older && copy[older]?.[key]) || window.MunetiosAccountStrings.catalog[locale]?.[key] || copy[code]?.[key] || copy.en[key] || window.MunetiosAccountStrings.catalog.en[key];
  }

  function showPrompt({ initial, deleting = false, error = "", keep, discard, cancel }) {
    const modal = document.createElement("div");
    modal.id = "omniLocalSignInPrompt";
    modal.className = "mu-modal mu-root omni-local-signin-dialog";
    modal.hidden = true;
    modal.innerHTML = `
      <section class="mu-dialog mu-dialog-md" role="dialog" aria-modal="true" aria-labelledby="omniLocalTitle" aria-describedby="omniLocalDescription">
        <div class="mu-dialog-header">
          <div class="mu-dialog-heading">
            <span class="mu-icon-circle" aria-hidden="true"><span class="mu-icon" id="omniLocalIcon">devices</span></span>
            <h2 id="omniLocalTitle"></h2>
          </div>
        </div>
        <p id="omniLocalDescription" class="mu-muted"></p>
        <p id="omniLocalError" role="alert" hidden></p>
        <div class="mu-dialog-actions">
          <button type="button" class="mu-btn mu-btn-ghost" data-choice="cancel"></button>
          <button type="button" class="mu-btn mu-btn-danger-outline" data-choice="delete"></button>
          <button type="button" class="mu-btn mu-btn-primary" data-choice="keep"></button>
        </div>
      </section>`;
    const find = id => modal.querySelector(id);
    const buttons = [...modal.querySelectorAll("[data-choice]")];
    const [cancelButton, deleteButton, keepButton] = buttons;
    let busy = false;
    function render() {
      find("#omniLocalIcon").textContent = deleting ? "delete" : "devices";
      find("#omniLocalTitle").textContent = text(deleting ? "localDeleteTitle" : initial);
      find("#omniLocalDescription").textContent = text(deleting ? "localDeleteBody" : "localSignInBody");
      const notice = find("#omniLocalError");
      notice.hidden = !error;
      notice.textContent = error ? text(error) : "";
      cancelButton.textContent = text("cancel");
      keepButton.textContent = text("signIn");
      keepButton.hidden = deleting;
      deleteButton.textContent = text("localDeleteAction");
      deleteButton.classList.toggle("mu-btn-danger", deleting);
      deleteButton.classList.toggle("mu-btn-danger-outline", !deleting);
    }
    function close() {
      document.removeEventListener("keydown", escape, true);
      window.MunetiosUI.closeModal(modal);
      modal.remove();
    }
    function back() {
      if (busy) return;
      if (deleting) { deleting = false; error = ""; render(); keepButton.focus(); }
      else { close(); cancel(); }
    }
    function escape(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      back();
    }
    cancelButton.addEventListener("click", back);
    keepButton.addEventListener("click", () => { close(); keep(); });
    deleteButton.addEventListener("click", async () => {
      if (!deleting) {
        deleting = true;
        render();
        cancelButton.focus();
        return;
      }
      busy = true;
      buttons.forEach(button => { button.disabled = true; });
      try {
        await discard();
        close();
      } catch (failure) {
        error = failure?.message === "editorOpen" ? "localDeleteCloseTabs" : "localDeleteFailed";
        buttons.forEach(button => { button.disabled = false; });
        busy = false;
        render();
        cancelButton.focus();
      }
    });
    modal.addEventListener("click", event => { if (event.target === modal) event.stopPropagation(); });
    render();
    document.body.append(modal);
    document.addEventListener("keydown", escape, true);
    window.MunetiosUI.openModal(modal.id);
    (deleting ? cancelButton : keepButton).focus();
  }

  function remember(choice) { try { sessionStorage.setItem(intentKey, choice); } catch {} }
  function takeChoice() {
    try {
      const choice = sessionStorage.getItem(intentKey);
      sessionStorage.removeItem(intentKey);
      return choice;
    } catch { return null; }
  }

  async function start(url) {
    if (prompting) return;
    prompting = true;
    try {
      if (!await hasData().catch(() => false)) { location.assign(url); return; }
      showPrompt({
        initial: "localSignInTitle",
        keep: () => { remember("keep"); location.assign(url); },
        discard: () => { sessionStorage.setItem(intentKey, "delete"); location.assign(url); },
        cancel: () => { prompting = false; }
      });
    } catch {
      prompting = false;
    }
  }

  async function checkSignIn(backUrl) {
    const main = document.querySelector(".signin-main");
    main.inert = true;
    const ready = () => { main.inert = false; };
    const choice = takeChoice();
    if (choice === "keep") { ready(); return; }
    let error = "";
    if (choice === "delete") {
      try { await clearData(); ready(); return; }
      catch (failure) { error = failure?.message === "editorOpen" ? "localDeleteCloseTabs" : "localDeleteFailed"; }
    } else if (!await hasData().catch(() => false)) { ready(); return; }
    showPrompt({
      initial: "localDataDetected",
      deleting: choice === "delete",
      error,
      keep: ready,
      discard: async () => { await clearData(); ready(); },
      cancel: () => location.assign(backUrl)
    });
  }

  if (document.currentScript.hasAttribute("data-omni-editor")) {
    document.addEventListener("click", event => {
      const link = event.target.closest?.('a[href^="/signin"]');
      if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      start(link.href);
    });
  }
  window.OmniLocalSignIn = { editorReady, start, checkSignIn, hasEditorData: null };
})();
