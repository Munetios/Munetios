"use client";

import { useEffect } from "react";
import { t } from "../i18n";
import { hasSignedInCookie } from "../lib/signedInCookie";
import { showModal } from "./modal";
import { showToast } from "./toast";

const authStorageKeys = [
  "munetiosSignedIn",
  "munetios:signedIn",
  "munetios.session",
  "munetiosSession",
  "munetiosAuth",
  "munetiosUser",
  "munetiosAccount",
  "session",
  "authToken",
  "accessToken",
  "token",
  "user",
  "account",
];
const testApiFailureKey = "munetios:test-api-failure";

let signedOutModalShown = false;
let fetchErrorToastTimeout = null;
const activeApiFailureToasts = new Set();

function getApiFailureToast(pathname) {
  let messageKey = "";
  let toastId = "";
  if (pathname === "/api/billing") {
    messageKey = "subscriptionCheckFailed";
    toastId = "subscription-check-failed";
  } else if (
    pathname === "/api/signedin" ||
    pathname === "/api/account" ||
    pathname.startsWith("/api/account/")
  ) {
    messageKey = "accountCheckFailed";
    toastId = "account-check-failed";
  }
  return messageKey ? { messageKey, toastId } : null;
}

function showApiCheckFailure(pathname) {
  const toast = getApiFailureToast(pathname);
  if (!toast || activeApiFailureToasts.has(toast.toastId)) return;
  activeApiFailureToasts.add(toast.toastId);
  const { messageKey, toastId } = toast;
  showToast({ messageKey, toastId, type: "error" });
}

function clearApiCheckFailure(pathname) {
  const toast = getApiFailureToast(pathname);
  if (toast) activeApiFailureToasts.delete(toast.toastId);
}

function shouldReportResponseFailure(response) {
  if (response.headers.get("X-Munetios-Test-Mode") === "true") {
    return true;
  }

  if (response.status === 401) {
    return (
      response.headers.get("X-Munetios-Auth-State") === "invalid-session"
    );
  }

  return hasSignedInCookie();
}

function showFetchErrorToast() {
  if (fetchErrorToastTimeout) {
    return;
  }

  showToast({
    messageKey: "fetchError",
    type: "error",
  });

  fetchErrorToastTimeout = window.setTimeout(() => {
    fetchErrorToastTimeout = null;
  }, 1000);
}

function createFetchFailureResponse() {
  const message = t().fetchError || "Failed to fetch.";

  return Response.json(
    {
      error: "fetch_failed",
      message,
    },
    {
      headers: {
        "Content-Type": "application/json",
      },
      status: 503,
    },
  );
}

function getTestApiFailure() {
  const storedFailure = window.sessionStorage.getItem(testApiFailureKey);
  if (!storedFailure) {
    return 0;
  }

  let failure;
  try {
    failure = JSON.parse(storedFailure);
  } catch {
    window.sessionStorage.removeItem(testApiFailureKey);
    return 0;
  }

  const status = Number(failure?.status);
  if (![429, 503].includes(status)) {
    window.sessionStorage.removeItem(testApiFailureKey);
    return 0;
  }

  return status;
}

function clearClientAuthState() {
  if (typeof window === "undefined") {
    return;
  }

  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of authStorageKeys) {
      storage.removeItem(key);
    }
  }

  // This is only a non-sensitive UI marker. The actual session cookie remains HttpOnly.
  // biome-ignore lint/suspicious/noDocumentCookie: Clear the non-sensitive signed-in UI marker.
  document.cookie =
    "munetios_signed_in=; Path=/; Max-Age=0; SameSite=Lax";
  window.dispatchEvent(new Event("munetios:authchange"));
}

