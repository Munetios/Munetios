import { getCaptchaImage } from "../../../../lib/authSecurity.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  const { challengeId } = await params;
  const accessToken = new URL(request.url).searchParams.get("access") || "";
  const image = getCaptchaImage(challengeId, accessToken);
  if (!image) {
    return new Response("Challenge expired", {
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" },
      status: 410,
    });
  }

  return new Response(image, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'none'; sandbox",
      "Content-Type": "image/svg+xml; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
