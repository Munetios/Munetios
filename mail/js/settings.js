// Searchable settings. Interface preferences use the schema-driven controls from the studio; mailbox settings,
// addresses, signatures, templates, contacts, folders, labels, filters, sender lists, import/export, and deletion
// talk to the Mail API.
import { state, emit, on, mailboxes, mailboxById, primaryMailbox, folders, labels } from "./state.js";
import { get, post, put, del, upload, fetchBlob, ApiError } from "./api.js";
import { t, formatBytes, formatDate, formatNumber } from "./i18n.js";
import { el, icon, iconButton, button, dialog, field, select, switchControl, settingRow, toast, confirmDialog, promptDialog, download, pickFiles, alertBox, emptyState, dateTimeField, toLocalDateTime, fromLocalDateTime } from "./ui.js";
import { control, renderSection, themesSection } from "./studio.js";
import { savePreference } from "./customize.js";
import { errorText } from "./actions.js";
import { RichEditor } from "./editor.js";
import { moveAllDeviceMail } from "./reader.js";
import { editFolder, editLabel, deleteFolder, deleteLabel } from "./sidebar.js";

const SECTIONS = [
    ["general", "tune"], ["appearance", "palette"], ["customization", "blur_on"], ["themes", "style"], ["typography", "text_fields"], ["layout", "dashboard"], ["inbox", "inbox"],
    ["compose", "edit_square"], ["htmlEditor", "code"], ["accounts", "manage_accounts"], ["addresses", "alternate_email"], ["aliases", "badge"], ["signatures", "signature"], ["templates", "article"],
    ["contacts", "contacts"], ["folders", "folder"], ["filters", "filter_alt"], ["notifications", "notifications"], ["sounds", "volume_up"], ["privacy", "shield"], ["remoteContent", "image_not_supported"],
    ["spam", "report"], ["blocked", "block"], ["shortcuts", "keyboard"], ["language", "translate"], ["accessibility", "accessibility_new"], ["offline", "cloud_off"], ["storage", "storage"],
    ["transfer", "import_export"], ["advanced", "settings_suggest"], ["about", "info"],
];
let mailboxId = null;
const box = () => mailboxById(mailboxId) || primaryMailbox();

async function saveSettings(patch) {
    try {
        const result = await put(`/mailboxes/${box().id}/settings`, patch);
        box().settings = result.settings;
        if ("displayName" in patch) { box().displayName = patch.displayName; emit("refreshBoot"); }
        toast(t("saved"), "success");
    } catch (error) { toast(errorText(error), "error"); }
}

const pref = path => control(path);
const mailboxPicker = rerender => mailboxes().length > 1 ? settingRow(t("mailbox"), t("mailboxSettingsHelp"), select(t("mailbox"), mailboxes().map(item => ({ value: item.id, label: item.address })), box().id, value => { mailboxId = value; rerender(); })) : null;

