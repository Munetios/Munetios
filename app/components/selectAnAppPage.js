"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentLocale, t } from "../i18n";
import IgnoreElementErrorBoundary from "./ignoreElementErrorBoundary";
import { showModal } from "./modal";
import SelectAnAppTopbar from "./selectAnAppTopbar";

const appOrderStorageKey = "munetios.select-app.order";
const appFoldersStorageKey = "munetios.select-app.folders";
const comingSoonApps = new Set([
  "mail",
  "ai",

  "drive",
  "chat",
  "sheets",
  "slides",
  "websites",
  "design",
]);

function getProductCategory(app) {
  if (["mail", "meet", "chat"].includes(app)) return "communication";
  if (["design", "websites", "slides"].includes(app)) return "creative";
  if (["calendar", "drive", "notes", "tasks"].includes(app)) return "organize";
  return "productivity";
}

function CreateFolderModal({ close, copy, onCreate }) {
  const [name, setName] = useState("");
  return (
    <div className="space-y-3">
      <input
        className="h-11 w-full rounded-xl border border-white/10 bg-white/5! px-3 text-sm text-white outline-none focus:border-purple-300/50"
        onChange={(event) => setName(event.target.value)}
        placeholder={copy.omniWriteCreateFolder}
        value={name}
      />
      <div className="flex justify-end gap-2">
        <button
          className="rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/10!"
          onClick={close}
          type="button"
        >
          {copy.cancel}
        </button>
        <button
          className="liquid-glass rounded-xl border border-purple-200/20 bg-purple-600/35! px-3 py-2 text-sm font-bold disabled:opacity-50"
          disabled={!name.trim()}
          onClick={() => {
            onCreate(name.trim());
            close();
          }}
          type="button"
        >
          {copy.businessFeedbackDone}
        </button>
      </div>
    </div>
  );
}

const _products = [
  {
    app: "mail",
    id: 1,
    name: "Munetios Mail",
    nameKey: "productMailName",
    image: "/mail.png",
    descriptionKey: "productMailDescription",
    url: "/apps/mail",
  },
  {
    app: "ai",
    id: 2,
    name: "Munetios AI",
    nameKey: "productAiName",
    image: "/ai.png",
    descriptionKey: "productAiDescription",
    url: "/apps/ai",
  },
  {
    app: "calendar",
    id: 3,
    name: "Munetios Calendar",
    nameKey: "productCalendarName",
    image: "/calendar.png",
    descriptionKey: "productCalendarDescription",
    url: "/apps/calendar",
  },
  {
    app: "omniwrite",
    id: 4,
    name: "Munetios OmniWrite",
    nameKey: "productOmniWriteName",
    image: "/omniwrite.png",
    descriptionKey: "productOmniWriteDescription",
    url: "https://omniwrite.munetios.com",
  },
  {
    app: "drive",
    id: 5,
    name: "Munetios Drive",
    nameKey: "productDriveName",
    image: "/drive.png",
    descriptionKey: "productDriveDescription",
    url: "https://drive.munetios.com",
  },
  {
    app: "meet",
    id: 6,
    name: "Munetios Meet",
    nameKey: "productMeetName",
    image: "/meet.png",
    descriptionKey: "productMeetDescription",
    url: "/apps/meet",
  },
  {
    app: "chat",
    id: 7,
    name: "Munetios Chat",
    nameKey: "productChatName",
    image: "/chat.png",
    descriptionKey: "productChatDescription",
    url: "https://chat.munetios.com",
  },
  {
    app: "sheets",
    id: 8,
    name: "Munetios Sheets",
    nameKey: "productSheetsName",
    image: "/sheets.png",
    descriptionKey: "productSheetsDescription",
    url: "https://sheets.munetios.com",
  },
  {
    app: "slides",
    id: 9,
    name: "Munetios Slides",
    nameKey: "productSlidesName",
    image: "/slides.png",
    descriptionKey: "productSlidesDescription",
    url: "https://slides.munetios.com",
  },
  {
    app: "websites",
    id: 10,
    name: "Munetios Websites",
    nameKey: "productWebsitesName",
    image: "/websites.png",
    descriptionKey: "productWebsitesDescription",
    url: "/apps/websites",
  },
  {
    app: "design",
    id: 11,
    name: "Munetios Design",
    nameKey: "productDesignName",
    image: "/design.png",
    descriptionKey: "productDesignDescription",
    url: "/apps/design",
  },
  {
    app: "notes",
    id: 13,
    name: "Munetios SupaNotes",
    nameKey: "productSupaNotesName",
    image: "https://notes.munetios.com/apple-touch-icon.png",
    descriptionKey: "productSupaNotesDescription",
    url: "https://notes.munetios.com",
  },
  {
    app: "tasks",
    id: 14,
    name: "Munetios Tasks",
    nameKey: "productTasksName",
    image: "https://tasks.munetios.com/apple-touch-icon.png",
    descriptionKey: "productTasksDescription",
    url: "/apps/tasks",
  },
];

