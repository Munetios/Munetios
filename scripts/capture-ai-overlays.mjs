import { writeFileSync } from "node:fs";

const endpoint = "http://127.0.0.1:9223/json/list";
let targets = [];
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    targets = await fetch(endpoint).then((response) => response.json());
    if (targets.length) break;
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));
}
const target = targets.find((item) => item.type === "page");
if (!target) throw new Error("Chrome page target unavailable");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const payload = JSON.parse(event.data);
  const waiter = pending.get(payload.id);
  if (!waiter) return;
  pending.delete(payload.id);
  if (payload.error) waiter.reject(new Error(payload.error.message));
  else waiter.resolve(payload.result);
});
function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { reject, resolve }));
}
async function evaluate(expression) {
  return send("Runtime.evaluate", { awaitPromise: true, expression, returnByValue: true });
}
async function screenshot(path) {
  const result = await send("Page.captureScreenshot", { captureBeyondViewport: false, format: "png" });
  writeFileSync(path, Buffer.from(result.data, "base64"));
}
await send("Page.enable");
await send("Runtime.enable");
await new Promise((resolve) => setTimeout(resolve, 2500));
await evaluate(`document.querySelector('.sidebar-profile-trigger')?.click()`);
await new Promise((resolve) => setTimeout(resolve, 300));
await evaluate(`Array.from(document.querySelectorAll('.requested-profile-menu button')).find((button) => button.querySelector('icon')?.textContent.trim() === 'settings')?.click()`);
await new Promise((resolve) => setTimeout(resolve, 500));
await screenshot("ai-live-settings.png");
await evaluate(`document.querySelector('.ai-modal-header button')?.click()`);
await send("Browser.setPermission", {
  origin: "http://127.0.0.1:3000",
  permission: { name: "microphone" },
  setting: "denied",
});
await evaluate(`document.querySelector('.prompt-container-right .btn-circleoutline')?.click()`);
await new Promise((resolve) => setTimeout(resolve, 1000));
await screenshot("ai-live-microphone-denied.png");
socket.close();
