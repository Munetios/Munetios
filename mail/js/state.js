// Small observable store shared by the Mail modules.
const listeners = new Map();

export const state = {
    boot: null,              // /bootstrap payload
    accountId: "",
    scope: "all",            // "all" (unified) or a mailbox id
    view: "inbox",           // inbox, starred, ..., f_<id>, label:<id>, search, device
    category: "primary",
    query: "",
    filter: "",
    sort: "date",
    items: [],               // loaded list rows (sparse array, index = position)
    total: 0,
    selection: new Set(),
    anchor: null,
    openId: null,
    tabs: [],                // [{ id, title, pinned }]
    counts: {},
    prefs: null,             // resolved preferences
    online: navigator.onLine,
    storage: {},             // mailboxId -> summary
    deviceMessages: [],      // mail kept only on this device
};

export function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => listeners.get(event).delete(handler);
}

export function emit(event, detail) {
    for (const handler of listeners.get(event) || []) {
        try { handler(detail); } catch (error) { console.error("mail: listener failed", error?.name); }
    }
}

export const mailboxes = () => state.boot?.mailboxes || [];
export const mailboxById = id => mailboxes().find(box => box.id === id);
export const activeMailboxes = () => state.scope === "all" ? mailboxes() : mailboxes().filter(box => box.id === state.scope);
// The mailbox new actions use: the scoped one, or the active account's own mailbox.
export function primaryMailbox() {
    if (state.scope !== "all") return mailboxById(state.scope);
    return mailboxes().find(box => box.accountId === state.accountId) || mailboxes()[0];
}
export const folders = () => state.boot?.folders || [];
export const labels = () => state.boot?.labels || [];
export const labelById = id => labels().find(label => label.id === id);
export const folderById = id => folders().find(folder => folder.id === id);
