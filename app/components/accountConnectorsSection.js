"use client";

import { useCallback, useEffect, useState } from "react";
import {
  developerSettingsChangeEvent,
  loadDeveloperSettings,
} from "../lib/developerSettings";
import { showParentalAwareToast } from "../lib/parentalControlsClient";
import LoadingSpinner from "./loadingSpinner";
import { showModal } from "./modal";
import { showToast } from "./toast";

const localConnectorsKey = "munetios.developer.connectors";

function loadLocalConnectors() {
  try {
    return JSON.parse(window.localStorage.getItem(localConnectorsKey) || "[]");
  } catch {
    return [];
  }
}

function CreateConnectorModal({ close, copy, onCreated }) {
  const [form, setForm] = useState({ description: "", name: "", url: "" });
  const create = () => {
    let url;
    try {
      url = new URL(form.url);
    } catch {
      showToast({ message: copy.developerConnectorInvalid, type: "error" });
      return;
    }
    if (!form.name.trim() || !/^https?:$/.test(url.protocol)) {
      showToast({ message: copy.developerConnectorInvalid, type: "error" });
      return;
    }
    const connector = {
      connected: false,
      description: form.description.trim(),
      developer: copy.developerLocalOnly,
      iconUrl: "/favicon.ico",
      id: `local-${crypto.randomUUID()}`,
      name: form.name.trim(),
      privacyUrl: url.toString(),
      termsUrl: url.toString(),
      visibility: "private",
      websiteUrl: url.toString(),
    };
    const next = [...loadLocalConnectors(), connector];
    window.localStorage.setItem(localConnectorsKey, JSON.stringify(next));
    onCreated(connector);
    close();
  };
  return (
    <div className="space-y-3">
      <input
        className="w-full rounded-xl border border-white/10 bg-black/20! px-3 py-2"
        onChange={(event) =>
          setForm((current) => ({ ...current, name: event.target.value }))
        }
        placeholder={copy.developerConnectorName}
        value={form.name}
      />
      <input
        className="w-full rounded-xl border border-white/10 bg-black/20! px-3 py-2"
        onChange={(event) =>
          setForm((current) => ({ ...current, url: event.target.value }))
        }
        placeholder={copy.developerProviderUrl}
        value={form.url}
      />
      <textarea
        className="min-h-24 w-full rounded-xl border border-white/10 bg-black/20! px-3 py-2"
        onChange={(event) =>
          setForm((current) => ({
            ...current,
            description: event.target.value,
          }))
        }
        placeholder={copy.developerConnectorDescription}
        value={form.description}
      />
      <button
        className="rounded-xl bg-purple-600/60! px-4 py-2 text-sm font-bold"
        onClick={create}
        type="button"
      >
        {copy.developerCreateConnector}
      </button>
    </div>
  );
}

