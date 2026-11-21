/*!
 * Munetios account button + menu. Put an element with
 * [data-munetios-account] where the button belongs; an existing
 * a.account-sign-in inside it is kept as the signed-out state.
 * Requires munetios-ui-v4.js, account-i18n.js, account-core.js.
 */
(() => {
  "use strict";
  const A = window.MunetiosAccount;
  if (!A) return;
  const t = A.t;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const notify = (message, type = "info") => (window.MunetiosUI?.toast ? window.MunetiosUI.toast(message, { type }) : window.showToast?.(message));
  const here = () => location.pathname + location.search + location.hash;
  const initial = account => ([...(account?.displayName || account?.email || "?").trim()][0] || "?").toLocaleUpperCase();
  const avatar = (account, large) => `<span class="mu-account-avatar${large ? " is-lg" : ""}" aria-hidden="true">${A.settings.get('showPictures') && account?.picture && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(account.picture) ? `<img src="${esc(account.picture)}" alt="">` : esc(initial(account))}</span>`;
  let menu = null, trigger = null, expanded = { workspaces: false, accounts: false }, cleanup = null;

  function status() {
    switch (A.state.status) {
      case "paused": return { key: "paused", icon: "cloud_off", text: t(A.state.revocation ? "sessionSyncPaused" : "syncOff") };
      case "full": return { key: "full", icon: "cloud_off", text: t("storageFull") };
      case "synced": return { key: "ok", icon: "cloud_done", text: t("synced"), sub: t("e2e") };
      case "error": return { key: "error", icon: "cloud_off", text: t("syncFailed") };
      case "locked": return { key: "locked", icon: "lock", text: t("syncLocked"), action: true };
      default: return { key: "syncing", icon: "sync", text: t("syncing"), sub: t("e2e") };
    }
  }

  /* ---------------------------------------------------------- button */
  function renderSlot(slot) {
    if (!A.state.ready) return;
    let signIn = slot.querySelector(".account-sign-in");
    let button = slot.querySelector(".mu-account-trigger");
    const account = A.state.account;
    let paused = slot.querySelector("[data-session-sync-status]");
    if (A.state.revocation && slot.dataset.accountPlacement !== "sidebar") {
      if (!paused) {
        paused = document.createElement("span");
        paused.className = "mu-status";
        paused.dataset.sessionSyncStatus = "";
        paused.setAttribute("role", "status");
        slot.append(paused);
      }
      paused.textContent = t("sessionSyncPaused");
    } else paused?.remove();
    if (slot.dataset.accountPlacement === "topbar" && account) { if (signIn) signIn.hidden = true; button?.remove(); return; }
    if (slot.dataset.accountPlacement === "sidebar") { slot.hidden = !account; if (!account) { button?.remove(); return; } }
    if (!account) {
      button?.remove();
      if (!signIn) {
        signIn = document.createElement("a");
        signIn.className = "account-sign-in mu-btn mu-btn-primary";
        signIn.textContent = t("signIn");
        slot.append(signIn);
      }
      signIn.hidden = false;
      signIn.href = `/signin?continue=${encodeURIComponent(here())}`;
      return;
    }
    if (signIn) signIn.hidden = true;
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = slot.dataset.accountPlacement === "sidebar" ? "mu-account-trigger mu-btn mu-btn-ghost" : "mu-account-trigger";
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("click", () => (menu ? closeMenu(true) : openMenu(button)));
      slot.append(button);
    }
    const s = status();
    button.dataset.status = s.key;
    button.setAttribute("aria-label", `${t("accountMenu")}: ${account.displayName || A.displayEmail(account)}. ${s.text}`);
    if (slot.dataset.accountPlacement === "sidebar") button.title = account.displayName || A.displayEmail(account);
    button.innerHTML = `${avatar(account)}${slot.dataset.accountPlacement === "sidebar" ? `<span class="mu-account-sidebar-name">${esc(account.displayName || A.displayEmail(account))}</span><span class="mu-icon" aria-hidden="true">expand_less</span>` : ""}`;
  }
  function renderSlots() {
    const sidebar = document.querySelector('.sidebar__bottom-actions');
    if (sidebar && document.getElementById('workspaceProfileSlot')) {
      let slot = document.getElementById('omniAccountProfileSlot');
      if (!slot) {
        slot = document.createElement('div'); slot.id = 'omniAccountProfileSlot';
        slot.setAttribute('data-munetios-account', ''); slot.dataset.accountPlacement = 'sidebar';
        slot.hidden = true; sidebar.append(slot);
      }
      document.querySelectorAll('.navbar [data-munetios-account]').forEach(top => { top.dataset.accountPlacement = 'topbar'; });
      document.body.classList.toggle('omni-account-signed-in', Boolean(A.state.ready && A.state.account));
    }
    document.querySelectorAll('[data-munetios-account]').forEach(renderSlot);
  }

  /* ---------------------------------------------------------- menu */
  function item(action, icon, label, extra = "") {
    return `<button type="button" class="mu-menu-item" role="menuitem" data-action="${action}" ${extra}><span class="mu-icon" aria-hidden="true">${icon}</span><span class="mu-account-item-label">${esc(label)}</span></button>`;
  }
  function renderMenu() {
    if (!menu) return;
    const account = A.state.account;
    if (!account) { closeMenu(false); return; }
    const s = status();
    const list = A.workspaces.list();
    const active = A.workspaces.active();
    const others = A.state.accounts || [];
    menu.innerHTML = `
      <div class="mu-account-head">${avatar(account, true)}<div class="mu-account-who">${account.displayName ? `<span class="mu-account-name">${esc(account.displayName)}</span>` : ""}<span class="mu-account-email">${esc(A.displayEmail(account))}</span></div><button type="button" class="mu-btn mu-account-manage" data-action="settings"><span class="mu-icon" aria-hidden="true">manage_accounts</span><span>${esc(t("accountSettings"))}</span></button></div>
      <div class="mu-account-status is-${s.key}" role="status">
        <span class="mu-icon mu-icon-filled" aria-hidden="true">${s.icon}</span>
        <span class="mu-account-status-text"><span>${esc(s.text)}</span>${s.sub ? `<span class="mu-account-status-sub"><span class="mu-icon" aria-hidden="true">lock</span>${esc(s.sub)}</span>` : ""}</span>
        ${s.action ? `<button type="button" class="mu-btn mu-btn-primary mu-account-unlock" data-action="unlock">${esc(t("unlockSync"))}</button>` : ""}
      </div>
      <div class="mu-menu-sep"></div>
      ${item("toggle-workspaces", "workspaces", t("workspaces"), `aria-expanded="${expanded.workspaces}"`).replace("</button>", `<span class="mu-icon mu-account-chevron" aria-hidden="true">${expanded.workspaces ? "expand_less" : "expand_more"}</span></button>`)}
      ${expanded.workspaces ? `<div class="mu-account-sub" role="group" aria-label="${esc(t("workspaces"))}">${list.map(ws => `<button type="button" class="mu-menu-item${ws.id === active ? " is-selected" : ""}" role="menuitemradio" aria-checked="${ws.id === active}" data-action="workspace" data-id="${esc(ws.id)}"><span class="mu-account-ws-initial" aria-hidden="true">${esc(([...A.workspaces.label(ws)][0] || "?").toLocaleUpperCase())}</span><span class="mu-account-item-label">${esc(A.workspaces.label(ws))}</span>${ws.id === active ? '<span class="mu-icon mu-menu-check" aria-hidden="true">check</span>' : ""}</button>`).join("")}</div>` : ""}
      ${item("toggle-accounts", "switch_account", t("switchAccounts"), `aria-expanded="${expanded.accounts}"`).replace("</button>", `<span class="mu-icon mu-account-chevron" aria-hidden="true">${expanded.accounts ? "expand_less" : "expand_more"}</span></button>`)}
      ${expanded.accounts ? `<div class="mu-account-sub" role="group" aria-label="${esc(t("switchAccounts"))}">${others.length ? others.map(other => `<button type="button" class="mu-menu-item" role="menuitem" data-action="switch" data-id="${esc(other.id)}">${avatar(other)}<span class="mu-account-item-label">${esc(other.displayName || A.displayEmail(other))}</span></button>`).join("") : `<p class="mu-account-empty">${esc(t("noOtherAccounts"))}</p>`}</div>` : ""}
      ${item("add", "person_add", t("addAccount"))}
      <div class="mu-menu-sep"></div>
      ${item("signout", "logout", t("signOut")).replace('class="mu-menu-item"', 'class="mu-menu-item mu-account-signout"')}`;
    position();
  }
  function position() {
    if (!menu || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(400, window.innerWidth - 24);
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`;
    menu.style.maxHeight = `${Math.max(0, window.innerHeight - 24)}px`;
    const below = window.innerHeight - rect.bottom - 22;
    const above = rect.top - 22;
    const up = above > below && menu.offsetHeight > below;
    menu.style.maxHeight = `${Math.max(0, up ? above : below)}px`;
    menu.style.top = `${Math.max(12, up ? rect.top - menu.offsetHeight - 10 : rect.bottom + 10)}px`;
  }
  function openMenu(button) {
    trigger = button;
    menu = document.createElement("div");
    menu.className = "mu-menu mu-menu-floating mu-scroll mu-account-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", t("accountMenu"));
    document.body.append(menu);
    renderMenu(); position();
    button.setAttribute("aria-expanded", "true");
    menu.addEventListener("click", onMenuClick);
    const outside = event => { if (menu && !menu.contains(event.target) && !trigger.contains(event.target)) closeMenu(false); };
    const keys = event => { if (event.key === "Escape") closeMenu(true); };
    const reflow = () => position();
    setTimeout(() => document.addEventListener("pointerdown", outside), 0);
    document.addEventListener("keydown", keys);
    window.addEventListener("resize", reflow);
    cleanup = () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", keys); window.removeEventListener("resize", reflow); };
    menu.querySelector("button")?.focus();
  }
  function closeMenu(focus) {
    cleanup?.(); cleanup = null;
    menu?.remove(); menu = null;
    if (trigger) { trigger.setAttribute("aria-expanded", "false"); if (focus) trigger.focus(); }
  }
  async function onMenuClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "toggle-workspaces" || action === "toggle-accounts") {
      expanded[action === "toggle-workspaces" ? "workspaces" : "accounts"] = !expanded[action === "toggle-workspaces" ? "workspaces" : "accounts"];
      renderMenu(); menu.querySelector(`[data-action="${action}"]`)?.focus();
      return;
    }
    if (action === "workspace") {
      try {
        if (window.OmniWriteSync?.openWorkspace) { window.OmniWriteSync.openWorkspace(button.dataset.id); closeMenu(false); }
        else { A.workspaces.setActive(button.dataset.id); location.href = "/omniwrite/"; }
      } catch { notify(t("workspaceOpenFailed"), "error"); }
      return;
    }
    if (action === "add") {
      const url = `/signin?add=1&continue=${encodeURIComponent(here())}`;
      if (window.OmniLocalSignIn) window.OmniLocalSignIn.start(url);
      else location.href = url;
      return;
    }
    if (action === "settings") { location.href = `/account/?from=${encodeURIComponent(here())}`; return; }
    if (action === "unlock") { closeMenu(false); openUnlock(); return; }
    if (action === "switch") {
      button.disabled = true;
      try { await A.switchAccount(button.dataset.id); location.reload(); }
      catch (error) { button.disabled = false; notify(t(error.code === "switchBlocked" ? "switchBlocked" : "switchFailed"), "error"); }
      return;
    }
    if (action === "signout") {
      button.disabled = true;
      try {
        await A.signOut();
        closeMenu(false);
        if (A.state.account) location.reload(); // another signed-in account is now active
      } catch { button.disabled = false; notify(t("signOutFailed"), "error"); }
    }
  }

  /* ---------------------------------------------------------- turn on sync */
  let checkingUnlockMethod = false;
  async function openUnlock() {
    if (checkingUnlockMethod || !A.state.account) return;
    const accountId = A.state.account.id;
    checkingUnlockMethod = true;
    try {
      const google = await A.google.connection();
      if (A.state.account?.id !== accountId) return;
      if (google.enabled && google.linked && !google.hasPassword) {
        const params = new URLSearchParams({ unlock: '1', continue: here() });
        location.assign('/api/auth/google/start?' + params);
        return;
      }
    } catch {
      if (A.state.account?.id !== accountId) return;
    } finally {
      checkingUnlockMethod = false;
    }
    openPasswordUnlock();
  }

  function openPasswordUnlock() {
    let modal = document.getElementById("munetiosUnlockModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.className = "mu-modal";
      modal.id = "munetiosUnlockModal";
      modal.hidden = true;
      document.body.append(modal);
    }
    modal.innerHTML = `
      <form class="mu-dialog" role="dialog" aria-labelledby="munetiosUnlockTitle" novalidate>
        <div class="mu-dialog-header"><div class="mu-dialog-heading"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">lock_open</span></span><h2 id="munetiosUnlockTitle">${esc(t("unlockSync"))}</h2></div>
          <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-mu-close aria-label="${esc(t("close"))}"><span class="mu-icon" aria-hidden="true">close</span></button></div>
        <p class="mu-muted mu-account-dialog-text">${esc(t("unlockBody"))}</p>
        <label class="mu-field"><span class="mu-field-label">${esc(t("password"))}</span><input class="mu-input" type="password" name="password" autocomplete="current-password" required></label>
        <p class="mu-account-dialog-error" role="alert" hidden></p>
        <div class="mu-dialog-actions"><button type="button" class="mu-btn" data-mu-close>${esc(t("cancel"))}</button><button type="submit" class="mu-btn mu-btn-primary">${esc(t("unlockSync"))}</button></div>
      </form>`;
    const shown = window.MunetiosUI?.openModal ? window.MunetiosUI.openModal("munetiosUnlockModal") : (modal.hidden = false, modal);
    const form = shown.querySelector("form");
    const error = form.querySelector(".mu-account-dialog-error");
    form.querySelector("input").focus();
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true; error.hidden = true;
      try {
        await A.unlock(form.password.value);
        window.MunetiosUI?.closeModal ? window.MunetiosUI.closeModal(shown) : (shown.hidden = true);
      } catch {
        error.textContent = t("unlockFailed"); error.hidden = false; submit.disabled = false;
      }
    });
  }

  let notifiedRevocation;
  function renderRevocation() {
    const revoked = A.state.revocation;
    if (!A.state.ready || !window.MunetiosUI?.openModal) return;
    if (!revoked) {
      const previous = document.getElementById("munetiosSignedOutModal");
      if (previous && !previous.hidden) window.MunetiosUI.closeModal(previous);
      return;
    }
    if (revoked.id === notifiedRevocation) return;
    notifiedRevocation = revoked.id;
    const modal = document.createElement("div");
    modal.className = "mu-modal";
    modal.id = "munetiosSignedOutModal";
    modal.hidden = true;
    const params = new URLSearchParams({ continue: here() });
    if (A.state.account) params.set("add", "1");
    modal.innerHTML = `<section class="mu-dialog" role="dialog" aria-modal="true" aria-labelledby="munetiosSignedOutTitle">
      <div class="mu-dialog-header"><h2 id="munetiosSignedOutTitle">${esc(t("sessionSignedOut"))}</h2></div>
      <p class="mu-muted">${esc(t("sessionSyncPaused"))}</p>
      <div class="mu-dialog-actions">
        <button type="button" class="mu-btn" data-mu-close>${esc(t("sessionStayHere"))}</button>
        <a class="mu-btn mu-btn-primary" href="/signin?${esc(params.toString())}">${esc(t("signIn"))}</a>
      </div>
    </section>`;
    document.getElementById(modal.id)?.remove();
    document.body.append(modal);
    window.MunetiosUI.openModal(modal.id);
  }
  A.on(() => { renderSlots(); renderMenu(); renderRevocation(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderRevocation, { once: true }); else renderRevocation();
  document.addEventListener("munetios-workspaces-changed", renderMenu);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderSlots, { once: true }); else renderSlots();
  window.MunetiosAccountMenu = { render: renderSlots, openUnlock };
})();