const RENDER = {
    general: () => [pref("behavior.afterAction"), pref("behavior.markReadDelay"), pref("behavior.confirmDelete"), pref("layout.conversationView"), pref("behavior.searchHistory"), pref("behavior.linkWarnings")],
    appearance: () => renderSection("appearance"),
    customization: () => renderSection("glass"),
    themes: rerender => [themesSection(rerender)],
    typography: () => renderSection("typography"),
    layout: () => renderSection("layout"),
    inbox: rerender => {
        const settings = box().settings;
        return [mailboxPicker(rerender), pref("layout.categoryTabs"),
            settingRow(t("inboxCategories"), t("inboxCategoriesHelp"), switchControl(t("inboxCategories"), settings.categories, value => saveSettings({ categories: value }))),
            settingRow(t("autoArchive"), t("autoArchiveHelp"), switchControl(t("autoArchive"), settings.autoArchive.enabled, value => saveSettings({ autoArchive: { ...settings.autoArchive, enabled: value } }))),
            settingRow(t("autoArchiveAfter"), "", select(t("autoArchiveAfter"), [7, 14, 30, 60, 90, 180, 365].map(value => ({ value, label: t("daysCount", { count: value }) })), settings.autoArchive.days, value => saveSettings({ autoArchive: { ...settings.autoArchive, days: Number(value) } }))),
            settingRow(t("autoArchiveReadOnly"), "", switchControl(t("autoArchiveReadOnly"), settings.autoArchive.readOnly, value => saveSettings({ autoArchive: { ...settings.autoArchive, readOnly: value } }))),
            ...vacationRows(settings)];
    },
    compose: rerender => {
        const settings = box().settings;
        return [mailboxPicker(rerender), pref("behavior.defaultMode"), pref("behavior.replyAll"), pref("behavior.quoteOriginal"), pref("behavior.attachmentReminder"), pref("behavior.spellcheck"),
            settingRow(t("undoSend"), t("undoSendHelp"), select(t("undoSend"), [0, 5, 10, 20, 30, 60, 120].map(value => ({ value, label: value ? t("secondsCount", { count: value }) : t("off") })), settings.undoSendSeconds, value => saveSettings({ undoSendSeconds: Number(value) }))),
            settingRow(t("defaultPriority"), "", select(t("defaultPriority"), ["low", "normal", "high"].map(value => ({ value, label: t("priority_" + value) })), settings.defaultPriority, value => saveSettings({ defaultPriority: value }))),
            pref("layout.composeWidth"), pref("layout.composeHeight")];
    },
    htmlEditor: () => [pref("behavior.defaultMode"), el("p", { class: "mu-muted", text: t("htmlEditorHelp") })],
    accounts: () => {
        const rows = mailboxes().map(item => el("div", { class: "mail-list-item" }, icon(item.kind === "forwarding" ? "forward_to_inbox" : "mail"),
            el("span", { text: `${item.displayName || ""} <${item.address}>` }), el("span", { class: "mu-muted", text: formatBytes(item.storage.usedBytes) })));
        return [el("div", { class: "mail-list-editor" }, rows),
            el("div", { class: "mail-inline-form" },
                el("a", { class: "mu-btn", href: "/signin?add=1&continue=" + encodeURIComponent("/mail/") }, icon("person_add"), t("addAccount")),
                el("a", { class: "mu-btn", href: "/account/" }, icon("manage_accounts"), t("accountSecurity"))),
            el("p", { class: "mu-muted", text: t("accountsHelp") })];
    },
    addresses: rerender => {
        const current = box();
        const name = el("input", { class: "mu-input", value: current.displayName || "", maxlength: 200 });
        const pictureRow = el("div", { class: "mail-inline-form", style: "align-items:center" },
            current.hasPicture ? el("img", { src: `/api/mail/v1/mailboxes/${current.id}/picture?${Date.now()}`, alt: t("profilePicture"), style: "width:64px;height:64px;border-radius:50%;object-fit:cover;flex:none" }) : icon("account_circle"),
            button(t("uploadPicture"), async () => {
                const [file] = await pickFiles({ accept: "image/png,image/jpeg,image/webp", multiple: false });
                if (!file) return;
                try { await upload(`/mailboxes/${current.id}/picture`, file, { headers: { "X-File-Type": file.type, "X-File-Name": encodeURIComponent(file.name) } }); current.hasPicture = true; emit("refreshBoot"); rerender(); }
                catch (error) { toast(error.code === "tooLarge" ? t("pictureTooLarge") : errorText(error), "error"); }
            }),
            current.hasPicture ? button(t("removePicture"), async () => { await del(`/mailboxes/${current.id}/picture`); current.hasPicture = false; emit("refreshBoot"); rerender(); }) : null);
        return [mailboxPicker(rerender), settingRow(t("address"), current.kind === "forwarding" ? t("forwardingAddressHelp") : "", el("strong", { dir: "ltr", text: current.address })),
            field(t("senderName"), name, t("senderNameHelp")), button(t("save"), () => saveSettings({ displayName: name.value.trim() }), { primary: true }),
            settingRow(t("profilePicture"), t("profilePictureHelp"), pictureRow), ...forwardingRows(current, rerender)];
    },
    aliases: rerender => {
        const current = box();
        const input = el("input", { class: "mu-input", placeholder: "name@munetios.com", dir: "ltr", spellcheck: "false" });
        const displayName = el("input", { class: "mu-input", placeholder: t("senderName") });
        return [mailboxPicker(rerender), el("p", { class: "mu-muted", text: t("aliasesHelp") }),
            el("div", { class: "mail-list-editor" }, current.aliases?.length ? current.aliases.map(alias => el("div", { class: "mail-list-item" }, icon("alternate_email"), el("span", { dir: "ltr", text: alias.address }), el("span", { class: "mu-muted", text: alias.displayName }),
                iconButton("delete", t("delete"), async () => {
                    if (!await confirmDialog({ title: t("deleteAlias"), message: t("deleteAliasMessage", { address: alias.address }), confirm: t("delete"), danger: true })) return;
                    await del(`/mailboxes/${current.id}/aliases/${alias.id}`); current.aliases = current.aliases.filter(item => item.id !== alias.id); emit("refreshBoot"); rerender();
                }, { class: "mu-icon-btn mu-icon-btn-sm" }))) : [el("p", { class: "mu-muted", text: t("noAliases") })]),
            el("div", { class: "mail-inline-form" }, field(t("newAlias"), input), field(t("senderName"), displayName),
                button(t("createAlias"), async () => {
                    let address = input.value.trim().toLowerCase();
                    if (address && !address.includes("@")) address += "@munetios.com";
                    try { const alias = await post(`/mailboxes/${current.id}/aliases`, { address, displayName: displayName.value.trim() }); current.aliases = [...(current.aliases || []), alias]; current.senders.push({ address, displayName: displayName.value.trim() }); emit("refreshBoot"); rerender(); toast(t("aliasCreated"), "success"); }
                    catch (error) { toast(error.code === "addressUnavailable" ? t("addressUnavailable") : errorText(error), "error"); }
                }, { primary: true }))];
    },
    signatures: rerender => [mailboxPicker(rerender), collection({ kind: "signatures", rerender })],
    templates: rerender => [mailboxPicker(rerender), collection({ kind: "templates", rerender })],
    contacts: rerender => [mailboxPicker(rerender), contactsView(rerender)],
    folders: rerender => foldersView(rerender),
    filters: rerender => [mailboxPicker(rerender), filtersView(rerender)],
    notifications: () => [notificationPermission(), ...renderSection("sounds").slice(0, 2)],
    sounds: () => renderSection("sounds").slice(2),
    privacy: () => [alertBox("", "shield", t("privacySummaryTitle"), t("privacySummary")), el("p", { class: "mu-muted", text: t("encryptionExplainer") }), pref("behavior.linkWarnings"),
        el("a", { class: "mu-btn", href: "/account/" }, icon("security"), t("twoFactor"))],
    remoteContent: rerender => {
        const settings = box().settings;
        return [mailboxPicker(rerender), settingRow(t("remoteContentMode"), t("remoteContentHelp"), select(t("remoteContentMode"), ["block", "ask", "proxy"].map(value => ({ value, label: t("remote_" + value) })), settings.remoteContent === "allow" ? "proxy" : settings.remoteContent, value => saveSettings({ remoteContent: value }))),
            sendersList("trusted", t("trustedSenders"), t("trustedSendersHelp"))];
    },
    spam: rerender => {
        const settings = box().settings;
        return [mailboxPicker(rerender), el("p", { class: "mu-muted", text: t("spamHelp") }), settingRow(t("spamSensitivity"), t("spamSensitivityHelp"), select(t("spamSensitivity"), ["relaxed", "standard", "strict"].map(value => ({ value, label: t("sensitivity_" + value) })), settings.spamSensitivity, value => saveSettings({ spamSensitivity: value }))),
            sendersList("allow", t("allowedSenders"), t("allowedSendersHelp"))];
    },
    blocked: rerender => [mailboxPicker(rerender), sendersList("block", t("blockedSenders"), t("blockedSendersHelp")), subscriptionsView()],
    shortcuts: () => renderSection("shortcuts"),
    language: () => [pref("behavior.language"), pref("behavior.timeFormat"), pref("behavior.weekStart"), el("p", { class: "mu-muted", text: t("languageHelp") })],
    accessibility: () => [pref("behavior.reduceMotion"), pref("appearance.highContrast"), pref("typography.size"), pref("typography.lineHeight"), pref("typography.letterSpacing"), pref("layout.iconSize"), pref("appearance.animationSpeed"),
        el("p", { class: "mu-muted", text: t("accessibilityHelp") })],
    offline: () => [pref("behavior.offline"), pref("behavior.offlineDays"), el("p", { class: "mu-muted", text: t("offlineHelp") }),
        button(t("clearOfflineData"), async () => { const { clearPrivateData } = await import("./offline.js"); await clearPrivateData(); toast(t("offlineCleared"), "success"); }),
        state.deviceMessages.length ? alertBox("warning", "smartphone", t("deviceMailBanner", { count: formatNumber(state.deviceMessages.length) }), t("deviceMailBannerDetail"), [button(t("moveAllToMailbox"), () => moveAllDeviceMail())]) : null],
    storage: () => [button(t("manageStorage"), () => emit("openStorage"), { primary: true, iconName: "storage" }), el("p", { class: "mu-muted", text: t("storageExplainer") })],
    transfer: rerender => [mailboxPicker(rerender), transferView(rerender)],
    advanced: rerender => [mailboxPicker(rerender), dangerZone()],
    about: () => [el("h3", { text: t("appName") }), el("p", { text: t("aboutText") }), el("p", { class: "mu-muted", text: t("encryptionExplainer") }),
        el("p", { class: "mu-muted", text: t("aboutInfrastructure") })],
};

