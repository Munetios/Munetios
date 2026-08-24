import HelpChatbot from "../helpChatbot";
import "../styles.css";

export const metadata = {
  robots: { index: false, follow: false },
  title: "Documentation assistant",
};

export default async function HelpChatbotPage({ searchParams }) {
  const params = await searchParams;
  return (
    <HelpChatbot
      initialContext={String(params?.context || "")}
      initialLocale={String(params?.locale || "en")}
      initialTheme={String(params?.theme || "account")}
    />
  );
}
