"use client";

import { useEffect } from "react";
import { t } from "../i18n";
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
const rateLimitTestExemptPaths = new Set(["/api/account", "/api/signedin"]);
const testApiFailureKey = "munetios:test-api-failure";

let signedOutModalShown = false;
let fetchErrorToastTimeout = null;

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

function consumeTestApiFailure(pathname) {
  if (rateLimitTestExemptPaths.has(pathname)) {
    return 0;
  }

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
  if (
    ![429, 503].includes(status) ||
    !Number.isFinite(failure?.expiresAt) ||
    failure.expiresAt <= Date.now()
  ) {
    window.sessionStorage.removeItem(testApiFailureKey);
    return 0;
  }

  window.sessionStorage.removeItem(testApiFailureKey);
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
    try {
      const request = args[0];
      const requestUrl =
        request instanceof Request ? request.url : String(request || "");
      const parsedRequestUrl = new URL(requestUrl, window.location.href);
      const isLocalApiRequest =
        parsedRequestUrl.origin === window.location.origin &&
        parsedRequestUrl.pathname.startsWith("/api/");
      const testStatus = isLocalApiRequest
        ? consumeTestApiFailure(parsedRequestUrl.pathname)
        : 0;

      if (testStatus === 429 || testStatus === 503) {
        return Response.json(
          {
            error: "test_api_failure",
            message: "Test API failure response.",
          },
          { status: testStatus },
        );
      }

      const response = await originalFetch(...args);

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

      showFetchErrorToast();
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
    if (!isProtectedSignedInAttempt()) {
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