function vacationRows(settings) {
    const v = settings.vacation;
    const subject = el("input", { class: "mu-input", value: v.subject, maxlength: 300 });
    const message = el("textarea", { class: "mu-textarea", rows: 5 });
    message.value = v.message;
    let start = toLocalDateTime(v.start), end = toLocalDateTime(v.end);
    let enabled = v.enabled, contactsOnly = v.contactsOnly;
    return [el("h3", { text: t("vacationResponder") }),
        settingRow(t("vacationEnabled"), t("vacationHelp"), switchControl(t("vacationEnabled"), enabled, value => { enabled = value; })),
        el("div", { class: "mail-inline-form" }, field(t("firstDay"), dateTimeField(t("firstDay"), start, value => { start = value; })), field(t("lastDay"), dateTimeField(t("lastDay"), end, value => { end = value; }))),
        field(t("subject"), subject), field(t("message"), message),
        el("label", { class: "mu-check" }, (() => { const box2 = el("input", { type: "checkbox" }); box2.checked = contactsOnly; box2.addEventListener("change", () => { contactsOnly = box2.checked; }); return box2; })(), t("contactsOnly")),
        button(t("saveVacation"), () => saveSettings({ vacation: { enabled, subject: subject.value, message: message.value, contactsOnly, start: fromLocalDateTime(start), end: fromLocalDateTime(end) } }), { primary: true })];
}

function forwardingRows(current, rerender) {
    const f = current.settings.forwarding;
    const address = el("input", { class: "mu-input", type: "email", value: f.address, dir: "ltr" });
    let keepCopy = f.keepCopy;
    const code = el("input", { class: "mu-input", inputmode: "numeric", maxlength: 6, placeholder: "000000" });
    return [el("h3", { text: t("autoForwarding") }), el("p", { class: "mu-muted", text: t("autoForwardingHelp") }),
        field(t("forwardTo"), address),
        el("label", { class: "mu-check" }, (() => { const box2 = el("input", { type: "checkbox" }); box2.checked = keepCopy; box2.addEventListener("change", () => { keepCopy = box2.checked; }); return box2; })(), t("keepCopy")),
        f.verified ? alertBox("success", "verified", t("forwardingVerified"), f.enabled ? t("forwardingOn") : t("forwardingOff")) : null,
        el("div", { class: "mail-inline-form" },
            button(t("saveAndVerify"), async () => {
                await saveSettings({ forwarding: { enabled: false, address: address.value.trim(), keepCopy } });
                if (!address.value.trim()) return;
                try { await post(`/mailboxes/${current.id}/forwarding/verify`); toast(t("verificationSent"), "success"); }
                catch (error) { toast(errorText(error), "error"); }
            }),
            field(t("verificationCode"), code),
            button(t("confirm"), async () => {
                try { await post(`/mailboxes/${current.id}/forwarding/confirm`, { code: code.value.trim() }); toast(t("forwardingVerified"), "success"); const fresh = await get(`/mailboxes/${current.id}/settings`); current.settings = fresh.settings; rerender(); }
                catch (error) { toast(error.code === "invalidCode" ? t("invalidCode") : error.code === "codeExpired" ? t("codeExpired") : errorText(error), "error"); }
            }, { primary: true }),
            f.verified ? button(f.enabled ? t("turnOff") : t("turnOn"), async () => { await saveSettings({ forwarding: { ...f, enabled: !f.enabled, address: f.address } }); const fresh = await get(`/mailboxes/${current.id}/settings`); current.settings = fresh.settings; rerender(); }) : null)];
}

function notificationPermission() {
    const supported = "Notification" in window;
    const status = !supported ? t("notificationsUnsupported") : Notification.permission === "granted" ? t("notificationsAllowed") : Notification.permission === "denied" ? t("notificationsBlocked") : t("notificationsNotAsked");
    return settingRow(t("desktopNotifications"), status, supported && Notification.permission === "default" ? button(t("allowNotifications"), async () => {
        const result = await Notification.requestPermission();
        if (result === "granted") savePreference("behavior.notifications", true);
        toast(result === "granted" ? t("notificationsAllowed") : t("notificationsBlocked"));
    }) : el("span"));
}

function sendersList(list, title, help) {
    const node = el("div", { class: "mail-list-editor" });
    const input = el("input", { class: "mu-input", placeholder: t("senderPatternPlaceholder"), dir: "ltr", spellcheck: "false" });
    const draw = async () => {
        const { senders } = await get(`/mailboxes/${box().id}/senders`).catch(() => ({ senders: [] }));
        const items = senders.filter(item => item.list === list);
        node.replaceChildren(...(items.length ? items.map(item => el("div", { class: "mail-list-item" }, icon(list === "block" ? "block" : list === "allow" ? "check_circle" : "verified_user"), el("span", { dir: "ltr", text: item.pattern }),
            iconButton("delete", t("remove"), async () => { await del(`/mailboxes/${box().id}/senders?list=${list}&pattern=${encodeURIComponent(item.pattern)}`); draw(); }, { class: "mu-icon-btn mu-icon-btn-sm" }))) : [el("p", { class: "mu-muted", text: t("listEmpty") })]));
    };
    draw();
    return el("div", { style: "display:grid;gap:8px" }, el("h3", { text: title }), el("p", { class: "mu-muted", style: "margin:0", text: help }), node,
        el("div", { class: "mail-inline-form" }, input, button(t("add"), async () => {
            try { await post(`/mailboxes/${box().id}/senders`, { list, pattern: input.value.trim() }); input.value = ""; draw(); }
            catch (error) { toast(error.code === "invalidAddress" ? t("invalidSenderPattern") : errorText(error), "error"); }
        }, { primary: true })));
}

