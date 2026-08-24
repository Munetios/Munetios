"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { t } from "../i18n";
import { hasSignedInCookie } from "../lib/signedInCookie";
import DropdownWrapper from "./dropdownwrapper";
import { showModal } from "./modal";

const feedbackEndpoint = "/api/feedback";
const feedbackTypeOptions = [
  { key: "businessFeedbackTypeGeneral", value: "general" },
  { key: "businessFeedbackTypeFeatureRequest", value: "feature-request" },
  { key: "businessFeedbackTypeBugReport", value: "bug-report" },
  { key: "businessFeedbackTypeOther", value: "other" },
];

function useFeedbackCopy() {
  const [copy, setCopy] = useState(() => t());

  useEffect(() => {
    const refreshCopy = () => setCopy(t());

    window.addEventListener("languagechange", refreshCopy);
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);

    return () => {
      window.removeEventListener("languagechange", refreshCopy);
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
    };
  }, []);

  return copy;
}

function FeedbackTypeDropdown({ copy, onChange, value }) {
  const selectedOption =
    feedbackTypeOptions.find((option) => option.value === value) ||
    feedbackTypeOptions[0];

  return (
    <div>
      <div className="mb-2 block text-sm font-semibold text-white/80">
        <span data-translate="businessFeedbackType">
          {copy.businessFeedbackType}
        </span>
      </div>
      <DropdownWrapper
        align="left"
        ariaLabel={copy.businessFeedbackType}
        buttonClassName="h-11 w-full justify-between rounded-xl border border-white/10 bg-white/10! px-3 text-left hover:border-purple-200/35 hover:bg-white/15!"
        className="w-full"
        panelClassName="w-[min(22rem,calc(100vw-1rem))]"
        trigger={
          <>
            <span
              className="min-w-0 truncate"
              data-translate={selectedOption.key}
            >
              {copy[selectedOption.key]}
            </span>
            <icon>expand_more</icon>
          </>
        }
        zIndex={4100}
      >
        <div className="space-y-1">
          {feedbackTypeOptions.map((option) => (
            <button
              className="flex w-full items-center justify-between rounded-lg border border-transparent bg-transparent px-3 py-2 text-left text-sm text-white transition hover:border-white/10 hover:bg-white/10!"
              key={option.value}
              onClick={() => onChange(option.value)}
              role="menuitem"
              type="button"
            >
              <span data-translate={option.key}>{copy[option.key]}</span>
              <span
                aria-hidden="true"
                className={
                  option.value === value
                    ? "text-purple-200"
                    : "invisible opacity-0"
                }
              >
                <icon>check</icon>
              </span>
            </button>
          ))}
        </div>
      </DropdownWrapper>
    </div>
  );
}

async function captureFeedbackScreenshot() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Screen capture is unavailable");
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: false,
    video: { displaySurface: "browser" },
  });

  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    await new Promise((resolve, reject) => {
      video.addEventListener("loadedmetadata", resolve, { once: true });
      video.addEventListener("error", reject, { once: true });
      void video.play().catch(reject);
    });

    const maximumWidth = 1920;
    const scale = Math.min(1, maximumWidth / Math.max(1, video.videoWidth));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Failed to prepare screen capture");
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
}

