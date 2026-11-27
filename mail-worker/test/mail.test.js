import assert from "node:assert/strict";
import { test } from "node:test";
import { LocalD1, LocalR2 } from "../src/local/adapters.js";
import { handleApi } from "../src/api.js";
import { deliverInbound } from "../src/inbound.js";
import { runJob } from "../worker.js";
import { processDeliveryEvent, dispatchScheduled } from "../src/outbound.js";
import { buildSearch } from "../src/search.js";
import { sanitizeEmailHtml } from "../src/sanitize.js";
import { checkUrl } from "../src/proxy.js";
import { sanitizeTheme, sanitizePreferences } from "../../mail/js/theme-schema.js";
import { scoreSpam } from "../src/rules.js";
import { parseRaw } from "../src/messages.js";

const ORIGIN = "https://mail.test";
const ACCOUNTS = {
    1: { id: "1", email: "ada@munetios.com", displayName: "Ada" },
    2: { id: "2", email: "grace@munetios.com", displayName: "Grace" },
    3: { id: "3", email: "outside@example.org", displayName: "Outside" },
};

function makeEnv({ quota = 20_000_000_000 } = {}) {
    const db = new LocalD1();
    db.migrate(new URL("../migrations/0001_mail.sql", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    const jobs = [];
    const sent = [];
    const env = {
        MAIL_DB: db, MAIL_STORE: new LocalR2(), MAIL_QUOTA_BYTES: String(quota),
        MAIL_JOBS: { async send(body, options = {}) { jobs.push({ body, options }); } },
        EMAIL: { failures: [], async send(message) { const failure = env.EMAIL.failures.shift(); if (failure) { const error = new Error(failure); error.code = failure; throw error; } sent.push(message); return { messageId: "cf-" + sent.length }; } },
        LEGACY: {
            async hasMailbox(id) { return ["1", "2"].includes(id); }, async aliasFor() { return null; }, async messages() { return []; },
            async addressTaken(address) { return Object.values(ACCOUNTS).some(item => item.email === address); },
            async accountForAddress(address) { return Object.values(ACCOUNTS).find(item => item.email === address && item.id !== "3") || null; },
        },
        resolveSession: async request => {
            const id = request.headers.get("X-Test-Account");
            const others = (request.headers.get("X-Test-Others") || "").split(",").filter(Boolean);
            return id ? { account: ACCOUNTS[id], accounts: others.map(other => ACCOUNTS[other]) } : null;
        },
    };
    return { env, jobs, sent };
}

function client(env, account, others = []) {
    return async (method, path, { body, headers = {}, raw } = {}) => {
        const init = { method, headers: { Origin: ORIGIN, "X-Test-Account": account, "X-Test-Others": others.join(","), ...headers } };
        if (raw !== undefined) { init.body = raw; init.headers["Content-Length"] = String(raw.byteLength); }
        else if (body !== undefined) { init.body = JSON.stringify(body); init.headers["Content-Type"] = "application/json"; }
        const response = await handleApi(new Request(ORIGIN + "/api/mail/v1" + path, init), env, { waitUntil() {} });
        const type = response.headers.get("Content-Type") || "";
        return { status: response.status, headers: response.headers, data: type.includes("json") ? await response.json() : new Uint8Array(await response.arrayBuffer()) };
    };
}

const mime = ({ from = "Sender <sender@example.org>", to = "ada@munetios.com", subject = "Hello", id = "<m1@example.org>", body = "Body text", extra = "" } = {}) =>
    new TextEncoder().encode(`From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: ${id}\r\nDate: Tue, 24 Nov 2026 10:00:00 +0000\r\n` +
        `Authentication-Results: mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass\r\n${extra}Content-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`);

async function deliver(env, raw, to = "ada@munetios.com", from = "sender@example.org") {
    let rejected = null;
    const result = await deliverInbound(env, { from, to, rawSize: raw.byteLength, raw: async () => raw, reject: reason => { rejected = reason; } }, null);
    return { ...result, rejected };
}

async function setup(options) {
    const ctx = makeEnv(options);
    const ada = client(ctx.env, "1");
    const grace = client(ctx.env, "2");
    const a = await ada("GET", "/bootstrap");
    const g = await grace("GET", "/bootstrap");
    return { ...ctx, ada, grace, adaBox: a.data.mailboxes[0], graceBox: g.data.mailboxes[0] };
}

test("bootstrap provisions mailboxes only for entitled accounts and returns the 20 GB quota", async () => {
    const { env, adaBox } = await setup();
    assert.equal(adaBox.address, "ada@munetios.com");
    assert.equal(adaBox.storage.quotaBytes, 20_000_000_000);
    const outside = await client(env, "3")("GET", "/bootstrap");
    assert.equal(outside.data.mailboxes[0].kind, "forwarding");
    assert.match(outside.data.mailboxes[0].address, /^inbox-[a-f0-9]{32}@munetios\.com$/);
    const anonymous = await handleApi(new Request(ORIGIN + "/api/mail/v1/bootstrap", { headers: { Origin: ORIGIN } }), env, {});
    assert.equal(anonymous.status, 401);
});

test("incoming MIME is parsed, stored with attachments and inline images, deduplicated, and isolated per account", async () => {
    const { env, ada, grace, adaBox } = await setup();
    const boundary = "b1";
    const raw = new TextEncoder().encode([
        "From: Lin <lin@example.org>", "To: ada@munetios.com", "Cc: grace@munetios.com", "Subject: =?UTF-8?B?UmVwb3J0IOKckw==?=", "Message-ID: <r1@example.org>",
        "Date: Tue, 24 Nov 2026 10:00:00 +0000", "Authentication-Results: mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass",
        `Content-Type: multipart/mixed; boundary=${boundary}`, "", `--${boundary}`, "Content-Type: text/html; charset=utf-8", "",
        '<p>See <img src="cid:logo1"> and <a href="https://example.org">site</a></p>', `--${boundary}`,
        "Content-Type: image/png; name=logo.png", "Content-Disposition: inline; filename=logo.png", "Content-ID: <logo1>", "Content-Transfer-Encoding: base64", "", "iVBORw0KGgo=",
        `--${boundary}`, "Content-Type: application/pdf; name=report.pdf", "Content-Disposition: attachment; filename=report.pdf", "Content-Transfer-Encoding: base64", "", "JVBERi0xLjQ=",
        `--${boundary}--`, ""].join("\r\n"));
    const first = await deliver(env, raw);
    assert.equal(first.status, "delivered");
    assert.equal((await deliver(env, raw)).status, "duplicate");
    const list = await ada("GET", `/messages?mailbox=${adaBox.id}&view=inbox`);
    assert.equal(list.data.total, 1);
    const item = list.data.messages[0];
    assert.equal(item.subject, "Report ✓");
    assert.equal(item.attachments, 1, "inline images referenced by cid are not counted as attachments");
    const full = await ada("GET", `/messages/${item.id}`);
    assert.match(full.data.message.html, /cid:logo1/);
    assert.equal(full.data.message.auth.dmarc, "pass");
    assert.equal(full.data.message.attachmentList.length, 2);
    const pdf = full.data.message.attachmentList.find(a => a.filename === "report.pdf");
    const download = await ada("GET", `/attachments/${pdf.id}`);
    assert.equal(new TextDecoder().decode(download.data), "%PDF-1.4");
    assert.match(download.headers.get("Content-Disposition"), /^attachment/);
    assert.match(download.headers.get("Cache-Control"), /no-store/);
    // Another account can't read, change, or delete it.
    assert.equal((await grace("GET", `/messages/${item.id}`)).status, 404);
    assert.equal((await grace("GET", `/attachments/${pdf.id}`)).status, 404);
    assert.equal((await grace("POST", "/messages/update", { body: { ids: [item.id], patch: { read: true } } })).status, 404);
    assert.equal((await grace("POST", "/messages/delete", { body: { ids: [item.id] } })).status, 404);
    assert.equal((await grace("GET", `/messages?mailbox=${adaBox.id}`)).status, 404);
    const eml = await ada("GET", `/messages/${item.id}/eml`);
    assert.deepEqual([...eml.data], [...raw], "original MIME is preserved");
});

test("unknown recipients and oversized messages are rejected, never dropped", async () => {
    const { env } = await setup();
    const unknown = await deliver(env, mime({ to: "nobody@munetios.com" }), "nobody@munetios.com");
    assert.equal(unknown.status, "rejected");
    assert.match(unknown.rejected, /5\.1\.1/);
    let reason = "";
    const big = await deliverInbound(env, { from: "a@example.org", to: "ada@munetios.com", rawSize: 26 * 1024 * 1024, raw: async () => new Uint8Array(), reject: value => { reason = value; } }, null);
    assert.equal(big.status, "rejected");
    assert.match(reason, /5.3.4/);
});

test("spoofed internal senders and dangerous attachments are scored as spam deterministically", async () => {
    const spoof = await parseRaw(new TextEncoder().encode("From: Support <support@munetios.com>\r\nTo: ada@munetios.com\r\nSubject: VERIFY YOUR ACCOUNT NOW!!!\r\nAuthentication-Results: mx.cloudflare.net; spf=fail; dmarc=fail\r\n\r\nconfirm your password"));
    const result = scoreSpam(spoof, "x@evil.example");
    assert.equal(result.spam, true);
    assert.ok(result.reasons.includes("spoofedInternalSender"));
    assert.equal(scoreSpam(spoof, "x@evil.example", { allowed: true }).spam, false);
});

test("a full mailbox still receives mail, kept for the owner's device only, and refuses uploads", async () => {
    const { env, ada, grace, adaBox } = await setup({ quota: 4000 });
    assert.equal((await deliver(env, mime({ id: "<a@x>" }))).status, "delivered");
    const used = (await ada("GET", `/storage?mailbox=${adaBox.id}`)).data;
    assert.ok(used.usedBytes > 0 && used.usedBytes < 4000);
    const big = mime({ id: "<b@x>", subject: "Over quota", body: "x".repeat(3000) });
    const held = await deliver(env, big);
    assert.equal(held.status, "heldForDevice");
    assert.equal(held.rejected, null, "the message is accepted, not rejected");
    assert.equal((await deliver(env, big)).status, "duplicate");
    assert.equal((await ada("GET", `/storage?mailbox=${adaBox.id}`)).data.usedBytes, used.usedBytes, "held mail doesn't use quota");
    const pending = (await ada("GET", "/device-deliveries")).data.deliveries;
    assert.equal(pending.length, 1);
    assert.equal(pending[0].subject, "Over quota");
    assert.equal((await grace("GET", `/device-deliveries/${pending[0].id}`)).status, 404, "other accounts can't collect it");
    const payload = (await ada("GET", `/device-deliveries/${pending[0].id}`)).data;
    assert.equal(payload.subject, "Over quota");
    assert.match(payload.text, /^x{100}/);
    assert.equal(atob(payload.raw).includes("Subject: Over quota"), true);
    assert.equal((await ada("POST", `/device-deliveries/${pending[0].id}/ack`, { body: {} })).status, 200);
    assert.equal((await ada("GET", "/device-deliveries")).data.deliveries.length, 0);
    assert.equal((await env.MAIL_STORE.list({ prefix: `m/${adaBox.id}/device/` })).objects.length, 0, "the server copy is deleted after the device saves it");
    const upload = await ada("POST", `/uploads?mailbox=${adaBox.id}`, { raw: new Uint8Array(5000), headers: { "Content-Type": "application/octet-stream", "X-File-Name": "a.bin" } });
    assert.equal(upload.status, 507);
    assert.equal(upload.data.error, "quotaExceeded");
    const list = await ada("GET", `/messages?mailbox=${adaBox.id}&view=inbox`);
    assert.equal(list.status, 200);
    const id = list.data.messages[0].id;
    assert.equal((await ada("GET", `/messages/${id}`)).status, 200);
    assert.equal((await ada("POST", "/messages/delete", { body: { ids: [id] } })).status, 200);
    assert.equal((await ada("GET", `/storage?mailbox=${adaBox.id}`)).data.usedBytes, 0);
});

test("unclaimed device-held mail is never dropped silently: the sender is notified after 30 days", async () => {
    const { env, sent } = await setup({ quota: 1 });
    assert.equal((await deliver(env, mime({ id: "<exp@x>", subject: "Late" }))).status, "heldForDevice");
    await env.MAIL_DB.prepare("UPDATE device_deliveries SET expires_at = 0").run();
    const { expireDeviceDeliveries } = await import("../src/device-delivery.js");
    assert.equal(await expireDeviceDeliveries(env), 1);
    assert.equal(sent.at(-1).to, "sender@example.org");
    assert.match(sent.at(-1).subject, /Undelivered: Late/);
    assert.equal((await env.MAIL_DB.prepare("SELECT COUNT(*) AS n FROM device_deliveries").first()).n, 0);
});

test("concurrent uploads can never exceed the quota", async () => {
    const { ada, adaBox } = await setup({ quota: 10_000 });
    const attempts = await Promise.all(Array.from({ length: 6 }, (_, index) => ada("POST", `/uploads?mailbox=${adaBox.id}`, {
        raw: new Uint8Array(3000).fill(index + 1), headers: { "Content-Type": "application/octet-stream", "X-File-Name": `f${index}.bin` } })));
    const ok = attempts.filter(item => item.status === 201).length;
    assert.equal(ok, 3);
    assert.equal(attempts.filter(item => item.status === 507).length, 3);
    const storage = (await ada("GET", `/storage?mailbox=${adaBox.id}`)).data;
    assert.ok(storage.usedBytes + storage.reservedBytes <= 10_000);
    assert.equal(storage.reservedBytes, 0);
});

test("trash keeps storage; permanent deletion releases it once nothing references the data", async () => {
    const { env, ada, adaBox } = await setup();
    await deliver(env, mime({ id: "<t1@x>" }));
    const id = (await ada("GET", `/messages?mailbox=${adaBox.id}`)).data.messages[0].id;
    const before = (await ada("GET", `/storage?mailbox=${adaBox.id}`)).data.usedBytes;
    await ada("POST", "/messages/update", { body: { ids: [id], patch: { folder: "trash" } } });
    assert.equal((await ada("GET", `/storage?mailbox=${adaBox.id}`)).data.usedBytes, before);
    const restored = await ada("POST", "/messages/update", { body: { ids: [id], patch: { restore: true } } });
    assert.equal(restored.status, 200);
    assert.equal((await ada("GET", `/messages/${id}`)).data.message.folder, "inbox");
    await ada("POST", "/messages/update", { body: { ids: [id], patch: { folder: "trash" } } });
    const emptied = await ada("POST", "/folders/empty", { body: { mailboxId: adaBox.id, folder: "trash" } });
    assert.equal(emptied.data.deleted, 1);
    assert.equal((await ada("GET", `/storage?mailbox=${adaBox.id}`)).data.usedBytes, 0);
    assert.equal((await env.MAIL_DB.prepare("SELECT COUNT(*) AS n FROM blobs").first()).n, 0);
    assert.ok((await env.MAIL_DB.prepare("SELECT COUNT(*) AS n FROM blob_deletions").first()).n >= 2);
});

test("identical attachments are stored and counted once", async () => {
    const { ada, adaBox } = await setup();
    const bytes = new Uint8Array(4096).fill(7);
    const up = () => ada("POST", `/uploads?mailbox=${adaBox.id}`, { raw: bytes, headers: { "Content-Type": "application/octet-stream", "X-File-Name": "same.bin" } });
    await up(); await up();
    const storage = (await ada("GET", `/storage?mailbox=${adaBox.id}`)).data;
    assert.equal(storage.usedBytes, 4096);
});

test("drafts save, sync attachments, detect conflicts, and send through Email Service with undo", async () => {
    const { env, ada, adaBox, jobs, sent } = await setup();
    const upload = (await ada("POST", `/uploads?mailbox=${adaBox.id}`, { raw: new TextEncoder().encode("hello file"), headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent("notes ✓.txt"), "X-File-Type": "text/plain" } })).data;
    const draft = { mailboxId: adaBox.id, from: "ada@munetios.com", to: [{ email: "lin@example.org", name: "Lin" }], bcc: [{ email: "secret@example.org" }],
        subject: "Plan", mode: "rich", html: '<p onclick="x()">Hi <script>alert(1)</script><a href="javascript:bad()">x</a></p>', attachments: [{ kind: "upload", id: upload.id }] };
    const saved = (await ada("POST", "/drafts", { body: draft })).data;
    assert.ok(saved.draftId);
    const loaded = (await ada("GET", `/drafts/${saved.draftId}`)).data.draft;
    assert.equal(loaded.attachments.length, 1);
    assert.equal(loaded.attachments[0].filename, "notes ✓.txt");
    const conflict = await ada("POST", "/drafts", { body: { ...draft, draftId: saved.draftId, baseVersion: saved.version - 1, attachments: loaded.attachments.map(a => ({ kind: "attachment", id: a.id })) } });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.error, "draftConflict");
    const send = await ada("POST", "/send", { body: { ...draft, draftId: saved.draftId, attachments: loaded.attachments.map(a => ({ kind: "attachment", id: a.id })), idempotencyKey: "key-0000000000000001", undoSeconds: 10 } });
    assert.equal(send.status, 202);
    assert.equal(jobs.at(-1).options.delaySeconds, 10);
    // Undo before the delay passes: back to drafts, nothing sent.
    const undo = await ada("POST", `/outbound/${send.data.outboundId}/cancel`, { body: {} });
    assert.equal(undo.status, 200);
    await runJob(jobs.at(-1).body, env);
    assert.equal(sent.length, 0);
    assert.equal((await ada("GET", `/messages/${saved.draftId}`)).data.message.folder, "drafts");
    // Send again (new idempotency key) with no delay.
    const again = await ada("POST", "/send", { body: { ...draft, draftId: saved.draftId, attachments: loaded.attachments.map(a => ({ kind: "attachment", id: a.id })), idempotencyKey: "key-0000000000000002", undoSeconds: 0 } });
    const duplicate = await ada("POST", "/send", { body: { ...draft, draftId: saved.draftId, idempotencyKey: "key-0000000000000002", undoSeconds: 0 } });
    assert.equal(duplicate.data.duplicate, true);
    await runJob(jobs.at(-1).body, env);
    await runJob(jobs.at(-1).body, env); // a second delivery attempt of the same job must not send twice
    assert.equal(sent.length, 1);
    const message = sent[0];
    assert.deepEqual(message.from, { email: "ada@munetios.com", name: "Ada" });
    assert.deepEqual(message.to, [{ email: "lin@example.org", name: "Lin" }]);
    assert.deepEqual(message.bcc, ["secret@example.org"]);
    assert.ok(!JSON.stringify(message.headers || {}).toLowerCase().includes("bcc"));
    assert.doesNotMatch(message.html, /script|onclick|javascript:/i);
    assert.equal(message.attachments[0].filename, "notes ✓.txt");
    const after = (await ada("GET", `/messages/${again.data.messageId}`)).data.message;
    assert.equal(after.folder, "sent");
    assert.equal(after.deliveryStatus, "sent");
    assert.deepEqual(after.bcc.map(b => b.email), ["secret@example.org"], "the sender still sees their own Bcc list");
    // Contacts learn recipients for autocomplete.
    const suggest = await ada("GET", `/recipients?mailbox=${adaBox.id}&q=lin`);
    assert.equal(suggest.data.suggestions[0].email, "lin@example.org");
});