function subscriptionsView() {
    const node = el("div", { class: "mail-table-wrap" }, el("span", { class: "mu-skeleton is-block" }));
    get(`/mailboxes/${box().id}/subscriptions`).then(({ subscriptions }) => {
        if (!subscriptions.length) { node.replaceChildren(el("p", { class: "mu-muted", text: t("noSubscriptions") })); return; }
        node.replaceChildren(el("table", { class: "mail-table" }, el("thead", {}, el("tr", {}, el("th", { text: t("sender") }), el("th", { class: "is-num", text: t("messages") }), el("th", { class: "is-num", text: t("size") }), el("th", { text: t("actions") }))),
            el("tbody", {}, subscriptions.map(item => el("tr", {}, el("td", { text: item.name ? `${item.name} <${item.sender}>` : item.sender }), el("td", { class: "is-num", text: formatNumber(item.count) }), el("td", { class: "is-num", text: formatBytes(item.bytes) }),
                el("td", {}, el("div", { style: "display:flex;gap:6px;flex-wrap:wrap" },
                    item.methods.oneClick || item.methods.mailto ? button(t("unsubscribe"), async event => {
                        if (!await confirmDialog({ title: t("unsubscribe"), message: t("unsubscribeConfirm", { sender: item.sender }), confirm: t("unsubscribe") })) return;
                        try { await post(`/mailboxes/${box().id}/subscriptions/unsubscribe`, { sender: item.sender }); toast(t("unsubscribed"), "success"); event.target.disabled = true; }
                        catch (error) { toast(errorText(error), "error"); }
                    }) : item.methods.web ? el("span", { class: "mu-muted", text: t("unsubscribeWebOnly") }) : null,
                    button(item.blocked ? t("blocked") : t("block"), async event => { await post(`/mailboxes/${box().id}/senders`, { list: "block", pattern: item.sender }); event.target.disabled = true; event.target.textContent = t("blocked"); }, { disabled: item.blocked }),
                    button(t("viewMail"), () => { emit("runSearch", `from:${item.sender}`); document.querySelector("#modalRoot .mu-modal:last-child [data-mu-close], #modalRoot .mu-modal:last-child .mu-dialog-header .mu-icon-btn")?.click(); }))))))));
    }).catch(() => node.replaceChildren(el("p", { class: "mu-muted", text: t("loadFailed") })));
    return el("div", { style: "display:grid;gap:8px" }, el("h3", { text: t("subscriptions") }), el("p", { class: "mu-muted", style: "margin:0", text: t("subscriptionsHelp") }), node);
}

function collection({ kind, rerender }) {
    const node = el("div", { class: "mail-list-editor" }, el("span", { class: "mu-skeleton is-block" }));
    const current = box();
    const edit = async item => {
        if (kind === "templates") {
            const full = item ? (await get(`/mailboxes/${current.id}/templates/${item.id}`)).template : null;
            const name = el("input", { class: "mu-input", value: full?.name || "" });
            const subject = el("input", { class: "mu-input", value: full?.data?.subject || "" });
            const editor = new RichEditor({ html: full?.data?.html || "", onChange() {} });
            editor.node.style.minHeight = "260px";
            const d = dialog({ title: item ? t("editTemplate") : t("newTemplate"), iconName: "article", size: "mu-dialog-lg", content: [field(t("name"), name), field(t("subject"), subject), editor.node], actions: [
                button(t("cancel"), () => d.close()),
                button(t("save"), async () => {
                    try { await (item ? put : post)(`/mailboxes/${current.id}/templates${item ? "/" + item.id : ""}`, { name: name.value, kind: full?.kind || "message", data: { ...(full?.data || {}), subject: subject.value, html: editor.html, mode: full?.data?.mode || "rich" } }); d.close(); draw(); }
                    catch (error) { toast(errorText(error), "error"); }
                }, { primary: true })] });
            return;
        }
        const name = el("input", { class: "mu-input", value: item?.name || "" });
        const editor = new RichEditor({ html: item?.html || "", onChange() {} });
        editor.node.style.minHeight = "220px";
        let defaultNew = item?.defaultNew || false, defaultReply = item?.defaultReply || false;
        const checks = el("div", { class: "mail-inline-form" },
            el("label", { class: "mu-check" }, (() => { const b = el("input", { type: "checkbox" }); b.checked = defaultNew; b.addEventListener("change", () => { defaultNew = b.checked; }); return b; })(), t("defaultForNew")),
            el("label", { class: "mu-check" }, (() => { const b = el("input", { type: "checkbox" }); b.checked = defaultReply; b.addEventListener("change", () => { defaultReply = b.checked; }); return b; })(), t("defaultForReplies")));
        const d = dialog({ title: item ? t("editSignature") : t("newSignature"), iconName: "signature", size: "mu-dialog-lg", content: [field(t("name"), name), editor.node, checks], actions: [
            button(t("cancel"), () => d.close()),
            button(t("save"), async () => {
                try { await (item ? put : post)(`/mailboxes/${current.id}/signatures${item ? "/" + item.id : ""}`, { name: name.value, html: editor.html, defaultNew, defaultReply }); d.close(); draw(); }
                catch (error) { toast(errorText(error), "error"); }
            }, { primary: true })] });
    };
    const draw = async () => {
        const data = await get(`/mailboxes/${current.id}/${kind}`).catch(() => ({}));
        const items = (data[kind] || []).filter(item => item.kind !== "component");
        node.replaceChildren(button(kind === "templates" ? t("newTemplate") : t("newSignature"), () => edit(null), { primary: true, iconName: "add" }),
            ...(items.length ? items.map(item => el("div", { class: "mail-list-item" }, icon(kind === "templates" ? (item.kind === "design" ? "dashboard_customize" : "article") : "signature"), el("span", { text: item.name }),
                item.defaultNew ? el("span", { class: "mail-chip", text: t("defaultForNew") }) : null, item.defaultReply ? el("span", { class: "mail-chip", text: t("defaultForReplies") }) : null,
                item.kind === "design" ? null : iconButton("edit", t("edit"), () => edit(item), { class: "mu-icon-btn mu-icon-btn-sm" }),
                iconButton("delete", t("delete"), async () => { if (await confirmDialog({ title: t("delete"), message: t("deleteItemMessage", { name: item.name }), confirm: t("delete"), danger: true })) { await del(`/mailboxes/${current.id}/${kind}/${item.id}`); draw(); } }, { class: "mu-icon-btn mu-icon-btn-sm" })))
                : [el("p", { class: "mu-muted", text: kind === "templates" ? t("noTemplates") : t("noSignatures") })]));
    };
    draw();
    return node;
}

