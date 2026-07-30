"use client";

import { useState } from "react";
import { t } from "../i18n";
import LoadingSpinner from "./loadingSpinner";
import { showToast } from "./toast";

export default function BusinessCustomSignIn({ business }) {
  const copy = t();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const signIn = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/signin", {
        body: JSON.stringify({ identifier, password }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("signin_failed");
      }
      window.location.assign("/");
    } catch {
      showToast({ messageKey: "failedSignIn", type: "error" });
      setSubmitting(false);
    }
  };

  return (
    <main
      className="flex min-h-dvh items-center justify-center px-4 py-16 text-white"
      style={{
        backgroundColor: business.backgroundColor,
        backgroundImage: business.backgroundImage
          ? `url("${business.backgroundImage}")`
          : undefined,
        backgroundPosition: "center",
        backgroundSize: "cover",
      }}
    >
      <header className="fixed left-0 top-0 z-20 flex w-full items-center justify-between bg-transparent p-3">
        <div className="liquid-glass topbar-left flex min-h-12 items-center gap-3 rounded-2xl border border-white/10 bg-purple-950/30! px-4">
          <icon>business</icon>
          <span className="font-bold">{business.title || business.name}</span>
        </div>
        <a
          className="liquid-glass topbar-right flex min-h-12 items-center gap-2 rounded-2xl border border-white/10 bg-purple-950/30! px-4 text-sm font-semibold"
          href="/help"
        >
          <icon>help</icon>
          {copy.aiProfileHelp}
        </a>
      </header>

      <form
        className="liquid-glass w-full max-w-md rounded-3xl border border-white/10 bg-purple-950/30! p-6 shadow-2xl shadow-purple-950/25"
        onSubmit={signIn}
      >
        <div
          className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15"
          style={{ backgroundColor: business.accentColor }}
        >
          <icon>business_center</icon>
        </div>
        <h1 className="text-2xl font-bold">{business.heading}</h1>
        {business.message
          ? <p className="mt-2 text-sm leading-6 text-white/65">
              {business.message}
            </p>
          : null}
        <label className="mt-6 block text-sm font-semibold text-white/80">
          {copy.signInEmailOrPhone}
          <input
            autoComplete="username"
            className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-white/10! px-4 outline-none focus:border-purple-300/60"
            onChange={(event) => setIdentifier(event.target.value)}
            required
            value={identifier}
          />
        </label>
        <label className="mt-4 block text-sm font-semibold text-white/80">
          {copy.signInPassword}
          <input
            autoComplete="current-password"
            className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-white/10! px-4 outline-none focus:border-purple-300/60"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        <button
          className="liquid-glass mt-6 flex h-12 w-full items-center justify-center rounded-xl border border-white/15 px-4 font-bold disabled:opacity-55"
          disabled={submitting}
          style={{ backgroundColor: business.accentColor }}
          type="submit"
        >
          {submitting
            ? <LoadingSpinner label={copy.accountProcessing} />
            : copy.signIn}
        </button>
        {business.oauthProviders?.github
          ? <a
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10! font-bold"
              href={`/api/auth/github?returnTo=${encodeURIComponent("/")}`}
            >
              <svg
                aria-hidden="true"
                className="h-5 w-5 fill-current"
                viewBox="0 0 24 24"
              >
                <path d="M12 .7A11.5 11.5 0 0 0 8.36 23.1c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.38.97.1-.75.4-1.27.74-1.56-2.57-.3-5.27-1.29-5.27-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.19-1.49 3.15-1.18 3.15-1.18.64 1.59.24 2.76.12 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.71 5.39-5.29 5.68.42.36.79 1.06.79 2.15v3.26c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
              </svg>
              {copy.signInWithGitHub}
            </a>
          : null}
        {business.quickCardsEnabled
          ? <p className="mt-4 text-center text-xs leading-5 text-white/55">
              {copy.adminQuickCardCustomSignInHint}
            </p>
          : null}
      </form>
    </main>
  );
}
