export function isHttpsRequest(request) {
  const forwardedProtocol = request?.headers
    ?.get?.("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    ?.toLowerCase();

  if (forwardedProtocol === "https") return true;

  try {
    return new URL(request?.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function getSecureCookieAttribute(request) {
  return isHttpsRequest(request) ? "; Secure" : "";
}
