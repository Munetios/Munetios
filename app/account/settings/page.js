import AccountSettings from "../../components/accountmanagerui";

export const metadata = {
  title: "Settings | Munetios",
  description: "Manage Munetios settings.",
};

export default function AccountSettingsPage() {
  return <AccountSettings initialPage="profile" />;
}
