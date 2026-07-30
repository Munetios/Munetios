"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AccountAvatar from "../components/accountAvatar";
import AccountWrapper from "../components/accountwraper";
import AppLauncherWrapper from "../components/appLauncherWrapper";
import AppTopbarRight from "../components/appTopbarRight";
import CustomToggle from "../components/customToggle";
import { openFeedbackModal } from "../components/feedbackModal";
import { showToast } from "../components/toast";
import { getArticlesForApp, getHelpArticle, helpApps } from "./helpContent";
import { getHelpCopy, helpLocales, normalizeHelpLocale } from "./helpI18n";

function routePrefix(locale) {
  return locale === "en" ? "" : `/${locale}`;
}

function helpHref(locale, path = "") {
  return `${routePrefix(locale)}/help${path ? `/${path}` : ""}`;
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", reject);
    reader.readAsDataURL(file);
  });
}

function HelpSettings({ close, copy, locale, preferences, setPreferences }) {
  const chooseLocale = (event) => {
    const nextLocale = event.target.value;
    window.location.assign(
      `${helpHref(nextLocale)}${window.location.pathname.includes("/submit") ? "/submit" : ""}`,
    );
  };
  return (
    <div className="help-settings-backdrop" role="presentation">
      <section
        aria-label={copy.settings}
        aria-modal="true"
        className="help-settings-modal liquid-glass"
        role="dialog"
      >
        <header>
          <h2>{copy.settings}</h2>
          <button aria-label={copy.back} onClick={close} type="button">
            <icon>close</icon>
          </button>
        </header>
        <label>
          <span>{copy.language}</span>
          <select onChange={chooseLocale} value={locale}>
            {Object.entries(helpLocales).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{copy.theme}</span>
          <select
            onChange={(event) =>
              setPreferences((current) => ({
                ...current,
                theme: event.target.value,
              }))
            }
            value={preferences.theme}
          >
            <option value="account">{copy.account}</option>
            <option value="system">{copy.themeSystem}</option>
            <option value="dark">{copy.themeDark}</option>
            <option value="light">{copy.themeLight}</option>
          </select>
        </label>
        <div className="help-toggle">
          <span>{copy.largeFont}</span>
          <CustomToggle
            checked={preferences.largeFont}
            label={copy.largeFont}
            onChange={(checked) =>
              setPreferences((current) => ({
                ...current,
                largeFont: checked,
              }))
            }
          />
        </div>
        <div className="help-toggle">
          <span>{copy.reduceMotion}</span>
          <CustomToggle
            checked={preferences.reduceMotion}
            label={copy.reduceMotion}
            onChange={(checked) =>
              setPreferences((current) => ({
                ...current,
                reduceMotion: checked,
              }))
            }
          />
        </div>
      </section>
    </div>
  );
}

function HelpTopbar({ copy, locale, preferences, setPreferences }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appsOpen, setAppsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [user, setUser] = useState(null);
  const appsRef = useRef(null);
  const accountRef = useRef(null);
  const accountPanelRef = useRef(null);
  const [accountPanelTop, setAccountPanelTop] = useState(72);

  const positionAccountPanel = useCallback(() => {
    const rect = accountRef.current?.getBoundingClientRect();
    if (rect) setAccountPanelTop(Math.max(10, rect.bottom + 10));
  }, []);

  useEffect(() => {
    fetch("/api/signedin", { cache: "no-store", credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) =>
        setUser(
          payload?.authenticated && payload?.signedIn ? payload.user : null,
        ),
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!accountOpen) return undefined;
    positionAccountPanel();
    const closeOutside = (event) => {
      if (
        accountPanelRef.current?.contains(event.target) ||
        accountRef.current?.contains(event.target) ||
        event.target.closest?.("[data-munetios-dropdown-portal='true']")
      )
        return;
      setAccountOpen(false);
    };
    const closeWithKeyboard = (event) => {
      if (event.key === "Escape") {
        setAccountOpen(false);
        accountRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithKeyboard);
    window.addEventListener("resize", positionAccountPanel);
    window.addEventListener("scroll", positionAccountPanel, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithKeyboard);
      window.removeEventListener("resize", positionAccountPanel);
      window.removeEventListener("scroll", positionAccountPanel, true);
    };
  }, [accountOpen, positionAccountPanel]);

  return (
    <>
      <header className="help-topbar topbar mcontainer">
        <div className="help-topbar-left topbar-left">
          <Link className="help-brand liquid-glass" href={helpHref(locale)}>
            <img alt="" src="/favicon.ico" />
            <span>Munetios {copy.helpCenter}</span>
          </Link>
        </div>
        <AppTopbarRight className="help-topbar-actions help-topbar-right topbar-right">
          <button className="help-topbar-item" onClick={() => setSettingsOpen(true)} type="button">
            <icon>settings</icon>
            <span>{copy.settings}</span>
          </button>
          <button className="help-topbar-item" disabled title={copy.comingSoon} type="button">
            <icon>smart_toy</icon>
            <span>{copy.chatbot}</span>
          </button>
          <button
            aria-label={copy.feedback}
            className="help-topbar-item"
            onClick={() => openFeedbackModal({ context: "help-center" })}
            type="button"
          >
            <icon>feedback</icon>
          </button>
          <button
            aria-label={copy.apps}
            className="help-topbar-item"
            onClick={() => setAppsOpen((value) => !value)}
            ref={appsRef}
            type="button"
          >
            <icon>apps</icon>
          </button>
          <button
            aria-expanded={accountOpen}
            aria-label={copy.account}
            className="help-account-trigger"
            onClick={() => {
              if (!user) {
                window.location.assign("/signin");
                return;
              }
              positionAccountPanel();
              setAppsOpen(false);
              setAccountOpen((value) => !value);
            }}
            ref={accountRef}
            type="button"
          >
            {user
              ? <AccountAvatar account={user} className="help-avatar" />
              : <icon>account_circle</icon>}
          </button>
        </AppTopbarRight>
      </header>
      <AppLauncherWrapper
        onClose={() => setAppsOpen(false)}
        open={appsOpen}
        triggerRef={appsRef}
      />
      {accountOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="help-account-wrapper-panel"
              ref={accountPanelRef}
              style={{ top: `${accountPanelTop}px` }}
            >
              <AccountWrapper
                appContext
                legalLinksInNewTab
                persistentDropdowns
              />
            </div>,
            document.body,
          )
        : null}
      {settingsOpen
        ? <HelpSettings
            close={() => setSettingsOpen(false)}
            copy={copy}
            locale={locale}
            preferences={preferences}
            setPreferences={setPreferences}
          />
        : null}
    </>
  );
}

