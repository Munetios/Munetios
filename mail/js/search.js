// Search bar with operator suggestions and history, the advanced search dialog, and saved searches.
import { state, emit, mailboxes, primaryMailbox, labels, folders } from "./state.js";
import { get, post, del } from "./api.js";
import { t } from "./i18n.js";
import { el, icon, dialog, button, field, select, toast, promptDialog, dateField, stepper, check } from "./ui.js";

const OPERATORS = ["from:", "to:", "cc:", "subject:", "has:attachment", "filename:", "filetype:", "is:unread", "is:starred", "is:important", "before:", "after:", "larger:", "smaller:", "label:", "folder:", "in:"];
let run = () => {};
let active = -1;
const input = () => document.getElementById("searchInput");
const box = () => document.getElementById("searchSuggestions");

export function init(options) {
    run = options.run;
    const node = input();
    node.addEventListener("keydown", event => {
        const items = [...box().querySelectorAll(".mu-menu-item")];
        if (event.key === "ArrowDown" && items.length) { event.preventDefault(); setActive(Math.min(items.length - 1, active + 1)); }
        else if (event.key === "ArrowUp" && items.length) { event.preventDefault(); setActive(Math.max(-1, active - 1)); }
        else if (event.key === "Enter") { event.preventDefault(); if (active >= 0 && items[active]) items[active].click(); else submit(node.value); }
        else if (event.key === "Escape") { hide(); if (!node.value) node.blur(); }
    });
    node.addEventListener("input", () => suggest(node.value));
    node.addEventListener("focus", () => suggest(node.value));
    node.addEventListener("blur", () => setTimeout(hide, 150));
    node.addEventListener("search", () => { if (!node.value && state.view === "search") run(""); });
    document.getElementById("advancedSearchButton").addEventListener("click", advanced);
}

export const focus = () => input().focus();
export function setValue(value) { input().value = value; }
function submit(value) { hide(); run(value); }

function setActive(index) {
    active = index;
    box().querySelectorAll(".mu-menu-item").forEach((item, i) => { item.classList.toggle("is-active", i === index); if (i === index) input().setAttribute("aria-activedescendant", item.id); });
}

function hide() { box().hidden = true; active = -1; input().setAttribute("aria-expanded", "false"); input().removeAttribute("aria-activedescendant"); }

async function suggest(value) {
    const items = [];
    const last = value.split(/\s+/).pop() || "";
    if (last && !last.includes(":")) for (const op of OPERATORS.filter(op => op.startsWith(last.toLowerCase()) && op !== last)) items.push({ icon: "data_object", label: op, hint: t("op_" + op.replace(/:/g, "")), value: value.slice(0, value.length - last.length) + op });
    if (!value) for (const op of OPERATORS.slice(0, 8)) items.push({ icon: "data_object", label: op, hint: t("op_" + op.replace(/:/g, "")), value: op });
    if (state.prefs?.behavior?.searchHistory !== false) {
        try {
            const { history } = await get("/search/history");
            for (const item of history.filter(entry => !value || entry.query.toLowerCase().includes(value.toLowerCase())).slice(0, 6)) items.unshift({ icon: "history", label: item.query, value: item.query, run: true });
        } catch { /* offline */ }
    }
    if (value.trim()) items.unshift({ icon: "search", label: t("searchFor", { query: value.trim() }), value: value.trim(), run: true });
    const node = box();
    if (!items.length) return hide();
    node.replaceChildren(...items.map((item, index) => {
        const entry = el("button", { type: "button", class: "mu-menu-item", role: "option", id: "searchOption" + index }, icon(item.icon), el("span", { text: item.label }), item.hint ? el("small", { text: item.hint }) : null);
        entry.addEventListener("mousedown", event => event.preventDefault());
        entry.addEventListener("click", () => {
            if (item.run) submit(item.value);
            else { input().value = item.value; input().focus(); suggest(item.value); }
        });
        return entry;
    }));
    if (state.prefs?.behavior?.searchHistory !== false) {
        const clear = el("button", { type: "button", class: "mu-menu-item" }, icon("delete_sweep"), el("span", { text: t("clearSearchHistory") }));
        clear.addEventListener("mousedown", event => event.preventDefault());
        clear.addEventListener("click", async () => { await del("/search/history").catch(() => {}); suggest(input().value); });
        node.append(el("div", { class: "mu-menu-sep" }), clear);
    }
    const rect = input().closest(".mail-command").getBoundingClientRect();
    node.style.left = rect.left + "px";
    node.style.top = rect.bottom + 6 + "px";
    node.style.width = rect.width + "px";
    node.hidden = false;
    input().setAttribute("aria-expanded", "true");
    active = -1;
}

