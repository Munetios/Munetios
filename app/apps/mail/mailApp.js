"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import AccountAvatar from "../../components/accountAvatar";
import AccountWrapper from "../../components/accountwraper";
import AppLauncherWrapper from "../../components/appLauncherWrapper";
import DropdownWrapper from "../../components/dropdownwrapper";
import LanguageSelector from "../../components/languageSelector";
import { showToast } from "../../components/toast";
import { t } from "../../i18n";
import { hasSignedInCookie } from "../../lib/signedInCookie";

const folders = [
  ["inbox", "inbox", "mailInbox"],
  ["favorites", "star", "mailFavorites"],
  ["drafts", "draft", "mailDrafts"],
  ["spam", "report", "mailSpam"],
  ["trash", "delete", "mailTrash"],
];
const fonts = [
  ["account-default", "Account default"],
  ["Google Sans Flex", "Google Sans Flex"],
  ["Arial", "Arial"],
  ["Georgia", "Georgia"],
  ["Verdana", "Verdana"],
  ["Courier New", "Courier New"],
];

function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function fromBase64Url(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function getMailIdentity(email) {
  const storageKey = `munetios.mail.zeroKnowledge.${email}`;
  const saved = JSON.parse(window.localStorage.getItem(storageKey) || "null");
  if (saved?.privateKey && saved?.publicKey) return saved;
  const pair = await window.crypto.subtle.generateKey(
    {
      hash: "SHA-256",
      modulusLength: 3072,
      name: "RSA-OAEP",
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["encrypt", "decrypt"],
  );
  const identity = {
    privateKey: await window.crypto.subtle.exportKey("jwk", pair.privateKey),
    publicKey: await window.crypto.subtle.exportKey("jwk", pair.publicKey),
  };
  window.localStorage.setItem(storageKey, JSON.stringify(identity));
  return identity;
}

async function registerMailIdentity(email) {
  if (!email) return null;
  const identity = await getMailIdentity(email);
  await fetch("/api/mail", {
    body: JSON.stringify({
      action: "register_key",
      publicKey: identity.publicKey,
    }),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  return identity;
}

async function encryptForRecipient(publicKey, content) {
  const recipientKey = await window.crypto.subtle.importKey(
    "jwk",
    publicKey,
    { hash: "SHA-256", name: "RSA-OAEP" },
    false,
    ["encrypt"],
  );
  const contentKey = await window.crypto.subtle.generateKey(
    { length: 256, name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
  const rawKey = await window.crypto.subtle.exportKey("raw", contentKey);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    { iv, name: "AES-GCM" },
    contentKey,
    new TextEncoder().encode(JSON.stringify(content)),
  );
  const wrappedKey = await window.crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    recipientKey,
    rawKey,
  );
  return {
    ciphertext: toBase64Url(ciphertext),
    iv: toBase64Url(iv),
    version: 1,
    wrappedKey: toBase64Url(wrappedKey),
  };
}

async function decryptMailMessage(message, identity) {
  if (!message.zeroKnowledgeEnvelope) return message;
  try {
    const privateKey = await window.crypto.subtle.importKey(
      "jwk",
      identity.privateKey,
      { hash: "SHA-256", name: "RSA-OAEP" },
      false,
      ["decrypt"],
    );
    const rawKey = await window.crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      privateKey,
      fromBase64Url(message.zeroKnowledgeEnvelope.wrappedKey),
    );
    const contentKey = await window.crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    const plaintext = await window.crypto.subtle.decrypt(
      {
        iv: fromBase64Url(message.zeroKnowledgeEnvelope.iv),
        name: "AES-GCM",
      },
      contentKey,
      fromBase64Url(message.zeroKnowledgeEnvelope.ciphertext),
    );
    return { ...message, ...JSON.parse(new TextDecoder().decode(plaintext)) };
  } catch {
    return { ...message, html: "", text: "", subject: "Encrypted message" };
  }
}

function clientSpamScore(message) {
  const value = `${message.subject} ${message.text}`.toLowerCase();
  let score = 0;
  if (
    /free money|act now|urgent payment|claim prize|verify your account/iu.test(
      value,
    )
  )
    score += 5;
  if (/bit\.ly|tinyurl|\.click|\.top|\.xyz/iu.test(value)) score += 3;
  if ((value.match(/!/gu) || []).length > 5) score += 1;
  return score;
}

function messageDate(value) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function SafeMessageBody({ html }) {
  const bodyRef = useRef(null);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.innerHTML = html || "";
  }, [html]);
  return <article className="mail-message-body" ref={bodyRef} />;
}

function Compose({ copy, initial = null, onClose, onSent, settings }) {
  const editorRef = useRef(null);
  const [htmlMode, setHtmlMode] = useState(false);
  const [html, setHtml] = useState(initial?.html || "");
  const [subject, setSubject] = useState(initial?.subject || "");
  const [to, setTo] = useState(initial?.to || "");
  const [working, setWorking] = useState(false);
  const font =
    settings?.font === "account-default" ? "var(--app-font)" : settings?.font;

  useEffect(() => {
    if (editorRef.current && !htmlMode) editorRef.current.innerHTML = html;
  }, [htmlMode, html]);

  const command = (name, value = null) => {
    editorRef.current?.focus();
    document.execCommand(name, false, value);
    setHtml(editorRef.current?.innerHTML || "");
  };
  const promptCommand = (name, promptText) => {
    const value = window.prompt(promptText, "https://");
    if (!value || !/^https?:\/\//iu.test(value)) return;
    command(name, value);
  };
  const submit = async (action) => {
    const content = htmlMode ? html : editorRef.current?.innerHTML || html;
    if (action === "send" && (!to.trim() || !content.trim())) {
      showToast({ message: copy.authRequiredDetails, type: "error" });
      return;
    }
    setWorking(true);
    let zeroKnowledgeEnvelope = null;
    if (action === "send") {
      const keyResponse = await fetch(
        `/api/mail?keyFor=${encodeURIComponent(to.trim())}`,
        { cache: "no-store", credentials: "include" },
      );
      if (keyResponse.ok) {
        const keyPayload = await keyResponse.json();
        zeroKnowledgeEnvelope = await encryptForRecipient(
          keyPayload.publicKey,
          {
            html: content,
            subject,
            text: editorRef.current?.textContent || "",
          },
        );
      }
    }
    const response = await fetch("/api/mail", {
      body: JSON.stringify({
        action,
        html: content,
        replyToId: initial?.replyToId,
        subject,
        threadId: initial?.threadId,
        to,
        zeroKnowledgeEnvelope,
      }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const payload = await response.json().catch(() => null);
    setWorking(false);
    if (!response.ok) {
      showToast({
        message:
          payload?.error === "email_not_configured"
            ? copy.mailServerUnavailable
            : copy.mailSendFailed,
        type: "error",
      });
      return;
    }
    showToast({
      message: action === "draft" ? copy.mailDraftSaved : copy.mailSent,
      type: "success",
    });
    onSent();
    onClose();
  };
  const tools = [
    ["format_bold", "bold", copy.mailBold],
    ["format_italic", "italic", copy.mailItalic],
    ["format_underlined", "underline", copy.mailUnderline],
    ["format_list_bulleted", "insertUnorderedList", copy.mailBullets],
    ["format_list_numbered", "insertOrderedList", copy.mailNumbered],
  ];
  return (
    <section
      aria-label={copy.mailCompose}
      className="mail-compose liquid-glass"
    >
      <header>
        <strong>
          {initial?.replyToId ? copy.mailReply : copy.mailNewMessage}
        </strong>
        <button aria-label={copy.close} onClick={onClose} type="button">
          <icon>close</icon>
        </button>
      </header>
      <label>
        <span>{copy.mailTo}</span>
        <input
          onChange={(event) => setTo(event.target.value)}
          type="email"
          value={to}
        />
      </label>
      <label>
        <span>{copy.mailSubject}</span>
        <input
          onChange={(event) => setSubject(event.target.value)}
          value={subject}
        />
      </label>
      <div className="mail-compose-tools">
        {tools.map(([icon, name, label]) => (
          <button
            aria-label={label}
            key={name}
            onClick={() => command(name)}
            title={label}
            type="button"
          >
            <icon>{icon}</icon>
          </button>
        ))}
        <button
          aria-label={copy.mailLink}
          onClick={() => promptCommand("createLink", copy.mailLink)}
          type="button"
        >
          <icon>link</icon>
        </button>
        <button
          aria-label={copy.mailImage}
          onClick={() => promptCommand("insertImage", copy.mailImage)}
          type="button"
        >
          <icon>image</icon>
        </button>
        <button
          aria-pressed={htmlMode}
          onClick={() => setHtmlMode((value) => !value)}
          type="button"
        >
          <icon>code</icon>
          {copy.mailHtml}
        </button>
      </div>
      {htmlMode
        ? <textarea
            className="mail-html-editor"
            onChange={(event) => setHtml(event.target.value)}
            value={html}
          />
        : <div
            className="mail-rich-editor"
            contentEditable
            onInput={(event) => setHtml(event.currentTarget.innerHTML)}
            ref={editorRef}
            style={{ fontFamily: font }}
            suppressContentEditableWarning
          />}
      <small>{copy.mailHtmlSecurity}</small>
      <footer>
        <button
          disabled={working}
          onClick={() => void submit("draft")}
          type="button"
        >
          {copy.mailSaveDraft}
        </button>
        <button
          className="mail-primary"
          disabled={working}
          onClick={() => void submit("send")}
          type="button"
        >
          <icon>send</icon>
          {working ? copy.accountProcessing : copy.mailSend}
        </button>
      </footer>
    </section>
  );
}

function Settings({ copy, onClose, onSaved, settings }) {
  const [theme, setTheme] = useState(settings.theme);
  const [font, setFont] = useState(settings.font);
  const [customFolders, setCustomFolders] = useState(settings.folders || []);
  const [labels, setLabels] = useState(settings.labels || []);
  const [folderName, setFolderName] = useState("");
  const [labelName, setLabelName] = useState("");
  const [notification, setNotification] = useState(
    settings.notificationEmails?.join(", ") || "",
  );
  const save = async () => {
    const response = await fetch("/api/mail", {
      body: JSON.stringify({
        action: "settings",
        settings: {
          font,
          folders: customFolders,
          labels,
          notificationEmails: notification
            .split(",")
            .map((email) => email.trim())
            .filter(Boolean),
          theme,
        },
      }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      return showToast({ message: copy.fetchError, type: "error" });
    onSaved(payload.settings);
    onClose();
  };
  return (
    <section className="mail-settings liquid-glass">
      <header>
        <h2>{copy.mailSettings}</h2>
        <button aria-label={copy.close} onClick={onClose} type="button">
          <icon>close</icon>
        </button>
      </header>
      <div className="mail-settings-field">
        <span>{copy.language}</span>
        <LanguageSelector copy={copy} />
      </div>
      <div className="mail-settings-field">
        <span>{copy.mailTheme}</span>
        <DropdownWrapper
          align="left"
          ariaLabel={copy.mailTheme}
          buttonClassName="mail-settings-dropdown"
          label={
            {
              system: copy.accountAppearanceModeSystem,
              dark: copy.accountAppearanceModeDark,
              light: copy.accountAppearanceModeLight,
            }[theme]
          }
          panelClassName="mail-settings-dropdown-panel"
        >
          {[
            ["system", copy.accountAppearanceModeSystem],
            ["dark", copy.accountAppearanceModeDark],
            ["light", copy.accountAppearanceModeLight],
          ].map(([value, label]) => (
            <button
              data-dropdown-close
              key={value}
              onClick={() => setTheme(value)}
              type="button"
            >
              <span>{label}</span>
              {theme === value ? <icon>check</icon> : null}
            </button>
          ))}
        </DropdownWrapper>
      </div>
      <div className="mail-settings-field">
        <span>{copy.mailFont}</span>
        <DropdownWrapper
          align="left"
          ariaLabel={copy.mailFont}
          buttonClassName="mail-settings-dropdown"
          label={fonts.find(([value]) => value === font)?.[1] || fonts[0][1]}
          panelClassName="mail-settings-dropdown-panel"
        >
          {fonts.map(([value, label]) => (
            <button
              data-dropdown-close
              key={value}
              onClick={() => setFont(value)}
              type="button"
            >
              <span
                style={{
                  fontFamily:
                    value === "account-default" ? "var(--app-font)" : value,
                }}
              >
                {label}
              </span>
              {font === value ? <icon>check</icon> : null}
            </button>
          ))}
        </DropdownWrapper>
      </div>
      <label>
        <span>{copy.mailNotificationEmail}</span>
        <input
          onChange={(event) => setNotification(event.target.value)}
          placeholder="name@gmail.com"
          type="email"
          value={notification}
        />
        <small>{copy.mailNotificationDescription}</small>
      </label>
      <div className="mail-settings-collection">
        <strong>{copy.mailFolders}</strong>
        <div className="mail-settings-add-row">
          <input
            aria-label={copy.mailNewFolder}
            onChange={(event) => setFolderName(event.target.value)}
            placeholder={copy.mailNewFolder}
            value={folderName}
          />
          <button
            disabled={!folderName.trim()}
            onClick={() => {
              setCustomFolders((current) => [
                ...current,
                {
                  id: `folder-${crypto.randomUUID()}`,
                  name: folderName.trim(),
                },
              ]);
              setFolderName("");
            }}
            type="button"
          >
            <icon>create_new_folder</icon>
          </button>
        </div>
        <div className="mail-settings-chips">
          {customFolders.map((item) => (
            <span key={item.id}>
              <icon>folder</icon>
              {item.name}
              <button
                aria-label={`${copy.delete} ${item.name}`}
                onClick={() =>
                  setCustomFolders((current) =>
                    current.filter((entry) => entry.id !== item.id),
                  )
                }
                type="button"
              >
                <icon>close</icon>
              </button>
            </span>
          ))}
        </div>
      </div>
      <div className="mail-settings-collection">
        <strong>{copy.mailLabels}</strong>
        <div className="mail-settings-add-row">
          <input
            aria-label={copy.mailNewLabel}
            onChange={(event) => setLabelName(event.target.value)}
            placeholder={copy.mailNewLabel}
            value={labelName}
          />
          <button
            disabled={!labelName.trim()}
            onClick={() => {
              setLabels((current) => [
                ...current,
                { id: `label-${crypto.randomUUID()}`, name: labelName.trim() },
              ]);
              setLabelName("");
            }}
            type="button"
          >
            <icon>new_label</icon>
          </button>
        </div>
        <div className="mail-settings-chips">
          {labels.map((item) => (
            <span key={item.id}>
              <icon>label</icon>
              {item.name}
              <button
                aria-label={`${copy.delete} ${item.name}`}
                onClick={() =>
                  setLabels((current) =>
                    current.filter((entry) => entry.id !== item.id),
                  )
                }
                type="button"
              >
                <icon>close</icon>
              </button>
            </span>
          ))}
        </div>
      </div>
      <div className="mail-account-card">
        <icon>alternate_email</icon>
        <span>
          <strong>{settings.primaryEmail}</strong>
          <small>{copy.mailPrimaryAccount}</small>
        </span>
      </div>
      <button
        className="mail-primary"
        onClick={() => void save()}
        type="button"
      >
        {copy.aiChatSave}
      </button>
    </section>
  );
}

export default function MailApp() {
  const [copy, setCopy] = useState(() => t());
  const [folder, setFolder] = useState("inbox");
  const [messages, setMessages] = useState([]);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [compose, setCompose] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appLauncherOpen, setAppLauncherOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [account, setAccount] = useState(null);
  const appLauncherTriggerRef = useRef(null);
  const [settings, setSettings] = useState({
    font: "account-default",
    folders: [],
    labels: [],
    notificationEmails: [],
    primaryEmail: "",
    theme: "system",
  });
  const signedIn = hasSignedInCookie();

  const load = useCallback(async () => {
    if (!signedIn) return setLoading(false);
    setLoading(true);
    const response = await fetch(
      `/api/mail?folder=${encodeURIComponent(folder)}`,
      { cache: "no-store", credentials: "include" },
    );
    const payload = await response.json().catch(() => null);
    if (response.ok) {
      const identity = await registerMailIdentity(
        payload.settings.primaryEmail,
      );
      const decrypted = await Promise.all(
        (payload.messages || []).map((message) =>
          decryptMailMessage(message, identity),
        ),
      );
      const normalizedQuery = query.trim().toLowerCase();
      const visible = decrypted.filter((message) =>
        normalizedQuery
          ? [message.from, message.to, message.subject, message.text]
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery)
          : true,
      );
      setMessages(visible);
      setSettings(payload.settings);
      setSelected((current) =>
        current ? visible.find((item) => item.id === current.id) || null : null,
      );
      if (folder === "inbox") {
        for (const message of decrypted) {
          if (message.zeroKnowledgeEnvelope && clientSpamScore(message) >= 5) {
            void fetch("/api/mail", {
              body: JSON.stringify({
                id: message.id,
                patch: { folder: "spam" },
              }),
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              method: "PATCH",
            });
          }
        }
      }
    } else showToast({ message: copy.mailLoadFailed, type: "error" });
    setLoading(false);
  }, [copy.mailLoadFailed, folder, query, signedIn]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 180);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const refresh = () => setCopy(t());
    window.addEventListener("munetios:languagechange", refresh);
    window.addEventListener("munetios:localechange", refresh);
    return () => {
      window.removeEventListener("munetios:languagechange", refresh);
      window.removeEventListener("munetios:localechange", refresh);
    };
  }, []);
  useEffect(() => {
    if (!signedIn) return undefined;
    const controller = new AbortController();
    const refreshAccount = async () => {
      const response = await fetch("/api/account", {
        cache: "no-store",
        credentials: "include",
        signal: controller.signal,
      }).catch(() => null);
      if (!response?.ok) return;
      const payload = await response.json().catch(() => null);
      if (payload?.authenticated) setAccount(payload);
    };
    const handleProfileChange = (event) => {
      if (!event.detail) return void refreshAccount();
      setAccount((current) => ({
        ...(current || {}),
        avatar: event.detail.avatar,
        avatarUrl: event.detail.profilePictureUrl || null,
        name: event.detail.name || current?.name,
        profilePictureUrl: event.detail.profilePictureUrl || null,
      }));
    };
    void refreshAccount();
    window.addEventListener("munetios:authchange", refreshAccount);
    window.addEventListener("munetios:profilechange", handleProfileChange);
    return () => {
      controller.abort();
      window.removeEventListener("munetios:authchange", refreshAccount);
      window.removeEventListener("munetios:profilechange", handleProfileChange);
    };
  }, [signedIn]);
  useEffect(() => {
    document.documentElement.dataset.mailTheme = settings.theme || "system";
    return () => {
      delete document.documentElement.dataset.mailTheme;
    };
  }, [settings.theme]);

  const patchMessage = async (id, patch) => {
    const response = await fetch("/api/mail", {
      body: JSON.stringify({ id, patch }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    if (!response.ok)
      return showToast({ message: copy.fetchError, type: "error" });
    await load();
  };
  const openMessage = (message) => {
    setSelected(message);
    if (!message.read) void patchMessage(message.id, { read: true });
  };
  const printMessage = () => {
    if (!selected) return;
    const popup = window.open(
      "",
      "munetios-mail-print",
      "popup,width=850,height=700",
    );
    if (!popup) return;
    popup.document.open();
    popup.document.close();
    popup.document.title = selected.subject;
    const title = popup.document.createElement("h1");
    title.textContent = selected.subject;
    const sender = popup.document.createElement("p");
    sender.textContent = `${copy.mailFrom}: ${selected.from}`;
    const divider = popup.document.createElement("hr");
    const body = popup.document.createElement("article");
    body.innerHTML = selected.html;
    popup.document.body.append(title, sender, divider, body);
    popup.focus();
    popup.print();
  };
  const downloadMessage = () => {
    if (!selected) return;
    const eml = [
      `From: ${selected.from}`,
      `To: ${selected.to}`,
      `Subject: ${selected.subject}`,
      `Date: ${new Date(selected.createdAt).toUTCString()}`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "",
      selected.html || selected.text,
    ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob([eml], { type: "message/rfc822;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.download = `${selected.subject.replace(/[^a-z0-9 _-]/giu, "_").slice(0, 80) || "message"}.eml`;
    anchor.href = url;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const folderTitle =
    copy[folders.find(([id]) => id === folder)?.[2]] ||
    settings.folders?.find((item) => item.id === folder)?.name ||
    settings.labels?.find((item) => `label:${item.id}` === folder)?.name ||
    copy.mailInbox;

  if (!signedIn)
    return (
      <main className="mail-signin">
        <Image alt="Munetios Mail" height={72} src="/mail.png" width={72} />
        <h1>
          {copy.productMailName} <small>Beta</small>
        </h1>
        <p>{copy.mailSignInRequired}</p>
        <Link className="mail-primary" href="/signin?returnTo=%2Fapps%2Fmail">
          {copy.signIn}
        </Link>
      </main>
    );

  return (
    <main className="mail-shell">
      <header className="mail-topbar">
        <div className="mail-brand liquid-glass">
          <Image alt="" height={34} src="/mail.png" width={34} />
          <strong>{copy.productMailName}</strong>
          <span>Beta</span>
        </div>
        <label className="mail-search liquid-glass">
          <icon>search</icon>
          <input
            aria-label={copy.mailSearch}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.mailSearch}
            value={query}
          />
        </label>
        <div className="mail-topbar-actions liquid-glass">
          <button
            aria-label={copy.mailSettings}
            className="mail-icon-button"
            onClick={() => setSettingsOpen(true)}
            type="button"
          >
            <icon>settings</icon>
          </button>
          <button
            aria-expanded={appLauncherOpen}
            aria-label={copy.openAppLauncher}
            className="mail-icon-button"
            onClick={() => {
              setAccountMenuOpen(false);
              setAppLauncherOpen(true);
            }}
            ref={appLauncherTriggerRef}
            type="button"
          >
            <icon>apps</icon>
          </button>
          <button
            aria-expanded={accountMenuOpen}
            aria-label={copy.openAccountMenu}
            className="mail-icon-button"
            onClick={() => {
              setAppLauncherOpen(false);
              setAccountMenuOpen((value) => !value);
            }}
            type="button"
          >
            {account
              ? <AccountAvatar
                  account={account}
                  alt={copy.accountProfileAlt}
                  className="mail-account-avatar"
                />
              : <output
                  aria-label={copy.accountProfileLoading}
                  className="mail-account-avatar-loading"
                />}
          </button>
        </div>
      </header>
      <aside className="mail-beta-banner">
        <icon>experiment</icon>
        <span>{copy.mailBetaBanner}</span>
      </aside>
      <nav className="mail-sidebar liquid-glass">
        <button
          className="mail-compose-button"
          onClick={() => setCompose({})}
          type="button"
        >
          <icon>edit</icon>
          <span className="mail-sidebar-label">{copy.mailCompose}</span>
        </button>
        {folders.map(([id, icon, key]) => (
          <button
            aria-current={folder === id ? "page" : undefined}
            key={id}
            onClick={() => {
              setFolder(id);
              setSelected(null);
            }}
            type="button"
          >
            <icon className="mail-sidebar-button-icon">{icon}</icon>
            <span className="mail-sidebar-label">{copy[key]}</span>
          </button>
        ))}
        <p className="mail-sidebar-heading">{copy.mailFolders}</p>
        {settings.folders?.map((item) => (
          <button
            aria-current={folder === item.id ? "page" : undefined}
            key={item.id}
            onClick={() => {
              setFolder(item.id);
              setSelected(null);
            }}
            type="button"
          >
            <icon className="mail-sidebar-button-icon">folder</icon>
            <span className="mail-sidebar-label">{item.name}</span>
          </button>
        ))}
        <p className="mail-sidebar-heading">{copy.mailLabels}</p>
        {settings.labels?.map((item) => (
          <button
            aria-current={folder === `label:${item.id}` ? "page" : undefined}
            key={item.id}
            onClick={() => {
              setFolder(`label:${item.id}`);
              setSelected(null);
            }}
            type="button"
          >
            <icon className="mail-sidebar-button-icon">label</icon>
            <span className="mail-sidebar-label">{item.name}</span>
          </button>
        ))}
        <div className="mail-security">
          <icon>encrypted</icon>
          <span>
            <strong>{copy.mailEncrypted}</strong>
            <small>{copy.mailEncryptedDescription}</small>
          </span>
        </div>
      </nav>
      <section className="mail-list" aria-label={folderTitle}>
        <header>
          <h1>{folderTitle}</h1>
          <button
            aria-label={copy.mailRefresh}
            title={copy.mailRefresh}
            onClick={() => void load()}
            type="button"
          >
            <icon>refresh</icon>
          </button>
        </header>
        {loading ? <p className="mail-status">{copy.loading}</p> : null}
        {!loading && !messages.length
          ? <p className="mail-status">{copy.mailEmpty}</p>
          : null}
        {messages.map((message) => (
          <button
            className={message.read ? "mail-row" : "mail-row is-unread"}
            key={message.id}
            onClick={() => openMessage(message)}
            type="button"
          >
            <span className="mail-avatar">
              {message.from[0]?.toUpperCase()}
            </span>
            <span className="mail-row-copy">
              <strong>{message.from}</strong>
              <span>{message.subject}</span>
              <small>{message.text}</small>
            </span>
            {message.favorite ? <icon>star</icon> : null}
            <time>{messageDate(message.createdAt)}</time>
          </button>
        ))}
      </section>
      <section className="mail-reader liquid-glass">
        {selected
          ? <>
              <header>
                <div>
                  <h2>{selected.subject}</h2>
                  <p>
                    {copy.mailFrom}: <strong>{selected.from}</strong>
                  </p>
                  <small>{new Date(selected.createdAt).toLocaleString()}</small>
                </div>
                <button
                  aria-label={copy.close}
                  onClick={() => setSelected(null)}
                  type="button"
                >
                  <icon>close</icon>
                </button>
              </header>
              <div className="mail-message-actions">
                {selected.folder !== "inbox"
                  ? <button
                      onClick={() =>
                        void patchMessage(selected.id, { folder: "inbox" })
                      }
                      type="button"
                    >
                      <icon>move_to_inbox</icon>
                      {copy.mailMoveInbox}
                    </button>
                  : null}
                <button
                  onClick={() =>
                    void patchMessage(selected.id, {
                      favorite: !selected.favorite,
                    })
                  }
                  type="button"
                >
                  <icon>{selected.favorite ? "star" : "star_outline"}</icon>
                  {copy.mailFavorite}
                </button>
                <button
                  onClick={() =>
                    void patchMessage(selected.id, { folder: "spam" })
                  }
                  type="button"
                >
                  <icon>report</icon>
                  {copy.mailMoveSpam}
                </button>
                <button
                  onClick={() =>
                    void patchMessage(selected.id, { folder: "trash" })
                  }
                  type="button"
                >
                  <icon>delete</icon>
                  {copy.mailTrash}
                </button>
                <button
                  onClick={() =>
                    void patchMessage(selected.id, { read: false })
                  }
                  type="button"
                >
                  <icon>mark_email_unread</icon>
                  {copy.mailMarkUnread}
                </button>
                <button onClick={downloadMessage} type="button">
                  <icon>download</icon>
                  {copy.download}
                </button>
                <button onClick={printMessage} type="button">
                  <icon>print</icon>
                  {copy.tasksPrint}
                </button>
                <DropdownWrapper
                  align="left"
                  ariaLabel={copy.mailMoveTo}
                  buttonClassName="mail-action-dropdown"
                  label={copy.mailMoveTo}
                  panelClassName="mail-action-dropdown-panel"
                >
                  {[
                    ["inbox", copy.mailInbox],
                    ["spam", copy.mailSpam],
                    ["trash", copy.mailTrash],
                    ...(settings.folders || []).map((item) => [
                      item.id,
                      item.name,
                    ]),
                  ].map(([value, label]) => (
                    <button
                      data-dropdown-close
                      key={value}
                      onClick={() =>
                        void patchMessage(selected.id, { folder: value })
                      }
                      type="button"
                    >
                      <icon>folder</icon>
                      {label}
                    </button>
                  ))}
                </DropdownWrapper>
                {settings.labels?.length
                  ? <DropdownWrapper
                      align="left"
                      ariaLabel={copy.mailAddLabel}
                      buttonClassName="mail-action-dropdown"
                      label={copy.mailAddLabel}
                      panelClassName="mail-action-dropdown-panel"
                    >
                      {settings.labels.map((item) => {
                        const active = selected.labels?.includes(item.id);
                        return (
                          <button
                            key={item.id}
                            onClick={() =>
                              void patchMessage(selected.id, {
                                labels: active
                                  ? selected.labels.filter(
                                      (id) => id !== item.id,
                                    )
                                  : [...(selected.labels || []), item.id],
                              })
                            }
                            type="button"
                          >
                            <icon>
                              {active ? "check_box" : "check_box_outline_blank"}
                            </icon>
                            {item.name}
                          </button>
                        );
                      })}
                    </DropdownWrapper>
                  : null}
              </div>
              {selected.security?.spamScore > 0
                ? <p className="mail-spam-score">
                    <icon>shield</icon>
                    {copy.mailSpamScore.replace(
                      "{score}",
                      selected.security.spamScore,
                    )}
                  </p>
                : null}
              <SafeMessageBody html={selected.html} />
              <button
                className="mail-primary mail-reply"
                onClick={() =>
                  setCompose({
                    html: "",
                    replyToId: selected.id,
                    subject: selected.subject.startsWith("Re:")
                      ? selected.subject
                      : `Re: ${selected.subject}`,
                    threadId: selected.threadId,
                    to: selected.from,
                  })
                }
                type="button"
              >
                <icon>reply</icon>
                {copy.mailReply}
              </button>
            </>
          : <div className="mail-reader-empty">
              <icon className="mail-reader-empty-icon">mail</icon>
              <p>{copy.mailSelectMessage}</p>
            </div>}
      </section>
      {compose
        ? <Compose
            copy={copy}
            initial={compose.replyToId ? compose : null}
            onClose={() => setCompose(null)}
            onSent={load}
            settings={settings}
          />
        : null}
      {settingsOpen
        ? <Settings
            copy={copy}
            onClose={() => setSettingsOpen(false)}
            onSaved={setSettings}
            settings={settings}
          />
        : null}
      {accountMenuOpen
        ? <div className="mail-account-menu">
            <AccountWrapper
              appContext="mail"
              legalLinksInNewTab
              persistentDropdowns
            />
          </div>
        : null}
      <AppLauncherWrapper
        copy={copy}
        onClose={() => setAppLauncherOpen(false)}
        open={appLauncherOpen}
        triggerRef={appLauncherTriggerRef}
      />
    </main>
  );
}
