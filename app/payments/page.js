import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "../../auth.js";
import CheckoutFrame from "../checkout/checkoutFrame";
import { t } from "../i18n";

function getSearchParam(params, key) {
  const value = params?.[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function PaymentsPage({ searchParams }) {
  const copy = t("en");
  const params = await searchParams;
  const requestedPlan = getSearchParam(params, "plan") || "business-pro";
  const requestedCurrency = getSearchParam(params, "currency");
  const requestedPaymentMethod =
    getSearchParam(params, "paymentMethod") || "card";
  const requestedSessionId = getSearchParam(params, "session_id");
  const cookieStore = await cookies();
  const session = await auth({ cookies: cookieStore });

  if (!session || session.demo) {
    const paymentPath = `/payments?plan=${encodeURIComponent(requestedPlan)}${requestedCurrency ? `&currency=${encodeURIComponent(requestedCurrency)}` : ""}&paymentMethod=${encodeURIComponent(requestedPaymentMethod)}`;
    redirect(`/signin?returnTo=${encodeURIComponent(paymentPath)}`);
  }

  return (
    <CheckoutFrame
      copy={copy}
      currency={requestedCurrency}
      initialPaymentMethod={requestedPaymentMethod}
      planId={requestedPlan}
      sessionId={requestedSessionId}
    />
  );
}
