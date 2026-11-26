/*!
 * Account settings page. Error wording by area:
 *   Security -> "We were unable to process…", account updates -> "Failed to…",
 *   workspaces -> "Couldn't…" / "We couldn't…".
 */
(() => {
  "use strict";
  const A = window.MunetiosAccount;
  const UI = window.MunetiosUI;
  const t = A.t;
  const root = document.documentElement;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const notify = (message, type = "info") => UI?.toast?.(message, { type });
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  const SECTIONS = ["account", "security", "sync", "workspaces", "data"];
  let remoteCounts = null, remoteCountsLoaded = false;

  /* ---------------------------------------------------------- back, theme, language */
  const from = new URLSearchParams(location.search).get("from") || "";
  $("backLink").href = /^\/(?!\/)[^\s\\]*$/.test(from) && !from.startsWith("/account") && !from.startsWith("/signin") ? from : "/";

  if (/^\/apps\/supervidplayer(?:[/?#]|$)/.test(from) && $("backLink").getAttribute("href") === from) {
    $("superVidPlayerLink").href = from;
    $("superVidPlayerLink").hidden = false;
  }

  function applyTheme() {
    const light = read("munetiosTheme") === "light-mode";
    if (root.dataset.muTheme !== (light ? "light" : "dark")) root.dataset.muTheme = light ? "light" : "dark";
    root.style.colorScheme = light ? "light" : "dark";
    $("themeButton").setAttribute("aria-label", t(light ? "darkTheme" : "lightTheme"));
    $("themeButton").querySelector(".mu-icon").textContent = light ? "dark_mode" : "light_mode";
  }
  $("themeButton").addEventListener("click", () => {
    // Same setting Ganetios uses, so the choice syncs with Appearance.
    write("munetiosTheme", read("munetiosTheme") === "light-mode" ? "munetios-default" : "light-mode");
    write("munetiosThemeUserOverride", "true");
    applyTheme();
    A.sync.schedule(600);
  });
  new MutationObserver(applyTheme).observe(root, { attributes: true, attributeFilter: ["data-mu-theme"] });

  function renderTexts() {
    const locale = A.locale();
    root.lang = locale;
    root.dir = locale === "ar" ? "rtl" : "ltr";
    document.title = `${t("accountSettings")} · Munetios`;
    document.querySelectorAll("[data-t]").forEach(element => { element.textContent = t(element.dataset.t); });
    // The birthday shows in the chosen language (skipped while the page is still starting up).
    try { paintBirthday(); } catch {}
    $("accountNav").setAttribute("aria-label", t("accountSettings"));
    applyTheme();
    renderAccountSettings();
    renderGoogleConnection();
  }
  const language = $("language");
  language.value = A.locale();
  language.addEventListener("change", () => {
    write("munetiosLanguage", language.value);
    renderTexts(); renderAll(); A.sync.schedule(600);
  });

  /* ---------------------------------------------------------- sections */
  function showSection(name) {
    const section = SECTIONS.includes(name) ? name : "account";
    SECTIONS.forEach(id => { $(`section-${id}`).hidden = id !== section; });
    document.querySelectorAll(".account-nav [data-section]").forEach(button => {
      if (button.dataset.section === section) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    if (section === "security") { loadDevices(); loadSecurity(); }
    if (section === "sync") loadStorage();
    if (section === "workspaces") loadRemoteCounts();
  }
  $("accountNav").addEventListener("click", event => {
    const button = event.target.closest("[data-section]");
    if (!button) return;
    history.replaceState(null, "", `#${button.dataset.section}`);
    showSection(button.dataset.section);
    $(`h-${button.dataset.section}`).focus?.();
  });
  window.addEventListener("hashchange", () => showSection(location.hash.slice(1)));

  /* ---------------------------------------------------------- dialog */
  function dialog({ icon, title, body, details = '', input, fields = [], confirm, danger = false, action }) {
    let modal = $("accountDialog");
    if (!modal) { modal = document.createElement("div"); modal.className = "mu-modal"; modal.id = "accountDialog"; modal.hidden = true; document.body.append(modal); }
    if (!modal.hidden) UI.closeModal(modal);
    modal.innerHTML = `
      <form class="mu-dialog" role="dialog" aria-labelledby="accountDialogTitle" novalidate>
        <div class="mu-dialog-header"><div class="mu-dialog-heading"><span class="mu-icon-circle${danger ? " mu-icon-circle-danger" : ""}"><span class="mu-icon" aria-hidden="true">${icon}</span></span><h2 id="accountDialogTitle">${esc(title)}</h2></div>
          <button type="button" class="mu-icon-btn mu-icon-btn-soft" data-mu-close aria-label="${esc(t("close"))}"><span class="mu-icon" aria-hidden="true">close</span></button></div>
        ${body ? `<p class="mu-muted account-dialog-text">${esc(body)}</p>` : ""}
        ${details}
        ${input ? `<label class="mu-field"><span class="mu-field-label">${esc(input.label)}</span><input class="mu-input" name="value" type="${input.type || "text"}" ${input.autocomplete ? `autocomplete="${input.autocomplete}"` : ""} value="${esc(input.value || "")}" maxlength="${input.maxlength || 1024}" dir="auto"></label>` : ""}
        ${fields.map(field => `<label class="mu-field"><span class="mu-field-label">${esc(field.label)}</span><input class="mu-input" name="${esc(field.name)}" type="${field.type || 'text'}" autocomplete="${field.autocomplete || 'off'}" ${field.numeric ? 'inputmode="numeric" pattern="[0-9]{6}" maxlength="6"' : 'maxlength="254"'} required></label>`).join('')}
        <p class="account-dialog-error" role="alert" hidden></p>
        <div class="mu-dialog-actions"><button type="button" class="mu-btn" data-mu-close>${esc(t("cancel"))}</button><button type="submit" class="mu-btn ${danger ? "mu-btn-danger" : "mu-btn-primary"}">${esc(confirm)}</button></div>
      </form>`;
    const shown = UI.openModal("accountDialog");
    const form = shown.querySelector("form");
    const error = form.querySelector(".account-dialog-error");
    (form.querySelector("input") || form.querySelector('[type="submit"]')).focus();
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true; error.hidden = true;
      try { await action(form.elements.namedItem("value")?.value, new FormData(form)); if (shown.querySelector("form") === form) UI.closeModal(shown); }
      catch (failure) { error.textContent = failure.message; error.hidden = false; submit.disabled = false; }
    });
  }
  const failWith = key => { throw new Error(t(key)); };

  /* ---------------------------------------------------------- account */
  const initial = account => ([...(account?.displayName || account?.email || "?").trim()][0] || "?").toLocaleUpperCase();
  function renderAccount() {
    const account = A.state.account;
    if (!account) return;
    $("profileAvatar").replaceChildren();
    if (account.picture && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(account.picture)) {
      const image = document.createElement('img'); image.src = account.picture; image.alt = '';
      $("profileAvatar").append(image);
    } else $("profileAvatar").textContent = initial(account);
    $("removePicture").hidden = !account.picture;
    if (!$("picturePrivacy").disabled) $("picturePrivacy").checked = account.showProfilePictureToEveryone !== false;
    $("profileName").textContent = account.displayName || account.email;
    $("profileEmail").textContent = account.displayName ? account.email : "";
    $("emailValue").textContent = account.email;
    $("passwordUsername").value = account.email;
    if (document.activeElement !== $("displayName")) $("displayName").value = account.displayName || "";
    if (!birthdayDirty) { birthday = account.birthday || ""; paintBirthday(); }
    $("memberSince").textContent = account.createdAt ? t("memberSince", { date: A.formatDate(account.createdAt) }) : "";
    $("memberSince").closest(".mu-row").hidden = !account.createdAt;
  }
  /* Birthday (optional): Munetios Calendar shows it every year. */
  let birthday = "", birthdayDirty = false;
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  function paintBirthday() {
    $("birthdayValue").dataset.placeholder = t("birthdayPlaceholder");
    $("birthdayClear").setAttribute("aria-label", t("birthdayClear"));
    $("birthdayClear").title = t("birthdayClear");
    $("birthdayClear").hidden = !birthday;
    if (!birthday) { $("birthdayValue").textContent = ""; return; }
    const [y, m, d] = birthday.split("-").map(Number);
    try { $("birthdayValue").textContent = new Intl.DateTimeFormat(A.locale?.() || document.documentElement.lang || undefined, { dateStyle: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d))); }
    catch { $("birthdayValue").textContent = birthday; }
  }
  $("birthdayButton").addEventListener("click", () => {
    if (!window.MunetiosUI?.pickDate) return;
    const max = todayIso();
    window.MunetiosUI.pickDate({
      anchor: $("birthdayButton"),
      value: birthday || `${new Date().getFullYear() - 25}-01-01`,
      min: "1900-01-01",
      max,
      locale: A.locale?.() || document.documentElement.lang || undefined,
      allowClear: Boolean(birthday),
      labels: { previous: t("pickerPrevious"), next: t("pickerNext"), today: t("pickerToday"), clear: t("birthdayClear"), date: t("birthday") },
      onPick: (iso) => { if (iso === undefined) return; birthday = iso && iso <= max ? iso : ""; birthdayDirty = true; paintBirthday(); $("birthdayButton").focus(); },
    });
  });
  $("birthdayClear").addEventListener("click", () => { birthday = ""; birthdayDirty = true; paintBirthday(); $("birthdayButton").focus(); });
  $("profileForm").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.submitter || $("profileForm").querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await A.updateProfile($("displayName").value.trim(), { birthday: birthday || null });
      birthdayDirty = false;
      notify(t("profileSaved"), "success");
    }
    catch (failure) { notify(t(failure?.code === "birthdayInvalid" ? "birthdayInvalid" : "nameFailed"), "error"); }
    finally { button.disabled = false; }
  });
  const pictureBusy = busy => { $("changePicture").disabled = $("removePicture").disabled = busy; };
  $("changePicture").addEventListener('click', () => $("pictureFile").click());
  $("pictureFile").addEventListener('change', async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (!['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(file.type) || file.size > 20 * 1024 * 1024) return notify(t('pictureInvalid'), 'error');
    pictureBusy(true);
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d');
      const side = Math.min(bitmap.width, bitmap.height);
      context.drawImage(bitmap, (bitmap.width-side)/2, (bitmap.height-side)/2, side, side, 0, 0, 256, 256);
      await A.updateProfilePicture(canvas.toDataURL('image/png'));
      notify(t('pictureSaved'), 'success');
    } catch { notify(t('pictureFailed'), 'error'); }
    finally { bitmap?.close(); pictureBusy(false); }
  });
  $("removePicture").addEventListener('click', async () => {
    pictureBusy(true);
    try { await A.updateProfilePicture(null); notify(t('pictureSaved'), 'success'); }
    catch { notify(t('pictureFailed'), 'error'); }
    finally { pictureBusy(false); }
  });

  /* ---------------------------------------------------------- security */
  $("passwordForm").addEventListener("submit", async event => {
    event.preventDefault();
    const error = $("passwordError");
    const current = $("currentPassword").value, next = $("newPassword").value, confirm = $("confirmNewPassword").value;
    const show = key => { error.textContent = t(key); error.hidden = false; };
    error.hidden = true;
    if (!current) { $("currentPassword").focus(); return show("passwordWrong"); }
    if ([...next].length < 12) { $("newPassword").focus(); return show("passwordWeak"); }
    if (next !== confirm) { $("confirmNewPassword").focus(); return show("passwordMismatch"); }
    const button = $("passwordForm").querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await A.changePassword(current, next);
      $("passwordForm").reset();
      notify(t("passwordChanged"), "success");
      loadDevices();
    } catch (failure) { show(failure.code === "invalidCredentials" ? "passwordWrong" : "passwordFailed"); }
    finally { button.disabled = false; }
  });
  function deviceText(device) {
    const [browser, os] = String(device || "Browser|Unknown").split("|");
    return t("deviceOn", { browser: browser === "Browser" ? t("browser") : browser, os: !os || os === "Unknown" ? t("unknownSystem") : os });
  }
  async function loadDevices() {
    const list = $("devicesList"), error = $("devicesError");
    error.hidden = true;
    try {
      const { sessions } = await A.sessions();
      list.innerHTML = sessions.map(session => {
        const mobile = /\|(iOS|Android)$/.test(session.device || "");
        return `<div class="mu-row"><span class="mu-icon" aria-hidden="true">${mobile ? "smartphone" : "computer"}</span>
          <div class="mu-row-info"><span class="mu-row-title">${esc(deviceText(session.device))}</span><span class="mu-row-subtitle">${esc(t("signedInOn", { date: A.formatTime(session.createdAt) }))}</span></div>
          ${session.current ? `<span class="account-device-badge">${esc(t("thisDevice"))}</span>` : `<button type="button" class="mu-btn mu-btn-danger-outline" data-revoke="${esc(session.id)}">${esc(t("signOutDevice"))}</button>`}</div>`;
      }).join("");
      $("signOutOthers").hidden = !sessions.some(session => !session.current);
    } catch { list.innerHTML = ""; error.textContent = t("devicesFailed"); error.hidden = false; }
  }
  $("devicesList").addEventListener("click", async event => {
    const button = event.target.closest("[data-revoke]");
    if (!button) return;
    dialog({ icon: 'devices_off', title: t('signOutDevice'), body: t('confirmDevice'), confirm: t('signOutDevice'), danger: true,
      async action() { try { await A.revokeSession(button.dataset.revoke); await loadDevices(); notify(t('deviceSignedOut'), 'success'); } catch { failWith('revokeFailed'); } }
    });
  });
  $('signOutOthers').addEventListener('click', () => dialog({ icon: 'devices_off', title: t('signOutOthers'), body: t('confirmDevice'), confirm: t('signOutDevice'), danger: true,
    async action() { try { await A.revokeOtherSessions(); await loadDevices(); notify(t('othersSignedOut'), 'success'); } catch { failWith('revokeFailed'); } }
  }));
  let security = { twoFactor: false, recoveryEmail: '' };
  let googleConnection;
  function renderGoogleConnection() {
    const connection = googleConnection;
    const passwordless = Boolean(connection?.linked && !connection.hasPassword);
    $("passwordHeading").dataset.t = passwordless ? "addPassword" : "changePassword";
    $("passwordHeading").textContent = t($("passwordHeading").dataset.t);
    $("passwordForm").hidden = passwordless;
    $("addPasswordActions").hidden = !passwordless;
    $('googleConnection').hidden = !connection?.linked;
    renderSync();
    if (!connection) return;
    $('googleConnectionLabel').textContent = t('usedGoogle');
    $('disconnectGoogle').hidden = !connection.linked || !connection.hasPassword;
  }
  async function loadGoogleConnection() {
    googleConnection = null;
    renderGoogleConnection();
    const accountId = A.state.account?.id;
    try {
      const connection = await A.google.connection();
      if (A.state.account?.id === accountId) { googleConnection = connection; renderGoogleConnection(); }
    } catch {}
  }
  $('disconnectGoogle').addEventListener('click', () => dialog({ icon: 'link_off', title: t('disconnectGoogle'),
    fields: [passwordField()], confirm: t('disconnectGoogle'),
    async action(_, data) { await A.google.disconnect(data.get('password')).catch(() => failWith('securityFailed')); await loadGoogleConnection(); }
  }));
  async function loadSecurity() {
    try {
      security = await A.security.get();
      $('recoveryCodesRow').hidden = !security.twoFactor;
      $('twoFactorStatus').textContent = t(security.twoFactor ? 'enabled' : 'disabled');
      $('twoFactorButton').textContent = t(security.twoFactor ? 'disable2fa' : 'enable2fa');
      $('recoveryValue').textContent = security.recoveryEmail ? `${security.recoveryEmail} \u00b7 ${t(security.recoveryVerified ? 'recoveryVerified' : 'unverified')}` : t('notSet');
    } catch { $('twoFactorStatus').textContent = t('loadFailed'); }
  }
  const passwordField = () => ({ name: 'password', label: t('password'), type: 'password', autocomplete: 'current-password' });
  const codeField = () => ({ name: 'code', label: t('authCode'), numeric: true, autocomplete: 'one-time-code' });
  function showRecoveryCodes(codes) {
    const contents = codes.join('\n');
    dialog({ icon: 'key', title: t('recoveryCodes'), body: t('recoveryCodesHelp'),
      details: `<pre class="account-recovery-codes" dir="ltr">${esc(contents)}</pre>`,
      confirm: t('downloadRecoveryCodes'),
      action() {
        const url = URL.createObjectURL(new Blob([contents + '\n'], { type: 'text/plain' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'munetios-recovery-codes.txt';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });
  }
  $('recoveryCodesButton').addEventListener('click', () => dialog({
    icon: 'key', title: t('newRecoveryCodes'), body: t('replaceRecoveryCodes'),
    fields: [passwordField(), { ...codeField(), label: t('factorOrRecovery'), numeric: false }], confirm: t('continue'),
    async action(_, data) {
      const result = await A.security.action('recovery-codes', data.get('password'), { code: data.get('code') }).catch(() => failWith('securityFailed'));
      showRecoveryCodes(result.recoveryCodes);
    }
  }));
  $('twoFactorButton').addEventListener('click', () => {
    if (security.twoFactor) return dialog({ icon: 'shield_lock', title: t('disable2fa'), fields: [passwordField(), codeField()], confirm: t('disable2fa'), danger: true,
      async action(_, data) { await A.security.action('disable', data.get('password'), { code: data.get('code') }).catch(() => failWith('securityFailed')); await loadSecurity(); }
    });
    dialog({ icon: 'shield_lock', title: t('enable2fa'), fields: [passwordField()], confirm: t('continue'),
      async action(_, data) {
        const password = data.get('password');
        const setup = await A.security.action('setup', password).catch(() => failWith('securityFailed'));
        const qr = /^data:image\/gif;base64,[A-Za-z0-9+/]+=*$/.test(setup.qr || '')
          ? `<img class="account-auth-qr" src="${esc(setup.qr)}" alt="${esc(t('scanAuthenticatorQr'))}">` : '';
        dialog({ icon: 'key', title: t('enable2fa'), body: t('scanAuthenticatorQr'),
          details: `${qr}<label class="mu-field"><span class="mu-field-label">${esc(t('orSetupKey'))}</span><input class="mu-input" dir="ltr" readonly value="${esc(setup.secret)}"></label>`,
          fields: [codeField()], confirm: t('enable2fa'),
          async action(_, code) {
            const result = await A.security.action('enable', password, { code: code.get('code') }).catch(() => failWith('securityFailed'));
            showRecoveryCodes(result.recoveryCodes);
            void loadSecurity();
            void loadDevices();
          }
        });
      }
    });
  });
  const emailCodeField = () => ({ name: 'emailCode', label: t('emailCode'), numeric: true, autocomplete: 'one-time-code' });
  function emailError(error) {
    failWith(({ emailCodeInvalid: 'emailCodeInvalid', emailDeliveryUnavailable: 'emailDeliveryUnavailable',
      createFailed: 'emailTaken', invalidCredentials: 'passwordWrong', twoFactorRequired: 'twoFactorRequired' })[error.code] || 'securityFailed');
  }
  $('changeEmail').addEventListener('click', async () => {
    if (googleConnection?.linked && !googleConnection.hasPassword) { location.assign('/signin/?forgot=1'); return; }
    await loadSecurity();
    dialog({ icon: 'mail', title: t('changeEmail'), input: { label: t('email'), type: 'email', autocomplete: 'email', maxlength: 254 },
      fields: [passwordField(), ...(security.twoFactor ? [codeField()] : [])], confirm: t('continue'),
      async action(value, data) {
        const email = value.trim().toLowerCase(), password = data.get('password'), factor = data.get('code');
        const finish = async code => {
          await A.changeEmail(email, password, code, factor).catch(emailError);
          await loadSecurity(); notify(t('emailSaved'), 'success');
        };
        if (email.endsWith('@munetios.com')) return finish();
        await A.requestEmailChangeCode(email, password).catch(error => { if (error.code !== 'emailCodeCooldown') emailError(error); });
        dialog({ icon: 'mark_email_read', title: t('changeEmail'), body: t('emailCodeSent'), fields: [emailCodeField()], confirm: t('save'),
          action(_, verification) { return finish(verification.get('emailCode')); } });
      } });
  });
  $('recoveryButton').addEventListener('click', () => {
    if (googleConnection?.linked && !googleConnection.hasPassword) { location.assign('/signin/?forgot=1'); return; }
    dialog({ icon: 'alternate_email', title: t('recoveryEmail'), body: t('recoverySetupHelp'),
    input: { label: t('recoveryEmail'), type: 'email', value: security.recoveryEmail, maxlength: 254 }, fields: [passwordField()], confirm: t('continue'),
    async action(value, data) {
      const email = value.trim().toLowerCase(), password = data.get('password');
      const finish = async code => {
        await A.security.action('recovery-email', password, { email, code }).catch(emailError);
        await loadSecurity(); notify(t('emailSaved'), 'success');
      };
      if (!email) return finish();
      await A.security.action('recovery-email/code', password, { email }).catch(error => { if (error.code !== 'emailCodeCooldown') emailError(error); });
      dialog({ icon: 'mark_email_read', title: t('recoveryEmail'), body: t('emailCodeSent'), fields: [emailCodeField()], confirm: t('save'),
        action(_, verification) { return finish(verification.get('emailCode')); } });
    }
    });
  });


  /* ---------------------------------------------------------- sync */
  function renderSync() {
    const status = A.state.status;
    const row = $("syncStatusRow");
    const map = {
      paused: ["cloud_off", t("syncOff"), t("localSaving")],
      full: ["cloud_off", t("storageFull"), t("localSaving")],
      synced: ["cloud_done", t("synced"), `${t("e2e")} · ${A.state.lastSynced ? t("lastSynced", { time: A.formatTime(A.state.lastSynced) }) : t("notSyncedYet")}`],
      error: ["cloud_off", t("syncFailed"), A.state.lastSynced ? t("lastSynced", { time: A.formatTime(A.state.lastSynced) }) : t("notSyncedYet")],
      locked: ["lock", t("syncLocked"), t("unlockBody")]
    };
    const [icon, text, sub] = map[status] || ["sync", t("syncing"), t("e2e")];
    row.dataset.status = status;
    $("syncStatusIcon").textContent = icon;
    $("syncStatusText").textContent = text;
    $("syncStatusSub").textContent = sub;
    const button = $("syncNow");
    button.querySelector("[data-t]").textContent = status === "locked" ? t("unlockSync") : t("syncNow");
    button.querySelector(".mu-icon").textContent = status === "locked" ? "lock_open" : "sync";
    button.disabled = status === "syncing" || status === "paused";
    $('toggleSync').textContent = t(A.state.syncEnabled ? 'turnOffSync' : 'turnOnSync');
    $('syncAddPassword').hidden = !(googleConnection?.linked && !googleConnection.hasPassword && (status === 'locked' || status === 'paused'));
    renderStorage();
  }
  const byteText = n => new Intl.NumberFormat(A.locale(), { style: 'unit', unit: n >= 1e9 ? 'gigabyte' : n >= 1e6 ? 'megabyte' : 'kilobyte', maximumFractionDigits: 2 }).format(n / (n >= 1e9 ? 1e9 : n >= 1e6 ? 1e6 : 1000));
  function renderStorage() {
    const storage = A.state.storage;
    if (!storage) { $("storageSummary").textContent = ""; $("storageBar").replaceChildren(); $("storageLegend").replaceChildren(); return; }
    $('storageSummary').textContent = `${byteText(storage.used)} / ${byteText(storage.quota)}`;
    const categories = [
      ['documents', 'itemDocuments', '#a78bfa'], ['spreadsheets', 'itemSpreadsheets', '#86efac'], ['images', 'itemImages', '#fb923c'], ['videos', 'itemVideos', '#f472b6'], ['audio', 'itemAudio', '#2dd4bf'], ['ls:search-history', 'itemSearchHistory', '#67e8f9'], ['ls:appearance', 'itemAppearance', '#f9a8d4'],
      ['ls:settings', 'itemSettings', '#fcd34d'], ['ls:shortcuts', 'itemShortcuts', '#6ee7b7'], ['ls:workspaces', 'itemWorkspaces', '#93c5fd']
    ];
    const known = new Set(categories.map(c => c[0]));
    categories.push(['other', 'otherItems', '#c4b5fd']);
    const other = Object.entries(storage.groups).reduce((sum, [key, n]) => sum + (known.has(key) ? 0 : n), 0);
    $('storageBar').setAttribute('aria-label', $('storageSummary').textContent);
    $('storageBar').replaceChildren(); $('storageLegend').replaceChildren();
    for (const [key, label, color] of categories) {
      const bytes = key === 'other' ? other : storage.groups[key] || 0;
      const segment = document.createElement('span'); segment.style.setProperty('--mu-storage-color', color); segment.style.flexBasis = `${Math.min(100, bytes / storage.quota * 100)}%`; segment.title = `${t(label)}: ${byteText(bytes)}`;
      if (bytes) $('storageBar').append(segment);
      const item = document.createElement('span'); item.className = 'mu-storage-key'; item.style.setProperty('--mu-storage-color', color); item.textContent = `${t(label)} \u00b7 ${byteText(bytes)}`; $('storageLegend').append(item);
    }
  }
  async function loadStorage() { try { await A.sync.storage(); } catch { $('storageSummary').textContent = t('loadFailed'); } }
  $('toggleSync').addEventListener('click', () => {
    if (!A.state.syncEnabled) { A.sync.setEnabled(true); return; }
    dialog({ icon: 'cloud_off', title: t('turnOffSync'), body: t('localSaving'), confirm: t('turnOffSync'), async action() { await A.sync.setEnabled(false); } });
  });
  $("syncNow").addEventListener("click", async () => {
    if (A.state.status === "locked") { window.MunetiosAccountMenu?.openUnlock(); return; }
    const ok = await A.sync.now();
    if (!ok && A.state.status === "error") notify(t("syncFailed"), "error");
  });
  $("deleteSynced").addEventListener("click", () => dialog({
    icon: "cloud_off", title: t("deleteSynced"), body: t("deleteSyncedBody"), confirm: t("deleteSynced"), danger: true,
    async action() {
      try { await A.sync.reset(); } catch { failWith("deleteSyncedFailed"); }
      await loadStorage(); notify(t("deleteSyncedDone"), "success");
    }
  }));

  /* ---------------------------------------------------------- workspaces */
  async function loadRemoteCounts() {
    if (remoteCountsLoaded) return;
    remoteCountsLoaded = true;
    try { remoteCounts = await A.sync.remoteWorkspaceCounts(); } catch { remoteCounts = null; }
    renderWorkspaces();
  }
  const workspaceCount = id => Math.max(A.workspaces.localCounts()[id] || 0, remoteCounts?.[id] || 0);
  function renderWorkspaces() {
    const list = $("workspacesList");
    try {
      const active = A.workspaces.active();
      list.innerHTML = A.workspaces.list().map(ws => {
        const label = A.workspaces.label(ws);
        const isPersonal = ws.id === A.workspaces.PERSONAL;
        return `<div class="mu-row" data-id="${esc(ws.id)}">
          <span class="account-ws-initial" aria-hidden="true">${esc(([...label][0] || "?").toLocaleUpperCase())}</span>
          <div class="mu-row-info"><span class="mu-row-title">${esc(label)}</span><span class="mu-row-subtitle">${esc(t("documentsCount", { count: workspaceCount(ws.id) }))}</span></div>
          ${ws.id === active ? `<span class="account-ws-badge">${esc(t("active"))}</span>` : ""}
          <div class="account-row-buttons">
            <button type="button" class="mu-btn" data-ws="open"><span class="mu-icon" aria-hidden="true">open_in_new</span>${esc(t("open"))}</button>
            ${isPersonal ? "" : `<button type="button" class="mu-btn" data-ws="rename"><span class="mu-icon" aria-hidden="true">edit</span>${esc(t("rename"))}</button>
            <button type="button" class="mu-btn mu-btn-danger-outline" data-ws="delete"><span class="mu-icon" aria-hidden="true">delete</span>${esc(t("delete"))}</button>`}
          </div></div>`;
      }).join("");
    } catch { list.innerHTML = `<p class="account-error">${esc(t("wsLoadFailed"))}</p>`; }
  }
  $("workspacesList").addEventListener("click", event => {
    const button = event.target.closest("[data-ws]");
    if (!button) return;
    const id = button.closest("[data-id]").dataset.id;
    const ws = A.workspaces.list().find(item => item.id === id);
    if (!ws) { notify(t("workspaceOpenFailed"), "error"); return; }
    if (button.dataset.ws === "open") {
      try { A.workspaces.setActive(id); location.href = "/omniwrite/"; } catch { notify(t("workspaceOpenFailed"), "error"); }
    } else if (button.dataset.ws === "rename") {
      dialog({
        icon: "edit", title: t("rename"), input: { label: t("workspaceName"), value: ws.name, maxlength: 80 }, confirm: t("save"),
        async action(value) {
          try { A.workspaces.rename(id, value); } catch (failure) { failWith(failure.code === "wsNameRequired" ? "wsNameRequired" : "wsRenameFailed"); }
          renderWorkspaces(); notify(t("wsRenamed"), "success");
        }
      });
    } else if (button.dataset.ws === "delete") {
      dialog({
        icon: "delete", title: t("confirmDeleteWorkspace", { name: A.workspaces.label(ws) }), confirm: t("delete"), danger: true,
        async action() {
          try { A.workspaces.remove(id, workspaceCount(id)); }
          catch (failure) { failWith(["wsDeleteHasDocs", "wsDeletePersonal"].includes(failure.code) ? failure.code : "wsDeleteFailed"); }
          renderWorkspaces(); notify(t("wsDeleted"), "success");
        }
      });
    }
  });
  $("workspaceForm").addEventListener("submit", event => {
    event.preventDefault();
    try {
      A.workspaces.create($("workspaceName").value);
      $("workspaceName").value = "";
      renderWorkspaces(); notify(t("wsCreated"), "success");
    } catch (failure) { notify(t(failure.code === "wsNameRequired" ? "wsNameRequired" : "wsCreateFailed"), "error"); }
  });
  document.addEventListener("munetios-workspaces-changed", renderWorkspaces);
  document.addEventListener("munetios-sync-applied", event => { if (event.detail.providers.includes("ls:workspaces")) renderWorkspaces(); });

  /* ---------------------------------------------------------- data & privacy */
  $("picturePrivacy").addEventListener("change", async event => {
    const control = event.currentTarget;
    control.disabled = true;
    try { await A.updateProfilePicturePrivacy(control.checked); }
    catch { notify(t("picturePrivacyFailed"), "error"); }
    finally {
      control.checked = A.state.account?.showProfilePictureToEveryone !== false;
      control.disabled = false;
    }
  });
  $("exportData").addEventListener("click", async () => {
    try {
      const data = await A.sync.exportLocal();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, A.settings.get('exportFormatting') === 'pretty' ? 2 : 0)], { type: "application/json" }));
      const link = Object.assign(document.createElement("a"), { href: url, download: `munetios-data-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { notify(t("exportFailed"), "error"); }
  });
  $("deleteAccount").addEventListener("click", () => dialog({
    icon: "delete_forever", title: t("deleteAccount"), body: `${t("deleteAccountBody")} ${t("deleteAccountConfirm")}`,
    input: { label: t("password"), type: "password", autocomplete: "current-password" }, confirm: t("deleteAccount"), danger: true,
    fields: [{ name: "confirmation", label: t("typeDelete") }],
    async action(password, data) {
      if (data.get("confirmation") !== "DELETE") failWith("typeDelete");
      try { await A.deleteAccount(password || "", data.get("confirmation")); }
      catch (failure) { failWith(failure.code === "invalidCredentials" ? "deleteAccountWrong" : "deleteAccountFailed"); }
      notify(t("accountDeleted"), "success");
      setTimeout(() => location.replace(A.state.account ? "/account/" : "/"), 900);
    }
  }));

  let renderingAccountSettings = false;
  function renderAccountSettings() {
    renderingAccountSettings = true;
    try {
      for (const [name, section, fallback, options] of A.settings.definitions) {
        const container = $(`${section}Settings`);
        let row = $(`account-setting-row-${name}`);
        if (!row) {
          row = document.createElement('div'); row.className = 'mu-row'; row.id = `account-setting-row-${name}`;
          row.innerHTML = `<div class="mu-row-info"><label class="mu-row-title" for="account-setting-${name}"></label></div>`;
          const control = document.createElement(options ? 'select' : 'input'); control.id = `account-setting-${name}`;
          if (options) { control.className = 'mu-select'; row.append(control); }
          else {
            control.type = 'checkbox';
            const wrapper = document.createElement('label'); wrapper.className = 'mu-switch';
            const track = document.createElement('span'); track.className = 'mu-switch-track';
            wrapper.append(control, track); row.append(wrapper);
          }
          control.addEventListener('change', () => {
            if (renderingAccountSettings) return;
            const error = $(`${section}SettingsError`); error.hidden = true;
            try { A.settings.set(name, typeof fallback === 'boolean' ? control.checked : control.value); }
            catch { error.textContent = t('settingsSaveError'); error.hidden = false; renderAccountSettings(); }
          });
          container.append(row);
        }
        const control = $(`account-setting-${name}`);
        const label = t(`setting_${name}`);
        row.querySelector('.mu-row-title').textContent = label; control.setAttribute('aria-label', label);
        if (options) {
          const value = A.settings.get(name);
          const values = options === 'timeZones' ? ['auto', ...new Set(['UTC', Intl.DateTimeFormat().resolvedOptions().timeZone, ...(Intl.supportedValuesOf?.('timeZone') || []), ...(value !== 'auto' ? [value] : [])])] : options;
          control.replaceChildren(...values.map(option => new Option(options === 'timeZones' && option !== 'auto' ? option.replaceAll('_', ' ') : t(`settingOption_${option}`), option)));
          control.value = value;
          UI?.enhanceSelect(control);
          control._mu?.button.setAttribute('aria-label', label);
          control.dispatchEvent(new Event('change'));
        } else control.checked = A.settings.get(name);
      }
    } finally { renderingAccountSettings = false; }
  }
  document.addEventListener('munetios-account-settings-changed', () => { renderAccountSettings(); renderAccount(); renderSync(); });

  /* ---------------------------------------------------------- start */
  let settingsAccountId = null;
  function renderAll() {
    if (!A.state.ready) return;
    if (!A.state.account) {
      if (A.state.revocation) {
        $("accountMain").hidden = true;
        return;
      }
      if (!A.state.offline) location.replace(`/signin?continue=${encodeURIComponent("/account/" + location.search + location.hash)}`);
      else notify(t("loadFailed"), "error");
      return;
    }
    $("accountMain").hidden = false;
    if (settingsAccountId !== A.state.account.id) { settingsAccountId = A.state.account.id; loadSecurity(); loadGoogleConnection(); loadStorage(); renderAccountSettings(); }
    renderAccount(); renderSync(); renderWorkspaces();
    $("accountMain").setAttribute("aria-busy", "false");
  }
  renderTexts();
  showSection(location.hash.slice(1));
  A.on(renderAll);
  renderAll();
})();
