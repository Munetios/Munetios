"use client";

import { startRegistration } from "@simplewebauthn/browser";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import {
  preparePasswordRewrap,
  resetAccountEncryptionKey,
  viewAccountEncryptionKey,
} from "../apps/tasks/lib/encryptedVault";
import { formatUserDateTime } from "../lib/dateTimePreferences";
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

async function signOutAllDevices() {
  const response = await fetch("/api/account/signoutalldevices", {
    credentials: "include",
    method: "POST",
  });
  const responsePayload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(responsePayload.error || "sign_out_all_devices_failed");
  }
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
      {!key
        ? <label className="block text-sm font-semibold">
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
        : <label className="block text-sm font-semibold">
            {copy.accountSecurityManualKey}
            <textarea
              className={`${inputClassName} min-h-24 resize-none break-all font-mono`}
              readOnly
              value={key}
            />
          </label>}
      <div className="flex justify-end gap-2">
        <button
          className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold"
          onClick={close}
          type="button"
        >
          {copy.cancel}
        </button>
        {!key
          ? <button
              className="liquid-glass rounded-xl bg-purple-600/75! px-4 py-2 text-sm font-bold disabled:opacity-55"
              disabled={!password || working}
              type="submit"
            >
              {copy.accountEncryptionViewKey}
            </button>
          : null}
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
      {step === 3
        ? <label className="block text-sm font-semibold">
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
        : null}
      {step === 5
        ? <label className="block text-sm font-semibold">
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
        : null}
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
  description,
  onConfirm,
}) {
  const [working, setWorking] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (working) return;
        setWorking(true);
        const succeeded = await onConfirm();
        if (succeeded) close();
        else setWorking(false);
      }}
    >
      <p className="text-sm leading-6 text-white/70">{description}</p>
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
          disabled={working}
          type="submit"
        >
          {confirmLabel}
        </button>
      </div>
    </form>
  );
}

function TwoFactorSetupForm({ close, copy, onComplete }) {
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [working, setWorking] = useState(true);
  useEffect(() => {
    fetch("/api/account/security/two-factor", {
      body: JSON.stringify({ action: "begin" }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        setSetup(payload);
      })
      .catch(() => showToast({ messageKey: "failedSetup2fa", type: "error" }))
      .finally(() => setWorking(false));
  }, []);
  if (recoveryCodes.length) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-white/70">
          {copy.accountSecurityGenerateRecovery}
        </p>
        <div className="grid gap-2 rounded-xl bg-black/25! p-3 font-mono text-sm sm:grid-cols-2">
          {recoveryCodes.map((item) => (
            <code key={item}>{item}</code>
          ))}
        </div>
        <button
          className="liquid-glass w-full rounded-xl bg-purple-600/75! px-4 py-3 font-bold"
          onClick={close}
          type="button"
        >
          {copy.confirm}
        </button>
      </div>
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setWorking(true);
        try {
          const response = await fetch("/api/account/security/two-factor", {
            body: JSON.stringify({
              action: "complete",
              code,
              setupId: setup.setupId,
            }),
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            method: "POST",
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error);
          setRecoveryCodes(payload.recoveryCodes || []);
          await onComplete();
        } catch {
          showToast({ messageKey: "authRecoveryCodeInvalid", type: "error" });
        } finally {
          setWorking(false);
        }
      }}
    >
      {setup
        ? <>
            <div className="mx-auto w-fit rounded-2xl bg-white p-3">
              <Image
                alt={copy.accountSecuritySetup2fa}
                height={280}
                src={setup.qrCode}
                unoptimized
                width={280}
              />
            </div>
            <label className="block text-sm font-semibold">
              {copy.accountSecurityManualKey}
              <input
                className={`${inputClassName} font-mono`}
                readOnly
                value={setup.secret}
              />
            </label>
            <label className="block text-sm font-semibold">
              {copy.authVerificationCode}
              <input
                autoComplete="one-time-code"
                className={inputClassName}
                inputMode="numeric"
                onChange={(event) => setCode(event.target.value)}
                required
                value={code}
              />
            </label>
          </>
        : <p className="text-sm text-white/65">
            {copy.accountSettingsSecurityDescription}
          </p>}
      <button
        className="liquid-glass w-full rounded-xl bg-purple-600/75! px-4 py-3 font-bold disabled:opacity-55"
        disabled={working || !setup || !code.trim()}
        type="submit"
      >
        {copy.continue}
      </button>
    </form>
  );
}

