import "./styles.css";

export const metadata = {
  applicationName: "Munetios Mail Beta",
  description: "Munetios Mail Beta",
  icons: {
    apple: "/mail.png",
    icon: "/mail.png",
    shortcut: "/mail.png",
  },
  title: "Munetios Mail Beta",
};

export const viewport = { themeColor: "#2e1065" };

export default function MailLayout({ children }) {
  return children;
}
