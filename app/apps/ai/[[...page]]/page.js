import AiShell from "../components/shell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AiPage({ params }) {
  const resolvedParams = await params;
  const pagePath = Array.isArray(resolvedParams?.page)
    ? resolvedParams.page.join("/")
    : "";

  return <AiShell pagePath={pagePath} />;
}