test("sender ownership and recipient limits are enforced", async () => {
    const { ada, adaBox } = await setup();
    const base = { mailboxId: adaBox.id, subject: "x", html: "<p>x</p>", idempotencyKey: "key-1111111111111111" };
    assert.equal((await ada("POST", "/send", { body: { ...base, from: "grace@munetios.com", to: [{ email: "a@example.org" }] } })).data.error, "senderNotAllowed");
    const many = Array.from({ length: 51 }, (_, i) => ({ email: `p${i}@example.org` }));
    assert.equal((await ada("POST", "/send", { body: { ...base, idempotencyKey: "key-2222222222222222", from: "ada@munetios.com", to: many } })).data.error, "tooManyRecipients");
});

test("transient delivery errors retry with backoff; permanent errors fail and are reported", async () => {
    const { env, ada, adaBox, jobs, sent } = await setup();
    env.EMAIL.failures.push("E_RATE_LIMIT_EXCEEDED");
    const send = await ada("POST", "/send", { body: { mailboxId: adaBox.id, from: "ada@munetios.com", to: [{ email: "x@example.org" }], subject: "R", html: "<p>r</p>", idempotencyKey: "key-3333333333333333", undoSeconds: 0 } });
    const first = await runJob(jobs.at(-1).body, env);
    assert.ok(first.retryDelaySeconds >= 30);
    assert.equal((await ada("GET", `/messages/${send.data.messageId}`)).data.message.deliveryStatus, "retrying");
    await env.MAIL_DB.prepare("UPDATE outbound SET send_at = 0").run();
    await runJob(jobs.at(-1).body, env);
    assert.equal(sent.length, 1);
    env.EMAIL.failures.push("E_RECIPIENT_SUPPRESSED");
    const bad = await ada("POST", "/send", { body: { mailboxId: adaBox.id, from: "ada@munetios.com", to: [{ email: "y@example.org" }], subject: "S", html: "<p>s</p>", idempotencyKey: "key-4444444444444444", undoSeconds: 0 } });
    const result = await runJob(jobs.at(-1).body, env);
    assert.equal(result.retryDelaySeconds, undefined);
    const failed = (await ada("GET", `/messages/${bad.data.messageId}`)).data.message;
    assert.equal(failed.deliveryStatus, "failed");
    assert.equal(failed.delivery.recipients[0].status, "failed");
    assert.equal((await ada("POST", `/outbound/${bad.data.outboundId}/retry`, { body: {} })).status, 200);
});

