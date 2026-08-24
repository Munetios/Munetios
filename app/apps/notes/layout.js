import "./styles.css";

export const metadata = {
  applicationName: "Munetios SupaNotes",
  description: "Munetios SupaNotes",
  icons: {
    icon: "https://notes.munetios.com/apple-touch-icon.png",
    shortcut: "https://notes.munetios.com/apple-touch-icon.png",
    apple: "https://notes.munetios.com/apple-touch-icon.png",
  },
  title: "Munetios SupaNotes",
};

export const viewport = {
  themeColor: "#3b0764",
};

export default function NotesLayout({ children }) {
  return children;
}
