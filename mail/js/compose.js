// Composer: multiple windows (minimize, full screen), recipients with autocomplete and groups, five editing modes
// (rich text, HTML source, split HTML + live preview, visual designer, plain text), attachments with progress,
// cancel, and retry, Munetios Photos, inline and pasted images, signatures, templates, priority, scheduled sending,
// undo send, attachment reminders, personalization, and autosave to this device and the server.
import { state, emit, mailboxes, mailboxById, primaryMailbox } from "./state.js";
import { get, post, del, upload, fetchBlob, idempotencyKey, ApiError } from "./api.js";
import { t, formatBytes, formatDateTime } from "./i18n.js";
import { el, icon, iconButton, button, menu, closeMenu, toast, confirmDialog, dialog, select, pickFiles, download, debounce, promptDialog } from "./ui.js";
import { RichEditor } from "./editor.js";
import { CodeEditor } from "./code-editor.js";
import { Designer, designToHtml, templateDesign } from "./designer.js";
import { formatHtml, validateHtml, inlineCss, htmlToText, textToHtml, emailDocument, buildEml, mentionsAttachment, hasVariables, personalize } from "./html-tools.js";
import { sanitizeIncoming, srcdoc } from "./render-email.js";
import { showUndo, pickDateTime, errorText, failText } from "./actions.js";
import * as offline from "./offline.js";

const windows = [];
let focused = null;
const signatureCache = new Map();
const dock = () => document.getElementById("composeDock");

export function init() {
    window.addEventListener("beforeunload", event => { if (windows.some(win => win.dirty || win.uploading())) { windows.forEach(win => win.saveLocal()); event.preventDefault(); } });
}
export const hasOpen = () => windows.length > 0;
export function attachFiles(files) { (focused || windows.at(-1))?.addFiles(files); }

export function open(prefill = {}) {
    const win = new ComposeWindow(prefill);
    windows.push(win);
    win.mount();
    fitDock(win);
    return win;
}

// When open windows can't fit side by side even at their smallest width, minimize the oldest ones
// (never `keep`, the window just opened or restored). Small screens show one full-screen window instead.
const stacked = window.matchMedia("(max-width: 900px)");
function fitDock(keep = null) {
    const node = dock();
    if (!node || stacked.matches) return;
    // The dock grows from the end edge, so overflow runs past the start edge (left in LTR, right in RTL),
    // where scrollWidth doesn't see it; compare the windows' boxes with the viewport instead.
    const overflowing = () => [...node.children].some(child => { const r = child.getBoundingClientRect(); return r.left < 8 || r.right > innerWidth - 8; });
    node.classList.remove("is-crowded");
    for (const win of windows) {
        if (!overflowing()) break;
        if (win === keep || win.minimized || win.full) continue;
        win.minimized = true;
        win.node.classList.add("is-minimized");
    }
    node.classList.toggle("is-crowded", overflowing());
}
window.addEventListener("resize", debounce(() => fitDock(focused), 150));

export async function editDraft(id) {
    const existing = windows.find(win => win.draftId === id);
    if (existing) { existing.restore(); return; }
    try {
        const { draft } = await get(`/drafts/${id}`);
        open({ ...draft, fromDraft: true });
    } catch (error) { toast(failText(error, "errOpenDraft"), "error"); }
}

// Drafts that only exist on this device (the network dropped, or the tab closed before syncing).
export async function recoverDrafts() {
    const local = await offline.draftList().catch(() => []);
    const pending = local.filter(item => item.draft.unsynced);
    if (!pending.length) return;
    showUndo(t("draftsRecovered", { count: pending.length }), null, 12);
    for (const item of pending) open({ ...item.draft, localId: item.localId, recovered: true });
}

const quoteHeader = (message, intro) => `<p>${intro.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</p>`;
const prefix = (value, p) => new RegExp(`^${p}:`, "i").test(value || "") ? value : `${p}: ${value || ""}`.trim();

export async function reply(item, mode) {
    let message = item;
    if (item.id && !item.html && !item.text) {
        try { message = (await get(`/messages/${item.id}`)).message; } catch (error) { toast(failText(error, "errOpenEmail"), "error"); return; }
    }
    const box = mailboxById(message.mailboxId) || primaryMailbox();
    const own = new Set(box.senders.map(sender => sender.address));
    const recipientAddress = [...(message.to || []), ...(message.cc || [])].map(person => person.email).find(address => own.has(address));
    const from = recipientAddress || box.address;
    const original = message.html ? sanitizeIncoming(message.html, { allowRemote: false }).html : textToHtml(message.text);
    const when = formatDateTime(message.date || Date.now());
    const sender = message.from?.name ? `${message.from.name} <${message.from.email}>` : message.from?.email || "";
    const prefs = state.prefs.behavior;
    if (mode === "forward") {
        const header = `<p>---------- ${t("forwardedMessage")} ----------<br>${t("from")}: ${sender.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c])}<br>${t("date")}: ${when}<br>${t("subject")}: ${(message.subject || "").replace(/[<>&]/g, "")}</p>`;
        const win = open({ mailboxId: box.id, from, subject: prefix(message.subject, "Fwd"), html: `<p><br></p><div class="mail-quote">${header}${original}</div>`, replyToMessageId: message.id, replyMode: "forward", forwardFrom: message });
        return win;
    }
    const replyTarget = message.replyTo ? [{ email: message.replyTo, name: "" }] : message.direction === "out" ? message.to : [message.from];
    const to = (replyTarget || []).filter(person => person?.email);
    let cc = [];
    if (mode === "replyAll" || (mode === "reply" && prefs.replyAll)) {
        const seen = new Set([...to.map(person => person.email), ...own]);
        cc = [...(message.to || []), ...(message.cc || [])].filter(person => person?.email && !seen.has(person.email) && seen.add(person.email));
    }
    const quote = prefs.quoteOriginal ? `<p><br></p><div class="mail-quote">${quoteHeader(message, t("wroteOn", { date: when, name: sender }))}<blockquote>${original}</blockquote></div>` : "<p><br></p>";
    return open({ mailboxId: box.id, from, to, cc, subject: prefix(message.subject, "Re"), html: quote, replyToMessageId: message.id || null, replyMode: mode === "replyAll" ? "replyAll" : "reply" });
}

