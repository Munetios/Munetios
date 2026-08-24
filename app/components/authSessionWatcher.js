"use client";

import { useEffect } from "react";
import { t } from "../i18n";
import { hasSignedInCookie } from "../lib/signedInCookie";
import { showModal } from "./modal";
import { showToast } from "./toast";

const testApiFailureKey = "munetios:test-api-failure";

let signedOutModalShown = false;
let invalidSessionHandled = false;

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
  if (!toast) return;
  const { messageKey, toastId } = toast;
  showToast({ messageKey, toastId, type: "error" });
}

function shouldReportResponseFailure(response) {
  if (response.headers.get("X-Munetios-Test-Mode") === "true") {
    return false;
  }

  if (response.status === 401) {
    return response.headers.get("X-Munetios-Auth-State") === "invalid-session";
  }

  return hasSignedInCookie();
}

function createFetchFailureResponse() {
  const copy = t();
  const message = getTestApiFailure()
    ? "Test API failure response."
    : copy.fetchError || "Failed to fetch.";

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

function showInvalidSessionToast() {
  showToast({
    messageKey: "invalidSessionToken",
    toastId: "invalid-session-token",
    type: "error",
  });
}

function handleInvalidSession() {
  if (invalidSessionHandled) return;
  invalidSessionHandled = true;
  showInvalidSessionToast();
  showSignedOutModal(t(), { invalidSession: true });
  window.dispatchEvent(
    new CustomEvent("munetios:authchange", {
      detail: { invalidSession: true, sessionInvalid: true, signedIn: true },
    }),
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

export function showSignedOutModal(
  copy = t(),
  { invalidSession = false } = {},
) {
  if (
    typeof window === "undefined" ||
    signedOutModalShown ||
    !invalidSession ||
    getTestApiFailure() ||
    !isProtectedSignedInAttempt()
  ) {
    return;
  }

  signedOutModalShown = true;

  showModal(
    ({ close }) => (
      <div className="flex min-h-0 flex-col gap-4">
        <div className="min-h-0 space-y-4 overflow-y-auto">
          <p className="text-sm leading-6 text-white/75">
            {copy.signedOutModalMessage}
          </p>
          <p className="text-sm leading-6 text-white/65">
            {copy.signedOutModalBody}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <button
            className="rounded-xl border border-white/10 bg-white/5! px-3 py-2 text-sm font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/10! hover:text-white"
            onClick={close}
            type="button"
          >
            {copy.signedOutModalDismiss}
          </button>
          <a
            className="liquid-glass rounded-xl border border-purple-300/25 bg-purple-600/75! px-4 py-2 text-sm font-bold text-white transition hover:bg-purple-500/80!"
            href="/signin"
          >
            {copy.signedOutModalSignIn}
          </a>
        </div>
      </div>
    ),
    {
      ariaLabel: copy.signedOutModalTitle,
      contentClassName: "overflow-hidden",
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
      const requestMethod = String(
        request instanceof Request ? request.method : args[1]?.method || "GET",
      ).toUpperCase();
      const requestUrl =
        request instanceof Request ? request.url : String(request || "");
      parsedRequestUrl = new URL(requestUrl, window.location.href);
      const isLocalApiRequest =
        parsedRequestUrl.origin === window.location.origin &&
        (parsedRequestUrl.pathname.startsWith("/api/") ||
          parsedRequestUrl.pathname === "/realtime");
      const testStatus = isLocalApiRequest ? getTestApiFailure() : 0;

      if (testStatus === 429 || testStatus === 503) {
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
      const isSignOutAllDevicesRequest =
        parsedRequestUrl.pathname === "/api/account/signoutalldevices";
      const isAuthenticationRequest =
        parsedRequestUrl.pathname.startsWith("/api/auth/");
      const invalidSession =
        response.status === 401 &&
        !isAuthenticationRequest &&
        response.headers.get("X-Munetios-Auth-State") === "invalid-session";

      if (invalidSession) {
        if (!getTestApiFailure()) handleInvalidSession();
      } else if ([401, 429, 503].includes(response.status)) {
        if (
          requestMethod !== "GET" &&
          !isSignOutAllDevicesRequest &&
          shouldReportResponseFailure(response)
        ) {
          showApiCheckFailure(parsedRequestUrl.pathname);
        }
      }
      return response;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw error;
      }

      const isSignOutAllDevicesRequest =
        parsedRequestUrl?.pathname === "/api/account/signoutalldevices";
      const isConnectorConnectRequest =
        /^\/api\/connectors\/[^/]+\/connect$/.test(
          parsedRequestUrl?.pathname || "",
        );
      if (
        !isSignOutAllDevicesRequest &&
        !isConnectorConnectRequest &&
        !getTestApiFailure() &&
        hasSignedInCookie()
      ) {
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
      if (event.detail?.invalidSession === true) handleInvalidSession();
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
