"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AccountAvatar from "../components/accountAvatar";
import AccountWrapper from "../components/accountwraper";
import AppLauncherWrapper from "../components/appLauncherWrapper";
import AppTopbarRight from "../components/appTopbarRight";
import CustomToggle from "../components/customToggle";
import DropdownWrapper from "../components/dropdownwrapper";
import { openFeedbackModal } from "../components/feedbackModal";
import { showToast } from "../components/toast";
import { hasSignedInCookie } from "../lib/signedInCookie";
import { getArticlesForApp, getHelpArticle, helpApps } from "./helpContent";
import { getHelpCopy, helpLocales, normalizeHelpLocale } from "./helpI18n";
import { translationReportLanguages } from "./helpLanguages";

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

function HelpDropdown({ label, onChange, options, value }) {
  const selected =
    options.find((option) => option.value === value) || options[0];
  return (
    <div className="help-custom-dropdown">
      <span>{label}</span>
      <DropdownWrapper
        align="left"
        ariaLabel={label}
        className="help-dropdown-root"
        buttonClassName="help-dropdown-trigger"
        trigger={
          <>
            <span>{selected?.label}</span>
            <icon>expand_more</icon>
          </>
        }
      >
        <div className="help-dropdown-options">
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => onChange(option.value)}
              role="menuitem"
              type="button"
            >
              <span>{option.label}</span>
              {option.value === value ? <icon>check</icon> : null}
            </button>
          ))}
        </div>
      </DropdownWrapper>
    </div>
  );
}

function HelpSettings({ close, copy, locale, preferences, setPreferences }) {
  const chooseLocale = (nextLocale) => {
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
        <HelpDropdown
          label={copy.language}
          onChange={chooseLocale}
          options={Object.entries(helpLocales).map(([value, label]) => ({
            label,
            value,
          }))}
          value={locale}
        />
        <HelpDropdown
          label={copy.theme}
          onChange={(theme) =>
            setPreferences((current) => ({ ...current, theme }))
          }
          options={[
            { label: copy.account, value: "account" },
            { label: copy.themeSystem, value: "system" },
            { label: copy.themeDark, value: "dark" },
            { label: copy.themeLight, value: "light" },
          ]}
          value={preferences.theme}
        />
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

function HelpChatbotWrapper({ close, copy, locale, path, theme }) {
  const frameRef = useRef(null);
  const context = path.filter(Boolean).slice(0, 2).join("/");
  const source = `/help/chatbot?locale=${encodeURIComponent(locale)}&theme=${encodeURIComponent(theme)}&context=${encodeURIComponent(context)}`;

  useEffect(() => {
    const receiveMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "munetios-help-chatbot-close") close();
    };
    const closeWithKeyboard = (event) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("message", receiveMessage);
    document.addEventListener("keydown", closeWithKeyboard);
    return () => {
      window.removeEventListener("message", receiveMessage);
      document.removeEventListener("keydown", closeWithKeyboard);
    };
  }, [close]);

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage(
      { theme, type: "munetios-help-chatbot-theme" },
      window.location.origin,
    );
  }, [theme]);

  return (
    <aside
      aria-label={copy.chatbotAssistant}
      className="help-chatbot-wrapper liquid-glass"
    >
      <iframe
        allow="clipboard-write"
        onLoad={() =>
          frameRef.current?.contentWindow?.postMessage(
            { theme, type: "munetios-help-chatbot-theme" },
            window.location.origin,
          )
        }
        ref={frameRef}
        src={source}
        title={copy.chatbotAssistant}
      />
    </aside>
  );
}

function HelpTopbar({ copy, locale, path, preferences, setPreferences }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatbotOpen, setChatbotOpen] = useState(false);
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
    if (!hasSignedInCookie()) {
      setUser(null);
      return;
    }

    setUser({ name: "Munetios" });
    fetch("/api/account", { cache: "no-store", credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload) setUser(payload);
      })
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
            <span>Munetios {copy.documentation}</span>
          </Link>
        </div>
        <AppTopbarRight className="help-topbar-actions help-topbar-right topbar-right">
          <button
            className="help-topbar-item"
            onClick={() => setSettingsOpen(true)}
            type="button"
          >
            <icon>settings</icon>
            <span>{copy.settings}</span>
          </button>
          <button
            aria-expanded={chatbotOpen}
            aria-label={copy.chatbotAssistant}
            className="help-topbar-item"
            onClick={() => {
              setAppsOpen(false);
              setAccountOpen(false);
              setChatbotOpen((open) => !open);
            }}
            type="button"
          >
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
      {chatbotOpen && typeof document !== "undefined"
        ? createPortal(
            <HelpChatbotWrapper
              close={() => setChatbotOpen(false)}
              copy={copy}
              locale={locale}
              path={path}
              theme={preferences.theme}
            />,
            document.body,
          )
        : null}
    </>
  );
}