test("scheduled messages are dispatched by cron only when due", async () => {
    const { env, ada, adaBox, jobs } = await setup();
    const at = Date.now() + 3_600_000;
    const send = await ada("POST", "/send", { body: { mailboxId: adaBox.id, from: "ada@munetios.com", to: [{ email: "x@example.org" }], subject: "Later", html: "<p>l</p>", idempotencyKey: "key-5555555555555555", sendAt: at } });
    assert.equal(send.data.state, "scheduled");
    assert.equal((await ada("GET", `/messages/${send.data.messageId}`)).data.message.folder, "scheduled");
    const queued = jobs.length;
    await dispatchScheduled(env);
    assert.equal(jobs.length, queued);
    await env.MAIL_DB.prepare("UPDATE outbound SET send_at = ?").bind(Date.now() - 1000).run();
    await dispatchScheduled(env);
    assert.equal(jobs.at(-1).body.type, "send");
    assert.equal((await ada("GET", `/messages/${send.data.messageId}`)).data.message.folder, "outbox");
});

test("delivery events update recipient status and bounces leave a notice", async () => {
    const { env, ada, adaBox, jobs } = await setup();
    const send = await ada("POST", "/send", { body: { mailboxId: adaBox.id, from: "ada@munetios.com", to: [{ email: "a@example.org" }, { email: "b@example.org" }], subject: "Status", html: "<p>s</p>", idempotencyKey: "key-6666666666666666", undoSeconds: 0 } });
    await runJob(jobs.at(-1).body, env);
    const event = (recipient, status, extra = {}) => ({ type: `cf.email.sending.message.${status}`, payload: { messageId: "cf-1", recipient, terminal: true, delivery: { status }, ...extra } });
    await processDeliveryEvent(env, event("a@example.org", "delivered"));
    await processDeliveryEvent(env, event("b@example.org", "bounced", { bounce: { type: "hard", reason: "550 5.1.1 user unknown" } }));
    const message = (await ada("GET", `/messages/${send.data.messageId}`)).data.message;
    assert.equal(message.deliveryStatus, "partial");
    assert.deepEqual(message.delivery.recipients.map(r => r.status).sort(), ["bounced", "delivered"]);
    const inbox = await ada("GET", `/messages?mailbox=${adaBox.id}&view=search&q=${encodeURIComponent("subject:\"Delivery failed\"")}`);
    assert.equal(inbox.data.total, 1);
});

