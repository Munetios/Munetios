"use client";

import Image from "next/image";
import { useState } from "react";
import { t } from "../i18n";
import { showToast } from "./toast";

export default function AccountRecovery({ type }) {
  const copy = t();
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [recoveredEmail, setRecoveredEmail] = useState("");
  const [recoveryId, setRecoveryId] = useState("");
  const [step, setStep] = useState("request");
  const [submitting, setSubmitting] = useState(false);
  const isEmailRecovery = type === "email";

  const requestRecovery = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/recovery", {
        body: JSON.stringify({
          identifier,
          type: isEmailRecovery ? "email" : "password",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.recoveryId)
        throw new Error("Recovery failed");
      setRecoveryId(payload.recoveryId);
      setCode(payload.developmentCode || "");
      setStep("verify");
      showToast({ messageKey: "authRecoverySent", type: "success" });
    } catch {
      showToast({ messageKey: "authRecoveryFailed", type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const verifyRecovery = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/recovery/verify", {
        body: JSON.stringify({
          code,
          newPassword,
          recoveryId,
          type: isEmailRecovery ? "email" : "password",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Recovery failed");
      setRecoveredEmail(payload.email || "");
      setStep("complete");
      showToast({ messageKey: "authRecoveryComplete", type: "success" });
    } catch {
      showToast({ messageKey: "authRecoveryCodeInvalid", type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="signin-background flex min-h-dvh items-center justify-center p-3 text-white">
      <section className="liquid-glass w-full max-w-lg rounded-3xl border border-white/10 bg-purple-950/50! p-5 sm:p-8">
        <a className="logo flex items-center gap-3" href="/">
          <Image
            alt={copy.landingLogoAlt}
            className="h-12 w-12"
            height={48}
            src="/favicon.ico"
            width={48}
          />
          <span className="text-xl font-bold">Munetios</span>
        </a>
        <h1 className="mt-7 text-3xl font-semibold tracking-[-0.03em]">
          {isEmailRecovery
            ? copy.authRecoverEmailTitle
            : copy.authRecoverPasswordTitle}
        </h1>
        <p className="mt-3 text-sm leading-6 text-white/65">
          {isEmailRecovery
            ? copy.authRecoverEmailDescription
            : copy.authRecoverPasswordDescription}
        </p>
        {step === "request"
          ? <form className="mt-6 space-y-4" onSubmit={requestRecovery}>
              <label className="block text-sm font-semibold text-white/80">
                <span>{copy.authRecoveryIdentifier}</span>
                <span className="relative mt-2 block">
                  <icon className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-purple-200">
                    contact_mail
                  </icon>
                  <input
                    className="h-12 w-full rounded-xl border border-white/10 bg-white/10! px-4 pl-11 text-white outline-none focus:border-purple-300/70"
                    onChange={(event) => setIdentifier(event.target.value)}
                    required
                    value={identifier}
                  />
                </span>
              </label>
              <button
                className="w-full rounded-xl bg-purple-600/80! px-4 py-3 font-semibold hover:bg-purple-500/90! disabled:opacity-60"
                disabled={submitting}
                type="submit"
              >
                {submitting
                  ? copy.authRecoverySending
                  : copy.authRecoveryContinue}
              </button>
            </form>
          : null}
        {step === "verify"
          ? <form className="mt-6 space-y-4" onSubmit={verifyRecovery}>
              <label className="block text-sm font-semibold text-white/80">
                <span>{copy.authVerificationCode}</span>
                <input
                  autoComplete="one-time-code"
                  className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-white/10! px-4 text-white outline-none focus:border-purple-300/70"
                  inputMode="numeric"
                  onChange={(event) => setCode(event.target.value)}
                  required
                  value={code}
                />
              </label>
              {!isEmailRecovery
                ? <label className="block text-sm font-semibold text-white/80">
                    <span>{copy.authRecoveryNewPassword}</span>
                    <span className="relative mt-2 block">
                      <input
                        autoComplete="new-password"
                        className="h-12 w-full rounded-xl border border-white/10 bg-white/10! px-4 pr-11 text-white outline-none focus:border-purple-300/70"
                        minLength={12}
                        onChange={(event) => setNewPassword(event.target.value)}
                        required
                        type={passwordVisible ? "text" : "password"}
                        value={newPassword}
                      />
                      <button
                        aria-label={
                          passwordVisible
                            ? copy.signInHidePassword
                            : copy.signInShowPassword
                        }
                        className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg hover:bg-white/10!"
                        onClick={() =>
                          setPasswordVisible((visible) => !visible)
                        }
                        type="button"
                      >
                        <icon>
                          {passwordVisible ? "visibility_off" : "visibility"}
                        </icon>
                      </button>
                    </span>
                    <span className="mt-2 block text-xs font-normal text-white/50">
                      {copy.authPasswordRequirements}
                    </span>
                  </label>
                : null}
              <button
                className="w-full rounded-xl bg-purple-600/80! px-4 py-3 font-semibold hover:bg-purple-500/90! disabled:opacity-60"
                disabled={submitting}
                type="submit"
              >
                {submitting
                  ? copy.authRecoveryVerifying
                  : copy.authRecoveryVerify}
              </button>
            </form>
          : null}
        {step === "complete"
          ? <div className="mt-6 rounded-2xl border border-emerald-300/20 bg-emerald-500/12! p-4 text-sm leading-6 text-emerald-50">
              <p>
                {isEmailRecovery
                  ? copy.authRecoveredEmail
                  : copy.authPasswordResetComplete}
              </p>
              {recoveredEmail
                ? <p className="mt-2 text-lg font-semibold">{recoveredEmail}</p>
                : null}
            </div>
          : null}
        <a
          className="mt-5 inline-flex text-sm text-purple-200 hover:underline"
          href="/signin"
        >
          {copy.authBackToSignIn}
        </a>
      </section>
    </main>
  );
}