function contactsView() {
    const current = box();
    const node = el("div", { style: "display:grid;gap:10px" });
    const search = el("input", { class: "mu-input", type: "search", placeholder: t("searchContacts"), "aria-label": t("searchContacts") });
    const list = el("div", { class: "mail-table-wrap" });
    const editContact = (item = null) => {
        const inputs = Object.fromEntries(["name", "email", "phone", "company"].map(key => [key, el("input", { class: "mu-input", value: item?.[key] || "", type: key === "email" ? "email" : "text" })]));
        const notes = el("textarea", { class: "mu-textarea", rows: 3 });
        notes.value = item?.notes || "";
        const d = dialog({ title: item ? t("editContact") : t("newContact"), iconName: "person", content: [field(t("name"), inputs.name), field(t("email"), inputs.email), el("div", { class: "mail-inline-form" }, field(t("phone"), inputs.phone), field(t("company"), inputs.company)), field(t("notes"), notes)], actions: [
            button(t("cancel"), () => d.close()),
            button(t("save"), async () => {
                try { await (item ? put : post)(`/mailboxes/${current.id}/contacts${item ? "/" + item.id : ""}`, { name: inputs.name.value, email: inputs.email.value, phone: inputs.phone.value, company: inputs.company.value, notes: notes.value }); d.close(); draw(); }
                catch (error) { toast(error.code === "invalidAddress" ? t("invalidAddress") : errorText(error), "error"); }
            }, { primary: true })] });
    };
    const editGroup = async (group = null, contacts = []) => {
        const name = el("input", { class: "mu-input", value: group?.name || "" });
        const members = new Set(group ? (await get(`/mailboxes/${current.id}/groups/${group.id}/members`)).members : []);
        const boxes = el("div", { class: "mail-list-editor", style: "max-height:320px;overflow-y:auto" }, contacts.map(contact => {
            const check = el("input", { type: "checkbox" });
            check.checked = members.has(contact.id);
            check.addEventListener("change", () => { if (check.checked) members.add(contact.id); else members.delete(contact.id); });
            return el("label", { class: "mu-check" }, check, `${contact.name || contact.email} <${contact.email}>`);
        }));
        const d = dialog({ title: group ? t("editGroup") : t("newGroup"), iconName: "group", content: [field(t("name"), name), boxes], actions: [
            group ? button(t("delete"), async () => { await del(`/mailboxes/${current.id}/groups/${group.id}`); d.close(); draw(); }, { danger: true }) : null,
            button(t("cancel"), () => d.close()),
            button(t("save"), async () => {
                try { await (group ? put : post)(`/mailboxes/${current.id}/groups${group ? "/" + group.id : ""}`, { name: name.value, members: [...members] }); d.close(); draw(); }
                catch (error) { toast(errorText(error), "error"); }
            }, { primary: true })].filter(Boolean) });
    };
    let showAuto = true;
    const draw = async () => {
        const data = await get(`/mailboxes/${current.id}/contacts?q=${encodeURIComponent(search.value)}&limit=500&auto=${showAuto ? "1" : ""}`).catch(() => ({ contacts: [], groups: [] }));
        list.replaceChildren(data.contacts.length ? el("table", { class: "mail-table" }, el("thead", {}, el("tr", {}, el("th", { text: t("name") }), el("th", { text: t("email") }), el("th", { text: t("company") }), el("th", { text: t("actions") }))),
            el("tbody", {}, data.contacts.map(contact => el("tr", {}, el("td", { text: contact.name || "" }), el("td", { dir: "ltr", text: contact.email }), el("td", { text: contact.company }),
                el("td", {}, el("div", { style: "display:flex;gap:4px" }, iconButton("edit", t("edit"), () => editContact(contact), { class: "mu-icon-btn mu-icon-btn-sm" }),
                    iconButton("edit_square", t("write"), () => { emit("composeTo", { to: contact.name ? `${contact.name} <${contact.email}>` : contact.email }); }, { class: "mu-icon-btn mu-icon-btn-sm" }),
                    iconButton("delete", t("delete"), async () => { await post(`/mailboxes/${current.id}/contacts/delete`, { ids: [contact.id] }); draw(); }, { class: "mu-icon-btn mu-icon-btn-sm" }))))))) : emptyState("contacts", t("noContacts"), ""));
        groups.replaceChildren(...data.groups.map(group => button(`${group.name} (${group.size})`, () => editGroup(group, data.contacts), { iconName: "group" })),
            button(t("newGroup"), () => editGroup(null, data.contacts), { iconName: "group_add" }));
    };
    const groups = el("div", { class: "mail-inline-form", style: "align-items:center" });
    search.addEventListener("input", () => { clearTimeout(search.timer); search.timer = setTimeout(draw, 250); });
    node.append(el("div", { class: "mail-inline-form", style: "align-items:center" }, search, button(t("newContact"), () => editContact(), { primary: true, iconName: "person_add" }),
        el("label", { class: "mu-check" }, (() => { const b = el("input", { type: "checkbox" }); b.checked = showAuto; b.addEventListener("change", () => { showAuto = b.checked; draw(); }); return b; })(), t("showAutoContacts")),
        button(t("importContacts"), async () => {
            const [file] = await pickFiles({ accept: ".vcf,.csv,text/vcard,text/csv", multiple: false });
            if (!file) return;
            try { const result = await post(`/mailboxes/${current.id}/contacts-transfer`, { text: await file.text() }); toast(t("contactsImported", { count: result.imported }), "success"); draw(); }
            catch (error) { toast(errorText(error), "error"); }
        }, { iconName: "upload" }),
        button(t("exportVcard"), async () => download(await fetchBlob(`/mailboxes/${current.id}/contacts-transfer?format=vcf`), "contacts.vcf"), { iconName: "download" }),
        button(t("exportCsv"), async () => download(await fetchBlob(`/mailboxes/${current.id}/contacts-transfer?format=csv`), "contacts.csv"), { iconName: "download" })),
        el("h3", { text: t("contactGroups") }), groups, list);
    draw();
    return node;
}

