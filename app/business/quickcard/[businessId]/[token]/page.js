import QuickCardSignIn from "../../../../components/quickCardSignIn";

export const dynamic = "force-dynamic";

export default async function QuickCardPage({ params }) {
  const { businessId, token } = await params;
  return <QuickCardSignIn businessId={businessId} token={token} />;
}