function SensitiveVerificationForm({
  close,
  copy,
  onVerified,
  twoFactorEnabled,
}) {
  const [value, setValue] = useState("");
  const [working, setWorking] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setWorking(true);
        try {
          await securityAction({
            action: "verify_sensitive",
            ...(twoFactorEnabled ? { code: value } : { password: value }),
          });
          close();
          await onVerified();
        } catch {
          showToast({ messageKey: "failedCheckAccount", type: "error" });
          setWorking(false);
        }
      }}
    >
      <p className="text-sm text-white/70">{copy.securityVerifyDescription}</p>
      <label className="block text-sm font-semibold">
        {twoFactorEnabled
          ? copy.authVerificationCode
          : copy.accountSecurityCurrentPassword}
        <input
          autoComplete={twoFactorEnabled ? "one-time-code" : "current-password"}
          className={inputClassName}
          onChange={(event) => setValue(event.target.value)}
          required
          type={twoFactorEnabled ? "text" : "password"}
          value={value}
        />
      </label>
      <button
        className="liquid-glass w-full rounded-xl bg-purple-600/75! px-4 py-3 font-bold disabled:opacity-55"
        disabled={working}
        type="submit"
      >
        {copy.authRecoveryVerify}
      </button>
    </form>
  );
}

function RecoveryCodesForm({ copy, recoveryCodes }) {
  const download = () => {
    const blob = new Blob(
      [`Munetios recovery codes\n\n${recoveryCodes.join("\n")}\n`],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "munetios-recovery-codes.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-2 rounded-xl bg-black/25! p-3 font-mono text-sm sm:grid-cols-2">
        {recoveryCodes.map((code) => (
          <code key={code}>{code}</code>
        ))}
      </div>
      <button
        className="liquid-glass w-full rounded-xl bg-purple-600/75! px-4 py-3 font-bold"
        disabled={!recoveryCodes.length}
        onClick={download}
        type="button"
      >
        {copy.download}
      </button>
    </div>
  );
}

export default function AccountSecuritySection({
  copy,
  managedStudent = false,
}) {
  const [security, setSecurity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadSecurity = useCallback(async () => {
    try {
      const response = await fetch("/api/account/security", {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) {
        const guest =
          response.status === 401 &&
          response.headers.get("X-Munetios-Auth-State") === "guest";
        setLoadError(!guest);
        if (!guest) {
          showToast({ messageKey: "devicesLoadFailed", type: "error" });
        }
        return;
      }
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

  const openSensitiveVerification = (onVerified) => {
    showModal(
      ({ close }) => (
        <SensitiveVerificationForm
          close={close}
          copy={copy}
          onVerified={onVerified}
          twoFactorEnabled={Boolean(security?.twoFactorEnabled)}
        />
      ),
      { ariaLabel: copy.securityVerifyTitle, title: copy.securityVerifyTitle },
    );
  };

  const requireSecurityVerification = (onVerified) => {
    if (!security?.lockdownMode) {
      void onVerified();
      return;
    }
    openSensitiveVerification(onVerified);
  };

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

  const openTwoFactorSetup = () => {
    showModal(
      ({ close }) => (
        <TwoFactorSetupForm
          close={close}
          copy={copy}
          onComplete={loadSecurity}
        />
      ),
      {
        ariaLabel: copy.accountSecuritySetup2fa,
        title: copy.accountSecuritySetup2fa,
      },
    );
  };

  const openRecoveryCodes = () => {
    openSensitiveVerification(async () => {
      try {
        const response = await fetch("/api/account/security/two-factor", {
          body: JSON.stringify({ action: "recovery_codes" }),
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error);
        showModal(
          () => (
            <RecoveryCodesForm
              copy={copy}
              recoveryCodes={payload.recoveryCodes || []}
            />
          ),
          {
            ariaLabel: copy.accountSecurityGenerateRecovery,
            title: copy.accountSecurityGenerateRecovery,
          },
        );
      } catch {
        showToast({ messageKey: "accountRequestFailed", type: "error" });
      }
    });
  };

  const disableTwoFactor = () => {
    openSensitiveVerification(async () => {
      try {
        const response = await fetch("/api/account/security/two-factor", {
          body: JSON.stringify({ action: "disable" }),
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        if (!response.ok) throw new Error("two_factor_disable_failed");
        await loadSecurity();
      } catch {
        showToast({ messageKey: "accountRequestFailed", type: "error" });
      }
    });
  };

  const trustCurrentDevice = () => {
    openSensitiveVerification(async () => {
      try {
        const response = await fetch("/api/account/security/two-factor", {
          body: JSON.stringify({ action: "trust_current_device" }),
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        if (!response.ok) throw new Error("trust_failed");
        await loadSecurity();
      } catch {
        showToast({ messageKey: "accountRequestFailed", type: "error" });
      }
    });
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

  const removeTrustedDevice = async (deviceId) => {
    try {
      const response = await fetch("/api/account/security/two-factor", {
        body: JSON.stringify({ action: "remove_trusted_device", deviceId }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("remove_failed");
      await loadSecurity();
    } catch {
      showToast({ messageKey: "accountRequestFailed", type: "error" });
    }
  };

  const openAllSessionsConfirmation = () => {
    showModal(
      ({ close }) => (
        <Confirmation
          cancelLabel={copy.cancel}
          close={close}
          confirmLabel={copy.accountSecuritySignOutAllDevices}
          description={copy.accountSecuritySignOutAllConfirm}
          onConfirm={async () => {
            try {
              await signOutAllDevices();
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

  const saveLockdown = async (enabled) => {
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

  const updateLockdown = (enabled) => {
    showModal(
      ({ close }) => (
        <SensitiveVerificationForm
          close={close}
          copy={copy}
          onVerified={() => saveLockdown(enabled)}
          twoFactorEnabled={Boolean(security?.twoFactorEnabled)}
        />
      ),
      { ariaLabel: copy.securityVerifyTitle, title: copy.securityVerifyTitle },
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{copy.accountSettingsSecurity}</h1>
        <p className="mt-1 text-sm text-white/65">
          {copy.accountSettingsSecurityDescription}
        </p>
      </div>
      {managedStudent
        ? <p className="rounded-xl border border-purple-200/15 bg-purple-500/10! p-3 text-sm text-purple-100">
            {copy.educationSecurityManagedByTeacher}
          </p>
        : null}
      {!managedStudent
        ? <section className="grid gap-3 md:grid-cols-2">
            <button
              className="liquid-glass flex items-center gap-3 rounded-2xl border border-white/10 bg-purple-950/30! p-4 text-left"
              onClick={() => requireSecurityVerification(openPasswordModal)}
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
              onClick={() => requireSecurityVerification(openRecoveryModal)}
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
              onClick={() => requireSecurityVerification(setupPasskey)}
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
              className="liquid-glass flex items-center gap-3 rounded-2xl border border-white/10 bg-purple-950/30! p-4 text-left disabled:opacity-60"
              disabled={Boolean(security?.twoFactorEnabled)}
              onClick={() => requireSecurityVerification(openTwoFactorSetup)}
              type="button"
            >
              <icon>phonelink_lock</icon>
              <span>
                <strong className="block">
                  {copy.accountSecuritySetup2fa}
                </strong>
                <small className="text-white/60">
                  {security?.twoFactorEnabled
                    ? copy.accountSecurityRecovery
                    : copy.accountSettingsSecurityDescription}
                </small>
              </span>
            </button>
            {security?.twoFactorEnabled
              ? <>
                  <button
                    className="liquid-glass flex items-center gap-3 rounded-2xl border border-white/10 bg-purple-950/30! p-4 text-left"
                    onClick={openRecoveryCodes}
                    type="button"
                  >
                    <icon>key</icon>
                    <span>
                      <strong className="block">
                        {copy.accountSecurityGenerateRecovery}
                      </strong>
                      <small className="text-white/60">
                        {copy.accountSecurityRecovery}
                      </small>
                    </span>
                  </button>
                  <button
                    className="liquid-glass flex items-center gap-3 rounded-2xl border border-rose-200/15 bg-rose-950/25! p-4 text-left text-rose-100"
                    onClick={disableTwoFactor}
                    type="button"
                  >
                    <icon>phonelink_erase</icon>
                    <strong>{copy.accountSecurityDisable2fa}</strong>
                  </button>
                </>
              : null}
          </section>
        : null}
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
            onClick={() =>
              requireSecurityVerification(openAllSessionsConfirmation)
            }
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
                  {deviceSession.deviceName}
                  {deviceSession.current
                    ? ` · ${copy.securityCurrentDevice}`
                    : ""}
                </p>
                <p className="text-xs text-white/55">
                  {deviceSession.location} ·{" "}
                  {formatUserDateTime(deviceSession.lastSeenAt)}
                </p>
              </div>
              <button
                className="rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/10!"
                onClick={() =>
                  requireSecurityVerification(() =>
                    openSessionConfirmation(deviceSession),
                  )
                }
                type="button"
              >
                {copy.signOut}
              </button>
            </article>
          ))}
          {!loading && loadError
            ? <p className="text-sm text-white/60">{copy.devicesLoadFailed}</p>
            : null}
          {!loading && !loadError && !security?.sessions?.length
            ? <p className="text-sm text-white/60">
                {copy.accountSecurityNoDevices}
              </p>
            : null}
        </div>
        <div className="mt-5 border-t border-white/10 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-bold">{copy.accountSecurityTrustedDevices}</h3>
            {security?.twoFactorEnabled
              ? <button
                  className="rounded-xl border border-purple-200/20 bg-purple-500/20! px-3 py-2 text-sm font-bold"
                  onClick={trustCurrentDevice}
                  type="button"
                >
                  {copy.accountSecurityTrustedDevices}
                </button>
              : null}
          </div>
          <div className="mt-2 space-y-2">
            {security?.trustedDevices?.map((device) => (
              <article
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5! p-3"
                key={device.id}
              >
                <icon>verified_user</icon>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {device.deviceName}
                  </p>
                  <p className="text-xs text-white/55">
                    {formatUserDateTime(device.createdAt)}
                  </p>
                </div>
                <button
                  className="rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold"
                  onClick={() =>
                    openSensitiveVerification(() =>
                      removeTrustedDevice(device.id),
                    )
                  }
                  type="button"
                >
                  {copy.remove}
                </button>
              </article>
            ))}
            {!security?.trustedDevices?.length
              ? <p className="text-sm text-white/60">
                  {copy.accountSecurityNoTrustedDevices}
                </p>
              : null}
          </div>
        </div>
      </section>
    </div>
  );
}
