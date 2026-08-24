"use client";

import { setServerSessionCookiePresent } from "../lib/signedInCookie";

export default function SessionCookieBoundary({ children, sessionPresent }) {
  setServerSessionCookiePresent(sessionPresent);
  return children;
}