export function showSignedOutModal(
  copy = t(),
  { invalidSession = false } = {},
) {
  if (
    typeof window === "undefined" ||
    signedOutModalShown ||
    !invalidSession ||
    !isProtectedSignedInAttempt()
  ) {
    return;
  }

  signedOutModalShown = true;
  clearClientAuthState();

  showModal(
    ({ close }) => (
      <div className="space-y-4">
        <p className="text-sm leading-6 text-white/75">
          {copy.signedOutModalMessage}
        </p>
        <p className="text-sm leading-6 text-white/65">
          {copy.signedOutModalBody}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            className="rounded-xl border border-white/10 bg-white/5! px-3 py-2 text-sm font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/10! hover:text-white"
            onClick={close}
            type="button"
          >
            {copy.signedOutModalDismiss}
          </button>
          <a
            className="rounded-xl border border-purple-200/25 bg-purple-500/80! px-3 py-2 text-sm font-semibold text-white transition hover:border-purple-100/40 hover:bg-purple-400/90!"
            href="/signin"
          >
            {copy.signedOutModalSignIn}
          </a>
        </div>
      </div>
    ),
    {
      ariaLabel: copy.signedOutModalTitle,
      modalId: "munetios-signed-out-modal",
      title: copy.signedOutModalTitle,
    },
  );
}

function isProtectedSignedInAttempt() {
  const url = new URL(window.location.href);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  return (
    pathname === "/account/settings" ||
    pathname.startsWith("/account/settings/") ||
    pathname === "/apps" ||
    pathname.startsWith("/apps/") ||
    pathname === "/business" ||
    pathname.startsWith("/business/") ||
    pathname === "/checkout" ||
    pathname === "/payments" ||
    (pathname === "/apps" && url.searchParams.get("loggedin") === "true")
  );
}

function patchFetchForUnauthorized() {
  if (window.__munetiosFetch401Patched) {
    return;
  }

  const originalFetch = window.fetch.bind(window);

  window.__munetiosOriginalFetch = originalFetch;
  window.__munetiosFetch401Patched = true;
  window.fetch = async (...args) => {
    let parsedRequestUrl = null;
    try {
      const request = args[0];
      const requestUrl =
        request instanceof Request ? request.url : String(request || "");
      parsedRequestUrl = new URL(requestUrl, window.location.href);
      const isLocalApiRequest =
        parsedRequestUrl.origin === window.location.origin &&
        (parsedRequestUrl.pathname.startsWith("/api/") ||
          parsedRequestUrl.pathname === "/realtime");
      const testStatus = isLocalApiRequest
        ? getTestApiFailure()
        : 0;

      if (testStatus === 429 || testStatus === 503) {
        showApiCheckFailure(parsedRequestUrl.pathname);
        return Response.json(
          {
            error: "test_api_failure",
            message: "Test API failure response.",
            testMode: true,
          },
          {
            headers:
              testStatus === 429
                ? { "Retry-After": "60", "X-Munetios-Test-Mode": "true" }
                : { "X-Munetios-Test-Mode": "true" },
            status: testStatus,
          },
        );
      }

      const response = await originalFetch(...args);

      if ([401, 429, 503].includes(response.status)) {
        if (shouldReportResponseFailure(response)) {
          showApiCheckFailure(parsedRequestUrl.pathname);
        } else {
          clearApiCheckFailure(parsedRequestUrl.pathname);
        }
      } else if (response.ok) {
        clearApiCheckFailure(parsedRequestUrl.pathname);
      }
      if (response.status === 401) {
        showSignedOutModal(t(), {
          invalidSession:
            response.headers.get("X-Munetios-Auth-State") === "invalid-session",
        });
      }

      return response;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw error;
      }

      if (hasSignedInCookie() || getTestApiFailure()) {
        showFetchErrorToast();
        if (parsedRequestUrl?.origin === window.location.origin) {
          showApiCheckFailure(parsedRequestUrl.pathname);
        }
      }
      return createFetchFailureResponse();
    }
  };
}

export default function AuthSessionWatcher() {
  useEffect(() => {
    patchFetchForUnauthorized();

    const onUnauthorized = (event) => {
      showSignedOutModal(t(), {
        invalidSession: event.detail?.invalidSession === true,
      });
    };

    window.addEventListener("munetios:unauthorized", onUnauthorized);

    return () => {
      window.removeEventListener("munetios:unauthorized", onUnauthorized);
    };
  }, []);

  useEffect(() => {
    if (!isProtectedSignedInAttempt() || !hasSignedInCookie()) {
      return undefined;
    }

    const controller = new AbortController();

    fetch("/api/account", {
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    }).catch(() => {});

    return () => {
      controller.abort();
    };
  }, []);

  return null;
}