test("search operators become parameterized SQL and find the right messages", async () => {
    const { env, ada, adaBox } = await setup();
    await deliver(env, mime({ id: "<s1@x>", subject: "Quarterly budget", body: "numbers inside", from: "Bo <bo@finance.example>" }));
    await deliver(env, mime({ id: "<s2@x>", subject: "Lunch", body: "tacos", from: "Cy <cy@food.example>" }));
    const q = async query => (await ada("GET", `/messages?mailbox=${adaBox.id}&view=search&q=${encodeURIComponent(query)}`)).data.messages.map(m => m.subject);
    assert.deepEqual(await q("from:bo"), ["Quarterly budget"]);
    assert.deepEqual(await q("subject:lunch"), ["Lunch"]);
    assert.deepEqual(await q("numbers"), ["Quarterly budget"]);
    assert.deepEqual(await q("-tacos is:unread"), ["Quarterly budget"]);
    assert.deepEqual(await q("larger:10M"), []);
    assert.deepEqual(await q("after:2026/11/01 before:2026/12/01 in:inbox").then(list => list.length), 2);
    const injection = buildSearch(`from:"x' OR 1=1 --" subject:%`);
    assert.ok(injection.params.includes("%x' OR 1=1 --%"));
    assert.ok(!injection.where.join(" ").includes("1=1"));
    const history = await ada("GET", "/search/history");
    assert.ok(history.data.history.some(item => item.query === "from:bo"));
});