export default function SelectAnAppPage({ active = true }) {
  const [locale, setLocale] = useState("en");
  const [archived, setArchived] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [organization, setOrganization] = useState(null);
  const [activeCategory, setActiveCategory] = useState("all");
  const [appOrder, setAppOrder] = useState([]);
  const [draggedAppId, setDraggedAppId] = useState(null);
  const [folders, setFolders] = useState([]);
  const [search, setSearch] = useState("");
  const suppressLaunchRef = useRef(false);
  const copy = useMemo(() => t(locale), [locale]);

  useEffect(() => {
    try {
      setAppOrder(
        JSON.parse(window.localStorage.getItem(appOrderStorageKey) || "[]"),
      );
      setFolders(
        JSON.parse(window.localStorage.getItem(appFoldersStorageKey) || "[]"),
      );
    } catch {
      setAppOrder([]);
      setFolders([]);
    }
  }, []);

  useEffect(() => {
    const refreshLocale = () => {
      setLocale(getCurrentLocale());
    };

    refreshLocale();
    window.addEventListener("languagechange", refreshLocale);
    window.addEventListener("munetios:languagechange", refreshLocale);
    window.addEventListener("munetios:localechange", refreshLocale);

    return () => {
      window.removeEventListener("languagechange", refreshLocale);
      window.removeEventListener("munetios:languagechange", refreshLocale);
      window.removeEventListener("munetios:localechange", refreshLocale);
    };
  }, []);

  useEffect(() => {
    fetch("/api/organization/access", {
      cache: "no-store",
      credentials: "include",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => setOrganization(payload?.organization || null))
      .catch(() => setOrganization(null));
  }, []);

  const availableProducts = useMemo(() => {
    const products = _products
      .filter((product) => organization?.appAccess?.[product.app] !== false)
      .map((product) => ({
        ...product,
        category: getProductCategory(product.app),
        comingSoon: comingSoonApps.has(product.app),
      }));
    if (organization?.administrator) {
      products.push({
        app: "admin",
        category: "productivity",
        descriptionKey: "adminDashboardDescriptionShort",
        id: 99,
        image: "/favicon.ico",
        name: "Munetios Admin",
        nameKey: "adminTitle",
        url: "/apps/admin",
      });
    }
    const order = new Map(appOrder.map((id, index) => [String(id), index]));
    return products.sort(
      (left, right) =>
        (order.get(String(left.id)) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(String(right.id)) ?? Number.MAX_SAFE_INTEGER) ||
        left.id - right.id,
    );
  }, [appOrder, organization]);

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(locale);
    return availableProducts.filter((product) => {
      if (product.comingSoon) return false;
      if (activeCategory !== "all" && product.category !== activeCategory) {
        return false;
      }
      const label = copy[product.nameKey] || product.name;
      return !query || label.toLocaleLowerCase(locale).includes(query);
    });
  }, [activeCategory, availableProducts, copy, locale, search]);

  const persistOrder = (nextOrder) => {
    setAppOrder(nextOrder);
    window.localStorage.setItem(appOrderStorageKey, JSON.stringify(nextOrder));
  };
  const dropBeforeApp = (targetId) => {
    if (!draggedAppId || draggedAppId === targetId) return;
    const currentOrder = availableProducts.map(({ id }) => String(id));
    const sourceId = String(draggedAppId);
    const next = currentOrder.filter((id) => id !== sourceId);
    next.splice(Math.max(0, next.indexOf(String(targetId))), 0, sourceId);
    persistOrder(next);
    setDraggedAppId(null);
  };
  const saveFolders = (nextFolders) => {
    setFolders(nextFolders);
    window.localStorage.setItem(
      appFoldersStorageKey,
      JSON.stringify(nextFolders),
    );
  };
  const addFolder = (name) => {
    saveFolders([
      ...folders,
      {
        appIds: [],
        id: globalThis.crypto?.randomUUID?.() || `folder-${Date.now()}`,
        name,
      },
    ]);
  };
  const addDraggedAppToFolder = (folderId) => {
    if (!draggedAppId) return;
    saveFolders(
      folders.map((folder) =>
        folder.id === folderId
          ? {
              ...folder,
              appIds: Array.from(
                new Set([...folder.appIds, String(draggedAppId)]),
              ),
            }
          : folder,
      ),
    );
    setDraggedAppId(null);
  };

  useEffect(() => {
    fetch("/api/account", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((account) => setArchived(Boolean(account?.archived)))
      .catch(() => setArchived(false));
  }, []);

  useEffect(() => {
    if (!archived || offlineMode) return undefined;
    const continueOffline = (event) => {
      if (event.key === "Escape") setOfflineMode(true);
    };
    window.addEventListener("keydown", continueOffline);
    return () => window.removeEventListener("keydown", continueOffline);
  }, [archived, offlineMode]);

  return (
    <main
      aria-label={copy.selectAppPageAriaLabel}
      className="munetios-app-render flex min-h-dvh flex-col overflow-x-hidden bg-[var(--app-background)] text-[var(--foreground)] [font-family:var(--app-font)]"
      data-munetios-app-render="true"
    >
      <IgnoreElementErrorBoundary>
        <SelectAnAppTopbar active={active} />
      </IgnoreElementErrorBoundary>
      <section className="mx-auto flex w-full max-w-7xl flex-1 flex-col items-center px-3 pb-5 pt-16 sm:px-4 lg:px-5">
        <div className="w-full text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-[var(--accent)]">
            {copy.selectAppKicker}
          </p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
            {copy.selectAppHeading}
          </h1>
          <p className="mt-2 text-sm text-[color-mix(in_srgb,var(--foreground)_68%,transparent)]">
            {copy.selectAppLaunchDescription}
          </p>
          <p className="liquid-glass mx-auto mt-3 flex w-fit items-center gap-2 rounded-full border border-purple-200/20 bg-purple-500/15! px-3 py-1.5 text-xs font-bold text-purple-100">
            <icon>experiment</icon>
            {copy.selectAppBetaNotice}
          </p>
        </div>
        <div className="mt-4 flex w-full flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {[
              ["all", copy.appLauncherShowAll],
              ["productivity", copy.selectAppCategoryProductivity],
              ["communication", copy.selectAppCategoryCommunication],
              ["creative", copy.selectAppCategoryCreative],
              ["organize", copy.selectAppCategoryOrganize],
            ].map(([id, label]) => (
              <button
                aria-pressed={activeCategory === id}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${activeCategory === id ? "border-purple-200/30 bg-purple-500/30!" : "border-white/10 bg-white/5! hover:bg-white/10!"}`}
                key={id}
                onClick={() => setActiveCategory(id)}
                type="button"
              >
                {label}
              </button>
            ))}
            <button
              className="liquid-glass ml-auto flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold"
              onClick={() =>
                showModal(
                  ({ close }) => (
                    <CreateFolderModal
                      close={close}
                      copy={copy}
                      onCreate={addFolder}
                    />
                  ),
                  {
                    ariaLabel: copy.omniWriteCreateFolder,
                    title: copy.omniWriteCreateFolder,
                    width: "min(430px, 100%)",
                  },
                )
              }
              type="button"
            >
              <icon>create_new_folder</icon>
              {copy.omniWriteCreateFolder}
            </button>
          </div>
          <label className="liquid-glass flex h-11 w-full items-center gap-2 rounded-2xl border border-white/10 px-3">
            <icon>search</icon>
            <input
              className="min-w-0 flex-1 bg-transparent! text-sm outline-none"
              onChange={(event) => setSearch(event.target.value)}
              placeholder={copy.appLauncherSearchPlaceholder}
              value={search}
            />
          </label>
          {folders.length
            ? <section
                aria-label={copy.omniWriteFolders}
                className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
              >
                {folders.map((folder) => (
                  <article
                    className="liquid-glass min-w-0 overflow-hidden rounded-2xl border border-dashed border-white/15 bg-white/5!"
                    key={folder.id}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => addDraggedAppToFolder(folder.id)}
                  >
                    <header className="flex min-w-0 items-center gap-2 border-b border-white/10 px-3 py-2.5 text-sm font-bold">
                      <icon>folder</icon>
                      <span className="truncate">{folder.name}</span>
                    </header>
                    <div className="flex min-h-16 flex-wrap content-start items-start gap-2 p-3">
                      {folder.appIds.map((appId) => {
                        const product = availableProducts.find(
                          ({ id }) => String(id) === appId,
                        );
                        return product
                          ? <button
                              aria-label={`${copy[product.nameKey] || product.name}${product.comingSoon ? ` — ${copy.comingSoon}` : ""}`}
                              className={`relative h-10 w-10 rounded-xl border border-white/10 bg-white/5! p-1.5 ${product.comingSoon ? "cursor-not-allowed opacity-55" : ""}`}
                              key={appId}
                              onClick={() => {
                                if (!product.comingSoon) {
                                  window.open(product.url, "_self");
                                }
                              }}
                              type="button"
                            >
                              {/* biome-ignore lint/performance/noImgElement: app icons can be local or organization-provided remote URLs. */}
                              <img
                                alt=""
                                className="h-full w-full rounded-lg object-contain"
                                src={product.image}
                              />
                              {product.comingSoon
                                ? <span className="sr-only">
                                    {copy.comingSoon}
                                  </span>
                                : null}
                            </button>
                          : null;
                      })}
                      {!folder.appIds.length
                        ? <span className="text-xs text-white/55">
                            {copy.appLauncherNoAppSelected}
                          </span>
                        : null}
                    </div>
                  </article>
                ))}
              </section>
            : null}
        </div>
        <div className="mt-3 grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visibleProducts.map((product) => (
            <button
              aria-disabled={product.comingSoon}
              className={`liquid-glass relative flex h-full flex-col items-start rounded-2xl border border-[color-mix(in_srgb,var(--foreground)_14%,transparent)] bg-[color-mix(in_srgb,var(--theme-surface-container)_45%,transparent)]! p-3 text-left text-[var(--foreground)] transition [transition-duration:var(--theme-transition)] ${product.comingSoon ? "cursor-not-allowed opacity-65" : "cursor-grab active:cursor-grabbing hover:border-[color-mix(in_srgb,var(--accent)_50%,transparent)] hover:bg-[color-mix(in_srgb,var(--theme-surface-container-high)_50%,transparent)]! hover:[transform:translateY(var(--theme-hover-y))]"}`}
              draggable={!product.comingSoon}
              key={product.id}
              onDragEnd={() => {
                setDraggedAppId(null);
                window.setTimeout(() => {
                  suppressLaunchRef.current = false;
                }, 250);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragStart={(event) => {
                if (product.comingSoon) {
                  event.preventDefault();
                  return;
                }
                suppressLaunchRef.current = true;
                setDraggedAppId(String(product.id));
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(product.id));
              }}
              onDrop={(event) => {
                event.preventDefault();
                dropBeforeApp(String(product.id));
              }}
              onClick={() => {
                if (!product.comingSoon && !suppressLaunchRef.current) {
                  window.open(product.url, "_self", "noopener,noreferrer");
                }
              }}
              type="button"
            >
              <icon className="absolute right-3 top-3 text-white/45">
                drag_indicator
              </icon>
              {/* biome-ignore lint/performance/noImgElement: app icons can be local or organization-provided remote URLs. */}
              <img
                alt={copy[product.nameKey] || product.name}
                className="mb-2 w-11 rounded-xl object-contain"
                src={product.image}
              />
              <h2 className="text-lg font-semibold text-[var(--foreground)]">
                {copy[product.nameKey] || product.name}
              </h2>
              {product.comingSoon
                ? <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-purple-200/20 bg-purple-500/20! px-2 py-1 text-xs font-bold text-purple-100">
                    <icon>schedule</icon>
                    {copy.comingSoon}
                  </span>
                : null}
              <p className="mt-1.5 text-sm leading-6 text-[color-mix(in_srgb,var(--foreground)_68%,transparent)]">
                {copy[product.descriptionKey] || copy.selectAppCardDescription}
              </p>
            </button>
          ))}
        </div>
      </section>
      <footer className="border-t border-[color-mix(in_srgb,var(--foreground)_12%,transparent)] py-4 text-center text-sm text-[color-mix(in_srgb,var(--foreground)_70%,transparent)]">
        {"\u00a9"} 2026 Munetios
      </footer>
      {archived && !offlineMode
        ? <div
            aria-live="assertive"
            aria-modal="true"
            className="fixed inset-0 z-[3000] flex min-h-dvh items-center justify-center bg-black/50! p-3 text-[var(--foreground)]"
            role="dialog"
          >
            <section className="liquid-glass w-full max-w-xl border border-[color-mix(in_srgb,var(--foreground)_14%,transparent)] bg-[color-mix(in_srgb,var(--theme-surface-container)_50%,transparent)]! p-4 shadow-2xl [border-radius:var(--theme-container-radius)] sm:p-5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/15! text-amber-100">
                <icon>domain_disabled</icon>
              </div>
              <h2 className="mt-5 text-2xl font-bold">
                {copy.demoArchivedSessionTitle}
              </h2>
              <p className="mt-4 text-sm leading-7 text-[color-mix(in_srgb,var(--foreground)_80%,transparent)]">
                {copy.demoArchivedSessionMessage}
              </p>
              <p className="mt-4 border border-[color-mix(in_srgb,var(--foreground)_12%,transparent)] bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]! p-3 text-sm leading-6 text-[color-mix(in_srgb,var(--foreground)_65%,transparent)] [border-radius:var(--theme-radius)]">
                {copy.demoArchivedOfflineHint}
              </p>
              <button
                className="mt-5 border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_50%,transparent)]! px-4 py-2 text-sm font-bold text-[var(--theme-on-primary)] [border-radius:var(--theme-radius)]"
                onClick={() => setOfflineMode(true)}
                type="button"
              >
                {copy.demoContinueOffline}
              </button>
            </section>
          </div>
        : null}
    </main>
  );
}
