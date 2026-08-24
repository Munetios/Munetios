import { cookies } from "next/headers";
import AccountSettings from "../../components/accountmanagerui";
import { getAccountSettingsMetadata } from "../../lib/accountSettingsMetadata";

export const generateMetadata = getAccountSettingsMetadata;

export default async function AccountSettingsPage() {
  const cookieStore = await cookies();
  const initialLoggedIn = cookieStore.has("munetios_session");
  const initialLocale = cookieStore.get("munetios_locale")?.value || "en";

  return (
    <AccountSettings
      initialLoggedIn={initialLoggedIn}
      initialLocale={initialLocale}
      initialPage="profile"
    />
  );
}
