import { createQrCodeSvg } from "../../../../lib/qrCode.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const data = new URL(request.url).searchParams.get("data") || "";
  if (!data || data.length > 271) {
    return Response.json({ error: "invalid_qr_data" }, { status: 400 });
  }
  try {
    return new Response(createQrCodeSvg(data), {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Security-Policy": "default-src 'none'",
        "Content-Type": "image/svg+xml; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "qr_generation_failed" }, { status: 400 });
  }
}