const FIELDS = ["from", "to", "cc", "subject", "body", "any", "hasAttachment", "size", "listId", "filename"];
const OPS = ["contains", "notContains", "equals", "startsWith", "endsWith", "matches", "greater", "less"];
const ACTIONS = ["move", "label", "star", "read", "important", "pin", "archive", "trash", "spam", "notSpam", "category", "forward"];

function filtersView() {
    const current = box();
    const node = el("div", { class: "mail-list-editor" });
    const edit = (filter = null) => {
        const name = el("input", { class: "mu-input", value: filter?.name || "" });
        const conditions = filter ? structuredClone(filter.conditions) : [{ field: "from", op: "contains", value: "" }];
        const actionList = filter ? structuredClone(filter.actions) : [{ type: "move", value: "archive" }];
        let matchAll = filter?.matchAll ?? true, stop = filter?.stop ?? false;
        const condBox = el("div", { style: "display:grid;gap:8px" });
        const actBox = el("div", { style: "display:grid;gap:8px" });
        const folderOptions = [...["inbox", "archive", "spam", "trash"].map(value => ({ value, label: t(value) })), ...folders().filter(item => item.mailboxId === current.id).map(item => ({ value: item.id, label: item.name }))];
        const labelOptions = labels().filter(item => item.mailboxId === current.id).map(item => ({ value: item.id, label: item.name }));
        const drawConditions = () => condBox.replaceChildren(...conditions.map((condition, index) => {
            const value = el("input", { class: "mu-input", value: condition.value, "aria-label": t("value") });
            value.addEventListener("input", () => { condition.value = value.value; });
            return el("div", { class: "mail-condition" },
                select(t("field"), FIELDS.map(item => ({ value: item, label: t("field_" + item) })), condition.field, next => { condition.field = next; }),
                select(t("operator"), OPS.map(item => ({ value: item, label: t("op_" + item) })), condition.op, next => { condition.op = next; }),
                value, iconButton("delete", t("remove"), () => { conditions.splice(index, 1); drawConditions(); }, { class: "mu-icon-btn mu-icon-btn-sm" }));
        }));
        const drawActions = () => actBox.replaceChildren(...actionList.map((action, index) => {
            let valueControl = el("span");
            if (action.type === "move") valueControl = select(t("folder"), folderOptions, action.value || "archive", next => { action.value = next; });
            else if (action.type === "label") valueControl = labelOptions.length ? select(t("label"), labelOptions, action.value || labelOptions[0].value, next => { action.value = next; }) : el("span", { class: "mu-muted", text: t("noLabelsYet") });
            else if (action.type === "category") valueControl = select(t("category"), ["primary", "social", "promotions", "updates", "forums"].map(value => ({ value, label: t("category_" + value) })), action.value || "primary", next => { action.value = next; });
            else if (action.type === "forward") valueControl = el("span", { class: "mu-muted", text: current.settings.forwarding.verified ? current.settings.forwarding.address : t("forwardNeedsVerification") });
            if (action.type === "forward") action.value = current.settings.forwarding.address;
            if (action.type === "move" && !action.value) action.value = "archive";
            if (action.type === "label" && !action.value && labelOptions[0]) action.value = labelOptions[0].value;
            return el("div", { class: "mail-condition" }, select(t("action"), ACTIONS.map(item => ({ value: item, label: t("filterAction_" + item) })), action.type, next => { action.type = next; action.value = ""; drawActions(); }),
                valueControl, el("span"), iconButton("delete", t("remove"), () => { actionList.splice(index, 1); drawActions(); }, { class: "mu-icon-btn mu-icon-btn-sm" }));
        }));
        drawConditions(); drawActions();
        const d = dialog({ title: filter ? t("editFilter") : t("newFilter"), iconName: "filter_alt", size: "mu-dialog-lg", content: [
            field(t("name"), name),
            settingRow(t("matchAll"), t("matchAllHelp"), switchControl(t("matchAll"), matchAll, value => { matchAll = value; })),
            el("h3", { text: t("conditions") }), condBox, button(t("addCondition"), () => { conditions.push({ field: "subject", op: "contains", value: "" }); drawConditions(); }, { iconName: "add" }),
            el("h3", { text: t("actions") }), actBox, button(t("addAction"), () => { actionList.push({ type: "label", value: "" }); drawActions(); }, { iconName: "add" }),
            settingRow(t("stopProcessing"), t("stopProcessingHelp"), switchControl(t("stopProcessing"), stop, value => { stop = value; }))], actions: [
            button(t("cancel"), () => d.close()),
            button(t("save"), async () => {
                try { await (filter ? put : post)(`/mailboxes/${current.id}/filters${filter ? "/" + filter.id : ""}`, { name: name.value || t("filter"), matchAll, stop, conditions: conditions.filter(item => item.value !== "" || item.field === "hasAttachment"), actions: actionList, enabled: filter?.enabled ?? true }); d.close(); draw(); }
                catch (error) { toast(t("error_" + error.code) || errorText(error), "error"); }
            }, { primary: true })] });
    };
    const draw = async () => {
        const { filters } = await get(`/mailboxes/${current.id}/filters`).catch(() => ({ filters: [] }));
        node.replaceChildren(el("p", { class: "mu-muted", text: t("filtersHelp") }), button(t("newFilter"), () => edit(), { primary: true, iconName: "add" }),
            ...filters.map((filter, index) => el("div", { class: "mail-list-item" }, switchControl(t("enabled"), filter.enabled, async value => { await put(`/mailboxes/${current.id}/filters/${filter.id}`, { ...filter, enabled: value }); }),
                el("span", { text: filter.name }),
                iconButton("arrow_upward", t("moveUp"), async () => { if (!index) return; const order = filters.map(item => item.id); [order[index - 1], order[index]] = [order[index], order[index - 1]]; await post(`/mailboxes/${current.id}/filters/order`, { order }); draw(); }, { class: "mu-icon-btn mu-icon-btn-sm" }),
                iconButton("play_arrow", t("runNow"), async () => { try { const result = await post(`/mailboxes/${current.id}/filters/${filter.id}/run`); toast(t("filterMatched", { count: result.matched }), "success"); emit("reload"); } catch (error) { toast(errorText(error), "error"); } }, { class: "mu-icon-btn mu-icon-btn-sm" }),
                iconButton("edit", t("edit"), () => edit(filter), { class: "mu-icon-btn mu-icon-btn-sm" }),
                iconButton("delete", t("delete"), async () => { if (await confirmDialog({ title: t("deleteFilter"), message: t("deleteItemMessage", { name: filter.name }), confirm: t("delete"), danger: true })) { await del(`/mailboxes/${current.id}/filters/${filter.id}`); draw(); } }, { class: "mu-icon-btn mu-icon-btn-sm" }))));
    };
    draw();
    return node;
}