export default function AccountConnectorsSection({
  copy,
  deletedAccount = false,
}) {
  const [connectors, setConnectors] = useState([]);
  const [state, setState] = useState("loading");
  const [workingConnectorId, setWorkingConnectorId] = useState("");
  const [developerMode, setDeveloperMode] = useState(false);

  const load = useCallback(async () => {
    if (deletedAccount) {
      setConnectors(loadLocalConnectors());
      setState("ready");
      return;
    }
    setState("loading");
    try {
      const response = await fetch("/api/connectors", {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) throw new Error("load_failed");
      const payload = await response.json();
      setConnectors([...(payload.connectors || []), ...loadLocalConnectors()]);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [deletedAccount]);

  useEffect(() => {
    void load();
    const url = new URL(window.location.href);
    const error = url.searchParams.get("connectorError");
    if (error === "connect") {
      showToast({ messageKey: "connectorConnectFailed", type: "error" });
      url.searchParams.delete("connectorError");
      window.history.replaceState(
        {},
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
  }, [load]);

  useEffect(() => {
    const refresh = (event) =>
      setDeveloperMode(
        Boolean((event?.detail || loadDeveloperSettings()).developerMode),
      );
    refresh();
    window.addEventListener(developerSettingsChangeEvent, refresh);
    return () =>
      window.removeEventListener(developerSettingsChangeEvent, refresh);
  }, []);

  const connect = async (connector) => {
    if (workingConnectorId) return;

    setWorkingConnectorId(connector.id);
    try {
      const response = await fetch("/api/connectors/github/connect", {
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.authorizeUrl) {
        setWorkingConnectorId("");
        showParentalAwareToast(
          payload,
          { messageKey: "connectorConnectFailed", type: "error" },
          showToast,
        );
        return;
      }
      window.location.assign(payload.authorizeUrl);
    } catch {
      setWorkingConnectorId("");
      showToast({ messageKey: "connectorConnectFailed", type: "error" });
    }
  };

  const disconnect = async (connector) => {
    if (workingConnectorId) return;

    setWorkingConnectorId(connector.id);
    try {
      const response = await fetch(
        `/api/connectors?connectorId=${encodeURIComponent(connector.id)}`,
        { credentials: "include", method: "DELETE" },
      );
      if (!response.ok) throw new Error("disconnect_failed");
      setConnectors((current) =>
        current.map((item) =>
          item.id === connector.id ? { ...item, connected: false } : item,
        ),
      );
    } catch {
      showToast({ messageKey: "connectorDisconnectFailed", type: "error" });
    } finally {
      setWorkingConnectorId("");
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {copy.accountSettingsConnectors}
          </h1>
          <p className="mt-1 text-sm text-white/65">
            {copy.connectorsAccountDescription}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {developerMode
            ? <button
                className="liquid-glass rounded-xl border border-purple-200/20 px-4 py-2 text-sm font-bold"
                onClick={() =>
                  showModal(
                    ({ close }) => (
                      <CreateConnectorModal
                        close={close}
                        copy={copy}
                        onCreated={(connector) =>
                          setConnectors((current) => [...current, connector])
                        }
                      />
                    ),
                    {
                      ariaLabel: copy.developerCreateConnector,
                      title: copy.developerCreateConnector,
                    },
                  )
                }
                type="button"
              >
                {copy.developerCreateConnector}
              </button>
            : null}
          <a
            className="liquid-glass rounded-xl border border-purple-200/20 bg-purple-600/45! px-4 py-2 text-sm font-bold"
            href="/apps/connectorstore"
          >
            {copy.connectorBrowseStore}
          </a>
        </div>
      </header>
      {state === "loading"
        ? <div className="grid min-h-52 place-items-center">
            <LoadingSpinner label={copy.connectorsLoading} />
          </div>
        : state === "error"
          ? <div className="liquid-glass rounded-2xl border border-rose-200/20 bg-rose-500/10! p-6 text-center">
              <icon className="text-4xl text-rose-200">error</icon>
              <p className="mt-3 font-semibold">{copy.connectorsLoadFailed}</p>
              <button
                className="mt-4 rounded-xl border border-white/10 bg-white/10! px-4 py-2 text-sm font-bold"
                onClick={() => void load()}
                type="button"
              >
                {copy.retry}
              </button>
            </div>
          : <div className="grid gap-4">
              {connectors.map((connector) => (
                <article
                  className="liquid-glass rounded-3xl border border-white/10 bg-white/8! p-5"
                  key={connector.id}
                >
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                    <img
                      alt=""
                      className="h-16 w-16 rounded-2xl bg-black/40! p-2"
                      src={connector.iconUrl}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-bold">{connector.name}</h2>
                        {connector.visibility === "private"
                          ? <span className="rounded-full bg-white/10! px-2 py-1 text-xs">
                              {copy.connectorPrivate}
                            </span>
                          : null}
                      </div>
                      <p className="mt-1 text-sm text-white/55">
                        {copy.connectorDeveloper}: {connector.developer}
                      </p>
                      <p className="mt-3 text-sm leading-6 text-white/70">
                        {connector.description}
                      </p>
                      <nav className="mt-3 flex flex-wrap gap-3 text-xs text-purple-200">
                        <a
                          href={connector.websiteUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {copy.connectorWebsite}
                        </a>
                        <a
                          href={connector.termsUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {copy.footerTerms}
                        </a>
                        <a
                          href={connector.privacyUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {copy.footerPrivacy}
                        </a>
                      </nav>
                    </div>
                    {connector.connected
                      ? <button
                          className="rounded-xl border border-rose-200/20 bg-rose-500/15! px-4 py-2 text-sm font-bold"
                          disabled={workingConnectorId === connector.id}
                          onClick={() => void disconnect(connector)}
                          type="button"
                        >
                          {copy.connectorDisconnect}
                        </button>
                      : connector.slug === "github"
                        ? <button
                            className="rounded-xl bg-purple-500/70! px-4 py-2 text-center text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={workingConnectorId === connector.id}
                            onClick={() => void connect(connector)}
                            type="button"
                          >
                            {copy.connectorConnect}
                          </button>
                        : null}
                  </div>
                </article>
              ))}
            </div>}
    </div>
  );
}