function HelpSidebar({ copy, locale, path }) {
  const selectedKey = path.slice(0, 2).join("/");
  return (
    <aside className="help-sidebar">
      <h2>{copy.categories}</h2>
      {helpApps.map((app) => (
        <details key={app.id} open>
          <summary>
            <icon>{app.icon}</icon>
            <span>{app.name}</span>
          </summary>
          <nav>
            {getArticlesForApp(app.id).map((article) => {
              const articleKey = `${article.appId}/${article.id}`;
              return (
                <div className="help-sidebar-category" key={article.id}>
                  <Link href={helpHref(locale, articleKey)}>
                    {article.title}
                  </Link>
                  {selectedKey === articleKey
                    ? <div className="help-sidebar-subcategories">
                        {article.sections.map((section) => (
                          <a href={`#${section.id}`} key={section.id}>
                            {section.title}
                          </a>
                        ))}
                      </div>
                    : null}
                </div>
              );
            })}
          </nav>
        </details>
      ))}
      <Link className="help-submit-link" href={helpHref(locale, "submit")}>
        <icon>campaign</icon>
        <span>{copy.submitRequest}</span>
      </Link>
    </aside>
  );
}

function useTranslatedArticle(article, locale) {
  const [translated, setTranslated] = useState(article);
  useEffect(() => {
    setTranslated(article);
    if (locale === "en") return undefined;
    const texts = [
      article.title,
      article.summary,
      ...(article.visual
        ? [
            article.visual.alt,
            article.visual.caption,
            ...article.visual.tooltips.map((tooltip) => tooltip.label),
          ]
        : []),
      ...article.sections.flatMap((section) => [
        section.title,
        ...section.paragraphs,
      ]),
    ];
    const controller = new AbortController();
    fetch("/api/help/translate", {
      body: JSON.stringify({ target: locale, texts }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!payload?.translations) return;
        let index = 0;
        const next = {
          ...article,
          title: payload.translations[index++] || article.title,
          summary: payload.translations[index++] || article.summary,
          visual: article.visual
            ? {
                ...article.visual,
                alt: payload.translations[index++] || article.visual.alt,
                caption:
                  payload.translations[index++] || article.visual.caption,
                tooltips: article.visual.tooltips.map((tooltip) => ({
                  ...tooltip,
                  label: payload.translations[index++] || tooltip.label,
                })),
              }
            : null,
          sections: article.sections.map((section) => ({
            ...section,
            title: payload.translations[index++] || section.title,
            paragraphs: section.paragraphs.map(
              (paragraph) => payload.translations[index++] || paragraph,
            ),
          })),
        };
        setTranslated(next);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [article, locale]);
  return translated;
}

function Documentation({ copy, locale, path }) {
  const sourceArticle = useMemo(() => getHelpArticle(path), [path]);
  const article = useTranslatedArticle(sourceArticle, locale);
  return (
    <>
      <article className="help-article">
        {locale !== "en"
          ? <div className="help-translation-note">
              <icon>translate</icon>
              <span>
                {copy.mayContainErrors} {copy.translatedBy}
              </span>
            </div>
          : null}
        <p className="help-eyebrow">{copy.documentation}</p>
        <h1>{article.title}</h1>
        <p className="help-summary">{article.summary}</p>
        {article.visual
          ? <figure className="help-article-visual">
              <div className="help-visual-stage">
                <img alt={article.visual.alt} src={article.visual.src} />
                {article.visual.tooltips.map((tooltip) => (
                  <span
                    className={`help-visual-tooltip ${tooltip.position}`}
                    key={tooltip.label}
                  >
                    <icon>{tooltip.icon}</icon>
                    <span>{tooltip.label}</span>
                  </span>
                ))}
              </div>
              <figcaption>{article.visual.caption}</figcaption>
            </figure>
          : null}
        {article.sections.map((section) => (
          <section id={section.id} key={section.id}>
            <h2>{section.title}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
      </article>
      <aside className="help-sections-panel">
        <h2>{copy.sections}</h2>
        {article.sections.map((section) => (
          <a href={`#${section.id}`} key={section.id}>
            {section.title}
          </a>
        ))}
      </aside>
    </>
  );
}

function SubmitReport({ copy }) {
  const [form, setForm] = useState({
    app: "tasks",
    category: "bug",
    context: "",
    email: "",
    reportType: "bug-report",
    screenshot: "",
    subject: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const categories = [
    ["bug", copy.categoryBug],
    ["feature", copy.categoryFeature],
    ["accessibility", copy.categoryAccessibility],
    ["account", copy.categoryAccount],
    ["billing", copy.categoryBilling],
    ["performance", copy.categoryPerformance],
    ["privacy", copy.categoryPrivacy],
    ["security", copy.categorySecurity],
    ["translation", copy.categoryTranslation],
  ];

  useEffect(() => {
    fetch("/api/signedin", { cache: "no-store", credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload?.user?.email) {
          setForm((current) => ({ ...current, email: payload.user.email }));
        }
      })
      .catch(() => undefined);
  }, []);

  const update = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const response = await fetch("/api/help/reports", {
        body: JSON.stringify(form),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (
          new Set(["profanity_not_allowed", "unsafe_content_not_allowed"]).has(
            payload.error,
          )
        ) {
          throw new Error("blocked");
        }
        throw new Error("failed");
      }
      showToast({ message: copy.reportSubmitted, type: "success" });
      setForm((current) => ({
        ...current,
        context: "",
        screenshot: "",
        subject: "",
      }));
    } catch (error) {
      showToast({
        message:
          error.message === "blocked" ? copy.reportBlocked : copy.reportFailed,
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <article className="help-report-page">
      <h1>{copy.submitRequest}</h1>
      <form onSubmit={submit}>
        <div className="help-segmented">
          <button
            className={form.reportType === "bug-report" ? "active" : ""}
            onClick={() => update("reportType", "bug-report")}
            type="button"
          >
            {copy.bugReport}
          </button>
          <button
            className={form.reportType === "feature-request" ? "active" : ""}
            onClick={() => update("reportType", "feature-request")}
            type="button"
          >
            {copy.featureRequest}
          </button>
        </div>
        <label>
          <span>{copy.subject}</span>
          <input
            maxLength={160}
            onChange={(event) => update("subject", event.target.value)}
            required
            value={form.subject}
          />
        </label>
        <label>
          <span>{copy.email}</span>
          <input
            onChange={(event) => update("email", event.target.value)}
            type="email"
            value={form.email}
          />
        </label>
        <div className="help-form-row">
          <label>
            <span>{copy.apps}</span>
            <select
              onChange={(event) => update("app", event.target.value)}
              value={form.app}
            >
              {helpApps.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{copy.category}</span>
            <select
              onChange={(event) => update("category", event.target.value)}
              value={form.category}
            >
              {categories.map(([category, label]) => (
                <option key={category} value={category}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          <span>{copy.context}</span>
          <textarea
            maxLength={8000}
            onChange={(event) => update("context", event.target.value)}
            placeholder={copy.contextPlaceholder}
            required
            rows={10}
            value={form.context}
          />
        </label>
        <label className="help-file-input">
          <span>{copy.screenshot}</span>
          <input
            accept="image/png,image/jpeg,image/webp"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return update("screenshot", "");
              if (file.size > 5 * 1024 * 1024) {
                showToast({ message: copy.screenshotTooLarge, type: "error" });
                event.target.value = "";
                return;
              }
              update("screenshot", await readFile(file));
            }}
            type="file"
          />
        </label>
        {form.screenshot
          ? <img
              alt={copy.screenshotPreview}
              className="help-screenshot-preview"
              src={form.screenshot}
            />
          : null}
        <button
          className="help-submit-button"
          disabled={submitting}
          type="submit"
        >
          {submitting ? "…" : copy.submit}
        </button>
      </form>
    </article>
  );
}

export default function HelpCenter({ initialLocale = "en", path = [] }) {
  const locale = normalizeHelpLocale(initialLocale);
  const copy = getHelpCopy(locale);
  const [query, setQuery] = useState("");
  const [preferences, setPreferences] = useState({
    largeFont: false,
    reduceMotion: false,
    theme: "account",
  });
  const isSubmit = path[0] === "submit";

  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("munetios.help.settings") || "{}",
      );
      setPreferences((current) => ({ ...current, ...saved }));
    } catch {}
  }, []);
  useEffect(() => {
    localStorage.setItem("munetios.help.settings", JSON.stringify(preferences));
  }, [preferences]);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return helpApps.flatMap((app) =>
      getArticlesForApp(app.id).filter((article) =>
        `${article.title} ${article.summary} ${app.name}`
          .toLowerCase()
          .includes(normalized),
      ),
    );
  }, [query]);

  return (
    <main
      className="help-center"
      data-help-large-font={preferences.largeFont}
      data-help-reduce-motion={preferences.reduceMotion}
      data-help-theme={preferences.theme}
    >
      <HelpTopbar
        copy={copy}
        locale={locale}
        preferences={preferences}
        setPreferences={setPreferences}
      />
      <div className="help-search-wrap" data-hero={copy.heroTitle}>
        <icon>search</icon>
        <input
          aria-label={copy.search}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.search}
          value={query}
        />
        {query
          ? <div className="help-search-results liquid-glass">
              {results.length
                ? results.map((article) => (
                    <Link
                      href={helpHref(locale, `${article.appId}/${article.id}`)}
                      key={`${article.appId}/${article.id}`}
                    >
                      <strong>{article.title}</strong>
                      <span>{article.summary}</span>
                    </Link>
                  ))
                : <p>{copy.noResults}</p>}
            </div>
          : null}
      </div>
      <div className="help-layout">
        <HelpSidebar copy={copy} locale={locale} path={path} />
        {isSubmit
          ? <SubmitReport copy={copy} />
          : <Documentation copy={copy} locale={locale} path={path} />}
      </div>
    </main>
  );
}