function transferView() {
    const current = box();
    const node = el("div", { style: "display:grid;gap:12px" });
    const exportsList = el("div", { class: "mail-list-editor" });
    const drawExports = async () => {
        const { exports } = await get(`/mailboxes/${current.id}/exports`).catch(() => ({ exports: [] }));
        exportsList.replaceChildren(...exports.map(item => el("div", { class: "mail-list-item" }, icon(item.state === "ready" ? "download_done" : "hourglass_top"),
            el("span", { text: `${formatDate(item.createdAt)} · ${t("export_" + item.state)}${item.state === "ready" ? ` · ${t("messagesTotal", { count: formatNumber(item.messageCount) })} · ${formatBytes(item.size)}` : ""}` }),
            item.state === "ready" ? button(t("download"), async () => download(await fetchBlob(`/mailboxes/${current.id}/exports/${item.id}?download=1`), `munetios-mail-${new Date(item.createdAt).toISOString().slice(0, 10)}.mbox`)) : null)));
        if (exports.some(item => item.state === "queued" || item.state === "running")) setTimeout(() => { if (exportsList.isConnected) drawExports(); }, 5000);
    };
    drawExports();
    const progress = el("div", { class: "mu-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": t("importProgress"), hidden: true }, el("span", { style: "width:0%" }));
    const status = el("p", { class: "mu-muted", role: "status", "aria-live": "polite" });
    let folder = "inbox";
    const importFiles = async files => {
        const messages = [];
        for (const file of files) {
            if (/\.mbox$/i.test(file.name) || file.type === "application/mbox") {
                const text = await file.text();
                for (const part of text.split(/\r?\n(?=From [^\r\n]* \w{3} \w{3}\s+\d+ [\d:]+ \d{4}\r?$)/m)) {
                    const body = part.replace(/^From [^\r\n]*\r?\n/, "").replace(/^>(>*From )/gm, "$1");
                    if (body.trim()) messages.push(new Blob([body.replace(/\r?\n/g, "\r\n")], { type: "message/rfc822" }));
                }
            } else messages.push(file);
        }
        progress.hidden = false;
        let done = 0, failed = 0;
        for (const message of messages) {
            try { await upload(`/mailboxes/${current.id}/import?folder=${encodeURIComponent(folder)}&read=1`, message); }
            catch (error) { failed++; if (error instanceof ApiError && error.code === "quotaExceeded") { status.textContent = t("importStoppedFull"); break; } }
            done++;
            progress.firstChild.style.width = `${(done / messages.length) * 100}%`;
            status.textContent = t("importedOf", { done: formatNumber(done), total: formatNumber(messages.length) });
        }
        toast(t("importFinished", { count: done - failed }), failed ? "info" : "success");
        emit("reload"); emit("storageStale");
    };
    node.append(
        el("h3", { text: t("exportMailbox") }), el("p", { class: "mu-muted", text: t("exportMailboxHelp") }),
        button(t("startExport"), async () => { try { await post(`/mailboxes/${current.id}/exports`); drawExports(); toast(t("exportStarted"), "success"); } catch (error) { toast(errorText(error), "error"); } }, { primary: true, iconName: "archive" }),
        exportsList,
        el("h3", { text: t("importMail") }), el("p", { class: "mu-muted", text: t("importMailHelp") }),
        el("div", { class: "mail-inline-form", style: "align-items:end" },
            field(t("importInto"), select(t("importInto"), [...["inbox", "archive", "sent"].map(value => ({ value, label: t(value) })), ...folders().filter(item => item.mailboxId === current.id).map(item => ({ value: item.id, label: item.name }))], folder, value => { folder = value; })),
            button(t("chooseFiles"), async () => { const files = await pickFiles({ accept: ".eml,.mbox,message/rfc822,application/mbox" }); if (files.length) importFiles(files); }, { iconName: "upload_file" })),
        progress, status,
        el("h3", { text: t("settingsBackup") }), el("p", { class: "mu-muted", text: t("settingsBackupHelp") }),
        el("div", { class: "mail-inline-form" },
            button(t("downloadSettings"), async () => { const data = await get(`/mailboxes/${current.id}/backup`); download(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `munetios-mail-settings-${new Date().toISOString().slice(0, 10)}.json`); }, { iconName: "download" }),
            button(t("restoreSettings"), async () => {
                const [file] = await pickFiles({ accept: ".json,application/json", multiple: false });
                if (!file) return;
                try { await post(`/mailboxes/${current.id}/backup`, JSON.parse(await file.text())); toast(t("settingsRestored"), "success"); emit("refreshBoot"); }
                catch (error) { toast(error.code === "invalidBackup" || error instanceof SyntaxError ? t("invalidBackup") : errorText(error), "error"); }
            }, { iconName: "restore" })));
    return node;
}

function dangerZone() {
    const current = box();
    return el("div", { class: "mu-danger-zone", style: "display:grid;gap:10px;padding:16px;border-radius:24px;border:1px solid var(--mu-danger)" },
        el("h3", { text: t("deleteMailbox") }), el("p", { class: "mu-muted", text: t("deleteMailboxHelp", { address: current.address }) }),
        button(t("deleteMailbox"), async () => {
            const typed = await promptDialog({ title: t("deleteMailbox"), label: t("typeAddressToConfirm", { address: current.address }), iconName: "warning", confirm: t("continue") });
            if (typed !== current.address) { if (typed !== null) toast(t("confirmationMismatch"), "error"); return; }
            const phrase = await promptDialog({ title: t("deleteMailbox"), label: t("typeDeleteToConfirm"), iconName: "warning", confirm: t("deleteMailbox") });
            if (phrase !== "DELETE") { if (phrase !== null) toast(t("confirmationMismatch"), "error"); return; }
            try { await post(`/mailboxes/${current.id}/delete`, { confirm: current.address, phrase }); toast(t("mailboxDeleting"), "success"); setTimeout(() => location.reload(), 1500); }
            catch (error) { toast(errorText(error), "error"); }
        }, { danger: true, "data-mu-danger": "" }));
}

