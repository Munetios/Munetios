"use client";

import { useEffect, useState } from "react";

const APP_SCOPE = "/apps/tasks";
const CACHE_PREFIX = "munetios-tasks-";
const SERVICE_WORKER_PATH = "/tasks-sw.js";

function isTasksServiceWorker(registration) {
  const worker =
    registration.active || registration.waiting || registration.installing;

  if (!worker) return false;

  try {
    const scriptUrl = new URL(worker.scriptURL);
    return (
      scriptUrl.origin === window.location.origin &&
      scriptUrl.pathname === SERVICE_WORKER_PATH
    );
  } catch {
    return false;
  }
}

async function deleteTasksCaches() {
  if (!("caches" in window)) return;

  const cacheNames = await window.caches.keys();
  await Promise.all(
    cacheNames
      .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX))
      .map((cacheName) => window.caches.delete(cacheName)),
  );
}

async function removeObsoleteRegistrations({ removeCurrent = false } = {}) {
  const registrations = await navigator.serviceWorker.getRegistrations();
  const expectedScope = new URL(APP_SCOPE, window.location.origin).href;
  const obsoleteRegistrations = registrations.filter(
    (registration) =>
      isTasksServiceWorker(registration) &&
      (removeCurrent || registration.scope !== expectedScope),
  );

  await Promise.all(
    obsoleteRegistrations.map((registration) => registration.unregister()),
  );
}

export default function TasksPwaRegistration({ copy }) {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const updateConnectivity = () => setOnline(navigator.onLine);
    updateConnectivity();
    window.addEventListener("online", updateConnectivity);
    window.addEventListener("offline", updateConnectivity);

    const registerServiceWorker = async () => {
      if (!("serviceWorker" in navigator)) return;

      try {
        if (process.env.NODE_ENV !== "production") {
          await removeObsoleteRegistrations({ removeCurrent: true });
          await deleteTasksCaches();
          return;
        }

        await removeObsoleteRegistrations();
        const registration = await navigator.serviceWorker.register(
          SERVICE_WORKER_PATH,
          {
            scope: APP_SCOPE,
            updateViaCache: "none",
          },
        );
        await registration.update();
      } catch (error) {
        console.error("Failed to register the Tasks service worker.", error);
      }
    };

    void registerServiceWorker();

    return () => {
      window.removeEventListener("online", updateConnectivity);
      window.removeEventListener("offline", updateConnectivity);
    };
  }, []);

  return online
    ? null
    : <output aria-live="polite" className="sr-only">
        {copy.tasksOfflineAvailable}
      </output>;
}
