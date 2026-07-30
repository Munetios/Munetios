"use client";

import { useEffect, useRef, useState } from "react";
import AccountAvatar from "../../components/accountAvatar";
import AccountWrapper from "../../components/accountwraper";
import AppLauncherWrapper from "../../components/appLauncherWrapper";
import AppTopbarRight from "../../components/appTopbarRight";
import LoadingSpinner from "../../components/loadingSpinner";
import CustomFilePicker from "../../components/customFilePicker";
import CustomToggle from "../../components/customToggle";
import { showModal } from "../../components/modal";
import { showToast } from "../../components/toast";
import { t } from "../../i18n";
import { hasSignedInCookie } from "../../lib/signedInCookie";

function StoreSettings({ copy }) {
  const [compact, setCompact] = useState(
    () => window.localStorage.getItem("connectorStoreCompact") === "true",
  );
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5! p-3">
        <span>{copy.connectorStoreCompact}</span>
        <CustomToggle
          checked={compact}
          label={copy.connectorStoreCompact}
          onChange={(checked) => {
            setCompact(checked);
            window.localStorage.setItem(
              "connectorStoreCompact",
              String(checked),
            );
          }}
        />
      </div>
      <p className="text-sm leading-6 text-white/60">
        {copy.connectorStoreSettingsDescription}
      </p>
    </div>
  );
}

function DeveloperBusinessForm({ copy, onVerified }) {
  const [form, setForm] = useState({
    businessName: "",
    contactEmail: "",
    description: "",
    website: "",
  });
  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const response = await fetch("/api/connectors/developer-business", {
          body: JSON.stringify(form),
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        if (!response.ok) {
          showToast({ messageKey: "connectorDeveloperVerificationFailed", type: "error" });
          return;
        }
        onVerified();
      }}
    >
      <p className="text-sm text-white/65">{copy.connectorDeveloperBusinessDescription}</p>
      {[
        ["businessName", copy.connectorBusinessName, "text"],
        ["website", copy.connectorBusinessWebsite, "url"],
        ["contactEmail", copy.connectorBusinessEmail, "email"],
      ].map(([key, label, type]) => (
        <label className="block text-sm font-semibold" key={key}>
          {label}
          <input
            className="mt-1 w-full rounded-xl border border-white/10 bg-white/8! px-3 py-2 outline-none"
            onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
            required
            type={type}
            value={form[key]}
          />
        </label>
      ))}
      <label className="block text-sm font-semibold">
        {copy.connectorBusinessDescription}
        <textarea
          className="mt-1 min-h-24 w-full rounded-xl border border-white/10 bg-white/8! px-3 py-2 outline-none"
          minLength={20}
          onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
          required
          value={form.description}
        />
      </label>
      <p className="text-xs text-white/50">{copy.connectorNoPhoneRequired}</p>
      <button className="w-full rounded-xl bg-purple-500/70! px-4 py-2 font-bold" type="submit">
        {copy.connectorVerifyBusiness}
      </button>
    </form>
  );
}

