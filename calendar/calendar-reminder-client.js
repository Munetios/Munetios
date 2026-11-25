(() => {
  "use strict";
  const API = "/api/calendar-reminders";
  const ownerKey = "munetiosCalendar:reminderAccount";

  function create({ account, reminders, writeSchedule, clearSchedule }) {
    const supported = () => "serviceWorker" in navigator && "PushManager" in window &&
      "Notification" in window && "caches" in window;
    let owner;
    try { owner = localStorage.getItem(ownerKey); } catch {}
    let sent = "";
    let saved = "";
    let timer;
    let running = Promise.resolve();
    const active = () => Boolean(owner && owner === account?.state.account?.id && supported() && Notification.permission === "granted");
    const serialize = task => {
      const result = running.then(task);
      running = result.catch(() => {});
      return result;
    };
    async function request(path, body) {
      const response = await fetch(API + path, {
        method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error("calendarRemindersUnavailable");
      return response.json();
    }
    async function registration() {
      const controller = await navigator.serviceWorker.register("sw.js");
      if (controller.active) return controller;
      let timeout;
      try {
        return await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("calendarWorkerUnavailable")), 10000); })
        ]);
      } finally { clearTimeout(timeout); }
    }
    async function subscribe(worker) {
      const { key } = await request("/key");
      const base64 = key.replaceAll("-", "+").replaceAll("_", "/");
      const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), letter => letter.charCodeAt(0));
      return worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    }
    async function publish(subscription, force = false) {
      const list = reminders();
      const times = [...new Set(list.map(item => item.at))];
      const encoded = JSON.stringify(list);
      const timesKey = JSON.stringify({ endpoint: subscription.endpoint, times });
      if (force || encoded !== saved) {
        await writeSchedule(list);
        saved = encoded;
      }
      if (sent !== timesKey || force) {
        await request("/schedule", { endpoint: subscription.endpoint, times });
        sent = timesKey;
      }
    }
    async function unsubscribe() {
      sent = "";
      saved = "";
      if (!supported()) return;
      let storageError;
      try { await clearSchedule(); } catch (error) { storageError = error; }
      const worker = await navigator.serviceWorker.getRegistration(location.href);
      const subscription = await worker?.pushManager.getSubscription();
      if (subscription) {
        try {
          if (owner && owner === account.state.account?.id) {
            await request("/schedule", { endpoint: subscription.endpoint, times: [], disable: true });
          }
        } catch {
          // Unsubscribing still prevents delivery if the server is temporarily unreachable.
        } finally { await subscription.unsubscribe(); }
      }
      if (storageError) throw storageError;
    }
    function setOwner(id) {
      owner = id;
      try { if (id) localStorage.setItem(ownerKey, id); else localStorage.removeItem(ownerKey); } catch {}
    }
    const refresh = () => {
      clearTimeout(timer);
      if (!owner || !account?.state.ready) return;
      timer = setTimeout(() => {
        serialize(async () => {
          if (!active()) {
            await unsubscribe();
            setOwner(null);
            return;
          }
          const worker = await registration();
          let subscription = await worker.pushManager.getSubscription();
          if (!subscription) subscription = await subscribe(worker);
          await publish(subscription);
        }).catch(() => { sent = ""; });
      }, 500);
    };
    return {
      active, supported, refresh,
      delivering: () => active() && Boolean(sent),
      async enable() {
        const accountId = account?.state.account?.id;
        if (!accountId || !supported()) throw new Error("calendarRemindersUnavailable");
        if (await Notification.requestPermission() !== "granted") throw new Error("calendarNotificationsBlocked");
        return serialize(async () => {
          if (account.state.account?.id !== accountId) throw new Error("calendarAccountChanged");
          if (owner && owner !== accountId) await unsubscribe();
          const worker = await registration();
          let subscription = await worker.pushManager.getSubscription();
          if (!subscription) subscription = await subscribe(worker);
          setOwner(accountId);
          try { await publish(subscription, true); }
          catch (error) {
            try { await unsubscribe(); } finally { setOwner(null); }
            throw error;
          }
        });
      },
      disable() {
        return serialize(async () => {
          try { await unsubscribe(); } finally { setOwner(null); }
        });
      }
    };
  }

  window.MunetiosCalendarReminders = { create };
})();
