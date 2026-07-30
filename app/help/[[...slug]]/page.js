import HelpCenter from "../helpCenter";
import "../styles.css";

export const metadata = {
  description: "Documentation and support for Munetios apps.",
  title: "Munetios Help Center",
};

export default async function HelpPage({ params }) {
  const { slug = [] } = await params;
  return <HelpCenter initialLocale="en" path={slug} />;
}