export function FeedbackModalContent({
  close,
  context = "unknown",
  initialEmail = "",
}) {
  const copy = useFeedbackCopy();
  const [email, setEmail] = useState(initialEmail);
  const [explanation, setExplanation] = useState("");
  const [feedbackType, setFeedbackType] = useState("general");
  const [includeScreenshot, setIncludeScreenshot] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (initialEmail || !hasSignedInCookie()) return undefined;

    const controller = new AbortController();
    const prefillAccountEmail = async () => {
      try {
        const response = await fetch("/api/account", {
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        const payload = await response.json();
        const accountEmail = response.ok ? payload.email?.trim() : "";

        if (accountEmail) {
          setEmail((currentEmail) => currentEmail || accountEmail);
        }
      } catch (error) {
        if (error?.name !== "AbortError") {
          // Email remains optional when account details are unavailable.
        }
      }
    };

    void prefillAccountEmail();
    return () => controller.abort();
  }, [initialEmail]);

  const submitFeedback = async (event) => {
    event.preventDefault();

    setSubmitting(true);
    setSubmissionError("");
    try {
      let screenshot = null;
      if (includeScreenshot) {
        try {
          screenshot = await captureFeedbackScreenshot();
        } catch {
          setSubmissionError(copy.businessFeedbackScreenshotFailed);
          return;
        }
      }

      const response = await fetch(feedbackEndpoint, {
        body: JSON.stringify({
          context,
          email: email.trim(),
          explanation: explanation.trim(),
          feedbackType,
          pageUrl: window.location.href,
          screenshot,
        }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Feedback failed");
      }

      setSubmitted(true);
    } catch {
      setSubmissionError(copy.businessFeedbackFailed);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-center px-2 pb-2 pt-1 text-center">
        <Image
          alt=""
          aria-hidden="true"
          className="h-auto w-full max-w-64 object-contain"
          height="256"
          src="/feedbacksubmitted.png"
          width="256"
        />
        <h3
          className="mt-2 text-2xl font-bold text-white"
          data-translate="businessFeedbackSuccessTitle"
        >
          {copy.businessFeedbackSuccessTitle}
        </h3>
        <p
          className="mt-2 max-w-md text-sm leading-6 text-white/70"
          data-translate="businessFeedbackSuccessMessage"
        >
          {copy.businessFeedbackSuccessMessage}
        </p>
        <button
          className="liquid-glass mt-5 w-full rounded-full border border-purple-200/25 bg-purple-500/18! px-4 py-3 text-sm font-bold text-white transition hover:bg-purple-500/28!"
          data-translate="businessFeedbackDone"
          onClick={close}
          type="button"
        >
          {copy.businessFeedbackDone}
        </button>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={submitFeedback}>
      <div className="rounded-2xl border border-amber-200/20 bg-amber-400/10! px-3 py-3 text-sm leading-5 text-white/80">
        <div className="flex items-start gap-2.5">
          <icon className="mt-0.5 shrink-0 text-amber-200">privacy_tip</icon>
          <span data-translate="businessFeedbackPrivacyWarning">
            {copy.businessFeedbackPrivacyWarning}
          </span>
        </div>
      </div>
      <FeedbackTypeDropdown
        copy={copy}
        onChange={setFeedbackType}
        value={feedbackType}
      />
      <label className="block text-sm font-semibold text-white/80">
        <span>
          {copy.businessFeedbackEmail} ({copy.businessSignupOptional})
        </span>
        <input
          autoComplete="email"
          className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/10! px-3 text-white outline-none transition placeholder:text-white/40 focus:border-purple-300/60"
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          value={email}
        />
      </label>
      <label className="block text-sm font-semibold text-white/80">
        <span data-translate="businessFeedbackExplanationOptional">
          {copy.businessFeedbackExplanationOptional}
        </span>
        <textarea
          className="mt-2 min-h-32 w-full resize-y rounded-xl border border-white/10 bg-white/10! px-3 py-3 text-white outline-none transition placeholder:text-white/40 focus:border-purple-300/60"
          data-translate-placeholder="businessFeedbackExplanationPlaceholder"
          maxLength={5000}
          onChange={(event) => setExplanation(event.target.value)}
          placeholder={copy.businessFeedbackExplanationPlaceholder}
          value={explanation}
        />
      </label>
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5! px-3 py-3">
        <div className="min-w-0">
          <p
            className="text-sm font-semibold text-white"
            data-translate="businessFeedbackIncludeScreenshot"
          >
            {copy.businessFeedbackIncludeScreenshot}
          </p>
          <p
            className="mt-1 text-xs leading-5 text-white/60"
            data-translate="businessFeedbackScreenshotHint"
          >
            {copy.businessFeedbackScreenshotHint}
          </p>
        </div>
        <button
          aria-checked={includeScreenshot}
          aria-label={copy.businessFeedbackIncludeScreenshot}
          className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full border p-1 transition ${
            includeScreenshot
              ? "border-purple-200/40 bg-purple-500!"
              : "border-white/15 bg-white/10!"
          }`}
          data-translate-aria-label="businessFeedbackIncludeScreenshot"
          onClick={() => setIncludeScreenshot((currentValue) => !currentValue)}
          role="switch"
          type="button"
        >
          <span
            aria-hidden="true"
            className={`block h-5 w-5 rounded-full bg-white shadow transition ${includeScreenshot ? "translate-x-5" : ""}`}
          />
        </button>
      </div>
      {submissionError
        ? <p
            aria-live="polite"
            className="rounded-xl border border-rose-200/20 bg-rose-500/12! px-3 py-2 text-sm text-rose-100"
            role="alert"
          >
            {submissionError}
          </p>
        : null}
      <button
        className="liquid-glass w-full rounded-full border border-purple-200/25 bg-purple-500/18! px-4 py-3 text-sm font-bold text-white transition hover:border-purple-100/40 hover:bg-purple-500/28! disabled:cursor-not-allowed disabled:opacity-60"
        disabled={submitting}
        type="submit"
      >
        <span
          data-translate={
            submitting ? "businessFeedbackSubmitting" : "businessFeedbackSubmit"
          }
        >
          {submitting
            ? copy.businessFeedbackSubmitting
            : copy.businessFeedbackSubmit}
        </span>
      </button>
    </form>
  );
}

export function openFeedbackModal({
  context = "unknown",
  initialEmail = "",
} = {}) {
  const copy = t();

  return showModal(
    ({ close }) => (
      <FeedbackModalContent
        close={close}
        context={context}
        initialEmail={initialEmail}
      />
    ),
    {
      ariaLabel: copy.businessFeedbackTitle,
      contentClassName: "overscroll-contain pr-1",
      height: "min(46rem, calc(100dvh - 1.5rem))",
      title: copy.businessFeedbackTitle,
      width: "36rem",
    },
  );
}
