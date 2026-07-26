"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useCallback, useEffect, useState } from "react";
import {
  preparePasswordRewrap,
  resetAccountEncryptionKey,
  viewAccountEncryptionKey,
} from "../apps/tasks/lib/encryptedVault";
import { showModal } from "./modal";
import { showToast } from "./toast";

const inputClassName =
  "liquid-glass mt-1 w-full rounded-xl border border-white/10 bg-purple-950/35! px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-purple-300/55";

async function securityAction(payload) {
  const response = await fetch("/api/account/security", {
    body: JSON.stringify(payload),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const responsePayload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(responsePayload.error || "request_failed");
  return responsePayload;
}

function PasswordForm({ close, copy }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [verifyPassword, setVerifyPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (newPassword !== verifyPassword) {
      showToast({ messageKey: "securityPasswordsDoNotMatch", type: "error" });
      return;
    }
    setSaving(true);
    try {
      const rewrap = await preparePasswordRewrap(currentPassword);
      await securityAction({
        action: "change_password",
        currentPassword,
        newPassword,
      });
      if (rewrap) await rewrap(newPassword);
      showToast({ messageKey: "successChangingPassword", type: "success" });
      close();
    } catch {
      showToast({ messageKey: "failedChangingPassword", type: "error" });
      setSaving(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <p className="text-sm leading-6 text-white/65">
        {copy.securityVerifyDescription}
      </p>
      <label className="block text-sm font-semibold">
        {copy.accountSecurityCurrentPassword}
        <input
          autoComplete="current-password"
          className={inputClassName}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
          type="password"
          value={currentPassword}
        />
      </label>
      <label className="block text-sm font-semibold">
        {copy.accountSecurityNewPassword}
        <input
          autoComplete="new-password"
          className={inputClassName}
          minLength={12}
          onChange={(event) => setNewPassword(event.target.value)}
          required
          type="password"
          value={newPassword}
        />
      </label>
      <label className="block text-sm font-semibold">
        {copy.accountSecurityConfirmPassword}
        <input
          autoComplete="new-password"
          className={inputClassName}
          minLength={12}
          onChange={(event) => setVerifyPassword(event.target.value)}
          required
          type="password"
          value={verifyPassword}
        />
      </label>
      <button
        className="liquid-glass w-full rounded-xl bg-purple-600/75! px-4 py-3 text-sm font-bold disabled:opacity-55"
        disabled={saving}
        type="submit"
      >
        {saving
          ? copy.accountProfileSaving
          : copy.accountSecurityChangePassword}
      </button>
    </form>
  );
}

function ViewEncryptionKeyForm({ close, copy }) {
  const [password, setPassword] = useState("");
  const [key, setKey] = useState("");
  const [working, setWorking] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setWorking(true);
        try {
          setKey(await viewAccountEncryptionKey(password));
        } catch {
          showToast({ messageKey: "failedCheckAccount", type: "error" });
        } finally {
          setWorking(false);
        }
      }}
    >
      <p className="text-sm leading-6 text-white/70">
        {copy.privacyEncryptionDescription}
      </p>
      {!key ? (
        <label className="block text-sm font-semibold">
          {copy.accountSecurityCurrentPassword}
          <input
            autoComplete="current-password"
            className={inputClassName}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
      ) : (
        <label className="block text-sm font-semibold">
          {copy.accountSecurityManualKey}
          <textarea
            className={`${inputClassName} min-h-24 resize-none break-all font-mono`}
            readOnly
            value={key}
          />
        </label>
      )}
      <div className="flex justify-end gap-2">
        <button
          className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold"
          onClick={close}
          type="button"
        >
          {copy.cancel}
        </button>
        {!key ? (
          <button
            className="liquid-glass rounded-xl bg-purple-600/75! px-4 py-2 text-sm font-bold disabled:opacity-55"
            disabled={!password || working}
            type="submit"
          >
            {copy.accountEncryptionViewKey}
          </button>
        ) : null}
      </div>
    </form>
  );
}

function ResetEncryptionWizard({ close, copy }) {
  const [step, setStep] = useState(1);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const titles = [
    copy.resetEncryptionKey,
    copy.privacyEncryptionTitle,
    copy.securityVerifyTitle,
    copy.accountDangerWarningFallback,
    copy.confirm,
  ];
  const descriptions = [
    copy.accountResetEncryptionMessage,
    copy.accountDangerWarning8,
    copy.securityVerifyDescription,
    copy.accountDangerWarning10,
    copy.accountResetEncryptionMessage,
  ];

  const advance = async () => {
    if (step === 3) {
      setWorking(true);
      try {
        await viewAccountEncryptionKey(password);
      } catch {
        showToast({ messageKey: "failedCheckAccount", type: "error" });
        setWorking(false);
        return;
      }
      setWorking(false);
    }
    if (step === 5) {
      if (confirmation !== copy.accountEncryptionResetPhrase) return;
      setWorking(true);
      try {
        await resetAccountEncryptionKey(password);
        showToast({
          messageKey: "accountEncryptionResetSuccess",
          type: "success",
        });
        close();
      } catch {
        showToast({ messageKey: "accountRequestFailed", type: "error" });
        setWorking(false);
      }
      return;
    }
    setStep((current) => current + 1);
  };

  return (
    <div className="space-y-4">
      <p className="text-xs font-bold uppercase tracking-wider text-purple-200/70">
        {step} / 5
      </p>
      <div>
        <h3 className="text-lg font-bold">{titles[step - 1]}</h3>
        <p className="mt-2 text-sm leading-6 text-white/70">
          {descriptions[step - 1]}
        </p>
      </div>
      {step === 3 ? (
        <label className="block text-sm font-semibold">
          {copy.accountSecurityCurrentPassword}
          <input
            autoComplete="current-password"
            className={inputClassName}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
      ) : null}
      {step === 5 ? (
        <label className="block text-sm font-semibold">
          {copy.accountEncryptionTypePhrase.replace(
            "{phrase}",
            copy.accountEncryptionResetPhrase,
          )}
          <input
            autoComplete="off"
            className={inputClassName}
            onChange={(event) => setConfirmation(event.target.value)}
            spellCheck="false"
            type="text"
            value={confirmation}
          />
        </label>
      ) : null}
      <div className="flex justify-between gap-2">
        <button
          className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold"
          onClick={step === 1 ? close : () => setStep((current) => current - 1)}
          type="button"
        >
          {step === 1 ? copy.cancel : copy.accountBack}
        </button>
        <button
          className={`liquid-glass rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-55 ${step === 5 ? "bg-rose-600/70!" : "bg-purple-600/75!"}`}
          disabled={
            working ||
            (step === 3 && !password) ||
            (step === 5 && confirmation !== copy.accountEncryptionResetPhrase)
          }
          onClick={advance}
          type="button"
        >
          {step === 5 ? copy.resetEncryptionKey : copy.continue}
        </button>
      </div>
    </div>
  );
}

function RecoveryEmailForm({ close, copy, currentEmail, onSaved }) {
  const [recoveryEmail, setRecoveryEmail] = useState(currentEmail);
  const [saving, setSaving] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = await securityAction({
        action: "recovery_email",
        recoveryEmail,
      });
      onSaved(payload.recoveryEmail);
      showToast({ messageKey: "securityRecoveryEmailSaved", type: "success" });
      close();
    } catch {
      showToast({ messageKey: "securityRecoveryEmailFailed", type: "error" });
      setSaving(false);
    }
  };
  return (
    <form className="space-y-4" onSubmit={submit}>
      <p className="text-sm leading-6 text-white/65">
        {copy.securityRecoveryEmailDescription}
      </p>
      <label className="block text-sm font-semibold">
        {copy.securityRecoveryEmail}
        <input
          autoComplete="email"
          className={inputClassName}
          onChange={(event) => setRecoveryEmail(event.target.value)}
          required
          type="email"
          value={recoveryEmail}
        />
      </label>
      <button
        className="liquid-glass w-full rounded-xl bg-purple-600/75! px-4 py-3 text-sm font-bold disabled:opacity-55"
        disabled={saving}
        type="submit"
      >
        {saving ? copy.accountProfileSaving : copy.securitySaveRecoveryEmail}
      </button>
    </form>
  );
}

