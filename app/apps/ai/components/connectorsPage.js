"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import LoadingSpinner from "../../../components/loadingSpinner";
import { showToast } from "../../../components/toast";
import { t } from "../../../i18n";
import { showParentalAwareToast } from "../../../lib/parentalControlsClient";
import ConnectorsTopbar from "./connectorsTopbar";

export default function ConnectorsPage() {
  const [copy, setCopy] = useState(() => t());
  const [authenticated, setAuthenticated] = useState(false);
  const [connectors, setConnectors] = useState([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [workingConnectorId, setWorkingConnectorId] = useState("");

  const loadConnectors = useCallback(async () => {
    setFailed(false);
    setLoading(true);
    try {
      const response = await fetch("/api/connectors?scope=store", {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) throw new Error("connectors_load_failed");
      const payload = await response.json();
      setAuthenticated(Boolean(payload.authenticated));
      setConnectors(
        Array.isArray(payload.connectors) ? payload.connectors : [],
      );
    } catch {
      setConnectors([]);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("connectorError") !== "connect") return;

    url.searchParams.delete("connectorError");
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    const toastTimer = window.setTimeout(() => {
      showToast({ messageKey: "connectorConnectFailed", type: "error" });
    }, 0);

    return () => window.clearTimeout(toastTimer);
  }, []);

  useEffect(() => {
    const refreshCopy = () => setCopy(t());
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);
    return () => {
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
    };
  }, []);

  const visibleConnectors = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return connectors;
    return connectors.filter((connector) =>
      [connector.name, connector.developer, connector.description].some(
        (value) =>
          String(value || "")
            .toLocaleLowerCase()
            .includes(normalizedQuery),
      ),
    );
  }, [connectors, query]);

  const disconnectConnector = useCallback(async (connectorId) => {
    setWorkingConnectorId(connectorId);
    try {
      const response = await fetch(
        `/api/connectors?connectorId=${encodeURIComponent(connectorId)}`,
        {
          credentials: "include",
          method: "DELETE",
        },
      );
      if (!response.ok) throw new Error("disconnect_failed");
      setConnectors((current) =>
        current.map((connector) =>
          connector.id === connectorId
            ? { ...connector, connected: false }
            : connector,
        ),
      );
    } catch {
      showToast({ messageKey: "connectorDisconnectFailed", type: "error" });
    } finally {
      setWorkingConnectorId("");
    }
  }, []);

  const connectConnector = useCallback(
    async (connector) => {
      if (!authenticated) {
        window.location.assign("/signin?returnTo=%2Fapps%2Fai%2Fconnectors");
        return;
      }

      setWorkingConnectorId(connector.id);
      try {
        const response = await fetch(
          `/api/connectors/${encodeURIComponent(connector.slug)}/connect?returnTo=%2Fapps%2Fai%2Fconnectors`,
          {
            cache: "no-store",
            credentials: "include",
            headers: { Accept: "application/json" },
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || typeof payload.authorizeUrl !== "string") {
          showParentalAwareToast(
            payload,
            { messageKey: "connectorConnectFailed", type: "error" },
            showToast,
          );
          setWorkingConnectorId("");
          return;
        }
        window.location.assign(payload.authorizeUrl);
      } catch {
        showToast({ messageKey: "connectorConnectFailed", type: "error" });
        setWorkingConnectorId("");
      }
    },
    [authenticated],
  );

  if (mobileSearchOpen) {
    return (
      <section className="ai-connectors-page ai-connectors-search-page">
        <header className="ai-connectors-mobile-search-topbar liquid-glass">
          <button
            aria-label={copy.accountBack}
            onClick={() => setMobileSearchOpen(false)}
            type="button"
          >
            <icon>arrow_back</icon>
          </button>
          <label className="ai-connectors-search-field">
            <icon>search</icon>
            <input
              aria-label={copy.aiConnectorsSearch}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.aiConnectorsSearch}
              value={query}
            />
          </label>
        </header>
        <ConnectorContent
          connectors={visibleConnectors}
          copy={copy}
          failed={failed}
          loading={loading}
          onConnect={connectConnector}
          onDisconnect={disconnectConnector}
          retry={loadConnectors}
          workingConnectorId={workingConnectorId}
        />
      </section>
    );
  }

  return (
    <section className="ai-connectors-page">
      <ConnectorsTopbar
        copy={copy}
        onOpenMobileSearch={() => setMobileSearchOpen(true)}
        query={query}
        setQuery={setQuery}
      />
      <ConnectorContent
        connectors={visibleConnectors}
        copy={copy}
        failed={failed}
        loading={loading}
        onConnect={connectConnector}
        onDisconnect={disconnectConnector}
        retry={loadConnectors}
        workingConnectorId={workingConnectorId}
      />
    </section>
  );
}

function ConnectorContent({
  connectors,
  copy,
  failed,
  loading,
  onConnect,
  onDisconnect,
  retry,
  workingConnectorId,
}) {
  if (loading) {
    return (
      <div className="ai-connectors-loading">
        <LoadingSpinner label={copy.connectorsLoading} />
      </div>
    );
  }

  if (failed) {
    return (
      <div className="ai-connectors-error" role="alert">
        <icon className="ai-connectors-error-icon">cloud_off</icon>
        <p>{copy.connectorsLoadFailed}</p>
        <button onClick={() => void retry()} type="button">
          <icon>refresh</icon>
          {copy.retry}
        </button>
      </div>
    );
  }

  if (connectors.length === 0) {
    return (
      <p className="ai-connectors-empty">{copy.accountConnectorsNoItems}</p>
    );
  }

  return (
    <div className="ai-connectors-grid">
      {connectors.map((connector) => (
        <article className="ai-connector-card liquid-glass" key={connector.id}>
          <Image
            alt=""
            height={56}
            src={connector.iconUrl}
            unoptimized
            width={56}
          />
          <div>
            <h2>{connector.name}</h2>
            <span>{connector.developer}</span>
            <p>{connector.description}</p>
          </div>
          {connector.connected
            ? <button
                className="ai-connector-action is-disconnect"
                disabled={workingConnectorId === connector.id}
                onClick={() => void onDisconnect(connector.id)}
                type="button"
              >
                {copy.connectorDisconnect}
              </button>
            : connector.slug === "github"
              ? <button
                  className="ai-connector-action"
                  disabled={workingConnectorId === connector.id}
                  onClick={() => void onConnect(connector)}
                  type="button"
                >
                  {copy.connectorConnect}
                </button>
              : null}
        </article>
      ))}
    </div>
  );
}
