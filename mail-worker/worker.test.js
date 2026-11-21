import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "./worker.js";

const secret = "worker-test-secret";
const request = (path, body, authorization = secret) => new Request("https://mail.example" + path, {
  method: "POST",
  headers: { Authorization: "Bearer " + authorization, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

test("the bridge authenticates requests and sends verification and mailbox messages", async () => {
  const messages = [];
  const env = { MAIL_BRIDGE_SECRET: secret, MAIL_VERIFICATION_FROM: "verify@munetios.com", EMAIL: { async send(message) { messages.push(message); return { messageId: "fixture" }; } } };
  const data = { recipient: "person@example.org", code: "038152" };
  assert.equal((await worker.fetch(request("/verification", data, "wrong"), env)).status, 401);
  assert.equal((await worker.fetch(request("/verification", { ...data, recipient: "owner@munetios.com" }), env)).status, 400);
  const result = await worker.fetch(request("/verification", data), env);
  assert.deepEqual(await result.json(), { ok: true, id: "fixture" });
  assert.equal(messages[0].to, data.recipient);
  assert.deepEqual(messages[0].from, { email: "verify@munetios.com", name: "Munetios" });
  assert.match(messages[0].text, /038152/);
  assert.match(messages[0].html, /038152/);
  assert.doesNotMatch(messages[0].html, /<script\b/i);
  assert.equal((await worker.fetch(request("/send", { sender: data.recipient, recipient: data.recipient, subject: "Test", body: "Hello" }), env)).status, 400);
  assert.equal((await worker.fetch(request("/send", { sender: "owner@munetios.com", recipient: data.recipient, subject: "Test", body: "Hello" }), env)).status, 200);
  assert.equal(messages[1].from, "owner@munetios.com");
  const reset = await worker.fetch(request("/password-reset", { ...data, token: "a".repeat(64) }), { ...env, MAIL_APP_ORIGIN: "https://app.example" });
  assert.equal(reset.status, 200);
  assert.match(messages[2].text, /https:\/\/app\.example\/signin\/#reset=[a-f0-9]{64}/);
  assert.match(messages[2].html, /Reset password<\/a>/);
});

test("incoming MIME is delivered to the authenticated bridge with a stable message key", async t => {
  const attempts = [];
  t.mock.method(globalThis, "fetch", async (url, request) => {
    attempts.push({ url: String(url), redirect: request.redirect, authorization: request.headers.Authorization, data: JSON.parse(request.body) });
    return Response.json({ ok: true });
  });
  const envelope = "From: Student <student@example.org>\r\nTo: owner@munetios.com\r\nSubject: Hello\r\nContent-Type: text/plain\r\n\r\nMessage body";
  const makeMessage = () => ({
    to: "owner@munetios.com", from: "student@example.org", rawSize: envelope.length,
    raw: new Blob([envelope]).stream(), setReject(reason) { assert.fail(reason); },
  });
  const env = { MAIL_APP_ORIGIN: "https://app.example", MAIL_BRIDGE_SECRET: secret };
  await worker.email(makeMessage(), env);
  await worker.email(makeMessage(), env);
  assert.equal(attempts[0].url, "https://app.example/api/mail/inbound");
  assert.equal(attempts[0].redirect, "manual");
  assert.equal(attempts[0].authorization, "Bearer " + secret);
  assert.equal(attempts[0].data.recipient, "owner@munetios.com");
  assert.equal(attempts[0].data.subject, "Hello");
  assert.match(attempts[0].data.body, /Message body/);
  assert.match(attempts[0].data.key, /^[a-f0-9]{64}$/);
  assert.equal(attempts[0].data.key, attempts[1].data.key);
});