test("the delivery sanitizer removes scripts, handlers, unsafe URLs, forms, and frames", () => {
    const dirty = '<div style="background:url(javascript:alert(1));color:red" onmouseover="x">ok<script>evil()</script><img src=x onerror=alert(1)>' +
        '<a href="  javascript:alert(1)">a</a><a href="https://ok.example">b</a><form action="https://x"><input name=p></form><iframe src="https://x"></iframe>' +
        '<svg><script>1</script></svg><style>@import url(https://x);body{background:url("https://img.example/a.png")}</style><meta http-equiv="refresh" content="0;url=https://x"></div>';
    const clean = sanitizeEmailHtml(dirty);
    assert.doesNotMatch(clean, /script|onerror|onmouseover|javascript:|<form|<input|<iframe|<svg|@import|http-equiv/i);
    assert.match(clean, /href="https:\/\/ok\.example" rel="noopener noreferrer"/);
    assert.match(clean, /color:red/);
    assert.match(clean, /url\("https:\/\/img\.example\/a\.png"\)/);
});

test("the remote content proxy refuses private, local, and non-HTTPS addresses", () => {
    for (const url of ["http://example.com/a.png", "https://127.0.0.1/a.png", "https://10.0.0.5/x", "https://169.254.169.254/latest", "https://localhost/x", "https://[::1]/x",
        "https://printer.local/x", "https://user:pass@example.com/x", "https://example.com:8443/x", "https://2130706433/x", "file:///etc/passwd", "https://intranet/x"]) {
        assert.throws(() => checkUrl(url), /invalidUrl/, url);
    }
    assert.equal(checkUrl("https://images.example.com/a.png").hostname, "images.example.com");
});

