import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "../../auth.js";
import { t } from "../i18n";
import CheckoutFrame from "./checkoutFrame";

export default async function CheckoutPage({ searchParams }) {
  const copy = t("en");
  const params = await searchParams;
  const requestedPlan = Array.isArray(params?.plan)
    ? params.plan[0]
    : params?.plan;
  const requestedCurrency = Array.isArray(params?.currency)
    ? params.currency[0]
    : params?.currency;
  const requestedSessionId = Array.isArray(params?.session_id)
    ? params.session_id[0]
    : params?.session_id;
  const cookieStore = await cookies();
  const session = await auth({ cookies: cookieStore });

  if (!session || session.demo) {
    const checkoutPath = `/checkout?plan=${encodeURIComponent(requestedPlan || "free")}&currency=${encodeURIComponent(requestedCurrency || "USD")}`;
    redirect(`/signin?returnTo=${encodeURIComponent(checkoutPath)}`);
  }

  return (
    <CheckoutFrame
      copy={copy}
      currency={requestedCurrency}
      planId={requestedPlan}
      sessionId={requestedSessionId}
    />
  );
}
