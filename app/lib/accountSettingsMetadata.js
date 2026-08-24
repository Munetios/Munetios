import { cookies } from "next/headers";
import { t } from "../i18n";

export async function getAccountSettingsMetadata() {
  const cookieStore = await cookies();
  const locale = cookieStore.get("munetios_locale")?.value || "en";
  const copy = t(locale);

  return {
    description: "Manage Munetios settings.",
    title: copy.accountSettingsTabTitle || `${copy.accountSettings} | Munetios`,
  };
}