test("imported themes keep only typed values and cannot carry CSS or scripts", () => {
    const theme = sanitizeTheme({ name: "Night<script>", data: {
        appearance: { accent: "red;}body{display:none", glass: { blur: 99, alpha: 0.9 }, background: { image: "https://evil/x.png" } },
        typography: { uiFont: "Arial;}*{x:y", features: '"ss01" 1, "liga" 0', size: 20 }, layout: { density: "spacious" }, behavior: { notifications: true }, extra: "<style>",
    } });
    assert.equal(theme.data.appearance.accent, undefined);
    assert.equal(theme.data.appearance.glass.blur, 3);
    assert.equal(theme.data.appearance.glass.alpha, 0.5);
    assert.equal(theme.data.appearance.background, undefined);
    assert.equal(theme.data.typography.uiFont, undefined);
    assert.equal(theme.data.typography.features, '"ss01" 1, "liga" 0');
    assert.equal(theme.data.behavior, undefined, "themes contain only appearance, typography, and layout");
    assert.equal(theme.data.extra, undefined);
    assert.equal(sanitizePreferences({ behavior: { shortcuts: { compose: "<x>" } } }).behavior.shortcuts.compose, "c");
});

test("preferences and themes persist per account with conflict detection", async () => {
    const { ada, grace } = await setup();
    const saved = await ada("PUT", "/preferences", { body: { data: { appearance: { accent: "#22c55e" }, layout: { density: "compact" } } } });
    assert.equal(saved.data.data.appearance.accent, "#22c55e");
    assert.equal((await ada("PUT", "/preferences", { body: { data: {}, baseVersion: 0 } })).status, 409);
    assert.equal((await grace("GET", "/preferences")).data.data.appearance, undefined);
    const theme = await ada("POST", "/themes", { body: { name: "Forest", data: { appearance: { accent: "#228b22" } } } });
    assert.equal((await ada("GET", "/themes")).data.themes[0].name, "Forest");
    assert.equal((await grace("DELETE", `/themes/${theme.data.id}`)).status, 404);
});

