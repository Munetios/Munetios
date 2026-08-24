"use client";

import AppTopbarRight from "../../../components/appTopbarRight";

export default function ImagesTopbar({ copy, setView, view }) {
  return (
    <header className="ai-images-topbar">
      <div className="ai-images-topbar-left">
        <h1 className="ai-images-title liquid-glass">{copy.aiImagesTitle}</h1>
      </div>
      <AppTopbarRight className="ai-images-topbar-right">
        <div className="ai-images-view-toggle">
          <button
            aria-label={copy.aiImagesGridView}
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
            type="button"
          >
            <icon>grid_view</icon>
          </button>
          <button
            aria-label={copy.aiImagesListView}
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
            type="button"
          >
            <icon>view_list</icon>
          </button>
        </div>
      </AppTopbarRight>
    </header>
  );
}
