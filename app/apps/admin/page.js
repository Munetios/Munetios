import AdminConsole from "./adminConsole";
import "./styles.css";

export const dynamic = "force-dynamic";

export const metadata = {
  description: "Manage your Munetios business.",
  title: "Munetios Admin",
};

export default function AdminPage() {
  return <AdminConsole />;
}
