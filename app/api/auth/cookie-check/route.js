export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const cookieName = "munetios_cookie_check";

function getCookie(request, name) {
  for (const entry of (request.headers.get("cookie") || "").split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    return entry.slice(separator + 1).trim();
  }
  return "";
}

export function GET(request) {
  const enabled = getCookie(request, cookieName) === "1";
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookie = enabled
    ? `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
    : `${cookieName}=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=60${secure}`;
  return Response.json(
    { enabled },
    {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": cookie,
      },
    },
  );
}
