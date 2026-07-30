import { notFound } from "next/navigation";
import HelpCenter from "../../../help/helpCenter";
import { helpLocales } from "../../../help/helpI18n";
import "../../../help/styles.css";

export default async function LocalizedHelpPage({ params }) {
  const { locale, slug = [] } = await params;
  if (!(locale in helpLocales)) notFound();
  return <HelpCenter initialLocale={locale} path={slug} />;
}

