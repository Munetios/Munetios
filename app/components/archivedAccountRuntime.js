"use client";

import { useEffect, useState } from "react";
import { t } from "../i18n";
import AccountAvatar from "./accountAvatar";
import { showToast } from "./toast";

function readArchivedAccount() {
  try {
    const value = JSON.parse(
      window.localStorage.getItem("munetios.archivedAccount") || "null",
    );
    return value?.id ? { ...value, archived: true } : null;
  } catch {
    return null;
  }
}

export default function ArchivedAccountRuntime() {
  const [account, setAccount] = useState(null);
  const [copy, setCopy] = useState(() => t());
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [taskBannerOpen, setTaskBannerOpen] = useState(true);
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const refresh = () => {
      const archived = readArchivedAccount();
      setAccount(archived);
      setOverlayOpen(Boolean(archived));
      setCopy(t());
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("munetios:authchange", refresh);
    window.addEventListener("munetios:localechange", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("munetios:authchange", refresh);
      window.removeEventListener("munetios:localechange", refresh);
    };
  }, []);

  if (!account) return null;
  const onTasks =
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/apps/tasks");

  return (
    <>
      {onTasks && taskBannerOpen
        ? <div className="fixed left-1/2 top-20 z-[2500] flex w-[min(44rem,calc(100vw-1.5rem))] -translate-x-1/2 items-start gap-3 rounded-2xl border border-amber-200/25 bg-amber-950/90! p-3 text-amber-50 shadow-2xl [backdrop-filter:blur(3px)]">
            <icon className="mt-0.5">cloud_off</icon>
            <p className="min-w-0 flex-1 text-sm leading-6">
              {copy.archivedTasksBanner}
            </p>
            <button
              aria-label={copy.close}
              className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/10!"
              onClick={() => setTaskBannerOpen(false)}
              type="button"
            >
              <icon>close</icon>
            </button>
          </div>
        : null}
      {overlayOpen
        ? <div
            className="fixed inset-0 z-[3100] flex items-center justify-center bg-black/55! p-4"
            role="dialog"
            aria-modal="true"
            aria-label={copy.archivedAccountTitle}
          >
            <section className="liquid-glass relative w-full max-w-lg rounded-3xl border border-amber-200/20 bg-purple-950/85! p-5 text-white shadow-2xl [backdrop-filter:blur(3px)]">
              <button
                aria-label={copy.close}
                className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-xl hover:bg-white/10!"
                onClick={() => setOverlayOpen(false)}
                type="button"
              >
                <icon>close</icon>
              </button>
              <div className="flex items-center gap-3 pr-10">
                <AccountAvatar
                  account={account}
                  className="h-12 w-12 rounded-xl"
                />
                <div className="min-w-0">
                  <h2 className="text-xl font-bold">
                    {copy.archivedAccountTitle}
                  </h2>
                  <p className="truncate text-sm text-white/55">
                    {account.email}
                  </p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-7 text-white/70">
                {copy.archivedAccountOverlayMessage}
              </p>
              <form
                className="mt-4 space-y-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setWorking(true);
                  try {
                    const response = await fetch("/api/account/archive", {
                      body: JSON.stringify({ accountId: account.id, password }),
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      method: "PUT",
                    });
                    if (!response.ok) throw new Error("unarchive_failed");
                    window.localStorage.removeItem("munetios.archivedAccount");
                    window.dispatchEvent(new Event("munetios:authchange"));
                    setAccount(null);
                    window.location.reload();
                  } catch {
                    showToast({
                      messageKey: "accountDataRequestFailed",
                      type: "error",
                    });
                    setWorking(false);
                  }
                }}
              >
                <label className="block text-sm font-semibold">
                  {copy.accountSecurityCurrentPassword}
                  <input
                    autoComplete="current-password"
                    className="liquid-glass mt-2 w-full rounded-xl border border-white/10 bg-purple-950/35! px-3 py-3 text-white outline-none focus:border-purple-300/55"
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    type="password"
                    value={password}
                  />
                </label>
                <button
                  className="liquid-glass w-full rounded-xl bg-purple-600/70! px-4 py-3 text-sm font-bold disabled:opacity-50"
                  disabled={!password || working}
                  type="submit"
                >
                  {working ? copy.accountProcessing : copy.unarchiveAccount}
                </button>
              </form>
            </section>
          </div>
        : null}
    </>
  );
}
