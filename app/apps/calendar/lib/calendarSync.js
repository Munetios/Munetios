"use client";

import { hasSignedInCookie } from "../../../lib/signedInCookie";

export const calendarSyncStatusEvent = "munetios:calendarsyncstatus";

export function calendarSyncReasonFromResponse(response, payload) {
  if (
    response.status === 401 &&
    response.headers.get("X-Munetios-Auth-State") === "invalid-session"
  ) {
    return (
      payload?.message ||
      "Your session token is invalid. Sign in again to resume calendar sync."
    );
  }
  return (
    payload?.message ||
    payload?.error ||
    response.statusText ||
    `Calendar sync failed (${response.status})`
  );
}

export function publishCalendarSyncStatus(detail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(calendarSyncStatusEvent, { detail: { ...detail } }),
  );
}

export async function calendarOperation(path, { method = "GET" } = {}) {
  if (!hasSignedInCookie()) return { local: true };
  const response = await fetch(`/api/calendar/${path}`, {
    cache: "no-store",
    credentials: "include",
    headers:
      method === "GET" ? undefined : { "Content-Type": "application/json" },
    method,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(calendarSyncReasonFromResponse(response, payload));
    error.reason = error.message;
    error.status = response.status;
    publishCalendarSyncStatus({ reason: String(error), status: "failed" });
    throw error;
  }
  return payload;
}

export function calendarSyncFailureReason(error) {
  return error?.reason || error?.message || "unknown";
}
