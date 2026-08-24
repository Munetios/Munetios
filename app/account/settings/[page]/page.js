import { cookies } from "next/headers";
import AccountSettings from "../../../components/accountmanagerui";
import { getAccountSettingsMetadata } from "../../../lib/accountSettingsMetadata";

export const generateMetadata = getAccountSettingsMetadata;

export default async function AccountSettingsSectionPage({ params }) {
  const [{ page }, cookieStore] = await Promise.all([params, cookies()]);
  const initialLoggedIn = cookieStore.has("munetios_session");
  const initialLocale = cookieStore.get("munetios_locale")?.value || "en";

  return (
    <AccountSettings
      initialLoggedIn={initialLoggedIn}
      initialLocale={initialLocale}
      initialPage={page}
    />
  );
}