function HelpSidebar({ copy, documents, locale, path }) {
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
            {getArticlesForApp(documents, app.id).map((article) => {
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
      <div className="help-community">
        <h2>{copy.community}</h2>
        {[
          ["youtube", "YouTube", "https://www.youtube.com/@Munetios"],
          ["x", "X", "https://x.com/Munetios"],
          ["tiktok", "TikTok", "https://www.tiktok.com/@munetios"],
          ["github", "GitHub", "https://github.com/Munetios"],
          ["discord", "Discord", "https://discord.gg/sNgVNf9MdB"],
        ].map(([asset, label, href]) => (
          <a href={href} key={label}>
            <Image
              alt=""
              aria-hidden="true"
              className="help-social-icon"
              height={20}
              src={`/documentation/assets/${asset}.svg`}
              width={20}
            />
            <span>{label}</span>
          </a>
        ))}
      </div>
    </aside>
  );
}

function inlineMarkdown(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part) => {
    if (part.startsWith("**"))
      return <strong key={`${part}-strong`}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`"))
      return <code key={`${part}-code`}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link)
      return (
        <a href={link[2]} key={`${part}-link`}>
          {link[1]}
        </a>
      );
    return part;
  });
}

function MarkdownBlocks({ lines }) {
  const blocks = [];
  for (let index = 0; index < lines.length; ) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      blocks.push(
        <figure
          className={`help-markdown-image ${image[2].includes("/screenshots/") ? "is-screenshot" : "is-logo"}`}
          key={index}
        >
          <img alt={image[1]} src={image[2]} />
          <figcaption>{image[1]}</figcaption>
        </figure>,
      );
      index += 1;
      continue;
    }
    if (/^(\d+\.|-) /.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const items = [];
      while (
        index < lines.length &&
        (ordered
          ? /^\d+\. /.test(lines[index].trim())
          : /^- /.test(lines[index].trim()))
      ) {
        items.push(
          lines[index].trim().replace(ordered ? /^\d+\. / : /^- /, ""),
        );
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={index}>
          {items.map((item) => (
            <li key={item}>{inlineMarkdown(item)}</li>
          ))}
        </List>,
      );
      continue;
    }
    blocks.push(<p key={index}>{inlineMarkdown(line)}</p>);
    index += 1;
  }
  return blocks;
}

function Documentation({ copy, documents, locale, path }) {
  const article = useMemo(
    () => getHelpArticle(documents, path),
    [documents, path],
  );
  return (
    <>
      <article className="help-article">
        {locale !== "en"
          ? <div className="help-translation-note">
              <icon>translate</icon>
              <span>{copy.englishDocumentation}</span>
            </div>
          : null}
        <p className="help-eyebrow">{copy.documentation}</p>
        <h1>{article.title}</h1>
        <p className="help-summary">{article.summary}</p>
        {article.sections.map((section) => (
          <section id={section.id} key={section.id}>
            <h2>{section.title}</h2>
            <MarkdownBlocks lines={section.markdown} />
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
    translationExpectedText: "",
    translationLanguage: "en",
    translationLocation: "",
    translationShownText: "",
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
    if (!hasSignedInCookie()) return;

    fetch("/api/account", { cache: "no-store", credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload?.email) {
          setForm((current) => ({ ...current, email: payload.email }));
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
        translationExpectedText: "",
        translationLocation: "",
        translationShownText: "",
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
          <HelpDropdown
            label={copy.apps}
            onChange={(app) => update("app", app)}
            options={helpApps.map((app) => ({
              label: app.name,
              value: app.id,
            }))}
            value={form.app}
          />
          <HelpDropdown
            label={copy.category}
            onChange={(category) => update("category", category)}
            options={categories.map(([value, label]) => ({ label, value }))}
            value={form.category}
          />
        </div>
        {form.category === "translation"
          ? <section className="help-translation-report-fields liquid-glass">
              <div className="help-translation-report-heading">
                <icon>translate</icon>
                <span>
                  <strong>{copy.translationIssueTitle}</strong>
                  <small>{copy.translationIssueDescription}</small>
                </span>
              </div>
              <HelpDropdown
                label={copy.translationIssueLanguage}
                onChange={(translationLanguage) =>
                  update("translationLanguage", translationLanguage)
                }
                options={translationReportLanguages}
                value={form.translationLanguage}
              />
              <label>
                <span>{copy.translationIssueShownText}</span>
                <textarea
                  maxLength={2000}
                  onChange={(event) =>
                    update("translationShownText", event.target.value)
                  }
                  placeholder={copy.translationIssueShownTextPlaceholder}
                  required
                  rows={3}
                  value={form.translationShownText}
                />
              </label>
              <label>
                <span>{copy.translationIssueExpectedText}</span>
                <textarea
                  maxLength={2000}
                  onChange={(event) =>
                    update("translationExpectedText", event.target.value)
                  }
                  placeholder={copy.translationIssueExpectedTextPlaceholder}
                  required
                  rows={3}
                  value={form.translationExpectedText}
                />
              </label>
              <label>
                <span>{copy.translationIssueLocation}</span>
                <input
                  maxLength={500}
                  onChange={(event) =>
                    update("translationLocation", event.target.value)
                  }
                  placeholder={copy.translationIssueLocationPlaceholder}
                  required
                  value={form.translationLocation}
                />
              </label>
            </section>
          : null}
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

export default function HelpCenter({
  documents,
  initialLocale = "en",
  path = [],
}) {
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
      getArticlesForApp(documents, app.id).filter((article) =>
        `${article.title} ${article.summary} ${app.name}`
          .toLowerCase()
          .includes(normalized),
      ),
    );
  }, [documents, query]);

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
        path={path}
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
        <HelpSidebar
          copy={copy}
          documents={documents}
          locale={locale}
          path={path}
        />
        {isSubmit
          ? <SubmitReport copy={copy} />
          : <Documentation
              copy={copy}
              documents={documents}
              locale={locale}
              path={path}
            />}
      </div>
    </main>
  );
}
