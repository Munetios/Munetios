import ReusableRouteElements from "../components/reusableRouteElements";

function isLoggedInParam(value) {
  const normalized = Array.isArray(value) ? value[0] : value;

  return normalized === "true";
}

export default async function AppsPage({ searchParams }) {
  const params = await searchParams;

  return (
    <ReusableRouteElements
      initialLoggedIn={isLoggedInParam(params?.loggedin)}
      route="apps"
    />
  );
}
