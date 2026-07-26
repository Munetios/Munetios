import ReusableRouteElements from "../../components/reusableRouteElements";

export const metadata = {
  title: "Sign up for business | Munetios",
};

function normalizeSignupPlan(plan) {
  return plan === "business-pro" ? "business-pro" : "business-free";
}

export default async function BusinessSignupPage({ searchParams }) {
  const params = await searchParams;
  const plan = Array.isArray(params?.plan) ? params.plan[0] : params?.plan;

  return (
    <ReusableRouteElements
      initialPlan={normalizeSignupPlan(plan)}
      route="business-signup"
    />
  );
}
