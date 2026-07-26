import AccountRecovery from "../components/accountRecovery";

export const metadata = {
  description: "Securely reset your Munetios account password.",
  title: "Forgot password - Munetios",
};

export default function ForgotPasswordPage() {
  return <AccountRecovery type="password" />;
}
