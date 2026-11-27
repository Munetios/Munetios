importScripts("/shared/offline-shell.js");

const root = new URL(self.registration.scope).pathname;
const REMINDER_CACHE = "munetios-calendar-reminders-local";
self.installMunetiosOfflineShell({
  cacheName: "munetios-calendar-v9",
  obsolete: (name) => name !== REMINDER_CACHE && (name.startsWith("munetios-calendar") || name === "munetios-cache-v2"),
  required: [
    "./", "calendar.css", "calendar.js", "calendar-i18n.js", "calendar-reminder-client.js",
    "/munetios-ui/munetios-ui-v4.css", "/munetios-ui/munetios-ui-v4.js",
    "/account/account-menu.css", "/account/account-i18n.js", "/account/account-core.js", "/account/account-menu.js", "/shared/test-error.js",
    "/shared/munetios-cloud.css", "/shared/cloud-i18n.js", "/shared/munetios-cloud.js",
  ],
  optional: [
    "site.webmanifest", "favicon-16x16.png", "favicon-32x32.png", "android-chrome-192x192.png",
    "android-chrome-512x512.png", "apple-touch-icon.png", "/fonts/google-sans-flex/munetios-ui-v4-font.ttf",
    "https://api.munetios.com/beautiful-css/beautiful.css",
    "https://api.munetios.com/fonts/material-symbols/MaterialSymbolsRounded-VariableFont_FILL,GRAD,opsz,wght.ttf",
  ],
  documentFor: (path) => [root, root + "index.html"].includes(path) ? "./" : null,
});

const reminderUrl = name => new URL(name, self.registration.scope);
let delivery = Promise.resolve();
const read = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function readSchedule() {
  const open = indexedDB.open("munetios-calendar-v4", 1);
  open.onupgradeneeded = () => open.transaction.abort();
  const db = await read(open).catch(() => null);
  if (!db) return [];
  try {
    const tx = db.transaction(["records", "keys"]);
    const [record, device] = await Promise.all([
      read(tx.objectStore("records").get("notification-schedule")),
      read(tx.objectStore("keys").get("main"))
    ]);
    if (!record || !device?.key) return [];
    const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv }, device.key, record.data);
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally { db.close(); }
}
async function deliverReminders() {
  const schedule = await readSchedule();
  if (!schedule.length) return;
  const cache = await caches.open(REMINDER_CACHE);
  const now = Date.now();
  const seenUrl = reminderUrl("reminders-seen");
  const receipt = await cache.match(seenUrl);
  const seen = Object.fromEntries(Object.entries(await receipt?.json() || {}).filter(([, at]) => at > now - 86400000));
  for (const { key, at, title, body } of schedule) {
    if (at > now || at < now - 900000 || seen[key]) continue;
    const tag = "calendar:" + key;
    if (!(await self.registration.getNotifications({ tag })).length) {
      await self.registration.showNotification(title, { body, tag, icon: reminderUrl("android-chrome-192x192.png").href, renotify: false });
    }
    seen[key] = now;
    await cache.put(seenUrl, new Response(JSON.stringify(seen)));
  }
}

self.addEventListener("push", event => {
  delivery = delivery.catch(() => {}).then(deliverReminders);
  event.waitUntil(delivery);
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = self.registration.scope;
    const scope = new URL(target);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const calendar = windows.find(client => {
      const url = new URL(client.url);
      return url.origin === scope.origin && (url.pathname === scope.pathname ||
        url.pathname === new URL("index.html", scope).pathname);
    });
    if (calendar) await calendar.focus();
    else await self.clients.openWindow(target);
  })());
});
