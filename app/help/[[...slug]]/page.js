import HelpCenter from "../helpCenter";
import { loadDocumentation } from "../documentationLoader";
import "../styles.css";

export const metadata = {
  description: "Documentation and support for Munetios apps.",
  title: "Munetios Documentation",
};

export default async function HelpPage({ params }) {
  const { slug = [] } = await params;
  return (
    <HelpCenter
      documents={await loadDocumentation()}
      initialLocale="en"
      path={slug}
    />
  );
}
