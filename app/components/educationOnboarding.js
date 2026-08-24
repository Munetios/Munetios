"use client";

import { useEffect } from "react";
import { t } from "../i18n";
import { hasSignedInCookie } from "../lib/signedInCookie";
import { showModal } from "./modal";
import { showToast } from "./toast";

let onboardingChecked = false;

function SchoolAddressForm({ close, copy }) {
  const save = async (schoolAddress = "") => {
    const response = await fetch("/api/education/profile", {
      body: JSON.stringify({ schoolAddress }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    if (!response.ok) {
      showToast({ messageKey: "educationSchoolAddressFailed", type: "error" });
      return;
    }
    close();
  };
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save(new FormData(event.currentTarget).get("schoolAddress"));
      }}
    >
      <label className="grid gap-2 text-sm font-semibold">
        {copy.educationSchoolAddress}
        <input
          autoComplete="street-address"
          className="h-12 rounded-xl border border-white/10 bg-purple-950/35! px-3 outline-none focus:border-purple-300/55"
          maxLength={240}
          name="schoolAddress"
        />
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          className="rounded-xl px-4 py-2 text-sm font-semibold text-white/70 hover:bg-white/10!"
          onClick={() => void save("")}
          type="button"
        >
          {copy.educationSkip}
        </button>
        <button
          className="liquid-glass rounded-xl bg-purple-600/75! px-4 py-2 text-sm font-bold"
          type="submit"
        >
          {copy.aiChatSave}
        </button>
      </div>
    </form>
  );
}

export default function EducationOnboarding() {
  useEffect(() => {
    if (
      onboardingChecked ||
      window.location.pathname !== "/apps" ||
      !hasSignedInCookie()
    ) {
      return;
    }
    onboardingChecked = true;
    fetch("/api/education/profile", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const profile = payload?.profile;
        if (
          profile?.role !== "teacher" ||
          profile.schoolAddressPromptDismissed
        ) {
          return;
        }
        const copy = t();
        showModal(
          ({ close }) => <SchoolAddressForm close={close} copy={copy} />,
          {
            ariaLabel: copy.educationSchoolAddressTitle,
            dismissible: false,
            title: copy.educationSchoolAddressTitle,
          },
        );
      })
      .catch(() => {});
  }, []);
  return null;
}
