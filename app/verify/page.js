import Image from "next/image";
import { t } from "../i18n.js";
import { readEmailVerificationToken } from "../lib/emailVerificationToken.js";

export const metadata = { title: "Verify email | Munetios" };

export default async function VerifyEmailPage({ searchParams }) {
  const copy = t();
  const token = String((await searchParams)?.token || "");
  const verification = readEmailVerificationToken(token);
  const continueUrl = verification
    ? `/signin?signup=true&contact=${encodeURIComponent(verification.identifier)}&verificationCode=${encodeURIComponent(verification.code)}&verificationId=${encodeURIComponent(verification.verificationId)}`
    : "/signin?signup=true";

  return (
    <main className="signin-background flex min-h-dvh items-center justify-center p-3 text-white">
      <section className="liquid-glass w-full max-w-lg rounded-3xl border border-white/10 bg-purple-950/50! p-6 sm:p-8">
        <a className="flex items-center gap-3" href="/">
          <Image alt="Munetios" height={48} src="/favicon.ico" width={48} />
          <span className="text-xl font-bold">Munetios</span>
        </a>
        <icon className="mt-8 block text-5xl text-purple-200">
          {verification ? "verified" : "link_off"}
        </icon>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.03em]">
          {verification
            ? copy.authVerificationRequired
            : copy.authRecoveryCodeInvalid}
        </h1>
        <p className="mt-3 text-sm leading-6 text-white/65">
          {verification
            ? copy.authVerificationSent
            : copy.authVerificationFailed}
        </p>
        <a
          className="mt-6 flex w-full items-center justify-center rounded-xl bg-purple-600/80! px-4 py-3 font-semibold hover:bg-purple-500/90!"
          href={continueUrl}
        >
          {copy.continue}
        </a>
      </section>
    </main>
  );
}
