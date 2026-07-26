import { createProviderPayment } from "../../lib/paymentProvider.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  return createProviderPayment(request, "cashapp");
}
