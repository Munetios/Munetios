"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import {
  AsYouType,
  getCountryCallingCode,
  getCountries as getPhoneCountryCodes,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
} from "libphonenumber-js";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentLocale, t } from "../i18n";
import {
  appearanceThemes,
  applyAppearanceSettings,
  getResolvedThemeMode,
  loadAppearanceSettings,
} from "./appearanceRuntime";
import DatePicker from "./datePicker";
import DropdownWrapper from "./dropdownwrapper";
import { openFeedbackModal } from "./feedbackModal";
import LanguageSelector from "./languageSelector";
import { showToast } from "./toast";

function getPhoneCountries(locale) {
  let displayNames = null;
  try {
    displayNames = new Intl.DisplayNames([locale], { type: "region" });
  } catch {
    displayNames = new Intl.DisplayNames(["en"], { type: "region" });
  }

  return getPhoneCountryCodes()
    .map((code) => ({
      code,
      dial: `+${getCountryCallingCode(code)}`,
      name: displayNames.of(code) || code,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, locale));
}

const genderOptions = [
  { key: "authGenderNotSpecified", value: "" },
  { key: "authGenderWoman", value: "woman" },
  { key: "authGenderMan", value: "man" },
  { key: "authGenderNonBinary", value: "nonbinary" },
  { key: "authGenderOther", value: "other" },
];

function getSafeReturnTo() {
  if (typeof window === "undefined") return "/";
  const value = new URL(window.location.href).searchParams.get("returnTo");
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function getAge(birthDate) {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
  ) {
    age -= 1;
  }
  return age;
}

function usernameFromEmail(value) {
  return String(value || "")
    .split("@")[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 30);
}

function formatPhoneInput(value, country) {
  const normalized = String(value || "").replace(/[^\d+]/g, "");
  return new AsYouType(country).input(normalized);
}

function getInternationalPhone(value, country) {
  return parsePhoneNumberFromString(String(value || ""), country)?.number || "";
}

function AuthInput({
  autoComplete,
  icon,
  inputMode,
  label,
  name,
  onChange,
  required = true,
  type = "text",
  value,
}) {
  return (
    <label className="block text-sm font-semibold text-white/80">
      <span>{label}</span>
      <span className="relative mt-2 block">
        <icon className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-purple-200">
          {icon}
        </icon>
        <input
          autoComplete={autoComplete}
          className="h-12 w-full rounded-xl border border-white/10 bg-white/10! px-4 pl-11 text-white outline-none transition focus:border-purple-300/70 focus:bg-white/15!"
          inputMode={inputMode}
          name={name}
          onChange={onChange}
          required={required}
          type={type}
          value={value}
        />
      </span>
    </label>
  );
}

function CookieWarning({ copy }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-300/25 bg-amber-500/12! p-3 text-sm text-amber-100">
      <icon>cookie_off</icon>
      <span>{copy.authCookiesRequired}</span>
    </div>
  );
}

function PasswordInput({ copy, onChange, value }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="block text-sm font-semibold text-white/80">
      <span>{copy.signInPassword}</span>
      <span className="relative mt-2 block">
        <icon className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-purple-200">
          lock
        </icon>
        <input
          autoComplete="current-password"
          className="h-12 w-full rounded-xl border border-white/10 bg-white/10! px-11 text-white outline-none transition focus:border-purple-300/70 focus:bg-white/15!"
          minLength={12}
          name="password"
          onChange={onChange}
          required
          type={visible ? "text" : "password"}
          value={value}
        />
        <button
          aria-label={
            visible ? copy.signInHidePassword : copy.signInShowPassword
          }
          className="absolute right-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10! hover:text-white"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          <icon>{visible ? "visibility_off" : "visibility"}</icon>
        </button>
      </span>
    </label>
  );
}