function Confirmation({
  cancelLabel,
  close,
  confirmLabel,
  confirmationLabel,
  confirmationWord = "",
  description,
  onConfirm,
}) {
  const [confirmation, setConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const canConfirm = !confirmationWord || confirmation === confirmationWord;
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!canConfirm || working) return;
        setWorking(true);
        const succeeded = await onConfirm();
        if (succeeded) close();
        else setWorking(false);
      }}
    >
      <p className="text-sm leading-6 text-white/70">{description}</p>
      {confirmationWord ? (
        <label className="block text-sm font-semibold">
          {confirmationLabel}
          <input
            autoComplete="off"
            className={inputClassName}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={confirmationWord}
            spellCheck="false"
            type="text"
            value={confirmation}
          />
        </label>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold"
          onClick={close}
          type="button"
        >
          {cancelLabel}
        </button>
        <button
          className="liquid-glass rounded-xl bg-rose-600/70! px-4 py-2 text-sm font-bold disabled:opacity-55"
          disabled={working || !canConfirm}
          type="submit"
        >
          {confirmLabel}
        </button>
      </div>
    </form>
  );
}

export default function AccountSecuritySection({ copy }) {
  const [security, setSecurity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadSecurity = useCallback(async () => {
    try {
      const response = await fetch("/api/account/security", {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) throw new Error("security_load_failed");
      setSecurity(await response.json());
      setLoadError(false);
    } catch {
      setLoadError(true);
      showToast({ messageKey: "devicesLoadFailed", type: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSecurity();
  }, [loadSecurity]);

  const openPasswordModal = () => {
    showModal(({ close }) => <PasswordForm close={close} copy={copy} />, {
      ariaLabel: copy.securityVerifyTitle,
      title: copy.securityVerifyTitle,
    });
  };

  const openRecoveryModal = () => {
    showModal(
      ({ close }) => (
        <RecoveryEmailForm
          close={close}
          copy={copy}
          currentEmail={security?.recoveryEmail || ""}
          onSaved={(recoveryEmail) =>
            setSecurity((current) => ({ ...current, recoveryEmail }))
          }
        />
      ),
      {
        ariaLabel: copy.securityRecoveryEmail,
        title: copy.securityRecoveryEmail,
      },
    );
  };

  const openViewEncryptionKey = () => {
    showModal(
      ({ close }) => <ViewEncryptionKeyForm close={close} copy={copy} />,
      {
        ariaLabel: copy.accountEncryptionViewKey,
        title: copy.accountEncryptionViewKey,
        zIndex: 100000002,
      },
    );
  };

  const openResetEncryptionKey = () => {
    showModal(
      ({ close }) => <ResetEncryptionWizard close={close} copy={copy} />,
      {
        ariaLabel: copy.resetEncryptionKey,
        title: copy.resetEncryptionKey,
        zIndex: 100000002,
      },
    );
  };

  const setupPasskey = async () => {
    if (!window.PublicKeyCredential || !navigator.credentials) {
      showToast({ messageKey: "securityPasskeySetupFailed", type: "error" });
      return;
    }
    try {
      const optionsResponse = await fetch(
        "/api/auth/passkey/register/options",
        { credentials: "include", method: "POST" },
      );
      const optionsPayload = await optionsResponse.json().catch(() => ({}));
      if (!optionsResponse.ok) throw new Error(optionsPayload.error);
      const credential = await startRegistration({
        optionsJSON: optionsPayload.options,
      });
      const verifyResponse = await fetch("/api/auth/passkey/register/verify", {
        body: JSON.stringify({
          challengeId: optionsPayload.challengeId,
          credential,
        }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!verifyResponse.ok) throw new Error("passkey_setup_failed");
      showToast({ messageKey: "securityPasskeySetupSuccess", type: "success" });
      await loadSecurity();
    } catch {
      showToast({ messageKey: "securityPasskeySetupFailed", type: "error" });
    }
  };

  const signOutSession = async (deviceSession) => {
    try {
      const payload = await securityAction({
        action: "sign_out_session",
        sessionId: deviceSession.id,
      });
      showToast({ messageKey: "securityDeviceSignedOut", type: "success" });
      if (payload.current) {
        window.dispatchEvent(
          new CustomEvent("munetios:unauthorized", {
            detail: { invalidSession: true },
          }),
        );
      } else {
        await loadSecurity();
      }
      return true;
    } catch {
      showToast({ messageKey: "securityDeviceSignoutFailed", type: "error" });
      return false;
    }
  };

  const openSessionConfirmation = (deviceSession) => {
    showModal(
      ({ close }) => (
        <Confirmation
          cancelLabel={copy.cancel}
          close={close}
          confirmLabel={copy.signOut}
          description={copy.securitySignOutDeviceConfirm}
          onConfirm={() => signOutSession(deviceSession)}
        />
      ),
      {
        ariaLabel: copy.securitySignOutDevice,
        title: copy.securitySignOutDevice,
      },
    );
  };

  const openAllSessionsConfirmation = () => {
    showModal(
      ({ close }) => (
        <Confirmation
          cancelLabel={copy.cancel}
          close={close}
          confirmLabel={copy.accountSecuritySignOutAllDevices}
          confirmationLabel={copy.signOutTypeToConfirm}
          confirmationWord={copy.signOutConfirmationWord}
          description={copy.accountSecuritySignOutAllConfirm}
          onConfirm={async () => {
            try {
              await securityAction({ action: "sign_out_all" });
              showToast({
                messageKey: "securityAllDevicesSignedOut",
                type: "success",
              });
              window.dispatchEvent(
                new CustomEvent("munetios:unauthorized", {
                  detail: { invalidSession: true },
                }),
              );
              return true;
            } catch {
              showToast({
                messageKey: "failedLogOutDevice",
                type: "error",
              });
              return false;
            }
          }}
        />
      ),
      {
        ariaLabel: copy.accountSecuritySignOutAllDevices,
        title: copy.accountSecuritySignOutAllDevices,
      },
    );
  };

  const updateLockdown = async (enabled) => {
    setSecurity((current) => ({ ...current, lockdownMode: enabled }));
    try {
      await securityAction({ action: "lockdown_mode", enabled });
      showToast({ messageKey: "securityLockdownSaved", type: "success" });
    } catch {
      setSecurity((current) => ({ ...current, lockdownMode: !enabled }));
      showToast({
        messageKey: "securityLockdownFailed",
        type: "error",
      });
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{copy.accountSettingsSecurity}</h1>
        <p className="mt-1 text-sm text-white/65">
          {copy.accountSettingsSecurityDescription}
        </p>
      </div>
      <section className="grid gap-3 md:grid-cols-2">
        <button
          className="liquid-glass flex items-center gap-3 rounded-2xl border border-white/10 bg-purple-950/30! p-4 text-left"
          onClick={openPasswordModal}
          type="button"
        >
          <icon>password</icon>
          <span>
            <strong className="block">
              {copy.accountSecurityChangePassword}
            </strong>
            <small className="text-white/60">
              {copy.securityChangePasswordDescription}
            </small>
          </span>
        </button>
        <button
          className="liquid-glass flex items-center gap-3 rounded-2xl border border-white/10 bg-purple-950/30! p-4 text-left"
          onClick={openRecoveryModal}
          type="button"
        >
          <icon>forward_to_inbox</icon>
          <span>
            <strong className="block">{copy.securityRecoveryEmail}</strong>
            <small className="text-white/60">
              {security?.recoveryEmail || copy.securityRecoveryEmailNotSet}
            </small>
          </span>
        </button>
        <button
          className="liquid-glass flex items-center gap-3 rounded-2xl border border-white/10 bg-purple-950/30! p-4 text-left"
          onClick={setupPasskey}
          type="button"
        >
          <icon>passkey</icon>
          <span>
            <strong className="block">{copy.securitySetupPasskey}</strong>
            <small className="text-white/60">
              {copy.securityPasskeyCount.replace(
                "{count}",
                security?.passkeyCount || 0,
              )}
            </small>
          </span>
        </button>
        <button
          className="liquid-glass flex cursor-not-allowed items-center gap-3 rounded-2xl border border-white/10 bg-purple-950/20! p-4 text-left opacity-60"
          disabled
          type="button"
        >
          <icon>phonelink_lock</icon>
          <span>
            <strong className="block">{copy.accountSecuritySetup2fa}</strong>
            <small className="text-white/60">{copy.securityComingSoon}</small>
          </span>
        </button>
      </section>
      <section className="liquid-glass rounded-2xl border border-white/10 bg-purple-950/30! p-5">
        <div>
          <h2 className="text-lg font-bold">{copy.privacyEncryptionTitle}</h2>
          <p className="text-sm text-white/60">
            {copy.privacyEncryptionDescription}
          </p>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            className="rounded-xl border border-purple-200/20 bg-purple-500/20! px-4 py-3 text-sm font-bold"
            onClick={openViewEncryptionKey}
            type="button"
          >
            {copy.accountEncryptionViewKey}
          </button>
          <button
            className="rounded-xl border border-rose-200/20 bg-rose-700/30! px-4 py-3 text-sm font-bold"
            onClick={openResetEncryptionKey}
            type="button"
          >
            {copy.resetEncryptionKey}
          </button>
        </div>
      </section>
      <section className="liquid-glass rounded-2xl border border-white/10 bg-purple-950/30! p-5">
        <label className="flex items-center justify-between gap-4">
          <span>
            <strong className="block">{copy.securityLockdownMode}</strong>
            <small className="text-white/60">
              {copy.securityLockdownDescription}
            </small>
          </span>
          <input
            aria-label={copy.securityLockdownMode}
            checked={Boolean(security?.lockdownMode)}
            className="h-5 w-10 accent-purple-500"
            disabled={loading}
            onChange={(event) => updateLockdown(event.target.checked)}
            type="checkbox"
          />
        </label>
      </section>
      <section className="liquid-glass rounded-2xl border border-white/10 bg-purple-950/30! p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{copy.accountSecurityDevices}</h2>
            <p className="text-sm text-white/60">
              {copy.securityDevicesDescription}
            </p>
          </div>
          <button
            className="rounded-xl border border-rose-200/20 bg-rose-700/35! px-3 py-2 text-sm font-bold"
            onClick={openAllSessionsConfirmation}
            type="button"
          >
            {copy.accountSecuritySignOutAllDevices}
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {security?.sessions?.map((deviceSession) => (
            <article
              className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5! p-3 sm:flex-row sm:items-center"
              key={deviceSession.id}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/20!">
                <icon>{deviceSession.icon}</icon>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {deviceSession.browser} · {deviceSession.os}
                  {deviceSession.current
                    ? ` · ${copy.securityCurrentDevice}`
                    : ""}
                </p>
                <p className="text-xs text-white/55">
                  {deviceSession.location} ·{" "}
                  {new Date(deviceSession.lastSeenAt).toLocaleString()}
                </p>
              </div>
              <button
                className="rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/10!"
                onClick={() => openSessionConfirmation(deviceSession)}
                type="button"
              >
                {copy.signOut}
              </button>
            </article>
          ))}
          {!loading && loadError ? (
            <p className="text-sm text-white/60">
              Error loading devices. Please try again
            </p>
          ) : null}
          {!loading && !loadError && !security?.sessions?.length ? (
            <p className="text-sm text-white/60">
              {copy.accountSecurityNoDevices}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
