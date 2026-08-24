"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n";
import DatePicker from "./datePicker";
import DropdownWrapper from "./dropdownwrapper";
import { showModal } from "./modal";
import { showToast } from "./toast";

const emptyForm = {
  birthDate: "",
  captchaAnswer: "",
  confirmPassword: "",
  email: "",
  firstName: "",
  gender: "",
  lastName: "",
  password: "",
  verificationCode: "",
  verificationId: "",
};

function EducationField({ label, ...props }) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-white/85">
      {label}
      <input
        className="h-12 rounded-xl border border-white/10 bg-purple-950/35! px-3 text-white outline-none transition focus:border-purple-300/55"
        {...props}
      />
    </label>
  );
}

export default function EducationSignup({ embedded = false }) {
  const [copy, setCopy] = useState(() => t());
  const [role, setRole] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [captcha, setCaptcha] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [verificationSending, setVerificationSending] = useState(false);

  const loadCaptcha = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/captcha", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (response.ok) {
        setCaptcha(payload);
        setForm((current) => ({ ...current, captchaAnswer: "" }));
        return;
      }
      showToast({
        messageKey:
          response.status === 429
            ? "authTooManyRequests"
            : "authCaptchaUnavailable",
        type: "error",
      });
    } catch {
      showToast({ messageKey: "authCaptchaUnavailable", type: "error" });
    }
  }, []);

  useEffect(() => {
    const refreshCopy = () => setCopy(t());
    window.addEventListener("munetios:languagechange", refreshCopy);
    return () =>
      window.removeEventListener("munetios:languagechange", refreshCopy);
  }, []);

  useEffect(() => {
    if (role === "teacher" && !captcha) void loadCaptcha();
  }, [captcha, loadCaptcha, role]);

  const chooseStudent = () => {
    setRole("student");
    showModal(
      ({ close }) => (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-white/70">
            {copy.educationStudentAskTeacherBody}
          </p>
          <div className="flex justify-end">
            <button
              className="liquid-glass rounded-xl bg-purple-600/70! px-4 py-2 text-sm font-bold"
              onClick={close}
              type="button"
            >
              {copy.close}
            </button>
          </div>
        </div>
      ),
      {
        ariaLabel: copy.educationStudentAskTeacherTitle,
        title: copy.educationStudentAskTeacherTitle,
      },
    );
  };

  const normalizedEmail = form.email.trim().toLowerCase();
  const usesExternalEmail =
    normalizedEmail.includes("@") && !normalizedEmail.endsWith("@munetios.com");

  const requestVerification = async () => {
    if (!normalizedEmail || !usesExternalEmail) {
      showToast({ messageKey: "authRequiredDetails", type: "error" });
      return false;
    }
    setVerificationSending(true);
    try {
      const response = await fetch("/api/auth/verification", {
        body: JSON.stringify({ identifier: normalizedEmail }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(12_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || "verification_failed");
        error.reason = payload.reason;
        throw error;
      }
      setForm((current) => ({
        ...current,
        verificationCode: "",
        verificationId: payload.verificationId,
      }));
      showToast({ messageKey: "authVerificationSent", type: "success" });
      return true;
    } catch (error) {
      const messageKey =
        {
          email_taken: "authEmailTaken",
          rate_limited: "authVerificationRateLimited",
          verification_unavailable: "authVerificationFailed",
        }[error.message] || "authVerificationFailed";
      showToast({ messageKey, type: "error" });
      return false;
    } finally {
      setVerificationSending(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    if (
      !form.firstName.trim() ||
      !form.lastName.trim() ||
      !form.birthDate ||
      !normalizedEmail ||
      !form.gender ||
      !form.password ||
      !form.confirmPassword ||
      !form.captchaAnswer.trim()
    ) {
      showToast({ messageKey: "authRequiredDetails", type: "error" });
      return;
    }
    if (usesExternalEmail && !form.verificationId) {
      await requestVerification();
      return;
    }
    if (usesExternalEmail && !form.verificationCode.trim()) {
      showToast({ messageKey: "authVerificationRequired", type: "error" });
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/education/signup", {
        body: JSON.stringify({
          ...form,
          captchaChallengeId: captcha?.challengeId,
        }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "signup_failed");
      window.dispatchEvent(
        new CustomEvent("munetios:authchange", {
          detail: { signedIn: true },
        }),
      );
      window.location.assign("/apps?educationWelcome=1");
    } catch (error) {
      const errorKeys = {
        email_taken: "authEmailTaken",
        invalid_account_details: "authRequiredDetails",
        invalid_captcha: "authCaptchaInvalid",
        rate_limited: "authTooManyRequests",
        verification_required: "authVerificationRequired",
      };
      showToast({
        messageKey: errorKeys[error.message] || "educationSignupFailed",
        type: "error",
      });
      if (error.message !== "rate_limited") {
        await loadCaptcha().catch(() => {});
      }
      setSubmitting(false);
    }
  };

  const update = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const updateEmail = (event) => {
    const email = event.target.value;
    setForm((current) => ({
      ...current,
      email,
      verificationCode: "",
      verificationId: "",
    }));
  };
  const genderOptions = [
    ["woman", copy.authGenderWoman],
    ["man", copy.authGenderMan],
    ["nonbinary", copy.authGenderNonBinary],
    ["other", copy.authGenderOther],
  ];

  const content = (
    <section
      className={`liquid-glass w-full max-w-3xl rounded-3xl border border-purple-200/15 bg-purple-950/30! p-5 sm:p-8 ${embedded ? "" : "mx-auto mt-8"}`}
    >
      {!embedded
        ? null
        : <p className="mb-2 text-sm font-bold text-purple-200">
            Munetios Education
          </p>}
      <h1 className="text-3xl font-bold tracking-[-0.03em]">
        {copy.educationSignupTitle}
      </h1>
      <p className="mt-2 text-sm leading-6 text-white/65">
        {copy.educationSignupDescription}
      </p>
      <fieldset className="mt-6 grid gap-3 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-bold">
          {copy.educationRoleQuestion}
        </legend>
        <button
          aria-pressed={role === "teacher"}
          className="liquid-glass rounded-2xl border border-purple-200/15 bg-purple-600/25! p-4 text-left hover:bg-purple-500/35!"
          onClick={() => setRole("teacher")}
          type="button"
        >
          <icon>school</icon>
          <strong className="ml-2">{copy.educationTeacher}</strong>
        </button>
        <button
          aria-pressed={role === "student"}
          className="liquid-glass rounded-2xl border border-purple-200/15 bg-purple-600/25! p-4 text-left hover:bg-purple-500/35!"
          onClick={chooseStudent}
          type="button"
        >
          <icon>person</icon>
          <strong className="ml-2">{copy.educationStudent}</strong>
        </button>
      </fieldset>
      {role === "teacher"
        ? <form className="mt-6 grid gap-4" noValidate onSubmit={submit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <EducationField
                autoComplete="given-name"
                label={copy.authFirstName}
                onChange={update("firstName")}
                required
                value={form.firstName}
              />
              <EducationField
                autoComplete="family-name"
                label={copy.familyChildLastName}
                onChange={update("lastName")}
                required
                value={form.lastName}
              />
            </div>
            <DatePicker
              copy={copy}
              label={copy.authBirthday}
              maximumYear={new Date().getFullYear() - 18}
              onChange={(birthDate) =>
                setForm((current) => ({ ...current, birthDate }))
              }
              value={form.birthDate}
            />
            <EducationField
              autoComplete="email"
              label={copy.authEmailAddress}
              onChange={updateEmail}
              required
              type="email"
              value={form.email}
            />
            {usesExternalEmail
              ? <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  {form.verificationId
                    ? <EducationField
                        autoComplete="one-time-code"
                        label={copy.authVerificationCode}
                        onChange={update("verificationCode")}
                        required
                        value={form.verificationCode}
                      />
                    : <p className="self-center text-sm leading-6 text-white/65">
                        {copy.authVerificationRequired}
                      </p>}
                  <button
                    className="liquid-glass h-12 rounded-xl bg-purple-600/55! px-4 text-sm font-bold disabled:opacity-55"
                    disabled={verificationSending}
                    onClick={() => void requestVerification()}
                    type="button"
                  >
                    {verificationSending
                      ? copy.authSendingCode
                      : form.verificationId
                        ? copy.authResendCode
                        : copy.authSendCode}
                  </button>
                </div>
              : null}
            <div className="grid gap-2 text-sm font-semibold text-white/85">
              <span>{copy.accountProfileGender}</span>
              <DropdownWrapper
                align="left"
                ariaLabel={copy.accountProfileGender}
                buttonClassName="h-12 w-full rounded-xl border border-white/10 bg-purple-950/35! px-3 text-left"
                label={
                  genderOptions.find(([value]) => value === form.gender)?.[1] ||
                  copy.accountProfileGenderSelect
                }
                panelClassName="w-full"
              >
                {genderOptions.map(([value, label]) => (
                  <button
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-white/10!"
                    key={value}
                    onClick={() =>
                      setForm((current) => ({ ...current, gender: value }))
                    }
                    type="button"
                  >
                    {label}
                    {form.gender === value ? <icon>check</icon> : null}
                  </button>
                ))}
              </DropdownWrapper>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <EducationField
                autoComplete="new-password"
                label={copy.signInPassword}
                minLength={8}
                onChange={update("password")}
                required
                type="password"
                value={form.password}
              />
              <EducationField
                autoComplete="new-password"
                label={copy.accountSecurityConfirmPassword}
                minLength={8}
                onChange={update("confirmPassword")}
                required
                type="password"
                value={form.confirmPassword}
              />
            </div>
            <div className="grid gap-3 rounded-2xl border border-white/10 bg-black/10! p-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
              {captcha?.imageUrl
                ? <Image
                    alt={copy.authCaptchaAlt}
                    className="h-[90px] w-[280px] max-w-full rounded-xl"
                    height={90}
                    src={captcha.imageUrl}
                    unoptimized
                    width={280}
                  />
                : <span>{copy.loading}</span>}
              <EducationField
                autoComplete="off"
                label={copy.authCaptchaLabel}
                onChange={update("captchaAnswer")}
                required
                value={form.captchaAnswer}
              />
              <button
                aria-label={copy.authRefreshCaptcha}
                className="liquid-glass h-12 rounded-xl px-4"
                onClick={() => void loadCaptcha()}
                type="button"
              >
                <icon>refresh</icon>
              </button>
            </div>
            <button
              className="liquid-glass rounded-xl bg-purple-600/80! px-4 py-3 font-bold disabled:opacity-55"
              disabled={submitting}
              type="submit"
            >
              {submitting ? copy.accountProcessing : copy.createMunetiosAccount}
            </button>
          </form>
        : null}
    </section>
  );

  if (embedded) return content;

  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_top,#3b0764_0%,#12051f_48%,#07030d_100%)] px-3 py-5 text-white sm:px-5">
      <header className="mx-auto flex max-w-5xl items-center justify-between">
        <a
          className="liquid-glass flex items-center gap-3 rounded-2xl px-3 py-2"
          href="/"
        >
          <Image alt="Munetios" height={40} src="/favicon.ico" width={40} />
          <strong>Munetios Education</strong>
        </a>
        <a
          className="liquid-glass rounded-xl px-4 py-2 text-sm font-bold"
          href="/signin"
        >
          {copy.signIn}
        </a>
      </header>
      {content}
    </main>
  );
}