class ComposeWindow {
    constructor(data) {
        const box = mailboxById(data.mailboxId) || primaryMailbox();
        this.mailboxId = box.id;
        this.from = data.from || box.address;
        this.draftId = data.draftId || null;
        this.version = data.version ?? null;
        this.localId = data.localId || crypto.randomUUID();
        this.subject = data.subject || "";
        this.mode = data.mode || state.prefs.behavior.defaultMode;
        this.recipients = { to: [...(data.to || [])].map(normalizePerson), cc: [...(data.cc || [])].map(normalizePerson), bcc: [...(data.bcc || [])].map(normalizePerson) };
        if (typeof data.to === "string") this.recipients.to = data.to.split(/[,;]/).map(value => normalizePerson(value.trim())).filter(person => person.email);
        this.priority = data.priority || box.settings?.defaultPriority || "normal";
        this.replyToMessageId = data.replyToMessageId || null;
        this.replyMode = data.replyMode || null;
        this.signatureId = data.signatureId || null;
        this.design = data.source?.design || data.design || null;
        this.sourceHtml = data.source?.html || "";
        this.initialHtml = data.html || (data.body ? textToHtml(data.body) : "");
        this.text = data.text || "";
        this.attachments = (data.attachments || []).map(item => ({ key: crypto.randomUUID(), ...item, status: "done", progress: 1 }));
        this.forwardFrom = data.forwardFrom || null;
        this.sendKey = idempotencyKey();
        this.dirty = Boolean(data.recovered);
        this.minimized = false;
        this.full = false;
        this.saveTimer = null;
        this.serverSave = debounce(() => this.save(), 2500);
        this.localSave = debounce(() => this.saveLocal(), 600);
    }

    uploading() { return this.attachments.some(item => item.status === "uploading"); }

    mount() {
        this.node = el("section", { class: "mail-compose mu-glass mu-glass-solid", role: "dialog", "aria-label": t("newMessage") });
        this.node.addEventListener("focusin", () => { focused = this; });
        this.title = el("h2", { text: this.subject || t("newMessage") });
        this.status = el("span", { class: "mu-muted", role: "status", "aria-live": "polite" });
        const head = el("div", { class: "mail-compose-head" }, this.title,
            iconButton("minimize", t("minimize"), () => this.toggleMinimize()),
            iconButton("open_in_full", t("fullScreen"), event => { this.full = !this.full; this.node.classList.toggle("is-full", this.full); event.currentTarget.querySelector(".mu-icon").textContent = this.full ? "close_fullscreen" : "open_in_full"; }),
            iconButton("close", t("saveAndClose"), () => this.close()));
        head.addEventListener("dblclick", () => this.toggleMinimize());
        this.body = el("div", { class: "mail-compose-body" });
        this.node.append(head, this.body);
        dock().prepend(this.node);
        this.render();
        this.loadInlinePreviews();
        if (this.forwardFrom) this.attachForwarded();
        if (!this.draftId && !this.initialHtml.includes("data-signature") && this.mode === "rich") this.applyDefaultSignature();
        setTimeout(() => (this.recipients.to.length ? this.editor?.focus() : this.body.querySelector(".mail-recipients input")?.focus()), 60);
    }

    restore() { this.minimized = false; this.node.classList.remove("is-minimized"); fitDock(this); this.node.scrollIntoView({ block: "nearest" }); }
    toggleMinimize() { this.minimized = !this.minimized; this.node.classList.toggle("is-minimized", this.minimized); if (!this.minimized) fitDock(this); }

    render() {
        const box = mailboxById(this.mailboxId);
        const senders = mailboxes().flatMap(item => item.senders.map(sender => ({ ...sender, mailboxId: item.id })));
        const fromRow = el("div", { class: "mail-field-row" }, el("span", { class: "mail-field-name", text: t("from") }),
            select(t("from"), senders.map(sender => ({ value: sender.mailboxId + "|" + sender.address, label: sender.displayName ? `${sender.displayName} <${sender.address}>` : sender.address })), this.mailboxId + "|" + this.from, value => {
                const [mailboxId, address] = value.split("|");
                if (mailboxId !== this.mailboxId && this.attachments.length) { toast(t("changeSenderAttachments"), "error"); return; }
                this.mailboxId = mailboxId; this.from = address; this.changed();
            }));
        this.ccToggle = el("button", { type: "button", class: "mu-btn mu-btn-ghost", style: "min-height:36px;padding:0 10px", text: t("ccBcc") });
        const ccRow = this.recipientRow("cc", t("cc"));
        const bccRow = this.recipientRow("bcc", t("bcc"));
        ccRow.hidden = bccRow.hidden = !(this.recipients.cc.length || this.recipients.bcc.length);
        this.ccToggle.addEventListener("click", () => { ccRow.hidden = bccRow.hidden = false; this.ccToggle.hidden = true; ccRow.querySelector("input").focus(); });
        this.ccToggle.hidden = !ccRow.hidden;
        const toRow = this.recipientRow("to", t("to"));
        toRow.append(this.ccToggle);
        const subject = el("input", { value: this.subject, "aria-label": t("subject"), maxlength: 998, placeholder: t("subject") });
        subject.addEventListener("input", () => { this.subject = subject.value; this.title.textContent = this.subject || t("newMessage"); this.changed(); });
        const fields = el("div", { class: "mail-compose-fields" }, senders.length > 1 ? fromRow : null, toRow, ccRow, bccRow, el("div", { class: "mail-field-row" }, el("label", { text: t("subject") }), subject));
        this.modes = el("div", { class: "mu-segmented", role: "group", "aria-label": t("editorMode") }, ...["rich", "html", "split", "designer", "plain"].map(mode => {
            const node = el("button", { type: "button", "aria-pressed": String(this.mode === mode), title: t("mode_" + mode) }, icon({ rich: "edit_note", html: "code", split: "vertical_split", designer: "dashboard_customize", plain: "notes" }[mode]), el("span", { class: "mail-mode-label", text: t("mode_" + mode) }));
            node.addEventListener("click", () => this.switchMode(mode));
            return node;
        }));
        this.editorHost = el("div", { class: "mail-compose-editor" });
        this.attachList = el("div", { class: "mail-compose-attachments", "aria-label": t("attachments") });
        this.body.replaceChildren(fields, el("div", { class: "mail-compose-modes" }, this.modes), this.editorHost, this.attachList, this.footer(box));
        this.mountEditor(this.initialHtml);
        this.renderAttachments();
    }

