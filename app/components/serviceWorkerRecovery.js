"use client";

import { useEffect } from "react";

const APP_SCOPE = "/apps/omniwrite";
const CACHE_PREFIX = "munetios-omniwrite-";
const RECOVERY_KEY = "munetios-omniwrite-worker-recovery-v7";
const SERVICE_WORKER_PATH = "/sw.js";

function getWorker(registration) {
  return registration.active || registration.waiting || registration.installing;
}

function isOmniWriteWorker(worker) {
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

export default function ServiceWorkerRecovery() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    const removeStaleWorkerState = async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const expectedScope = new URL(APP_SCOPE, window.location.origin).href;
      const removeAll = process.env.NODE_ENV !== "production";
      const controlledByOmniWriteWorker = isOmniWriteWorker(
        navigator.serviceWorker.controller,
      );
      const obsoleteRegistrations = registrations.filter((registration) => {
        const worker = getWorker(registration);
        return (
          isOmniWriteWorker(worker) &&
          (removeAll || registration.scope !== expectedScope)
        );
      });

      await Promise.all(
        obsoleteRegistrations.map((registration) => registration.unregister()),
      );

      if (removeAll && "caches" in window) {
        const cacheNames = await window.caches.keys();
        await Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX))
            .map((cacheName) => window.caches.delete(cacheName)),
        );
      }

      if (
        controlledByOmniWriteWorker &&
        obsoleteRegistrations.length > 0 &&
        window.sessionStorage.getItem(RECOVERY_KEY) !== "complete"
      ) {
        window.sessionStorage.setItem(RECOVERY_KEY, "complete");
        window.location.reload();
      }
    };

    void removeStaleWorkerState().catch((error) => {
      console.error("Failed to clean up stale OmniWrite worker state.", error);
    });
  }, []);

  return null;
}