function CreateConnector({ copy, close, onCreated }) {
  const [needsVerification, setNeedsVerification] = useState(false);
  const [iconFile, setIconFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    description: "",
    developer: "",
    iconUrl: "",
    name: "",
    privacyUrl: "",
    termsUrl: "",
    visibility: "private",
    websiteUrl: "",
  });
  if (needsVerification) {
    return (
      <DeveloperBusinessForm
        copy={copy}
        onVerified={() => setNeedsVerification(false)}
      />
    );
  }
  return (
    <form
      className="grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setSubmitting(true);
        try {
          let iconUrl = "";
          if (iconFile) {
            const uploadResponse = await fetch("/api/connectors/icons", {
              body: iconFile,
              credentials: "include",
              headers: {
                "Content-Type": iconFile.type,
                "X-File-Name": encodeURIComponent(iconFile.name),
              },
              method: "POST",
            });
            if (!uploadResponse.ok) throw new Error("icon_upload_failed");
            iconUrl = (await uploadResponse.json()).iconUrl;
          }
          const response = await fetch("/api/connectors/create", {
            body: JSON.stringify({ ...form, iconUrl }),
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            method: "POST",
          });
          const payload = await response.json().catch(() => ({}));
          if (payload.error === "publisher_verification_required") {
            setNeedsVerification(true);
            return;
          }
          if (!response.ok) throw new Error("connector_create_failed");
          onCreated(payload.connector);
          close();
        } catch {
          showToast({ messageKey: "connectorCreateFailed", type: "error" });
        } finally {
          setSubmitting(false);
        }
      }}
    >
      {[
        ["name", copy.connectorName, "text"],
        ["developer", copy.connectorDeveloper, "text"],
        ["websiteUrl", copy.connectorWebsite, "url"],
        ["termsUrl", copy.footerTerms, "url"],
        ["privacyUrl", copy.footerPrivacy, "url"],
      ].map(([key, label, type]) => (
        <label className="text-sm font-semibold" key={key}>
          {label}
          <input
            className="mt-1 w-full rounded-xl border border-white/10 bg-white/8! px-3 py-2 outline-none"
            onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
            required={key !== "iconUrl"}
            type={type}
            value={form[key]}
          />
        </label>
      ))}
      <label className="text-sm font-semibold">
        {copy.connectorIcon}
        <div className="mt-1">
          <CustomFilePicker
            copy={copy}
            onChange={({ error, file }) => {
              if (error) {
                showToast({ messageKey: "filePickerInvalidImage", type: "error" });
                return;
              }
              setIconFile(file);
            }}
          />
        </div>
      </label>
      <label className="text-sm font-semibold">
        {copy.connectorDescription}
        <textarea
          className="mt-1 min-h-24 w-full rounded-xl border border-white/10 bg-white/8! px-3 py-2 outline-none"
          minLength={20}
          onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
          required
          value={form.description}
        />
      </label>
      <label className="text-sm font-semibold">
        {copy.connectorVisibility}
        <select
          className="mt-1 w-full rounded-xl border border-white/10 bg-purple-950/50! px-3 py-2"
          onChange={(event) => setForm((current) => ({ ...current, visibility: event.target.value }))}
          value={form.visibility}
        >
          <option value="private">{copy.connectorPrivate}</option>
          <option value="public">{copy.connectorPublishToStore}</option>
        </select>
      </label>
      <p className="text-xs leading-5 text-white/50">{copy.connectorPublishingRequirements}</p>
      <button
        className="rounded-xl bg-purple-500/70! px-4 py-2 font-bold disabled:opacity-55"
        disabled={submitting}
        type="submit"
      >
        {submitting ? copy.connectorUploading : copy.connectorCreate}
      </button>
    </form>
  );
}

