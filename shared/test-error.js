/*!
 * testError(): a developer tool for checking how Munetios apps handle failing requests.
 *
 *   testError()             Every API request fails with 503 Service Unavailable.
 *   testError("signedOut")  The session acts as invalid: the account still shows as signed in,
 *                           but account and sync requests fail with 401.
 *   testError(false)        Back to normal.
 *
 * "API requests" are fetch, XMLHttpRequest, and sendBeacon calls to /api/ on this site and to
 * other sites. The page's own files (scripts, styles, languages, images) still load so error
 * messages can show. The setting is kept in sessionStorage: it lasts through reloads in this tab
 * and goes back to normal when the tab is closed.
 * Load this before other scripts so every request goes through it.
 */
(() => {
  "use strict";
  // SuperVidPlayer has its own copy; whichever loads first is used.
  if (typeof window.testError === "function") return;
  const KEY = "munetios-test-error";
  const read = () => { try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; } };
  const write = value => { try { value ? sessionStorage.setItem(KEY, value) : sessionStorage.removeItem(KEY); } catch {} };
  // "true" (503) matches the value SuperVidPlayer stores; "signedOut" simulates an invalid session.
  let mode = read();
  const failing = () => mode === "true" || mode === "signedOut";

  const parse = input => {
    try { return new URL(typeof input === "string" ? input : input?.url || String(input), location.href); } catch { return null; }
  };
  const isApiRequest = input => {
    const url = parse(input);
    if (!url || !/^https?:$/.test(url.protocol)) return false;
    return url.origin !== location.origin || /^\/api(?:\/|$)/.test(url.pathname);
  };
  const methodOf = (input, init) => String(init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();
  const headers = extra => ({ "Content-Type": "application/json", "Cache-Control": "no-store", "X-Munetios-Test-Mode": "true", ...extra });

  function failure(input, init) {
    const url = parse(input);
    const path = url ? url.pathname : "";
    if (mode === "signedOut" && url?.origin === location.origin) {
      // The session check answers like a revoked session; everything else is refused as signed out.
      if (path === "/api/auth/session" && methodOf(input, init) === "GET") {
        return new Response(JSON.stringify({ account: null, accounts: [], sessionRevoked: true }), { status: 200, headers: headers() });
      }
      return new Response(JSON.stringify({ error: "signedOut", testMode: true }), { status: 401, statusText: "Unauthorized", headers: headers() });
    }
    return new Response(JSON.stringify({ error: "testError", message: "This request was failed on purpose by testError().", status: 503, testMode: true }), {
      status: 503, statusText: "Service Unavailable", headers: headers({ "Retry-After": "30" })
    });
  }
  const log = (input, init) => {
    const url = parse(input);
    console.warn(`testError: ${methodOf(input, init)} ${url ? (url.origin === location.origin ? url.pathname : url.href) : String(input)} failed on purpose.`);
  };

  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  if (nativeFetch) {
    window.fetch = (input, init) => {
      if (failing() && isApiRequest(input)) {
        const signal = init?.signal || (typeof input === "object" ? input?.signal : undefined);
        if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        log(input, init);
        return Promise.resolve(failure(input, init));
      }
      return nativeFetch(input, init);
    };
  }

  const XHR = window.XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function (method, url, ...rest) {
      this.__munetiosTestRequest = { method, url };
      return open.call(this, method, url, ...rest);
    };
    XHR.prototype.send = function (body) {
      const request = this.__munetiosTestRequest;
      if (failing() && request && isApiRequest(request.url)) {
        log(request.url, { method: request.method });
        // Behaves like a request that couldn't reach the server.
        setTimeout(() => { this.dispatchEvent(new ProgressEvent("error")); this.dispatchEvent(new ProgressEvent("loadend")); }, 0);
        return;
      }
      return send.call(this, body);
    };
  }

  if (navigator.sendBeacon) {
    const beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => {
      if (failing() && isApiRequest(url)) { log(url, { method: "POST" }); return false; }
      return beacon(url, data);
    };
  }

  window.testError = (option = true) => {
    mode = option === false || option === "off" ? "" : option === "signedOut" || option === 401 ? "signedOut" : "true";
    write(mode);
    if (mode === "signedOut") console.info('testError: the session now acts as invalid in this tab. Account and sync requests fail with 401 while the account still shows as signed in. Run testError(false) to stop, or close the tab.');
    else if (mode) console.info("testError: every API request now fails with 503 in this tab. Run testError(false) to stop, or close the tab.");
    else console.info("testError: requests are back to normal. Reload to clear any errors already shown.");
    // Let the account check its session right away instead of waiting for the next check.
    try { window.MunetiosAccount?.refresh?.({ scheduleSync: true }); } catch {}
    return mode ? (mode === "signedOut" ? "signedOut" : 503) : false;
  };
  window.TestError = window.testError;
  if (failing()) console.info(`testError is on in this tab (${mode === "signedOut" ? "invalid session" : "503 for every API request"}). Run testError(false) to stop, or close the tab.`);
})();