function ThemeSelector({
  buttonClassName = "h-12 w-12 justify-center rounded-xl border border-white/10 bg-white/10! hover:bg-white/15!",
  copy,
}) {
  const [themeId, setThemeId] = useState(() => loadAppearanceSettings().theme);
  const [themeMode, setThemeMode] = useState(
    () => loadAppearanceSettings().themeMode,
  );
  const theme =
    appearanceThemes.find((item) => item.id === themeId) || appearanceThemes[0];
  const resolvedThemeMode = getResolvedThemeMode(themeMode);

  const applySettings = (settings) => {
    window.localStorage.setItem(
      "munetios.appearance",
      JSON.stringify(settings),
    );
    applyAppearanceSettings(settings);
    window.dispatchEvent(
      new CustomEvent("munetios:appearance-change", { detail: settings }),
    );
  };

  const selectTheme = (nextTheme) => {
    const currentSettings = loadAppearanceSettings();
    const settings = {
      ...currentSettings,
      theme: nextTheme.id,
      themeMode: nextTheme.lightOnly ? "light" : currentSettings.themeMode,
    };
    applySettings(settings);
    setThemeId(nextTheme.id);
    setThemeMode(settings.themeMode);
  };

  const toggleThemeMode = () => {
    const nextThemeMode = resolvedThemeMode === "dark" ? "light" : "dark";
    const settings = {
      ...loadAppearanceSettings(),
      themeMode: nextThemeMode,
    };
    applySettings(settings);
    setThemeMode(nextThemeMode);
  };

  return (
    <DropdownWrapper
      align="right"
      ariaLabel={copy.signInTheme}
      buttonClassName={buttonClassName}
      panelClassName="max-h-80 w-[min(22rem,calc(100vw-1rem))] overflow-y-auto"
      placement="top"
      trigger={<icon>palette</icon>}
    >
      <div className="mb-2 flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5! px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-sm text-white">
          <icon>
            {resolvedThemeMode === "dark" ? "dark_mode" : "light_mode"}
          </icon>
          <span>
            {resolvedThemeMode === "dark"
              ? copy.accountAppearanceModeDark
              : copy.accountAppearanceModeLight}
          </span>
        </span>
        <button
          aria-label={copy.accountAppearanceColorMode}
          aria-checked={resolvedThemeMode === "dark"}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition ${resolvedThemeMode === "dark" ? "border-purple-200/35 bg-purple-500/70!" : "border-white/15 bg-white/10!"}`}
          onClick={toggleThemeMode}
          role="switch"
          type="button"
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${resolvedThemeMode === "dark" ? "left-6" : "left-1"}`}
          />
        </button>
      </div>
      <div className="space-y-1 border-t border-white/10 pt-2">
        {appearanceThemes.map((option) => (
          <button
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-white transition hover:bg-white/10!"
            key={option.id}
            onClick={() => selectTheme(option)}
            type="button"
          >
            <span>{copy[option.labelKey] || option.id}</span>
            {option.id === theme.id ? <icon>check</icon> : null}
          </button>
        ))}
      </div>
    </DropdownWrapper>
  );
}

function SignUpMenu({ copy, openSelfSignup }) {
  return (
    <DropdownWrapper
      align="right"
      ariaLabel={copy.signUp}
      buttonClassName="h-11 rounded-xl bg-purple-600/75! px-4 font-semibold text-white hover:bg-purple-500/90!"
      label={copy.signUp}
      panelClassName="w-[min(20rem,calc(100vw-1rem))]"
    >
      <div className="space-y-1">
        <button
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/10!"
          onClick={openSelfSignup}
          type="button"
        >
          <icon>person</icon>
          {copy.signUpForMyself}
        </button>
        <button
          aria-disabled="true"
          className="flex w-full cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-white/45"
          disabled
          type="button"
        >
          <icon>child_care</icon>
          {copy.signUpForMyChild}
        </button>
        <a
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/10!"
          href="/business/signup?plan=business-free"
        >
          <icon>business</icon>
          {copy.signUpForMyBusiness}
        </a>
      </div>
    </DropdownWrapper>
  );
}

