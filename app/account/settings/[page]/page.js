import AccountSettings from "../../../components/accountmanagerui";

export const metadata = {
  title: "Settings | Munetios",
  description: "Manage Munetios settings.",
};

export default async function AccountSettingsSectionPage({ params }) {
  const { page } = await params;

  return <AccountSettings initialPage={page} />;
}
