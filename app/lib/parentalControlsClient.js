"use client";

export async function fetchSelfParentalControls() {
  try {
    const response = await fetch("/api/account/family", {
      credentials: "include",
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.self?.parentalControls || null;
  } catch {
    return null;
  }
}

export function isParentalErrorPayload(payload) {
  return (
    payload?.error === "parental_control_blocked" ||
    payload?.error === "parental_approval_required"
  );
}

export function showParentalAwareToast(payload, fallback, showToastFn) {
  if (isParentalErrorPayload(payload) && payload?.message) {
    showToastFn({ message: payload.message, type: "info" });
    return true;
  }
  showToastFn(fallback);
  return false;
}
