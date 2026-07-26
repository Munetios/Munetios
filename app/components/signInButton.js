import { t } from "../i18n";

export default function SignInButton({
  className = "",
  href = "/signin",
  id,
  labelKey = "signIn",
}) {
  const copy = t("en");

  return (
    <a className={className} data-translate={labelKey} href={href} id={id}>
      {copy[labelKey] || copy.signIn}
    </a>
  );
}
