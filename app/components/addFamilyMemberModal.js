"use client";

import { useState } from "react";
import DropdownWrapper from "./dropdownwrapper";
import { showToast } from "./toast";

const roleErrorKeys = {
  account_is_adult: "familyErrorAccountIsAdult",
  account_not_found: "familyErrorAccountNotFound",
  already_in_family: "familyErrorAlreadyInFamily",
  already_member: "familyErrorAlreadyMember",
  cannot_add_self: "familyErrorCannotAddSelf",
  invalid_email: "familyErrorInvalidEmail",
  not_authorized: "familyErrorNotAuthorized",
};

export default function AddFamilyMemberModal({ close, copy, onAdded }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("child");
  const [submitting, setSubmitting] = useState(false);
  const roleOptions = [
    ["adult", copy.familyRoleAdult],
    ["teen", copy.familyRoleTeen],
    ["child", copy.familyRoleChild],
  ];

  const submit = async () => {
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/account/family", {
        body: JSON.stringify({ email: email.trim(), role }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast({
          message:
            copy[roleErrorKeys[payload?.error]] ||
            copy.familyAddMemberErrorGeneric,
          type: "error",
        });
        return;
      }
      onAdded?.(payload.member);
      close();
    } catch {
      showToast({ message: copy.familyAddMemberErrorGeneric, type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-white/70">
        {copy.familyAddMemberDescription}
      </p>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">{copy.familyMemberEmail}</span>
        <input
          autoComplete="off"
          className="h-11 w-full rounded-xl border border-white/15 bg-white/5! px-3 text-sm text-white outline-none focus:border-purple-300/60"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@munetios.com"
          type="email"
          value={email}
        />
      </label>
      <div className="space-y-1.5">
        <span className="text-sm font-semibold">{copy.familyMemberType}</span>
        <DropdownWrapper
          align="left"
          ariaLabel={copy.familyMemberType}
          buttonClassName="w-full justify-between"
          label={roleOptions.find(([value]) => value === role)?.[1]}
        >
          {roleOptions.map(([value, label]) => (
            <button
              aria-checked={role === value}
              data-dropdown-close
              key={value}
              onClick={() => setRole(value)}
              role="menuitemradio"
              type="button"
            >
              <span>{label}</span>
              {role === value ? <icon>check</icon> : null}
            </button>
          ))}
        </DropdownWrapper>
        <p className="text-xs leading-5 text-white/55">
          {copy.familyAdultAccountNotice}
        </p>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button
          className="h-10 rounded-xl px-4 text-sm font-semibold text-white/70 transition hover:bg-white/10! hover:text-white"
          onClick={close}
          type="button"
        >
          {copy.cancel}
        </button>
        <button
          className="h-10 rounded-xl bg-[var(--accent)]! px-4 text-sm font-semibold text-white transition hover:bg-[var(--accent)]/85! disabled:opacity-50"
          disabled={!email.trim() || submitting}
          onClick={submit}
          type="button"
        >
          {submitting ? copy.familyAdding : copy.familyAddMemberAction}
        </button>
      </div>
    </div>
  );
}
