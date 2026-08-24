"use client";

import { setServerSessionCookiePresent } from "../../../lib/signedInCookie";

export default function CalendarSessionBoundary({ children, sessionPresent }) {
  setServerSessionCookiePresent(sessionPresent);
  return children;
}