test("mutating requests from another origin are refused (CSRF)", async () => {
    const { env, adaBox } = await setup();
    const response = await handleApi(new Request(ORIGIN + "/api/mail/v1/messages/delete", {
        method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json", "X-Test-Account": "1" }, body: JSON.stringify({ ids: [] }) }), env, {});
    assert.equal(response.status, 403);
    const noOrigin = await handleApi(new Request(ORIGIN + `/api/mail/v1/folders/empty`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Test-Account": "1" }, body: JSON.stringify({ mailboxId: adaBox.id, folder: "trash" }) }), env, {});
    assert.equal(noOrigin.status, 403);
});

test("unified inbox includes every signed-in account and nothing else", async () => {
    const { env, adaBox, graceBox } = await setup();
    await deliver(env, mime({ id: "<u1@x>", to: "ada@munetios.com" }));
    await deliver(env, mime({ id: "<u2@x>", to: "grace@munetios.com" }), "grace@munetios.com");
    const both = client(env, "1", ["2"]);
    const all = await both("GET", "/messages?mailbox=all&view=inbox");
    assert.deepEqual(new Set(all.data.messages.map(m => m.mailboxId)), new Set([adaBox.id, graceBox.id]));
    const one = await client(env, "1")("GET", "/messages?mailbox=all&view=inbox");
    assert.deepEqual(one.data.messages.map(m => m.mailboxId), [adaBox.id]);
});

test("labels, folders, filters, and snooze organize mail deterministically", async () => {
    const { env, ada, adaBox } = await setup();
    const label = (await ada("POST", "/labels", { body: { mailboxId: adaBox.id, name: "Finance", color: "#22c55e" } })).data;
    const parent = (await ada("POST", "/folders", { body: { mailboxId: adaBox.id, name: "Work" } })).data;
    const child = (await ada("POST", "/folders", { body: { mailboxId: adaBox.id, name: "Reports", parentId: parent.id } })).data;
    assert.equal((await ada("PUT", `/folders/${parent.id}`, { body: { parentId: child.id } })).status, 400, "folder cycles are refused");
    await ada("POST", `/mailboxes/${adaBox.id}/filters`, { body: { name: "Invoices", conditions: [{ field: "subject", op: "contains", value: "invoice" }], actions: [{ type: "label", value: label.id }, { type: "move", value: child.id }, { type: "star" }] } });
    await deliver(env, mime({ id: "<f1@x>", subject: "Your invoice 42" }));
    const inFolder = await ada("GET", `/messages?mailbox=${adaBox.id}&view=${child.id}`);
    assert.equal(inFolder.data.total, 1);
    const message = inFolder.data.messages[0];
    assert.deepEqual(message.labels, [label.id]);
    assert.equal(message.starred, true);
    await ada("POST", "/messages/update", { body: { ids: [message.id], patch: { snoozeUntil: Date.now() + 60_000 } } });
    assert.equal((await ada("GET", `/messages?mailbox=${adaBox.id}&view=snoozed`)).data.total, 1);
    await ada("DELETE", `/folders/${parent.id}`);
    assert.equal((await ada("GET", `/messages/${message.id}`)).data.message.folder, "inbox", "messages in deleted folders move to the inbox");
});

test("mailbox export builds an mbox in R2", async () => {
    const { env, ada, adaBox, jobs } = await setup();
    await deliver(env, mime({ id: "<e1@x>", body: "From the start of a line" }));
    const started = await ada("POST", `/mailboxes/${adaBox.id}/exports`, { body: {} });
    await runJob(jobs.at(-1).body, env);
    const list = (await ada("GET", `/mailboxes/${adaBox.id}/exports`)).data.exports;
    assert.equal(list[0].state, "ready");
    const file = await ada("GET", `/mailboxes/${adaBox.id}/exports/${started.data.id}?download=1`);
    const text = new TextDecoder().decode(file.data);
    assert.match(text, /^From sender@example\.org /);
    assert.match(text, /Subject: Hello/);
});

test("aliases follow reservation rules and can send", async () => {
    const { ada, adaBox } = await setup();
    assert.equal((await ada("POST", `/mailboxes/${adaBox.id}/aliases`, { body: { address: "postmaster@munetios.com" } })).status, 409);
    assert.equal((await ada("POST", `/mailboxes/${adaBox.id}/aliases`, { body: { address: "grace@munetios.com" } })).status, 409);
    assert.equal((await ada("POST", `/mailboxes/${adaBox.id}/aliases`, { body: { address: "ada.projects@munetios.com", displayName: "Ada Projects" } })).status, 201);
    const boot = await ada("GET", "/bootstrap");
    assert.ok(boot.data.mailboxes[0].senders.some(sender => sender.address === "ada.projects@munetios.com"));
});
