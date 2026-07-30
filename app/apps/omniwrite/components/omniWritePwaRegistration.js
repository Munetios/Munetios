"use client";

import { useEffect } from "react";

const APP_SCOPE = "/apps/omniwrite";
const CACHE_PREFIX = "munetios-omniwrite-";
const SERVICE_WORKER_PATH = "/sw.js";

function isOmniWriteServiceWorker(registration) {
  const worker =
    registration.active || registration.waiting || registration.installing;

  if (!worker) {
    return false;
  }

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

async function deleteOmniWriteCaches() {
  if (!("caches" in window)) {
    return;
  }

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
      isOmniWriteServiceWorker(registration) &&
      (removeCurrent || registration.scope !== expectedScope),
  );

  await Promise.all(
    obsoleteRegistrations.map((registration) => registration.unregister()),
  );

  return obsoleteRegistrations.length > 0;
}

function waitForWorkerActivation(worker) {
  if (!worker || worker.state === "activated" || worker.state === "redundant") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const handleStateChange = () => {
      if (worker.state === "activated" || worker.state === "redundant") {
        worker.removeEventListener("statechange", handleStateChange);
        resolve();
      }
    };

    worker.addEventListener("statechange", handleStateChange);
  });
}

export default function OmniWritePwaRegistration() {
  useEffect(() => {
    const registerServiceWorker = async () => {
      if (!("serviceWorker" in navigator)) {
        return;
      }

      try {
        if (process.env.NODE_ENV !== "production") {
          await removeObsoleteRegistrations({ removeCurrent: true });
          await deleteOmniWriteCaches();
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
        await waitForWorkerActivation(
          registration.installing ||
            registration.waiting ||
            registration.active,
        );
        await navigator.serviceWorker.ready;
      } catch (error) {
        console.error(
          "Failed to register the OmniWrite service worker.",
          error,
        );
      }
    };

    void registerServiceWorker();
  }, []);

  return null;
}
