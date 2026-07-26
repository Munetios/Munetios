import AccountRecovery from "../components/accountRecovery";

export const metadata = {
  description: "Securely recover your Munetios email address.",
  title: "Forgot email - Munetios",
};

export default function ForgotEmailPage() {
  return <AccountRecovery type="email" />;
}
