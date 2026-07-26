import "./styles.css";
import TasksShell from "./components/shell";

export const metadata = {
  applicationName: "Munetios Tasks",
  description: "Munetios Tasks",
  manifest: "/tasks.webmanifest",
  icons: {
    icon: [
      {
        url: "https://tasks.munetios.com/apple-touch-icon.png",
        type: "image/png",
      },
    ],
    shortcut: "https://tasks.munetios.com/apple-touch-icon.png",
    apple: "https://tasks.munetios.com/apple-touch-icon.png",
  },
  title: "Munetios Tasks",
};

export const viewport = {
  themeColor: "#3b0764",
};

export default function TasksLayout({ children }) {
  return <TasksShell>{children}</TasksShell>;
}
