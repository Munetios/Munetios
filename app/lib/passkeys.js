export function getPasskeyRequestContext(request) {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  const host = forwardedHost || requestUrl.host;
  const protocol = forwardedProtocol || requestUrl.protocol.slice(0, -1);
  const hostname = host.split(":")[0];

  return {
    origin: `${protocol}://${host}`,
    rpID: process.env.WEBAUTHN_RP_ID || hostname,
  };
}
