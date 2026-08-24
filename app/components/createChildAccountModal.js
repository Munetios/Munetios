"use client";

import { useState } from "react";
import DatePicker from "./datePicker";
import DropdownWrapper from "./dropdownwrapper";
import { showToast } from "./toast";

const errorKeys = {
  actor_age_restricted: "familyErrorActorTooYoung",
  account_creation_failed: "familyErrorGeneric",
  email_in_use: "familyErrorEmailInUse",
  invalid_birthday: "familyErrorInvalidBirthday",
  invalid_child_email: "familyErrorInvalidChildEmail",
  invalid_name: "familyErrorInvalidName",
  invalid_password: "familyErrorInvalidPassword",
  not_authorized: "familyErrorNotAuthorized",
  username_unavailable: "familyErrorGeneric",
};

function Field({ children, id, label }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputClassName =
  "h-11 w-full rounded-xl border border-white/15 bg-white/5! px-3 text-sm text-white outline-none focus:border-purple-300/60";

export default function CreateChildAccountModal({ close, copy, onCreated }) {
  const [form, setForm] = useState({
    birthday: "",
    confirmPassword: "",
    email: "",
    firstName: "",
    gender: "",
    lastName: "",
    password: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const genderOptions = [
    ["woman", copy.accountProfileGenderWoman],
    ["man", copy.accountProfileGenderMan],
    ["nonbinary", copy.accountProfileGenderNonBinary],
    ["other", copy.familyChildGenderOther],
  ];
  const update = (patch) => setForm((current) => ({ ...current, ...patch }));

  const minBirthday = (() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 13);
    date.setDate(date.getDate() + 1);
    return date.toISOString().slice(0, 10);
  })();
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = new Date().getFullYear();

  const hasValidFirstName = Boolean(form.firstName.trim());
  const hasValidEmail = /@munetios\.com$/i.test(form.email.trim());
  const hasValidBirthday = Boolean(
    form.birthday && form.birthday >= minBirthday && form.birthday <= today,
  );
  const hasValidPassword = Boolean(
    form.password && form.password === form.confirmPassword,
  );
  const valid =
    hasValidFirstName && hasValidEmail && hasValidBirthday && hasValidPassword;

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/account/family/create-child", {
        body: JSON.stringify(form),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast({
          message: copy[errorKeys[payload?.error]] || copy.familyErrorGeneric,
          type: "error",
        });
        return;
      }
      onCreated?.(payload.member);
      close();
    } catch {
      showToast({ message: copy.familyErrorGeneric, type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-white/70">
        {copy.familyCreateChildDescription}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="familyChildFirstName" label={`${copy.authFirstName} *`}>
          <input
            className={inputClassName}
            id="familyChildFirstName"
            onChange={(event) => update({ firstName: event.target.value })}
            value={form.firstName}
          />
        </Field>
        <Field
          id="familyChildLastName"
          label={`${copy.familyChildLastName} (${copy.optional})`}
        >
          <input
            className={inputClassName}
            id="familyChildLastName"
            onChange={(event) => update({ lastName: event.target.value })}
            value={form.lastName}
          />
        </Field>
      </div>
      <Field id="familyChildEmail" label={`${copy.familyChildEmail} *`}>
        <input
          className={inputClassName}
          id="familyChildEmail"
          onChange={(event) => update({ email: event.target.value })}
          placeholder="child@munetios.com"
          type="email"
          value={form.email}
        />
      </Field>
      <DatePicker
        copy={copy}
        label={`${copy.authBirthday} *`}
        maximumYear={currentYear}
        minimumYear={currentYear - 13}
        onChange={(birthday) => update({ birthday })}
        value={form.birthday}
      />
      <div className="space-y-1.5">
        <span className="text-sm font-semibold">
          {copy.accountProfileGender}
        </span>
        <DropdownWrapper
          align="left"
          ariaLabel={copy.accountProfileGender}
          buttonClassName="w-full justify-between"
          label={
            genderOptions.find(([value]) => value === form.gender)?.[1] ||
            copy.accountProfileGenderPreferNotToSay
          }
        >
          {genderOptions.map(([value, label]) => (
            <button
              aria-checked={form.gender === value}
              data-dropdown-close
              key={value}
              onClick={() => update({ gender: value })}
              role="menuitemradio"
              type="button"
            >
              <span>{label}</span>
              {form.gender === value ? <icon>check</icon> : null}
            </button>
          ))}
        </DropdownWrapper>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="familyChildPassword" label={`${copy.familyChildPassword} *`}>
          <input
            autoComplete="new-password"
            className={inputClassName}
            id="familyChildPassword"
            onChange={(event) => update({ password: event.target.value })}
            type="password"
            value={form.password}
          />
        </Field>
        <Field
          id="familyChildConfirmPassword"
          label={`${copy.accountSecurityConfirmPassword} *`}
        >
          <input
            autoComplete="new-password"
            className={inputClassName}
            id="familyChildConfirmPassword"
            onChange={(event) =>
              update({ confirmPassword: event.target.value })
            }
            type="password"
            value={form.confirmPassword}
          />
        </Field>
      </div>
      {form.confirmPassword && form.password !== form.confirmPassword
        ? <p className="text-xs text-rose-200">
            {copy.securityPasswordsDoNotMatch}
          </p>
        : null}
      <p className="text-xs leading-5 text-white/55">
        {copy.familyChildAccountNotice}
      </p>
      {!valid
        ? <ul className="space-y-1 text-xs leading-5 text-amber-200/90">
            {!hasValidFirstName
              ? <li>{copy.familyChildMissingFirstName}</li>
              : null}
            {!hasValidEmail ? <li>{copy.familyChildMissingEmail}</li> : null}
            {!hasValidBirthday
              ? <li>{copy.familyChildMissingBirthday}</li>
              : null}
            {!hasValidPassword
              ? <li>{copy.familyChildMissingPassword}</li>
              : null}
          </ul>
        : null}
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
          disabled={!valid || submitting}
          onClick={submit}
          type="button"
        >
          {submitting ? copy.familyCreatingChild : copy.familyCreateChildAction}
        </button>
      </div>
    </div>
  );
}
