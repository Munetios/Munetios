import calendarInlineStyles from "./calendarInlineStyles";

export const metadata = {
  applicationName: "Munetios Calendar",
  description: "Munetios Calendar",
  icons: {
    icon: "/calendar.png",
    shortcut: "/calendar.png",
    apple: "/calendar.png",
  },
  title: "Munetios Calendar",
};

export const viewport = {
  themeColor: "#3b0764",
};

export default function CalendarLayout({ children }) {
  return (
    <>
      <style>{calendarInlineStyles}</style>
      {children}
    </>
  );
}