    recipientRow(kind, label) {
        const wrap = el("div", { class: "mail-recipients" });
        const input = el("input", { type: "email", multiple: true, autocomplete: "off", "aria-label": label, spellcheck: "false" });
        const draw = () => {
            wrap.replaceChildren(...this.recipients[kind].map((person, index) => {
                const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email);
                const chip = el("span", { class: "mail-recipient" + (valid ? "" : " is-invalid"), title: person.email }, el("span", { text: person.name || person.email }),
                    el("button", { type: "button", "aria-label": t("removeRecipient", { name: person.name || person.email }) }, icon("close")));
                chip.querySelector("button").addEventListener("click", () => { this.recipients[kind].splice(index, 1); draw(); this.changed(); input.focus(); });
                return chip;
            }), input);
        };
        // Suggestions open without taking focus, so typing keeps going into the field and nothing half-typed is committed.
        let suggestions = null;
        const closeSuggestions = () => { if (suggestions?.isConnected) closeMenu(); suggestions = null; };
        const add = text => {
            closeSuggestions();
            const parts = String(text).split(/[,;\n]+/).map(value => value.trim()).filter(Boolean);
            for (const part of parts) {
                const person = normalizePerson(part);
                if (person.email && !this.recipients[kind].some(item => item.email === person.email)) this.recipients[kind].push(person);
            }
            input.value = "";
            draw(); this.changed();
            input.focus();
        };
        const suggest = debounce(async () => {
            const q = input.value.trim();
            if (q.length < 1) { closeSuggestions(); return; }
            try {
                const { suggestions: items } = await get(`/recipients?mailbox=${this.mailboxId}&q=${encodeURIComponent(q)}`);
                // The field changed or lost focus while the request ran: these suggestions are stale.
                if (input.value.trim() !== q || document.activeElement !== input) return;
                closeSuggestions();
                if (!items.length) return;
                suggestions = menu(input, items.map(item => item.type === "group"
                    ? { icon: "group", label: `${item.name} (${item.members.length})`, action: () => { for (const member of item.members) if (!this.recipients[kind].some(p => p.email === member.email)) this.recipients[kind].push(member); input.value = ""; draw(); this.changed(); input.focus(); } }
                    : { icon: "person", label: item.name ? `${item.name} <${item.email}>` : item.email, action: () => add(item.name ? `${item.name} <${item.email}>` : item.email) }), { label: t("suggestions"), focus: false });
            } catch { /* offline: type addresses manually */ }
        }, 180);
        input.addEventListener("input", suggest);
        input.addEventListener("keydown", event => {
            const complete = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizePerson(input.value.trim()).email || "");
            // Enter or Tab on an unfinished address takes the first suggestion instead of adding the fragment.
            if (["Enter", "Tab"].includes(event.key) && !complete && suggestions?.isConnected && input.value.trim()) { event.preventDefault(); suggestions.querySelector("button")?.click(); }
            else if (["Enter", ",", ";", "Tab"].includes(event.key) && input.value.trim()) { event.preventDefault(); add(input.value); }
            else if (event.key === "Escape" && suggestions?.isConnected) { event.preventDefault(); event.stopPropagation(); closeSuggestions(); }
            else if (event.key === "Backspace" && !input.value && this.recipients[kind].length) { this.recipients[kind].pop(); draw(); this.changed(); }
            else if (event.key === "ArrowDown" && suggestions?.isConnected) { event.preventDefault(); suggestions.querySelector("button")?.focus(); }
        });
        input.addEventListener("paste", event => { const text = event.clipboardData.getData("text"); if (/[,;\n]/.test(text)) { event.preventDefault(); add(text); } });
        // Leaving the field (clicking elsewhere) commits what was typed, but only once focus has really left it
        // and isn't in the suggestions.
        input.addEventListener("blur", () => setTimeout(() => {
            if (document.activeElement === input || suggestions?.contains(document.activeElement)) return;
            closeSuggestions();
            if (input.value.trim()) add(input.value);
        }, 200));
        draw();
        return el("div", { class: "mail-field-row" }, el("span", { class: "mail-field-name", text: label }), wrap);
    }

    footer(box) {
        const sendButton = el("button", { type: "button", class: "mu-btn mu-btn-primary" }, icon("send"), t("send"));
        sendButton.addEventListener("click", () => this.send());
        const scheduleButton = el("button", { type: "button", class: "mu-btn mu-btn-primary", "aria-label": t("scheduleSend"), title: t("scheduleSend") }, icon("arrow_drop_down"));
        scheduleButton.addEventListener("click", () => {
            const at = (days, hour) => { const date = new Date(); date.setDate(date.getDate() + days); date.setHours(hour, 0, 0, 0); return date.getTime(); };
            menu(scheduleButton, [
                { icon: "schedule_send", label: t("tomorrowMorning"), shortcut: formatDateTime(at(1, 8)), action: () => this.send(at(1, 8)) },
                { icon: "schedule_send", label: t("tomorrowAfternoon"), shortcut: formatDateTime(at(1, 13)), action: () => this.send(at(1, 13)) },
                { icon: "schedule_send", label: t("mondayMorning"), action: () => this.send(at(((8 - new Date().getDay()) % 7) || 7, 8)) },
                { icon: "edit_calendar", label: t("pickDateTime"), action: () => pickDateTime(t("scheduleSend"), value => this.send(value)) },
            ], { label: t("scheduleSend") });
        });
        const attach = iconButton("attach_file", t("attach"), () => menu(attach, [
            { icon: "upload_file", label: t("uploadFromDevice"), action: async () => this.addFiles(await pickFiles()) },
            { icon: "photo_library", label: t("selectFromPhotos"), action: () => this.fromPhotos() },
            { icon: "add_photo_alternate", label: t("insertInlineImage"), action: async () => { const files = await pickFiles({ accept: "image/png,image/jpeg,image/gif,image/webp" }); for (const file of files) this.addFile(file, { inline: true }); } },
            { icon: "content_paste", label: t("pasteFromClipboard"), action: () => this.pasteClipboard() },
        ], { label: t("attach") }));
        const signature = iconButton("signature", t("signature"), () => this.signatureMenu(signature));
        const templates = iconButton("article", t("templates"), () => this.templateMenu(templates));
        const priority = iconButton(this.priority === "high" ? "priority_high" : this.priority === "low" ? "low_priority" : "flag", t("priority"), () => menu(priority, ["low", "normal", "high"].map(value => ({
            label: t("priority_" + value), checked: this.priority === value, action: () => { this.priority = value; priority.querySelector(".mu-icon").textContent = value === "high" ? "priority_high" : value === "low" ? "low_priority" : "flag"; this.changed(); },
        })), { label: t("priority") }));
        const more = iconButton("more_vert", t("more"), () => menu(more, [
            { icon: "save", label: t("saveDraftNow"), action: () => this.save(true) },
            { icon: "bookmark_add", label: t("saveAsTemplate"), action: () => this.saveTemplate() },
            { icon: "forward_to_inbox", label: t("sendTest"), action: () => this.sendTest() },
            { icon: "html", label: t("exportHtml"), action: () => download(new Blob([emailDocument(this.currentHtml(true), this.subject)], { type: "text/html" }), (this.subject || "email").replace(/[\\/:*?"<>|]+/g, "_") + ".html") },
            { icon: "mail", label: t("exportEml"), action: () => download(new Blob([buildEml({ from: this.from, to: this.recipients.to, cc: this.recipients.cc, subject: this.subject, html: this.currentHtml(true) })], { type: "message/rfc822" }), (this.subject || "email").replace(/[\\/:*?"<>|]+/g, "_") + ".eml") },
            "sep",
            { icon: "delete", label: t("discardDraft"), danger: true, action: () => this.discard() },
        ], { label: t("more") }));
        return el("div", { class: "mail-compose-foot" }, el("div", { class: "mail-send-group" }, sendButton, scheduleButton), attach, signature, templates, priority, more, el("span", { class: "mail-spacer" }), this.status);
    }

    /* ---------------------------------------------------------------- editors */
    mountEditor(html) {
        this.editor = null; this.code = null; this.designer = null; this.plain = null;
        const onChange = () => this.changed();
        if (this.mode === "rich") {
            this.editor = new RichEditor({ html, spellcheck: state.prefs.behavior.spellcheck, onChange, placeholder: t("writeMessage"), onImage: (kind, file) => kind === "file" ? this.addFile(file, { inline: true }) : pickFiles({ accept: "image/*" }).then(files => files.forEach(item => this.addFile(item, { inline: true }))) });
            this.editorHost.replaceChildren(this.editor.node);
        } else if (this.mode === "html" || this.mode === "split") {
            this.code = new CodeEditor({ value: this.sourceHtml || formatHtml(html) || emailDocument("<p></p>"), onChange: value => { this.sourceHtml = value; onChange(); this.refreshPreview(); } });
            this.code.onFormat = () => { this.code.value = formatHtml(this.code.value); this.sourceHtml = this.code.value; onChange(); };
            const tools = el("div", { class: "mail-format-bar", role: "toolbar", "aria-label": t("htmlTools") },
                iconButton("format_align_left", t("formatHtml"), () => this.code.onFormat()),
                iconButton("format_paint", t("inlineCss"), () => { this.code.value = inlineCss(this.code.value); this.sourceHtml = this.code.value; onChange(); this.refreshPreview(); toast(t("cssInlined"), "success"); }),
                iconButton("rule", t("validateHtml"), () => this.refreshPreview(true)),
                iconButton("find_replace", t("findReplace"), () => this.code.toggleFind(true)),
                el("span", { class: "mu-divider-v" }),
                iconButton("upload_file", t("importHtml"), async () => { const [file] = await pickFiles({ accept: ".html,.htm,text/html", multiple: false }); if (file) { this.code.value = await file.text(); this.sourceHtml = this.code.value; onChange(); this.refreshPreview(); } }),
                iconButton("download", t("exportHtml"), () => download(new Blob([this.code.value], { type: "text/html" }), (this.subject || "email").replace(/[\\/:*?"<>|]+/g, "_") + ".html")),
                iconButton("content_copy", t("copyHtml"), async () => { try { await navigator.clipboard.writeText(this.code.value); toast(t("copied"), "success"); } catch { toast(t("copyFailed"), "error"); } }));
            const split = el("div", { class: "mail-split" + (this.mode === "split" ? " is-split" : "") });
            const editorPane = el("div", { style: "display:flex;flex-direction:column;min-height:0" }, this.code.node);
            split.append(editorPane);
            this.issues = el("div", { class: "mail-issues", role: "log", "aria-label": t("validation") });
            if (this.mode === "split") split.append(this.previewPane());
            this.editorHost.replaceChildren(tools, split, this.issues);
            this.refreshPreview(true);
        } else if (this.mode === "designer") {
            this.designer = new Designer({ design: this.design || (html && html !== "<p><br></p>" ? { ...templateDesign(""), blocks: [{ id: "b0", type: "html", props: { html } }] } : null), onChange: design => { this.design = design; onChange(); },
                onImage: () => new Promise(resolve => pickFiles({ accept: "image/*", multiple: false }).then(async ([file]) => { if (!file) return resolve(null); const item = await this.addFile(file, { inline: true, skipInsert: true }); resolve(item ? "cid:" + item.contentId : null); })),
                onSaveComponent: (name, block) => post(`/mailboxes/${this.mailboxId}/templates`, { name, kind: "component", data: { design: { block } } }),
                components: this.components || [] });
            this.design = this.designer.design;
            const tools = el("div", { class: "mail-format-bar", role: "toolbar", "aria-label": t("designer") },
                ...["newsletter", "business", "invitation", "announcement"].map(kind => button(t("template_" + kind), async () => {
                    if (this.design.blocks.length && !await confirmDialog({ title: t("useTemplate"), message: t("replaceDesignMessage"), confirm: t("replace") })) return;
                    this.design = templateDesign(kind); this.mountEditor(""); this.changed();
                }, { class: "mu-btn mu-btn-ghost", iconName: { newsletter: "newspaper", business: "business_center", invitation: "celebration", announcement: "campaign" }[kind] })),
                el("span", { class: "mu-divider-v" }), iconButton("visibility", t("preview"), () => this.previewDialog()));
            this.editorHost.replaceChildren(tools, this.designer.node);
            this.loadComponents();
        } else {
            this.plain = el("textarea", { class: "mail-plain-editor", "aria-label": t("messageBody"), spellcheck: String(state.prefs.behavior.spellcheck), placeholder: t("writeMessage") });
            this.plain.value = this.text || htmlToText(html);
            this.plain.addEventListener("input", () => { this.text = this.plain.value; onChange(); });
            this.editorHost.replaceChildren(this.plain);
        }
        this.modes?.querySelectorAll("button").forEach((node, index) => node.setAttribute("aria-pressed", String(["rich", "html", "split", "designer", "plain"][index] === this.mode)));
    }

    async loadComponents() {
        if (this.components) return;
        try {
            const { templates } = await get(`/mailboxes/${this.mailboxId}/templates`);
            const list = [];
            for (const item of templates.filter(entry => entry.kind === "component")) {
                const { template } = await get(`/mailboxes/${this.mailboxId}/templates/${item.id}`);
                if (template.data?.design?.block) list.push({ name: item.name, block: template.data.design.block });
            }
            this.components = list;
            if (list.length && this.designer) { this.designer.components = list; this.designer.renderPalette(); }
        } catch { this.components = []; }
    }

    previewPane() {
        this.previewFrame = el("iframe", { sandbox: "", title: t("livePreview"), referrerpolicy: "no-referrer" });
        this.previewStage = el("div", { class: "mail-preview-stage" }, this.previewFrame);
        const size = el("div", { class: "mu-segmented is-icons", role: "group", "aria-label": t("previewDevice") }, ...[["desktop_windows", "100%", t("desktop")], ["tablet_mac", "768px", t("tablet")], ["smartphone", "375px", t("mobile")]].map(([name, width, label], index) => {
            const node = el("button", { type: "button", "aria-pressed": String(index === 0), "aria-label": label, title: label }, icon(name));
            node.addEventListener("click", () => { this.previewStage.style.setProperty("--preview-w", width); size.querySelectorAll("button").forEach(other => other.setAttribute("aria-pressed", String(other === node))); });
            return node;
        }));
        const theme = el("div", { class: "mu-segmented is-icons", role: "group", "aria-label": t("previewTheme") }, ...[["light_mode", false, t("light")], ["dark_mode", true, t("dark")]].map(([name, dark, label], index) => {
            const node = el("button", { type: "button", "aria-pressed": String(index === 0), "aria-label": label, title: label }, icon(name));
            node.addEventListener("click", () => { this.previewDark = dark; this.previewStage.classList.toggle("is-dark", dark); theme.querySelectorAll("button").forEach(other => other.setAttribute("aria-pressed", String(other === node))); this.refreshPreview(); });
            return node;
        }));
        return el("div", { class: "mail-preview-pane" }, el("div", { class: "mail-preview-bar" }, size, theme), this.previewStage);
    }

    refreshPreview(validate = false) {
        if (!this.code) return;
        clearTimeout(this.previewTimer);
        this.previewTimer = setTimeout(() => {
            const source = this.code.value;
            if (this.previewFrame) {
                const { html } = sanitizeIncoming(source, { allowRemote: true, cidMap: this.cidMap() });
                this.previewFrame.srcdoc = srcdoc(html, { dark: this.previewDark });
            }
            const issues = validateHtml(source);
            this.code.setIssues(issues);
            this.issues.replaceChildren(...issues.slice(0, 200).map(issue => el("div", { class: "mail-issue is-" + issue.level }, icon(issue.level === "error" ? "error" : "warning"),
                el("button", { type: "button", text: t("lineNumber", { line: issue.line }), onclick: () => { const lines = source.split("\n"); const offset = lines.slice(0, issue.line - 1).join("\n").length + (issue.line > 1 ? 1 : 0); this.code.textarea.focus(); this.code.textarea.setSelectionRange(offset, offset + (lines[issue.line - 1] || "").length); } }),
                el("span", { text: issue.message }))));
            if (validate && !issues.length) this.issues.replaceChildren(el("div", { class: "mail-issue" }, icon("check_circle"), el("span", { text: t("noIssues") })));
        }, 250);
    }

    previewDialog() {
        const frame = el("iframe", { sandbox: "", title: t("preview"), style: "width:100%;height:65vh;border:0;border-radius:16px;background:#fff" });
        const { html } = sanitizeIncoming(this.currentHtml(false), { allowRemote: true, cidMap: this.cidMap() });
        frame.srcdoc = srcdoc(html);
        const d = dialog({ title: t("preview"), iconName: "visibility", size: "mu-dialog-lg", content: [frame], actions: [button(t("close"), () => d.close(), { primary: true })] });
    }

    cidMap() { return new Map(this.attachments.filter(item => item.contentId && item.previewUrl).map(item => [item.contentId, item.previewUrl])); }

    // Moves content between modes without losing the editable source of the mode being left.
    switchMode(mode) {
        if (mode === this.mode) return;
        const html = this.currentHtml(false);
        if (this.mode === "plain") this.text = this.plain.value;
        if (this.mode === "html" || this.mode === "split") this.sourceHtml = this.code.value;
        const previous = this.mode;
        this.mode = mode;
        if ((mode === "html" || mode === "split") && !(previous === "html" || previous === "split")) this.sourceHtml = formatHtml(previous === "designer" ? designToHtml(this.design) : html);
        if (mode === "plain") this.text = htmlToText(html);
        this.mountEditor(mode === "rich" ? this.withPreviews(previous === "plain" ? textToHtml(this.text) : html) : html);
        this.changed();
    }

    withPreviews(html) {
        let out = html;
        for (const item of this.attachments) if (item.contentId && item.previewUrl) out = out.split(`cid:${item.contentId}`).join(item.previewUrl);
        return out.replace(/<img([^>]*?)src="(blob:[^"]+)"/g, (match, attrs, src) => {
            const item = this.attachments.find(entry => entry.previewUrl === src);
            return item && !/data-cid=/.test(attrs) ? `<img${attrs}data-cid="${item.contentId}" src="${src}"` : match;
        });
    }

    // HTML in the portable form: inline images reference their attachment with cid:.
    currentHtml(forDelivery) {
        let html;
        if (this.mode === "rich") {
            const doc = new DOMParser().parseFromString(this.editor.html, "text/html");
            doc.querySelectorAll("img[data-cid]").forEach(img => { img.setAttribute("src", "cid:" + img.dataset.cid); img.removeAttribute("data-cid"); img.removeAttribute("data-upload"); img.classList.remove("is-selected"); if (!img.className) img.removeAttribute("class"); });
            doc.querySelectorAll("mark.mail-find-hit").forEach(mark => mark.replaceWith(...mark.childNodes));
            doc.querySelectorAll("ul[data-checklist] li").forEach(li => { if (forDelivery) li.prepend(li.dataset.checked === "true" ? "☑ " : "☐ "); });
            html = doc.body.innerHTML;
        } else if (this.mode === "html" || this.mode === "split") html = this.code.value;
        else if (this.mode === "designer") html = designToHtml(this.design);
        else html = textToHtml(this.plain?.value ?? this.text);
        if (forDelivery) for (const item of this.attachments) if (item.contentId && item.previewUrl) html = html.split(item.previewUrl).join("cid:" + item.contentId);
        return html;
    }

    async loadInlinePreviews() {
        for (const item of this.attachments) {
            if (!item.contentId || !/^image\//.test(item.mimeType || "") || item.previewUrl) continue;
            try { item.previewUrl = URL.createObjectURL(await fetchBlob(`/attachments/${item.id}?inline=1`)); } catch { continue; }
        }
        if (this.mode === "rich" && this.editor) { const html = this.withPreviews(this.editor.html); if (html !== this.editor.html) { this.editor.area.innerHTML = html; } }
    }

    /* ---------------------------------------------------------------- attachments */
    addFiles(files) { for (const file of files) this.addFile(file); }

    async addFile(file, { inline = false, skipInsert = false, source = "device" } = {}) {
        if (file.size > state.boot.limits.maxMessageBytes) { toast(t("fileTooLarge", { name: file.name, size: formatBytes(state.boot.limits.maxMessageBytes) }), "error"); return null; }
        const isImage = /^image\/(png|jpeg|gif|webp)$/.test(file.type);
        const item = { key: crypto.randomUUID(), kind: "upload", filename: file.name || "image.png", mimeType: file.type || "application/octet-stream", size: file.size, inline: inline && isImage,
            contentId: inline && isImage ? crypto.randomUUID().replace(/-/g, "") + "@munetios.com" : null, status: "uploading", progress: 0, file, source };
        if (item.inline) item.previewUrl = URL.createObjectURL(file);
        this.attachments.push(item);
        if (item.inline && !skipInsert && this.mode === "rich") this.editor.insertImage(item.previewUrl, { cid: item.contentId, alt: "" });
        this.renderAttachments();
        await this.startUpload(item);
        return item;
    }

    async startUpload(item, loader = null) {
        item.status = "uploading"; item.error = null; item.progress = 0;
        item.abort = new AbortController();
        this.renderAttachments();
        try {
            const blob = item.file || (loader ? await loader({ signal: item.abort.signal, onProgress: (done, total) => { item.progress = total ? done / total / 2 : 0; this.renderAttachments(); } }) : null);
            if (!blob) throw new ApiError("unavailable", 0);
            item.file = blob; item.size = blob.size;
            if (item.inline && !item.previewUrl) item.previewUrl = URL.createObjectURL(blob);
            const result = await upload(`/uploads?mailbox=${this.mailboxId}`, blob, {
                headers: { "X-File-Name": encodeURIComponent(item.filename), "X-File-Type": item.mimeType, "X-Upload-Source": item.source || "device" }, signal: item.abort.signal,
                onProgress: (done, total) => { item.progress = (loader ? 0.5 : 0) + (done / total) * (loader ? 0.5 : 1); this.renderAttachments(); },
            });
            Object.assign(item, { id: result.id, status: "done", progress: 1, file: null });
            emit("storageStale");
        } catch (error) {
            if (error?.name === "AbortError") { this.attachments = this.attachments.filter(other => other !== item); if (item.contentId) this.removeInline(item); }
            else { item.status = "error"; item.error = error instanceof ApiError && error.code === "quotaExceeded" ? t("uploadQuota") : failText(error, "errUploadAttachment"); item.retry = () => this.startUpload(item, loader); }
        }
        this.renderAttachments();
        this.changed();
    }

    removeInline(item) {
        if (this.mode === "rich") this.editor.area.querySelectorAll(`img[data-cid="${CSS.escape(item.contentId)}"]`).forEach(img => img.remove());
    }

    renderAttachments() {
        const list = this.attachments.filter(item => !item.inline || item.status !== "done");
        this.attachList.replaceChildren(...list.map(item => {
            const progress = el("div", { class: "mu-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(item.progress * 100)), "aria-label": t("uploadProgress", { name: item.filename }) }, el("span", { style: `width:${Math.round(item.progress * 100)}%` }));
            const remove = iconButton(item.status === "uploading" ? "close" : "delete", item.status === "uploading" ? t("cancelUpload") : t("remove"), async () => {
                if (item.status === "uploading") { item.abort?.abort(); return; }
                this.attachments = this.attachments.filter(other => other !== item);
                if (item.contentId) this.removeInline(item);
                if (item.kind === "upload" && item.id) del(`/uploads/${item.id}?mailbox=${this.mailboxId}`).catch(() => {});
                this.renderAttachments(); this.changed();
            }, { class: "mu-icon-btn mu-icon-btn-sm" });
            return el("div", { class: "mail-upload" + (item.status === "error" ? " is-error" : "") },
                icon(item.inline ? "image" : /^image\//.test(item.mimeType) ? "image" : /^video\//.test(item.mimeType) ? "movie" : "draft"),
                el("div", { style: "min-width:0;display:grid;gap:2px" }, el("span", { class: "mail-upload-name", text: item.filename }),
                    item.status === "uploading" ? progress : el("span", { class: "mu-muted", text: item.status === "error" ? item.error : formatBytes(item.size) })),
                el("div", { style: "display:flex" }, item.status === "error" && item.retry ? iconButton("refresh", t("retry"), () => item.retry(), { class: "mu-icon-btn mu-icon-btn-sm" }) : null, remove));
        }));
        const total = this.attachments.reduce((sum, item) => sum + (item.size || 0), 0);
        if (total) this.attachList.append(el("span", { class: "mu-muted", style: "align-self:center", text: t("attachmentsTotal", { size: formatBytes(total) }) }));
    }

    async fromPhotos() {
        const { pickPhotos } = await import("./photos-picker.js");
        const jobs = await pickPhotos({});
        for (const job of jobs) {
            const item = { key: crypto.randomUUID(), kind: "upload", filename: job.name, mimeType: "application/octet-stream", size: job.size, inline: job.inline, status: "uploading", progress: 0, source: "photos",
                contentId: job.inline ? crypto.randomUUID().replace(/-/g, "") + "@munetios.com" : null };
            this.attachments.push(item);
            this.renderAttachments();
            this.startUpload(item, async options => {
                const blob = await job.load(options);
                item.mimeType = blob.type || item.mimeType;
                if (/\.(heic|heif)$/i.test(item.filename) && blob.type === "image/jpeg") item.filename = item.filename.replace(/\.(heic|heif)$/i, ".jpg");
                if (item.inline) { item.previewUrl = URL.createObjectURL(blob); if (this.mode === "rich") this.editor.insertImage(item.previewUrl, { cid: item.contentId, alt: item.filename }); }
                return blob;
            });
        }
    }

    async pasteClipboard() {
        try {
            const items = await navigator.clipboard.read();
            let found = false;
            for (const entry of items) for (const type of entry.types) {
                if (!type.startsWith("image/")) continue;
                const blob = await entry.getType(type);
                await this.addFile(new File([blob], `pasted-image.${type.split("/")[1]}`, { type }), { inline: true, source: "clipboard" });
                found = true;
            }
            if (!found) toast(t("clipboardNoImage"));
        } catch { toast(t("clipboardDenied"), "error"); }
    }

    async attachForwarded() {
        const message = this.forwardFrom;
        for (const attachment of message.attachmentList || []) {
            const inline = attachment.disposition === "inline" && attachment.contentId && message.html?.includes("cid:" + attachment.contentId);
            try {
                const result = await post("/uploads/from-attachment", { mailboxId: this.mailboxId, attachmentId: attachment.id });
                this.attachments.push({ key: crypto.randomUUID(), kind: "upload", id: result.id, filename: result.filename, mimeType: result.mimeType, size: result.size, status: "done", progress: 1, inline, contentId: inline ? attachment.contentId : null });
            } catch (error) { toast(failText(error, "errUploadAttachment"), "error"); }
        }
        this.loadInlinePreviews();
        this.renderAttachments();
        this.changed();
    }

    /* ---------------------------------------------------------------- signatures and templates */
    async signatures() {
        if (!signatureCache.has(this.mailboxId)) signatureCache.set(this.mailboxId, get(`/mailboxes/${this.mailboxId}/signatures`).then(result => result.signatures).catch(() => []));
        return signatureCache.get(this.mailboxId);
    }

    async applyDefaultSignature() {
        const list = await this.signatures();
        const chosen = list.find(item => (this.replyMode ? item.defaultReply : item.defaultNew));
        if (chosen) this.setSignature(chosen);
    }

    setSignature(signature) {
        if (this.mode !== "rich") { toast(t("signatureRichOnly")); return; }
        this.signatureId = signature?.id || null;
        const area = this.editor.area;
        area.querySelector("[data-signature]")?.remove();
        if (signature) {
            const node = el("div", { "data-signature": signature.id });
            node.innerHTML = "<p>--</p>" + signature.html;
            const quote = area.querySelector(".mail-quote");
            if (quote) quote.before(node); else area.append(node);
        }
        this.editor.record();
        this.changed();
    }

    async signatureMenu(anchor) {
        const list = await this.signatures();
        menu(anchor, [...list.map(item => ({ icon: "signature", label: item.name, checked: this.signatureId === item.id, action: () => this.setSignature(item) })),
            { icon: "do_not_disturb_on", label: t("noSignature"), action: () => this.setSignature(null) }, "sep",
            { icon: "settings", label: t("manageSignatures"), action: () => emit("openSettings", "signatures") }], { label: t("signature") });
    }

    async templateMenu(anchor) {
        let list = [];
        try { list = (await get(`/mailboxes/${this.mailboxId}/templates`)).templates.filter(item => item.kind !== "component"); } catch { /* offline */ }
        menu(anchor, [...list.map(item => ({ icon: item.kind === "design" ? "dashboard_customize" : "article", label: item.name, action: () => this.applyTemplate(item.id) })),
            list.length ? "sep" : null, { icon: "bookmark_add", label: t("saveAsTemplate"), action: () => this.saveTemplate() }], { label: t("templates") });
    }

    async applyTemplate(id) {
        try {
            const { template } = await get(`/mailboxes/${this.mailboxId}/templates/${id}`);
            const data = template.data || {};
            if (!this.subject && data.subject) { this.subject = data.subject; this.body.querySelector('input[aria-label="' + t("subject") + '"]').value = data.subject; this.title.textContent = data.subject; }
            if (data.design) { this.design = data.design; this.mode = "designer"; }
            else if (data.mode === "html" || data.mode === "split") { this.sourceHtml = data.html; this.mode = data.mode; }
            else if (data.mode === "plain") { this.text = data.text; this.mode = "plain"; }
            else this.mode = "rich";
            this.mountEditor(data.html || "");
            this.changed();
        } catch (error) { toast(failText(error, "errApplyTemplate"), "error"); }
    }

    async saveTemplate() {
        const name = await promptDialog({ title: t("saveAsTemplate"), label: t("name"), value: this.subject || t("template"), iconName: "bookmark_add" });
        if (!name) return;
        try {
            await post(`/mailboxes/${this.mailboxId}/templates`, { name, kind: this.mode === "designer" ? "design" : "message", data: { subject: this.subject, html: this.currentHtml(false), text: this.plain?.value || "", mode: this.mode, design: this.mode === "designer" ? this.design : null } });
            toast(t("templateSaved"), "success");
        } catch (error) { toast(failText(error, "errCreateTemplate"), "error"); }
    }

    /* ---------------------------------------------------------------- saving */
    payload() {
        const html = this.currentHtml(true);
        return {
            mailboxId: this.mailboxId, draftId: this.draftId || undefined, baseVersion: this.version ?? undefined, from: this.from,
            to: this.recipients.to, cc: this.recipients.cc, bcc: this.recipients.bcc, subject: this.subject, mode: this.mode,
            html: this.mode === "plain" ? "" : html, text: this.mode === "plain" ? (this.plain?.value ?? this.text) : htmlToText(html),
            source: { html: this.mode === "html" || this.mode === "split" ? this.code?.value || this.sourceHtml : this.mode === "rich" ? html : "", design: this.mode === "designer" ? this.design : null },
            priority: this.priority, replyToMessageId: this.replyToMessageId, replyMode: this.replyMode, signatureId: this.signatureId,
            attachments: this.attachments.filter(item => item.status === "done" && item.id).map(item => ({ kind: item.kind === "attachment" || item.id.startsWith("a_") ? "attachment" : "upload", id: item.id, inline: Boolean(item.inline), contentId: item.contentId || null })),
        };
    }

    changed() {
        this.dirty = true;
        this.status.textContent = t("editing");
        this.localSave();
        this.serverSave();
    }

    async saveLocal() {
        if (this.closed || this.discarding) return;
        try { await offline.draftPut(this.localId, { ...this.payload(), unsynced: this.dirty, localId: this.localId, version: this.version }); } catch { /* storage unavailable */ }
    }

    save(manual = false) {
        if (this.closed || this.discarding) return;
        if (this.saving) return this.saving;
        if (this.uploading()) { this.serverSave(); return; }
        if (!this.dirty && !manual) return;
        this.saving = this.saveDraft(manual).finally(() => { this.saving = null; });
        return this.saving;
    }

    async saveDraft(manual) {
        this.status.textContent = t("saving");
        try {
            const result = await post("/drafts", this.payload());
            this.draftId = result.draftId;
            this.version = result.version;
            for (const mapping of result.attachments || []) { const item = this.attachments.find(entry => entry.id === mapping.upload); if (item) { item.id = mapping.id; item.kind = "attachment"; } }
            this.dirty = false;
            this.status.textContent = t("draftSaved");
            this.retryDelay = 0;
            await offline.draftDelete(this.localId);
            emit("countsStale");
        } catch (error) {
            if (this.discarding) return;
            if (error instanceof ApiError && error.code === "draftConflict") await this.resolveConflict(error.data.draft);
            else if (error instanceof ApiError && error.code === "offline") { this.status.textContent = t("savedOnDevice"); await this.saveLocal(); }
            else {
                // Keep a copy on this device, show why the save failed, and retry with backoff (5 s, 10 s, 20 s … up to 2 min).
                await this.saveLocal();
                const reason = error instanceof ApiError ? t("error_" + error.code) : "";
                this.status.textContent = reason ? `${t("draftNotSaved")} ${reason}` : t("draftNotSaved");
                if (manual) toast(failText(error, "draftNotSaved"), "error");
                if (!this.closed && !(error instanceof ApiError && [400, 403, 404, 413].includes(error.status))) {
                    this.retryDelay = Math.min((this.retryDelay || 2500) * 2, 120_000);
                    clearTimeout(this.retryTimer);
                    this.retryTimer = setTimeout(() => { if (!this.closed && this.dirty) this.save(); }, this.retryDelay);
                }
            }
        }
    }

    // The draft changed on another device: keep this version, or switch to the other one.
    async resolveConflict(server) {
        const keepMine = await confirmDialog({ title: t("draftConflictTitle"), message: t("draftConflictMessage", { time: formatDateTime(server.updatedAt) }), confirm: t("keepThisVersion"), iconName: "sync_problem" });
        if (keepMine) { this.version = server.version; await this.save(true); return; }
        this.version = server.version;
        this.subject = server.subject || ""; this.recipients = { to: server.to || [], cc: server.cc || [], bcc: server.bcc || [] };
        this.mode = server.mode || "rich"; this.design = server.source?.design || null; this.sourceHtml = server.source?.html || ""; this.text = server.text || "";
        this.attachments = (server.attachments || []).map(item => ({ key: crypto.randomUUID(), ...item, status: "done", progress: 1 }));
        this.initialHtml = server.html || "";
        this.dirty = false;
        this.render();
        this.loadInlinePreviews();
    }

    async close() {
        if (this.uploading()) { toast(t("waitForUploads")); return; }
        const hasContent = this.subject || this.recipients.to.length || htmlToText(this.currentHtml(false)).trim() || this.attachments.length;
        if (this.dirty && hasContent) await this.save(true);
        else if (!hasContent && !this.draftId) await offline.draftDelete(this.localId);
        this.destroy();
        if (hasContent && this.draftId) toast(t("draftSaved"));
    }

    destroy() {
        this.closed = true;
        clearTimeout(this.retryTimer);
        this.node.remove();
        windows.splice(windows.indexOf(this), 1);
        fitDock(focused);
        if (focused === this) focused = null;
        for (const item of this.attachments) if (item.previewUrl?.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(item.previewUrl), 5000);
    }

    async discard() {
        if (this.discarding || this.closed) return;
        if (!await confirmDialog({ title: t("discardDraft"), message: t("discardDraftMessage"), confirm: t("discard"), danger: true })) return;
        if (this.discarding || this.closed) return;
        this.discarding = true;
        try {
            await this.saving;
            if (this.draftId) await del(`/drafts/${this.draftId}`);
        } catch (error) {
            if (!(error instanceof ApiError && error.code === "mailNotFound")) {
                this.discarding = false;
                toast(failText(error, "errTrash"), "error");
                return;
            }
        }
        for (const item of this.attachments) if (item.status === "uploading") item.abort?.abort();
        for (const item of this.attachments) if (item.id?.startsWith("u_")) del(`/uploads/${item.id}?mailbox=${this.mailboxId}`).catch(() => {});
        await offline.draftDelete(this.localId);
        this.destroy();
        if (this.draftId) emit("removeRows", [this.draftId]);
        emit("countsStale");
        toast(t("draftDiscarded"));
    }

    /* ---------------------------------------------------------------- sending */
    async send(sendAt = null) {
        if (this.discarding) return;
        if (this.uploading()) { toast(t("waitForUploads")); return; }
        if (this.attachments.some(item => item.status === "error")) { toast(t("removeFailedUploads"), "error"); return; }
        const all = [...this.recipients.to, ...this.recipients.cc, ...this.recipients.bcc];
        if (!all.length) { toast(t("addRecipient"), "error"); this.body.querySelector(".mail-recipients input")?.focus(); return; }
        // An empty subject is usually a mistake, and it makes spam filtering more likely.
        if (!String(this.subject || "").trim() && !await confirmDialog({ title: t("noSubjectTitle"), message: t("noSubjectMessage"), confirm: t("sendAnyway"), iconName: "subject" })) return;
        const invalid = all.find(person => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email));
        if (invalid) { toast(t("invalidRecipient", { address: invalid.email }), "error"); return; }
        if (new Set(all.map(person => person.email)).size > state.boot.limits.maxRecipients) { toast(t("tooManyRecipients", { count: state.boot.limits.maxRecipients }), "error"); return; }
        const payload = this.payload();
        if (state.prefs.behavior.attachmentReminder && mentionsAttachment(payload.text) && !this.attachments.some(item => !item.inline)) {
            if (!await confirmDialog({ title: t("forgotAttachmentTitle"), message: t("forgotAttachmentMessage"), confirm: t("sendAnyway"), iconName: "attach_file" })) return;
        }
        if (!this.subject.trim() && !await confirmDialog({ title: t("noSubjectTitle"), message: t("noSubjectMessage"), confirm: t("sendAnyway") })) return;
        const personal = hasVariables(payload.html);
        if (personal && all.length > 1 && !await confirmDialog({ title: t("personalizedTitle"), message: t("personalizedMessage", { count: all.length }), confirm: t("sendIndividually"), iconName: "group" })) return;
        if (this.dirty || !this.draftId) await this.save(true);
        if (!this.draftId) { toast(t("draftNotSaved"), "error"); return; }
        const box = mailboxById(this.mailboxId);
        const undoSeconds = box?.settings?.undoSendSeconds ?? 10;
        const sender = box.senders.find(item => item.address === this.from);
        const values = person => { const [first, ...rest] = (person.name || "").split(" "); return { first_name: first || "", last_name: rest.join(" "), name: person.name || person.email, email: person.email, sender_name: sender?.displayName || this.from, date: formatDateTime(Date.now()).split(",")[0] }; };
        try {
            let result;
            if (personal) {
                for (const person of all) {
                    const html = personalize(payload.html, values(person));
                    result = await post("/send", { ...payload, draftId: undefined, attachments: [], to: [person], cc: [], bcc: [], html, text: htmlToText(html), idempotencyKey: `${this.sendKey}-${person.email}`.slice(0, 64).replace(/[^A-Za-z0-9-]/g, "-"), sendAt: sendAt || undefined, undoSeconds: 0 });
                }
                await del(`/drafts/${this.draftId}`).catch(() => {});
            } else result = await post("/send", { ...this.payload(), draftId: this.draftId, idempotencyKey: this.sendKey, sendAt: sendAt || undefined, undoSeconds });
            await offline.draftDelete(this.localId);
            this.destroy();
            emit("countsStale"); emit("storageStale");
            if (sendAt) toast(t("scheduledFor", { time: formatDateTime(sendAt) }), "success");
            else if (!personal && result.undoSeconds > 0) {
                showUndo(t("sending"), async () => {
                    try { await post(`/outbound/${result.outboundId}/cancel`); editDraft(result.messageId); toast(t("sendCanceled")); }
                    catch { toast(t("alreadySent"), "error"); }
                }, result.undoSeconds);
            } else toast(personal ? t("sentIndividually", { count: all.length }) : t("messageQueued"), "success");
        } catch (error) {
            toast(failText(error, "errSendMessage"), "error");
        }
    }

    async sendTest() {
        const box = mailboxById(this.mailboxId);
        const address = await promptDialog({ title: t("sendTest"), label: t("sendTestTo"), value: box.address, type: "email", iconName: "forward_to_inbox", confirm: t("send") });
        if (!address) return;
        if (this.uploading()) { toast(t("waitForUploads")); return; }
        await this.save(true);
        try {
            const payload = this.payload();
            const html = personalize(payload.html, { first_name: t("sampleFirstName"), last_name: t("sampleLastName"), name: t("sampleName"), email: address, sender_name: this.from, date: formatDateTime(Date.now()) });
            await post("/send", { ...payload, draftId: undefined, attachments: [], to: [{ email: address }], cc: [], bcc: [], subject: `[${t("test")}] ${this.subject}`, html, text: payload.mode === "plain" ? payload.text : htmlToText(html), idempotencyKey: idempotencyKey(), undoSeconds: 0 });
            toast(t("testQueued", { address }), "success");
        } catch (error) { toast(failText(error, "errSendMessage"), "error"); }
    }
}

function normalizePerson(value) {
    if (value && typeof value === "object") return { email: String(value.email || "").trim().toLowerCase(), name: String(value.name || "").trim() };
    const text = String(value || "").trim();
    const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(text);
    return match ? { name: match[1].trim(), email: match[2].trim().toLowerCase() } : { name: "", email: text.toLowerCase() };
}

