import AccountRecovery from "../../components/accountRecovery";

export const metadata = {
  description: "Recover access to your Munetios account.",
  title: "Account recovery - Munetios",
};

export default async function RecoveryPage({ searchParams }) {
  const params = await searchParams;
  const type = Array.isArray(params?.type) ? params.type[0] : params?.type;
  return <AccountRecovery type={type === "email" ? "email" : "password"} />;
}
