import { POST as createStripeCheckout } from "../checkout/route.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const checkoutRequest = new Request(new URL("/api/checkout", request.url), {
    body: JSON.stringify({ ...payload, paymentMethod: "paypal" }),
    headers: request.headers,
    method: "POST",
  });
  return createStripeCheckout(checkoutRequest);
}
