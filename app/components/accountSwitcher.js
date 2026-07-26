"use client";

import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n";
import AccountAvatar from "./accountAvatar";
import { showModal } from "./modal";

function LoadingSpinner({ label }) {
  return (
    <output
      aria-label={label}
      className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-white/25 border-t-purple-200"
      style={{
        borderColor: "color-mix(in srgb, var(--foreground) 24%, transparent)",
        borderTopColor: "var(--accent)",
      }}
    />
  );
}

function AccountSwitcherContent({ close, copy: suppliedCopy, initialAdding }) {
  const copy = suppliedCopy || t();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(Boolean(initialAdding));
  const [switchingId, setSwitchingId] = useState("");

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/auth/accounts", {
        cache: "no-store",
        credentials: "include",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error("load_failed");
      setAccounts(Array.isArray(payload.accounts) ? payload.accounts : []);
    } catch {
      window.showToast?.({
        messageKey: "accountSwitcherLoadFailed",
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    const onAccountAdded = (event) => {
      if (
        event.origin !== window.location.origin ||
        event.data?.type !== "munetios:account-added"
      ) {
        return;
      }
      setAdding(false);
      void loadAccounts();
      window.dispatchEvent(new Event("munetios:authchange"));
    };
    window.addEventListener("message", onAccountAdded);
    return () => window.removeEventListener("message", onAccountAdded);
  }, [loadAccounts]);

  const switchAccount = async (accountId) => {
    setSwitchingId(accountId);
    try {
      const response = await fetch("/api/auth/accounts/switch", {
        body: JSON.stringify({ accountId }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("switch_failed");
      window.dispatchEvent(new Event("munetios:authchange"));
      close();
      window.location.reload();
    } catch {
      window.showToast?.({ messageKey: "accountSwitchFailed", type: "error" });
      setSwitchingId("");
    }
  };

  if (adding) {
    return (
      <div className="space-y-3">
        <button
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/75 transition hover:bg-white/10! hover:text-white"
          onClick={() => setAdding(false)}
          type="button"
        >
          <icon>arrow_back</icon>
          {copy.accountBack}
        </button>
        <iframe
          className="h-[min(42rem,75dvh)] w-full rounded-2xl border border-white/10 bg-purple-950/60!"
          sandbox="allow-forms allow-same-origin allow-scripts"
          src="/signin?addAccount=true&embedded=true"
          title={copy.addAccount}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm leading-6 text-white/65">
        {copy.accountChooseAccount}
      </p>
      {loading
        ? <div className="flex min-h-32 items-center justify-center">
            <LoadingSpinner label={copy.accountLoading} />
          </div>
        : <div className="space-y-2">
            {accounts.map((account) => (
              <button
                className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/5! p-3 text-left transition hover:border-purple-200/35 hover:bg-purple-500/15! disabled:opacity-60"
                disabled={account.active || Boolean(switchingId)}
                key={account.id}
                onClick={() => switchAccount(account.id)}
                type="button"
              >
                <AccountAvatar
                  account={account}
                  className="h-11 w-11 rounded-xl"
                />
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm text-white">
                    {account.name}
                  </strong>
                  <small className="block truncate text-xs text-white/55">
                    {account.email}
                  </small>
                  <span className="mt-1 inline-flex rounded-full border border-purple-200/20 bg-purple-500/20! px-2 py-0.5 text-[0.68rem] font-bold text-purple-100">
                    {copy.personalAccountBadge}
                  </span>
                </span>
                {switchingId === account.id
                  ? <LoadingSpinner label={copy.accountSwitching} />
                  : account.active
                    ? <icon className="text-purple-200">check_circle</icon>
                    : <icon className="text-white/45">chevron_right</icon>}
              </button>
            ))}
          </div>}
      <button
        className="liquid-glass flex w-full items-center justify-center gap-2 rounded-xl border border-purple-200/25 bg-purple-600/60! px-4 py-3 text-sm font-semibold text-white transition hover:bg-purple-500/70!"
        onClick={() => setAdding(true)}
        type="button"
      >
        <icon>person_add</icon>
        {copy.addAccount}
      </button>
    </div>
  );
}

export function openAccountSwitcher({ addAccount = false, copy } = {}) {
  const resolvedCopy = copy || t();
  showModal(
    ({ close }) => (
      <AccountSwitcherContent
        close={close}
        copy={resolvedCopy}
        initialAdding={addAccount}
      />
    ),
    {
      ariaLabel: resolvedCopy.switchAccount,
      title: addAccount ? resolvedCopy.addAccount : resolvedCopy.switchAccount,
      width: "min(34rem, calc(100vw - 1rem))",
    },
  );
}

function SigningOut({ copy }) {
  useEffect(() => {
    const signOut = async () => {
      try {
        await fetch("/api/auth/signout", {
          credentials: "include",
          method: "POST",
        });
      } finally {
        for (const storage of [window.localStorage, window.sessionStorage]) {
          [
            "munetiosSignedIn",
            "munetios:signedIn",
            "munetios.session",
            "munetiosSession",
            "munetiosAuth",
            "munetiosAccount",
            "session",
            "authToken",
            "accessToken",
            "token",
          ].forEach((key) => {
            storage.removeItem(key);
          });
        }
        window.dispatchEvent(new Event("munetios:authchange"));
        window.location.replace("/");
      }
    };
    void signOut();
  }, []);

  return (
    <div className="flex min-h-[16rem] flex-col items-center justify-center gap-4 text-center">
      <LoadingSpinner label={copy.signingOutThisBrowser} />
      <h2 className="text-xl font-bold text-white">
        {copy.signingOutThisBrowser}
      </h2>
    </div>
  );
}

export function signOutAllAccounts({ copy } = {}) {
  const resolvedCopy = copy || t();
  showModal(<SigningOut copy={resolvedCopy} />, {
    ariaLabel: resolvedCopy.signingOutThisBrowser,
    fullViewport: true,
    height: "100vh",
    title: resolvedCopy.signOut,
    width: "100%",
  });
}

function BrowserSignOutConfirmation({ close, copy }) {
  const [confirmation, setConfirmation] = useState("");
  const canSignOut = confirmation === copy.signOutConfirmationWord;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSignOut) return;
        close();
        signOutAllAccounts({ copy });
      }}
    >
      <p className="text-sm leading-6 text-white/75">
        {copy.signOutBrowserConfirmMessage}
      </p>
      <label className="block space-y-2">
        <span className="text-sm font-medium text-white/85">
          {copy.signOutTypeToConfirm}
        </span>
        <input
          autoComplete="off"
          className="w-full rounded-xl border border-white/15 bg-purple-950/45! px-3.5 py-3 text-white outline-none transition placeholder:text-white/35 focus:border-purple-300/70 focus:ring-2 focus:ring-purple-400/25"
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder={copy.signOutConfirmationWord}
          spellCheck="false"
          type="text"
          value={confirmation}
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          className="rounded-xl border border-white/10 bg-white/5! px-4 py-2.5 text-sm text-white/75 transition hover:bg-white/10! hover:text-white"
          onClick={close}
          type="button"
        >
          {copy.cancel}
        </button>
        <button
          className="rounded-xl border border-rose-200/25 bg-rose-500/80! px-4 py-2.5 text-sm font-semibold text-white transition enabled:hover:bg-rose-400/90! disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!canSignOut}
          type="submit"
        >
          {copy.signOut}
        </button>
      </div>
    </form>
  );
}

export function confirmBrowserSignOut({ copy } = {}) {
  const resolvedCopy = copy || t();
  showModal(
    ({ close }) => (
      <BrowserSignOutConfirmation close={close} copy={resolvedCopy} />
    ),
    {
      ariaLabel: resolvedCopy.signOut,
      title: resolvedCopy.signOut,
    },
  );
}