export default function SignInScreen() {
  const [locale, setLocale] = useState(() => getCurrentLocale());
  const [copy, setCopy] = useState(() => t());
  const [mode, setMode] = useState("signin");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cookiesEnabled, setCookiesEnabled] = useState(null);
  const [verificationSending, setVerificationSending] = useState(false);
  const [signup, setSignup] = useState({
    birthDate: "",
    captchaAnswer: "",
    contact: "",
    contactMode: "munetios",
    country: "US",
    firstName: "",
    gender: "",
    lastName: "",
    password: "",
    username: "",
    verificationCode: "",
    verificationId: "",
  });
  const [captcha, setCaptcha] = useState(null);
  const countries = useMemo(() => getPhoneCountries(locale), [locale]);
  const selectedCountry = useMemo(
    () =>
      countries.find((country) => country.code === signup.country) ||
      countries[0],
    [countries, signup.country],
  );

  const completeAuthentication = useCallback(() => {
    const addAccount =
      new URL(window.location.href).searchParams.get("addAccount") === "true";
    if (addAccount && window.parent !== window) {
      window.parent.postMessage(
        { type: "munetios:account-added" },
        window.location.origin,
      );
      return;
    }
    window.location.assign(getSafeReturnTo());
  }, []);

  const checkAuthenticationCookies = useCallback(
    async ({ notify = true } = {}) => {
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await fetch("/api/auth/cookie-check", {
            cache: "no-store",
            credentials: "include",
          });
          const payload = await response.json().catch(() => ({}));
          if (response.ok && payload.enabled === true) {
            setCookiesEnabled(true);
            return true;
          }
        }
      } catch {}
      setCookiesEnabled(false);
      if (notify) {
        showToast({ messageKey: "authCookiesRequired", type: "error" });
      }
      return false;
    },
    [],
  );

  useEffect(() => {
    void checkAuthenticationCookies({ notify: false });
  }, [checkAuthenticationCookies]);

  useEffect(() => {
    if (new URL(window.location.href).searchParams.get("signup") === "true") {
      setMode("signup");
    }

    const refreshCopy = () => {
      const nextLocale = getCurrentLocale();
      setLocale(nextLocale);
      setCopy(t(nextLocale));
    };
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);
    return () => {
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
    };
  }, []);

  const loadCaptcha = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/captcha", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error("Captcha unavailable");
      setCaptcha(payload);
      setSignup((current) => ({ ...current, captchaAnswer: "" }));
    } catch {
      showToast({ messageKey: "authCaptchaUnavailable", type: "error" });
    }
  }, []);

  useEffect(() => {
    if (mode === "signup" && !captcha) void loadCaptcha();
  }, [captcha, loadCaptcha, mode]);

  const submitSignIn = async (event) => {
    event.preventDefault();
    if (!(await checkAuthenticationCookies())) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/signin", {
        body: JSON.stringify({ identifier, password }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "signin_failed");
      window.dispatchEvent(new CustomEvent("munetios:authchange"));
      completeAuthentication();
    } catch (error) {
      showToast({
        messageKey:
          {
            account_not_found: "authAccountDoesNotExist",
            demo_signin_disabled: "authDemoSignInDisabled",
          }[error.message] || "failedSignIn",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const requestVerification = async () => {
    const identifierValue =
      signup.contactMode === "phone"
        ? getInternationalPhone(signup.contact, signup.country)
        : signup.contact;
    if (
      signup.contactMode === "phone" &&
      !isValidPhoneNumber(identifierValue)
    ) {
      showToast({ messageKey: "authVerificationFailed", type: "error" });
      return false;
    }
    setVerificationSending(true);
    try {
      const response = await fetch("/api/auth/verification", {
        body: JSON.stringify({ identifier: identifierValue }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || "verification_failed");
        error.reason = payload.reason;
        throw error;
      }
      setSignup((current) => ({
        ...current,
        verificationCode: "",
        verificationId: payload.verificationId,
      }));
      showToast({ messageKey: "authVerificationSent", type: "success" });
      return true;
    } catch (error) {
      const messageKey =
        error.reason === "sms_delivery_not_configured"
          ? "authSmsVerificationUnavailable"
          : {
              email_taken: "authEmailTaken",
              phone_taken: "authPhoneTaken",
              rate_limited: "authVerificationRateLimited",
            }[error.message] || "authVerificationFailed";
      showToast({
        messageKey,
        type: "error",
      });
      return false;
    } finally {
      setVerificationSending(false);
    }
  };

  const submitSignup = async (event) => {
    event.preventDefault();
    if (!(await checkAuthenticationCookies())) return;
    const age = getAge(signup.birthDate);
    if (age !== null && age < 13) {
      showToast({ messageKey: "authParentRequired", type: "warning" });
      return;
    }

    if (signup.contactMode !== "munetios" && !signup.verificationId) {
      await requestVerification();
      return;
    }
    if (signup.contactMode !== "munetios" && !signup.verificationCode.trim()) {
      showToast({ messageKey: "authVerificationRequired", type: "warning" });
      return;
    }

    const contact =
      signup.contactMode === "munetios"
        ? `${signup.username.trim().toLowerCase()}@munetios.com`
        : signup.contactMode === "phone"
          ? getInternationalPhone(signup.contact, signup.country)
          : signup.contact.trim().toLowerCase();
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/signup", {
        body: JSON.stringify({
          birthDate: signup.birthDate,
          captchaAnswer: signup.captchaAnswer,
          captchaChallengeId: captcha?.challengeId,
          contact,
          contactType: signup.contactMode === "phone" ? "phone" : "email",
          firstName: signup.firstName,
          gender: signup.gender,
          lastName: signup.lastName,
          password: signup.password,
          username: signup.username,
          verificationCode: signup.verificationCode,
          verificationId: signup.verificationId,
        }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "signup_failed");
      window.dispatchEvent(new CustomEvent("munetios:authchange"));
      completeAuthentication();
    } catch (error) {
      const errorKey = {
        account_already_exists: "authAccountAlreadyUsed",
        email_taken: "authEmailTaken",
        invalid_captcha: "authCaptchaInvalid",
        parent_required: "authParentRequired",
        phone_taken: "authPhoneTaken",
        verification_required: "authVerificationRequired",
      }[error.message];
      showToast({ messageKey: errorKey || "authSignupFailed", type: "error" });
      void loadCaptcha();
    } finally {
      setSubmitting(false);
    }
  };

  const signInWithPasskey = async () => {
    if (!window.PublicKeyCredential) {
      showToast({ messageKey: "authPasskeyUnavailable", type: "error" });
      return;
    }
    setSubmitting(true);
    try {
      const optionsResponse = await fetch(
        "/api/auth/passkey/authenticate/options",
        { method: "POST" },
      );
      const optionsPayload = await optionsResponse.json().catch(() => ({}));
      if (!optionsResponse.ok) throw new Error(optionsPayload.error);
      const credential = await startAuthentication({
        optionsJSON: optionsPayload.options,
      });
      const verifyResponse = await fetch(
        "/api/auth/passkey/authenticate/verify",
        {
          body: JSON.stringify({
            challengeId: optionsPayload.challengeId,
            credential,
          }),
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      if (!verifyResponse.ok) throw new Error("passkey_signin_failed");
      window.dispatchEvent(new CustomEvent("munetios:authchange"));
      completeAuthentication();
    } catch {
      showToast({ messageKey: "authPasskeyNoCredential", type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="signinApp flex h-screen flex-row text-white">
      <div className="signin-background flex h-full w-full">
        <div className="hidden h-full flex-col items-start justify-start p-4 md:flex! md:w-1/2">
          <div className="logo text-2xl font-bold">Munetios</div>
          <div
            className="m-auto flex h-full items-center justify-center text-center"
            id="signinLeftContainer"
          >
            <h1
              className="mb-4 text-3xl font-bold"
              data-translate="signInAccountHeading"
            >
              {copy.signInAccountHeading}
            </h1>
          </div>
          <div
            className="mt-8 flex w-full justify-between"
            id="signInFooterSettings"
          >
            <div id="languageSelectorBtn">
              <LanguageSelector
                buttonClassName="liquid-glass h-12 p-4 transition-all hover:bg-white/20!"
                className="min-w-48"
                copy={copy}
                placement="top"
              />
            </div>
            <div id="themeToggle">
              <ThemeSelector
                buttonClassName="liquid-glass h-12 w-12 justify-center transition-all hover:bg-white/20!"
                copy={copy}
              />
            </div>
          </div>
        </div>
        <div
          className="liquid-glass h-full w-full p-4 md:w-1/2"
          id="signinRightContainer"
        >
          <div
            className="flex h-16 w-full items-center justify-between p-4"
            id="signInHeader"
          >
            <div className="logo flex items-center gap-4 p-2">
              <Image
                alt={copy.landingLogoAlt}
                className="h-14 w-14"
                data-translate-alt="landingLogoAlt"
                height={56}
                src="/favicon.ico"
                width={56}
              />
              <h1 className="text-3xl font-bold" data-translate="signIn">
                {mode === "signin" ? copy.signIn : copy.signUp}
              </h1>
            </div>
            {mode === "signin"
              ? <SignUpMenu
                  copy={copy}
                  openSelfSignup={() => setMode("signup")}
                />
              : <button
                  className="h-11 rounded-xl border border-white/10 bg-white/10! px-4 text-sm font-semibold hover:bg-white/15!"
                  onClick={() => setMode("signin")}
                  type="button"
                >
                  {copy.signIn}
                </button>}
          </div>
          <div
            className="flex h-[calc(100%-4rem)] w-full items-start justify-center overflow-y-auto px-2 py-6"
            id="signInFormContainer"
          >
            {mode === "signin"
              ? <form
                  className="w-full max-w-md space-y-5"
                  onSubmit={submitSignIn}
                >
                  {cookiesEnabled === false
                    ? <CookieWarning copy={copy} />
                    : null}
                  <div>
                    <h1 className="text-3xl font-bold tracking-[-0.03em]">
                      {copy.signIn}
                    </h1>
                    <p className="mt-2 text-sm leading-6 text-white/65">
                      {copy.authWelcomeBack}
                    </p>
                  </div>
                  <AuthInput
                    autoComplete="username"
                    icon="alternate_email"
                    label={copy.signInEmailOrPhone}
                    name="identifier"
                    onChange={(event) => setIdentifier(event.target.value)}
                    value={identifier}
                  />
                  <PasswordInput
                    copy={copy}
                    onChange={(event) => setPassword(event.target.value)}
                    value={password}
                  />
                  <div className="flex flex-wrap justify-between gap-3 text-sm">
                    <a
                      className="text-purple-200 hover:underline"
                      href="/forgot-password"
                    >
                      {copy.forgotPassword}
                    </a>
                    <a
                      className="text-purple-200 hover:underline"
                      href="/forgot-email"
                    >
                      {copy.forgotEmail}
                    </a>
                  </div>
                  <button
                    className="liquid-glass w-full rounded-xl bg-purple-600/80! px-4 py-3 font-semibold text-white transition hover:bg-purple-500/90! disabled:opacity-60"
                    disabled={submitting || cookiesEnabled === false}
                    type="submit"
                  >
                    {submitting ? copy.authSigningIn : copy.signIn}
                  </button>
                  <div className="flex items-center gap-3 text-xs uppercase tracking-[0.16em] text-white/45">
                    <span className="h-px flex-1 bg-white/10" />
                    {copy.authOr}
                    <span className="h-px flex-1 bg-white/10" />
                  </div>
                  <button
                    className="liquid-glass flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/8! px-4 py-3 font-semibold hover:bg-white/14!"
                    onClick={signInWithPasskey}
                    type="button"
                  >
                    <icon>passkey</icon>
                    {copy.signInWithPasskey}
                  </button>
                </form>
              : <form
                  className="w-full max-w-xl space-y-5"
                  onSubmit={submitSignup}
                >
                  {cookiesEnabled === false
                    ? <CookieWarning copy={copy} />
                    : null}
                  <div>
                    <h1 className="text-3xl font-bold tracking-[-0.03em]">
                      {copy.createMunetiosAccount}
                    </h1>
                    <p className="mt-2 text-sm leading-6 text-white/65">
                      {copy.authCreateAccountDescription}
                    </p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <AuthInput
                      autoComplete="given-name"
                      icon="person"
                      label={copy.authFirstName}
                      name="firstName"
                      onChange={(event) =>
                        setSignup((current) => ({
                          ...current,
                          firstName: event.target.value,
                        }))
                      }
                      value={signup.firstName}
                    />
                    <AuthInput
                      autoComplete="family-name"
                      icon="person_outline"
                      label={copy.authLastNameOptional}
                      name="lastName"
                      onChange={(event) =>
                        setSignup((current) => ({
                          ...current,
                          lastName: event.target.value,
                        }))
                      }
                      required={false}
                      value={signup.lastName}
                    />
                  </div>
                  {signup.contactMode === "phone"
                    ? <div className="grid items-end gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
                        <div className="min-w-0">
                          <div className="mb-2 text-sm font-semibold text-white/80">
                            {copy.authCountry}
                          </div>
                          <DropdownWrapper
                            align="left"
                            ariaLabel={copy.authCountry}
                            buttonClassName="h-12 w-full justify-between rounded-xl border border-white/10 bg-white/10! px-3 text-left hover:border-purple-200/35 hover:bg-white/15!"
                            panelClassName="max-h-72 w-[min(24rem,calc(100vw-1rem))] overflow-y-auto"
                            trigger={
                              <>
                                <span className="truncate">
                                  {selectedCountry.code} {selectedCountry.dial}
                                </span>
                                <icon>expand_more</icon>
                              </>
                            }
                          >
                            {countries.map((country) => (
                              <button
                                className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/10!"
                                key={country.code}
                                onClick={() =>
                                  setSignup((current) => ({
                                    ...current,
                                    contact: formatPhoneInput(
                                      current.contact,
                                      country.code,
                                    ),
                                    country: country.code,
                                    verificationCode: "",
                                    verificationId: "",
                                  }))
                                }
                                type="button"
                              >
                                <span className="truncate">{country.name}</span>
                                <span className="shrink-0 text-white/60">
                                  {country.dial}
                                </span>
                              </button>
                            ))}
                          </DropdownWrapper>
                        </div>
                        <AuthInput
                          autoComplete="tel-national"
                          icon="phone"
                          inputMode="tel"
                          label={copy.authPhoneNumber}
                          name="phone"
                          onChange={(event) =>
                            setSignup((current) => ({
                              ...current,
                              contact: formatPhoneInput(
                                event.target.value,
                                current.country,
                              ),
                              verificationCode: "",
                              verificationId: "",
                            }))
                          }
                          value={signup.contact}
                        />
                      </div>
                    : <label className="block text-sm font-semibold text-white/80">
                        <span>
                          {signup.contactMode === "existing"
                            ? copy.authEmailAddress
                            : copy.authMunetiosEmail}
                        </span>
                        <span className="relative mt-2 flex h-12 overflow-hidden rounded-xl border border-white/10 bg-white/10! focus-within:border-purple-300/70">
                          <icon className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-purple-200">
                            alternate_email
                          </icon>
                          <input
                            autoComplete={
                              signup.contactMode === "existing"
                                ? "email"
                                : "username"
                            }
                            className="min-w-0 flex-1 bg-transparent! py-2 pl-11 pr-2 text-white outline-none"
                            name="email"
                            onChange={(event) =>
                              setSignup((current) =>
                                current.contactMode === "existing"
                                  ? {
                                      ...current,
                                      contact: event.target.value,
                                      username: usernameFromEmail(
                                        event.target.value,
                                      ),
                                      verificationCode: "",
                                      verificationId: "",
                                    }
                                  : {
                                      ...current,
                                      username: event.target.value,
                                    },
                              )
                            }
                            required
                            type={
                              signup.contactMode === "existing"
                                ? "email"
                                : "text"
                            }
                            value={
                              signup.contactMode === "existing"
                                ? signup.contact
                                : signup.username
                            }
                          />
                          {signup.contactMode !== "existing"
                            ? <span className="flex shrink-0 items-center border-l border-white/10 bg-white/5! px-3 text-sm text-white/65">
                                @munetios.com
                              </span>
                            : null}
                        </span>
                      </label>}
                  <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    {[
                      ["existing", copy.authUseExistingEmailAddress],
                      ["phone", copy.authUsePhoneNumberInstead],
                    ].map(([value, label]) => (
                      <button
                        aria-pressed={signup.contactMode === value}
                        className={`rounded-lg px-1 py-1 text-purple-200 transition hover:text-white hover:underline ${signup.contactMode === value ? "font-semibold underline" : ""}`}
                        key={value}
                        onClick={() =>
                          setSignup((current) => ({
                            ...current,
                            contact: "",
                            contactMode:
                              current.contactMode === value
                                ? "munetios"
                                : value,
                            verificationCode: "",
                            verificationId: "",
                          }))
                        }
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <DatePicker
                    copy={copy}
                    label={copy.authBirthday}
                    onChange={(birthDate) =>
                      setSignup((current) => ({
                        ...current,
                        birthDate,
                      }))
                    }
                    value={signup.birthDate}
                  />
                  <div>
                    <div className="mb-2 text-sm font-semibold text-white/80">
                      {copy.authGenderOptional}
                    </div>
                    <DropdownWrapper
                      align="left"
                      ariaLabel={copy.authGenderOptional}
                      buttonClassName="h-12 w-full justify-between rounded-xl border border-white/10 bg-white/10! px-3 text-left hover:border-purple-200/35 hover:bg-white/15!"
                      panelClassName="w-[min(22rem,calc(100vw-1rem))]"
                      trigger={
                        <>
                          <span>
                            {
                              copy[
                                genderOptions.find(
                                  (option) => option.value === signup.gender,
                                )?.key || "authGenderNotSpecified"
                              ]
                            }
                          </span>
                          <icon>expand_more</icon>
                        </>
                      }
                    >
                      {genderOptions.map((option) => (
                        <button
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/10!"
                          key={option.key}
                          onClick={() =>
                            setSignup((current) => ({
                              ...current,
                              gender: option.value,
                            }))
                          }
                          type="button"
                        >
                          <span>{copy[option.key]}</span>
                          {signup.gender === option.value
                            ? <icon>check</icon>
                            : null}
                        </button>
                      ))}
                    </DropdownWrapper>
                  </div>
                  {getAge(signup.birthDate) !== null &&
                  getAge(signup.birthDate) < 13
                    ? <div className="rounded-xl border border-amber-300/25 bg-amber-500/12! p-3 text-sm text-amber-100">
                        {copy.authParentRequired}
                      </div>
                    : null}
                  {signup.contactMode !== "munetios"
                    ? <div className="space-y-3">
                        {signup.verificationId
                          ? <AuthInput
                              autoComplete="one-time-code"
                              icon="verified_user"
                              label={copy.authVerificationCode}
                              name="verification"
                              onChange={(event) =>
                                setSignup((current) => ({
                                  ...current,
                                  verificationCode: event.target.value,
                                }))
                              }
                              value={signup.verificationCode}
                            />
                          : null}
                        <button
                          className="w-full rounded-xl border border-purple-200/20 bg-purple-600/45! px-4 py-3 text-sm font-semibold hover:bg-purple-500/60! disabled:opacity-60"
                          disabled={
                            verificationSending ||
                            cookiesEnabled === false ||
                            !signup.contact.trim()
                          }
                          onClick={requestVerification}
                          type="button"
                        >
                          {verificationSending
                            ? copy.authSendingCode
                            : signup.verificationId
                              ? copy.authResendCode
                              : copy.authSendCode}
                        </button>
                      </div>
                    : null}
                  <PasswordInput
                    copy={copy}
                    onChange={(event) =>
                      setSignup((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    value={signup.password}
                  />
                  <p className="text-xs leading-5 text-white/50">
                    {copy.authPasswordRequirements}
                  </p>
                  <div className="rounded-2xl border border-white/10 bg-white/5! p-3">
                    <div className="flex items-center gap-3">
                      {captcha?.imageUrl
                        ? <Image
                            alt={copy.authCaptchaAlt}
                            className="h-[90px] min-w-0 flex-1 rounded-xl object-contain"
                            height={90}
                            src={captcha.imageUrl}
                            unoptimized
                            width={280}
                          />
                        : <div className="h-[90px] flex-1 animate-pulse rounded-xl bg-white/10!" />}
                      <button
                        aria-label={copy.authRefreshCaptcha}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10! hover:bg-white/15!"
                        onClick={loadCaptcha}
                        type="button"
                      >
                        <icon>refresh</icon>
                      </button>
                    </div>
                    <div className="mt-3">
                      <AuthInput
                        autoComplete="off"
                        icon="shield_lock"
                        label={copy.authCaptchaLabel}
                        name="captcha"
                        onChange={(event) =>
                          setSignup((current) => ({
                            ...current,
                            captchaAnswer: event.target.value,
                          }))
                        }
                        value={signup.captchaAnswer}
                      />
                    </div>
                  </div>
                  <button
                    className="liquid-glass w-full rounded-xl bg-purple-600/80! px-4 py-3 font-semibold text-white hover:bg-purple-500/90! disabled:opacity-60"
                    disabled={
                      submitting ||
                      cookiesEnabled === false ||
                      (getAge(signup.birthDate) !== null &&
                        getAge(signup.birthDate) < 13)
                    }
                    type="submit"
                  >
                    {submitting ? copy.authCreatingAccount : copy.signUp}
                  </button>
                  <p className="text-center text-xs leading-5 text-white/55">
                    {copy.authBySigningUp}{" "}
                    <a
                      className="text-purple-200 hover:underline"
                      href="/terms"
                    >
                      {copy.footerTerms}
                    </a>{" "}
                    {copy.authAnd}{" "}
                    <a
                      className="text-purple-200 hover:underline"
                      href="/privacy"
                    >
                      {copy.footerPrivacy}
                    </a>
                    .
                  </p>
                </form>}
          </div>
        </div>
      </div>
      <button
        aria-label={copy.businessFeedback}
        className="liquid-glass fixed bottom-4 right-4 z-[1200] flex h-12 items-center gap-2 rounded-2xl border border-white/10 bg-purple-950/40! px-4 text-sm font-semibold text-white shadow-xl transition hover:bg-purple-900/55!"
        onClick={() => openFeedbackModal({ context: "signin" })}
        type="button"
      >
        <icon>feedback</icon>
        <span>{copy.businessFeedback}</span>
      </button>
    </div>
  );
}
