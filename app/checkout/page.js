import CommerceComingSoon from "../components/commerceComingSoon";
import { t } from "../i18n";

export default function CheckoutPage() {
  const copy = t("en");
  return (
    <CommerceComingSoon
      copy={copy}
      fullPage
      title={copy.accountSettingsBilling}
    />
  );
}