export function open(section = "general") {
    mailboxId = state.scope !== "all" ? state.scope : primaryMailbox()?.id;
    let current = SECTIONS.some(([key]) => key === section) ? section : "general";
    const nav = el("nav", { class: "mail-settings-nav mu-scroll", "aria-label": t("settings") });
    const search = el("input", { type: "search", placeholder: t("searchSettings"), "aria-label": t("searchSettings") });
    const heading = el("h2", { class: "mu-h-title" });
    const content = el("div", { class: "mail-settings-content mu-scroll", role: "region", "aria-live": "polite" });
    const rerender = () => draw();
    const draw = () => {
        const query = search.value.trim().toLowerCase();
        nav.replaceChildren(el("label", { class: "mu-search" }, icon("search"), search),
            el("div", { class: "mu-nav" }, SECTIONS.filter(([key]) => !query || t("settings_" + key).toLowerCase().includes(query) || sectionText(key).includes(query)).map(([key, iconName]) => {
                const item = el("button", { type: "button", class: "mu-nav-item", "aria-current": key === current ? "page" : undefined }, icon(iconName, key === current), el("span", { text: t("settings_" + key) }));
                item.addEventListener("click", () => { current = key; draw(); });
                return item;
            })));
        heading.textContent = t("settings_" + current);
        try { content.replaceChildren(...RENDER[current](rerender).filter(Boolean)); }
        catch { content.replaceChildren(alertBox("danger", "error", t("loadFailed"), "")); }
        if (query) content.querySelectorAll(".mu-row").forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(query) && !t("settings_" + current).toLowerCase().includes(query); });
        const keep = document.activeElement === search;
        if (keep) search.focus();
    };
    const sectionCache = new Map();
    const sectionText = key => {
        if (!sectionCache.has(key)) {
            try { const nodes = key === current || ["general", "appearance", "customization", "typography", "layout", "shortcuts", "language", "accessibility", "offline", "sounds", "notifications"].includes(key) ? RENDER[key](() => {}) : []; sectionCache.set(key, nodes.filter(Boolean).map(node => node.textContent).join(" ").toLowerCase()); }
            catch { sectionCache.set(key, ""); }
        }
        return sectionCache.get(key);
    };
    search.addEventListener("input", draw);
    const d = dialog({ title: "", content: [el("div", { class: "mail-settings" }, nav, el("div", { class: "mail-settings-body" }, el("div", { class: "mail-settings-head" }, heading, iconButton("close", t("close"), () => d.close())), content))] });
    d.dialog.style.width = "min(1180px, 100%)";
    d.dialog.style.padding = "0";
    d.dialog.setAttribute("aria-label", t("settings"));
    draw();
}



// Folders and labels: each item listed once with edit and delete actions; subfolders indented under their parent.
function foldersView(rerender) {
    const id = box().id;
    const refreshAfter = () => { const stop = on("bootChanged", () => { stop(); rerender(); }); };
    const actionsFor = (item, kind) => el("div", { class: "mail-section-actions" },
        iconButton("edit", t("edit"), () => { refreshAfter(); kind === "folder" ? editFolder(item) : editLabel(item); }, { class: "mu-icon-btn mu-icon-btn-sm" }),
        iconButton("delete", t("delete"), async () => { refreshAfter(); await (kind === "folder" ? deleteFolder(item) : deleteLabel(item)); }, { class: "mu-icon-btn mu-icon-btn-sm" }));
    const byPosition = (a, b) => (a.position || 0) - (b.position || 0) || a.name.localeCompare(b.name);
    const own = folders().filter(item => item.mailboxId === id);
    const known = new Set(own.map(item => item.id));
    const rows = [];
    const walk = (folder, depth) => {
        rows.push(el("div", { class: "mail-list-item", style: depth ? `margin-inline-start:${Math.min(depth, 6) * 28}px` : "" },
            el("span", { class: "mu-icon", "aria-hidden": "true", style: folder.color ? `color:${folder.color}` : "", text: folder.icon || "folder" }),
            el("span", { class: "mail-list-name", text: folder.name }),
            folder.favorite ? el("span", { class: "mu-icon", "aria-label": t("favorite"), text: "star" }) : null,
            actionsFor(folder, "folder")));
        for (const kid of own.filter(item => item.parentId === folder.id).sort(byPosition)) walk(kid, depth + 1);
    };
    for (const folder of own.filter(item => !item.parentId || !known.has(item.parentId)).sort(byPosition)) walk(folder, 0);
    const labelRows = labels().filter(item => item.mailboxId === id).sort(byPosition).map(item => el("div", { class: "mail-list-item" },
        el("span", { class: "mail-swatch-dot", style: `background:${item.color}` }),
        el("span", { class: "mail-list-name", text: item.name }),
        item.favorite ? el("span", { class: "mu-icon", "aria-label": t("favorite"), text: "star" }) : null,
        actionsFor(item, "label")));
    const head = (title, onAdd, addLabel) => el("div", { class: "mail-block-head" }, el("h3", { text: title }), button(addLabel, () => { refreshAfter(); onAdd(); }, { iconName: "add" }));
    return [mailboxPicker(rerender), el("p", { class: "mu-muted", text: t("foldersHelp") }),
        head(t("folders"), () => editFolder(null, null, id), t("newFolder")),
        rows.length ? el("div", { class: "mail-list-editor" }, rows) : el("p", { class: "mu-muted", text: t("listEmpty") }),
        head(t("labels"), () => editLabel(null, id), t("newLabel")),
        labelRows.length ? el("div", { class: "mail-list-editor" }, labelRows) : el("p", { class: "mu-muted", text: t("listEmpty") }),
        el("h3", { text: t("navigation") }), pref("layout.navOrder")];
}
