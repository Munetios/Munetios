import MeetShell from "../components/shell";

export const metadata = {
  description: "View meetings you joined with Munetios Meet.",
  title: "History | Munetios Meet",
};

export default function MeetHistoryPage() {
  return <MeetShell view="history" />;
}