export default function ConnectorStore() {
  const copy = t();
  const [connectors, setConnectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workingConnectorId, setWorkingConnectorId] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);
  const appsRef = useRef(null);

  useEffect(() => {
    fetch("/api/connectors?scope=store", {
      cache: "no-store",
      credentials: "include",
    })
      .then((response) => {
        if (!response.ok) throw new Error("load_failed");
        return response.json();
      })
      .then((payload) => setConnectors(payload.connectors || []))
      .catch(() => showToast({ messageKey: "connectorsLoadFailed", type: "error" }))
      .finally(() => setLoading(false));
  }, []);

  const openCreate = () => {
    if (!hasSignedInCookie()) {
      window.location.assign("/signin");
      return;
    }
    showModal(
      ({ close }) => (
        <CreateConnector
          close={close}
          copy={copy}
          onCreated={(connector) => setConnectors((current) => [...current, connector])}
        />
      ),
      { title: copy.connectorCreate, width: "min(38rem, calc(100vw - 1rem))" },
    );
  };

  const disconnect = async (connector) => {
    if (workingConnectorId) {
      return;
    }

    setWorkingConnectorId(connector.id);
    try {
      const response = await fetch(
        `/api/connectors?connectorId=${encodeURIComponent(connector.id)}`,
        {
          credentials: "include",
          method: "DELETE",
        },
      );
      if (!response.ok) {
        throw new Error("disconnect_failed");
      }
      setConnectors((current) =>
        current.map((item) =>
          item.id === connector.id ? { ...item, connected: false } : item,
        ),
      );
    } catch {
      showToast({
        messageKey: "connectorDisconnectFailed",
        type: "error",
      });
    } finally {
      setWorkingConnectorId("");
    }
  };

  const connect = async (connector) => {
    if (workingConnectorId) {
      return;
    }
    if (!hasSignedInCookie()) {
      window.location.assign("/signin");
      return;
    }

    setWorkingConnectorId(connector.id);
    try {
      const response = await fetch("/api/connectors/github/connect", {
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error("connect_failed");
      }
      const payload = await response.json();
      if (!payload.authorizeUrl) {
        throw new Error("connect_failed");
      }
      window.location.assign(payload.authorizeUrl);
    } catch {
      setWorkingConnectorId("");
      showToast({
        messageKey: "connectorConnectFailed",
        type: "error",
      });
    }
  };

  return (
    <main className="min-h-dvh px-3 pb-12 pt-24 text-white sm:px-5">
      <header className="topbar mcontainer fixed inset-x-0 top-0 z-50 flex h-20 items-center justify-between bg-transparent px-3 sm:px-5">
        <div className="topbar-left liquid-glass flex h-14 items-center gap-3 rounded-2xl border border-white/10 bg-white/10! px-4 backdrop-blur-[3px]">
          <img alt="" className="h-8 w-8 rounded-xl" src="/favicon.ico" />
          <strong>{copy.connectorStoreTitle}</strong>
        </div>
        <AppTopbarRight className="topbar-right rounded-2xl border border-white/10 bg-white/10! shadow-xl shadow-black/10 backdrop-blur-[3px]">
          <button className="grid h-10 w-10 place-items-center rounded-xl transition hover:bg-purple-500/25! active:scale-95" aria-label={copy.connectorCreate} onClick={openCreate} type="button"><icon>add</icon></button>
          <button
            aria-label={copy.settings}
            className="grid h-10 w-10 place-items-center rounded-xl transition hover:bg-purple-500/25! active:scale-95"
            onClick={() => showModal(<StoreSettings copy={copy} />, { title: copy.settings })}
            type="button"
          ><icon>settings</icon></button>
          <button className="grid h-10 w-10 place-items-center rounded-xl transition hover:bg-purple-500/25! active:scale-95" aria-label={copy.apps} onClick={() => setAppsOpen((open) => !open)} ref={appsRef} type="button"><icon>apps</icon></button>
          <button className="grid h-10 w-10 place-items-center overflow-hidden rounded-xl transition hover:bg-purple-500/25! active:scale-95" aria-label={copy.account} onClick={() => setAccountOpen((open) => !open)} type="button">
            {hasSignedInCookie() ? <AccountAvatar account={{ name: "Munetios" }} className="h-9 w-9 rounded-xl" /> : <icon>account_circle</icon>}
          </button>
        </AppTopbarRight>
      </header>
      <AppLauncherWrapper copy={copy} onClose={() => setAppsOpen(false)} open={appsOpen} triggerRef={appsRef} />
      {accountOpen ? <div className="fixed right-3 top-20 z-[1100] w-[min(30rem,calc(100vw-1.5rem))]"><AccountWrapper appContext /></div> : null}
      <section className="mx-auto max-w-6xl">
        <p className="text-sm font-bold uppercase tracking-[0.15em] text-purple-200">Munetios</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">{copy.connectorStoreTitle}</h1>
        <p className="mt-4 max-w-2xl text-white/65">{copy.connectorStoreDescription}</p>
        {loading ? <div className="grid min-h-64 place-items-center"><LoadingSpinner label={copy.connectorsLoading} /></div> : (
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {connectors.filter((connector) => connector.visibility === "public").map((connector) => (
              <article className="liquid-glass rounded-3xl border border-white/10 bg-white/8! p-6" key={connector.id}>
                <img alt="" className="h-16 w-16 rounded-2xl bg-black/40! p-2" src={connector.iconUrl} />
                <h2 className="mt-4 text-2xl font-bold">{connector.name}</h2>
                <p className="mt-1 text-sm text-white/50">{connector.developer}</p>
                <p className="mt-3 text-sm leading-6 text-white/70">{connector.description}</p>
                <div className="mt-5 flex gap-2">
                  {connector.connected ? (
                    <button
                      className="rounded-xl border border-rose-200/20 bg-rose-500/15! px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={workingConnectorId === connector.id}
                      onClick={() => void disconnect(connector)}
                      type="button"
                    >
                      {copy.connectorDisconnect}
                    </button>
                  ) : connector.slug === "github" ? (
                    <button
                      className="rounded-xl bg-purple-500/70! px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={workingConnectorId === connector.id}
                      onClick={() => void connect(connector)}
                      type="button"
                    >
                      {copy.connectorConnect}
                    </button>
                  ) : null}
                  <a className="rounded-xl border border-white/10 px-4 py-2 text-sm" href={connector.privacyUrl} target="_blank">{copy.footerPrivacy}</a>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