const quote = value => /\s/.test(value) ? `"${value.replace(/"/g, "")}"` : value;

function advanced() {
    const fields = {};
    const text = key => (fields[key] = el("input", { class: "mu-input" }));
    const date = key => { fields[key] = { value: "" }; return dateField(t(key), "", value => { fields[key].value = value; }); };
    let size = { op: "larger", value: "", unit: "M" };
    let status = "", folder = "", label = "", attach = false;
    const scopeBoxes = state.scope === "all" ? mailboxes().map(item => item.id) : [state.scope];
    const content = [
        el("div", { class: "mail-inline-form" }, field(t("from"), text("from")), field(t("to"), text("to"))),
        el("div", { class: "mail-inline-form" }, field(t("subject"), text("subject")), field(t("hasWords"), text("words"))),
        el("div", { class: "mail-inline-form" }, field(t("doesntHave"), text("without")), field(t("attachmentName"), text("filename"))),
        el("div", { class: "mail-inline-form" }, field(t("after"), date("after")), field(t("before"), date("before"))),
        el("div", { class: "mail-inline-form" },
            field(t("size"), select(t("size"), [{ value: "larger", label: t("largerThan") }, { value: "smaller", label: t("smallerThan") }], "larger", value => { size.op = value; })),
            field(t("amount"), (() => { const node = stepper(t("amount"), 0, { min: 0, max: 100000, step: 1 }); fields.size = node.input; return node; })()),
            field(t("unit"), select(t("unit"), [{ value: "K", label: "KB" }, { value: "M", label: "MB" }, { value: "G", label: "GB" }], "M", value => { size.unit = value; }))),
        el("div", { class: "mail-inline-form" },
            field(t("status"), select(t("status"), [{ value: "", label: t("any") }, { value: "is:unread", label: t("unread") }, { value: "is:starred", label: t("starred") }, { value: "is:important", label: t("important") }], "", value => { status = value; })),
            field(t("searchIn"), select(t("searchIn"), [{ value: "", label: t("allMailNoSpam") }, { value: "anywhere", label: t("anywhere") }, ...["inbox", "sent", "drafts", "archive", "spam", "trash"].map(value => ({ value, label: t(value) })),
                ...folders().filter(item => scopeBoxes.includes(item.mailboxId)).map(item => ({ value: item.name, label: item.name }))], "", value => { folder = value; })),
            field(t("label"), select(t("label"), [{ value: "", label: t("any") }, ...labels().filter(item => scopeBoxes.includes(item.mailboxId)).map(item => ({ value: item.name, label: item.name }))], "", value => { label = value; }))),
        check(t("hasAttachment"), false, value => { attach = value; }),
    ];
    const build = () => {
        const parts = [];
        if (fields.from.value.trim()) parts.push("from:" + quote(fields.from.value.trim()));
        if (fields.to.value.trim()) parts.push("to:" + quote(fields.to.value.trim()));
        if (fields.subject.value.trim()) parts.push("subject:" + quote(fields.subject.value.trim()));
        if (fields.words.value.trim()) parts.push(fields.words.value.trim());
        for (const word of fields.without.value.trim().split(/\s+/).filter(Boolean)) parts.push("-" + word);
        if (fields.filename.value.trim()) parts.push("filename:" + quote(fields.filename.value.trim()));
        if (fields.after.value) parts.push("after:" + fields.after.value);
        if (fields.before.value) parts.push("before:" + fields.before.value);
        if (Number(fields.size.value) > 0) parts.push(`${size.op}:${fields.size.value}${size.unit}`);
        if (status) parts.push(status);
        if (folder) parts.push("in:" + quote(folder));
        if (label) parts.push("label:" + quote(label));
        if (attach) parts.push("has:attachment");
        return parts.join(" ");
    };
    const d = dialog({ title: t("advancedSearch"), iconName: "manage_search", size: "mu-dialog-lg", content, actions: [
        button(t("saveSearch"), () => { const query = build(); if (query) saveCurrent(query); }),
        button(t("cancel"), () => d.close()),
        button(t("search"), () => { const query = build(); d.close(); if (query) { setValue(query); run(query); } }, { primary: true }),
    ] });
}

export async function saveCurrent(query) {
    const name = await promptDialog({ title: t("saveSearch"), label: t("name"), value: query.slice(0, 60), iconName: "bookmark_add" });
    if (!name) return;
    const box = state.scope === "all" ? primaryMailbox() : mailboxes().find(item => item.id === state.scope);
    try {
        await post(`/mailboxes/${box.id}/searches`, { name, query, smart: true });
        toast(t("searchSaved"), "success");
        emit("refreshBoot");
    } catch { toast(t("actionFailed"), "error"); }
}
