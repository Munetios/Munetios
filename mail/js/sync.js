// Real-time synchronization: one hibernating WebSocket per signed-in account (Durable Object), change-feed catch-up,
// automatic reconnection with backoff, a polling fallback, offline action replay, and collection of mail that a full
// mailbox kept for this device.
import { get, post, api, ApiError } from "./api.js";
import { state, emit, mailboxes } from "./state.js";
import * as offline from "./offline.js";

const sockets = new Map();
let seq = 0;
let pollTimer = null;
let catchingUp = false;
let pendingCatchUp = false;

export function start(initialSeq) {
    seq = initialSeq || 0;
    const accounts = [...new Set(mailboxes().map(box => box.accountId))];
    for (const accountId of accounts) connect(accountId, 0);
    schedulePoll();
    window.addEventListener("online", () => { setOnline(true); replayQueue(); catchUp(); collectDeviceDeliveries(); for (const id of accounts) if (!sockets.get(id)?.open) connect(id, 0); });
    window.addEventListener("offline", () => setOnline(false));
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") catchUp(); });
    replayQueue();
    collectDeviceDeliveries();
}

function setOnline(online) {
    if (state.online === online) return;
    state.online = online;
    emit("online", online);
}

function connect(accountId, attempt) {
    if (!("WebSocket" in window)) return;
    const url = new URL("/api/mail/v1/live", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("account", accountId);
    let socket;
    try { socket = new WebSocket(url); } catch { return retry(accountId, attempt); }
    const entry = { socket, open: false, ping: null };
    sockets.set(accountId, entry);
    socket.addEventListener("open", () => {
        entry.open = true;
        setOnline(true);
        entry.ping = setInterval(() => { try { socket.send("ping"); } catch { /* closed */ } }, 25_000);
        catchUp();
        schedulePoll();
    });
    socket.addEventListener("message", event => {
        if (event.data === "pong") return;
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === "hello") return;
        handleEvent(data);
    });
    socket.addEventListener("close", () => {
        clearInterval(entry.ping);
        entry.open = false;
        schedulePoll();
        retry(accountId, attempt + 1);
    });
}

function retry(accountId, attempt) {
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6)) + Math.random() * 1000;
    setTimeout(() => { if (navigator.onLine) connect(accountId, attempt); }, delay);
}

// Poll every 30 seconds while any live connection is down (and every 5 minutes as a safety net).
function schedulePoll() {
    clearInterval(pollTimer);
    const live = [...sockets.values()].some(entry => entry.open);
    pollTimer = setInterval(() => { catchUp(); collectDeviceDeliveries(); }, live ? 300_000 : 30_000);
}

function handleEvent(data) {
    if (data.type === "deviceDelivery") { collectDeviceDeliveries(); return; }
    if (data.type === "storage") emit("storageWarning", data);
    if (data.type === "message" && data.unread && data.folder === "inbox") emit("newMail", data);
    if (data.type === "delivery") emit("delivery", data);
    if (data.type === "followup") emit("followup", data);
    if (data.type === "mailboxStatus" || data.type === "mailboxDeleted") emit("reboot");
    catchUp();
}

export async function catchUp() {
    if (catchingUp) { pendingCatchUp = true; return; }
    catchingUp = true;
    try {
        do {
            pendingCatchUp = false;
            const result = await get(`/changes?mailbox=all&since=${seq}`);
            setOnline(true);
            if (result.changes.length) {
                seq = result.seq;
                const kinds = new Set(result.changes.map(change => change.entity));
                const ids = new Set(result.changes.filter(change => change.entity === "message").map(change => change.entityId));
                emit("changes", { kinds, ids, changes: result.changes });
            }
            if (result.more) pendingCatchUp = true;
        } while (pendingCatchUp);
    } catch (error) {
        if (error instanceof ApiError && error.code === "offline") setOnline(false);
    } finally { catchingUp = false; }
}

// Offline actions are replayed in order. Actions the server refuses (for example, the message was deleted on
// another device) are dropped: the server is the source of truth.
let replaying = false;
export async function replayQueue() {
    if (replaying || !navigator.onLine) return;
    replaying = true;
    try {
        for (const { seq: itemSeq, action } of await offline.queued()) {
            if (!action) { await offline.dequeue(itemSeq); continue; }
            try { await api(action.path, { method: action.method, body: action.body }); }
            catch (error) {
                if (error instanceof ApiError && error.code === "offline") break;
            }
            await offline.dequeue(itemSeq);
        }
    } finally { replaying = false; }
    emit("changes", { kinds: new Set(["message"]), ids: new Set(), changes: [] });
}

// Runs an action now, or queues it for later when offline.
export async function perform(path, method, body) {
    try { return await api(path, { method, body }); }
    catch (error) {
        if (error instanceof ApiError && error.code === "offline") {
            await offline.enqueue({ path, method, body });
            setOnline(false);
            return { queued: true };
        }
        throw error;
    }
}

// Mail held because the mailbox was full: save it to this device, then tell the server it can delete its copy.
let collecting = false;
export async function collectDeviceDeliveries() {
    if (collecting || !navigator.onLine) return;
    collecting = true;
    let saved = 0;
    try {
        const { deliveries } = await get("/device-deliveries?mailbox=all");
        for (const delivery of deliveries) {
            const message = await get(`/device-deliveries/${delivery.id}`);
            await offline.deviceSave({ ...message, savedAt: Date.now() });
            await post(`/device-deliveries/${delivery.id}/ack`);
            saved++;
        }
    } catch { /* tried again on the next sync */ }
    finally { collecting = false; }
    state.deviceMessages = await offline.deviceList();
    emit("deviceMessages", { saved });
}
