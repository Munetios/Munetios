"use client";

import AppTopbarRight from "../../../components/appTopbarRight";

export default function ConnectorsTopbar({
  copy,
  onOpenMobileSearch,
  query,
  setQuery,
}) {
  return (
    <header className="ai-connectors-topbar">
      <div className="ai-connectors-topbar-left">
        <button
          aria-label={copy.notesShortcutToggleSidebar}
          className="ai-connectors-menu-button liquid-glass"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("munetios:ai-open-sidebar"))
          }
          type="button"
        >
          <icon>menu</icon>
        </button>
        <h1 className="ai-connectors-title liquid-glass">
          {copy.accountSettingsConnectors}
        </h1>
      </div>
      <AppTopbarRight className="ai-connectors-topbar-right">
        <label className="ai-connectors-desktop-search">
          <icon>search</icon>
          <input
            aria-label={copy.aiConnectorsSearch}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.aiConnectorsSearch}
            value={query}
          />
        </label>
        <button
          aria-label={copy.aiConnectorsSearch}
          className="ai-connectors-mobile-search-button"
          onClick={onOpenMobileSearch}
          type="button"
        >
          <icon>search</icon>
        </button>
      </AppTopbarRight>
    </header>
  );
}
