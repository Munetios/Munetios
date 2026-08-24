"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import CustomToggle from "../../../components/customToggle";
import DropdownWrapper from "../../../components/dropdownwrapper";
import LanguageSelector from "../../../components/languageSelector";
import {
  LOCATION_DENIED_STACKING_LAYER,
  MODAL_STACKING_LAYER,
} from "../../../components/layering";
import LoadingSpinner from "../../../components/loadingSpinner";
import { dismissModal, showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";
import { t } from "../../../i18n";
import { formatUserDateTime } from "../../../lib/dateTimePreferences";
import { fetchSelfParentalControls } from "../../../lib/parentalControlsClient";
import { hasSignedInCookie } from "../../../lib/signedInCookie";
import {
  archiveAllGuestConversations,
  deleteAllGuestConversations,
  listGuestConversations,
  updateGuestConversation,
} from "../lib/guestConversations";

const settingsUrl = "/api/ai/settings";
let lastSubscriptionCheckFailureToast = 0;
let openSettingsModalCount = 0;

export function showSubscriptionCheckFailure(message) {
  const now = Date.now();
  if (now - lastSubscriptionCheckFailureToast < 2000) return;
  lastSubscriptionCheckFailureToast = now;
  showToast({ message, type: "error" });
}

const unsafeInstructionPattern =
  /\b(bypass|jailbreak|ignore (all|any|previous|prior) (rules|instructions)|disable safety|unsafe tools?|evade safeguards?|override system)\b/i;
export const aiSettingsDefaults = {
  accentColor: "#a855f7",
  additionalInstructions: "",
  agentApprovalMode: "always-ask",
  automaticImageGeneration: true,
  autoDeleteChatHistory: "never",
  automaticThinking: true,
  automaticWebSearch: true,
  bubbleRoundness: 24,
  chatFont: "account-default",
  chatFontSize: 16,
  customization: true,
  customIntroductions: "",
  developerMode: false,
  extendedRequests: false,
  fastAnswers: false,
  hiddenForYouCards: [],
  lineHeight: 1.55,
  location: false,
  memory: true,
  memories: [],
  moreAboutYou: "",
  nickname: "",
  pinnedTools: [],
  privacyPersonalization: true,
  rememberChatHistory: true,
  selectedModel: "munet-1-instant",
  textColor: "#f7f2ff",
  theme: "system",
  tone: "balanced",
  traits: "",
  voiceInputComposer: true,
  voiceModePitch: 1,
  voiceModeSpeed: 1,
  voiceModeType: "prompt",
  voiceModeVersion: "new",
  voiceModeVoice: "auto",
};
const panels = [
  ["general", "settings", "aiSettingsGeneral", true],
  ["appearance", "palette", "accountSettingsAppearance", true],
  ["personalization", "person", "aiSettingsPersonalization", true],
  ["usage", "monitoring", "aiSettingsUsage", true],
  ["agent", "smart_toy", "aiSettingsAgent", true],
  ["privacy", "shield", "accountSettingsPrivacy", true],
  ["voice", "graphic_eq", "aiVoiceMode", true],
  ["advanced", "build", "accountSettingsAdvanced", true],
];
const guestPanelIds = new Set([
  "advanced",
  "appearance",
  "general",
  "personalization",
  "privacy",
  "voice",
]);
const fontOptions = [
  ["account-default", "aiSettingsAccountDefault"],
  ["Google Sans Flex", "Google Sans Flex"],
  ["Google Sans", "Google Sans"],
  ["Inter", "Inter"],
  ["Roboto", "Roboto"],
  ["Poppins", "Poppins"],
  ["Open Sans", "Open Sans"],
  ["system-ui", "accountAppearanceSystem"],
];
function Toggle({ checked, description, label, onChange }) {
  return (
    <div className="ai-settings-toggle">
      <span>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <CustomToggle checked={checked} label={label} onChange={onChange} />
    </div>
  );
}

function CustomSelect({ copy, label, onChange, options, value }) {
  const selected = options.find(([option]) => option === value) || options[0];
  const optionLabel = (option) => copy[option[1]] || option[1];
  return (
    <div className="ai-settings-field">
      <span>{label}</span>
      <DropdownWrapper
        align="left"
        ariaLabel={label}
        buttonClassName="ai-settings-select-trigger"
        className="w-full"
        panelClassName="w-[min(24rem,calc(100vw-1rem))]"
        trigger={
          <>
            <span>{optionLabel(selected)}</span>
            <icon>expand_more</icon>
          </>
        }
      >
        {options.map((option) => (
          <button
            className="ai-settings-select-option"
            data-dropdown-close
            key={option[0]}
            onClick={() => onChange(option[0])}
            role="menuitem"
            type="button"
          >
            <span style={{ fontFamily: option[0] }}>{optionLabel(option)}</span>
            {option[0] === value ? <icon>check</icon> : null}
          </button>
        ))}
      </DropdownWrapper>
    </div>
  );
}

function Slider({ label, max, min, onChange, step = 1, value, valueLabel }) {
  return (
    <label className="ai-settings-slider">
      <span>
        <strong>{label}</strong>
        <output>{valueLabel || value}</output>
      </span>
      <input
        className="munetios-custom-slider"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{
          "--slider-progress": `${((value - min) / (max - min)) * 100}%`,
        }}
        step={step}
        type="range"
        value={value}
      />
    </label>
  );
}

function TextField({
  label,
  maxLength,
  multiline = false,
  onChange,
  placeholder,
  value,
}) {
  const Field = multiline ? "textarea" : "input";
  return (
    <div className="ai-settings-text-field">
      <span>{label}</span>
      <Field
        aria-label={label}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={multiline ? 4 : undefined}
        type={multiline ? undefined : "text"}
        value={value}
      />
    </div>
  );
}

function showLocationGuidance(copy) {
  showModal(
    <div className="ai-location-guidance">
      <Image
        alt={copy.aiSettingsLocationImageAlt}
        height={945}
        src="/ai-location-permission.png"
        width={1680}
      />
      <ol>
        <li>{copy.aiLocationStepOne}</li>
        <li>{copy.aiLocationStepTwo}</li>
        <li>{copy.aiLocationStepThree}</li>
      </ol>
    </div>,
    {
      ariaLabel: copy.aiSettingsLocationDeniedTitle,
      title: copy.aiSettingsLocationDeniedTitle,
      width: "44rem",
      zIndex: LOCATION_DENIED_STACKING_LAYER,
    },
  );
}

function ConfirmMemoryDelete({ close, copy, memory, onDelete }) {
  return (
    <form
      className="ai-memory-confirm"
      onSubmit={(event) => {
        event.preventDefault();
        onDelete(memory.id);
        close();
      }}
    >
      <p>{copy.aiSettingsDeleteMemoryDescription}</p>
      <button type="submit">{copy.aiSettingsDeleteMemory}</button>
    </form>
  );
}

function MemoryManager({ copy, initialMemories, onChange }) {
  const [memories, setMemories] = useState(initialMemories);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const saveMemories = (next) => {
    setMemories(next);
    onChange(next);
  };
  const addMemory = () => {
    const value = draft.trim();
    if (!value) return;
    if (unsafeInstructionPattern.test(value)) {
      setError(copy.aiSettingsUnsafeMemory);
      return;
    }
    saveMemories([
      ...memories,
      {
        createdAt: new Date().toISOString(),
        id: crypto.randomUUID(),
        text: value,
      },
    ]);
    setDraft("");
    setError("");
  };
  const deleteMemory = (id) =>
    saveMemories(memories.filter((memory) => memory.id !== id));

  return (
    <div className="ai-memory-manager">
      <div className="ai-memory-add">
        <textarea
          aria-label={copy.aiSettingsAddMemory}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={copy.aiSettingsMemoryPlaceholder}
          value={draft}
        />
        <button onClick={addMemory} type="button">
          <icon>add</icon>
          {copy.aiSettingsAddMemory}
        </button>
      </div>
      {error ? <p className="ai-settings-error">{error}</p> : null}
      {memories.length
        ? <ul>
            {memories.map((memory) => (
              <li key={memory.id}>
                <span>{memory.text}</span>
                <button
                  aria-label={copy.aiSettingsDeleteMemory}
                  onClick={() =>
                    showModal(
                      ({ close }) => (
                        <ConfirmMemoryDelete
                          close={close}
                          copy={copy}
                          memory={memory}
                          onDelete={deleteMemory}
                        />
                      ),
                      {
                        ariaLabel: copy.aiSettingsDeleteMemory,
                        title: copy.aiSettingsDeleteMemory,
                      },
                    )
                  }
                  type="button"
                >
                  <icon>delete</icon>
                </button>
              </li>
            ))}
          </ul>
        : <p>{copy.aiSettingsNoMemory}</p>}
    </div>
  );
}

function UsagePanel({
  appLoading = false,
  billingDisabled = false,
  copy,
  signedIn,
}) {
  const [usage, setUsage] = useState(null);
  const [loadState, setLoadState] = useState("loading");
  const [display, setDisplay] = useState("percentage");
  const [quantity, setQuantity] = useState(1);
  const fallbackTimerRef = useRef(0);
  const loadControllerRef = useRef(null);
  const subscriptionFailureMessageRef = useRef(copy.aiSubscriptionCheckFailed);

  useEffect(() => {
    subscriptionFailureMessageRef.current = copy.aiSubscriptionCheckFailed;
  }, [copy.aiSubscriptionCheckFailed]);

  const loadUsage = useCallback(async () => {
    if (!signedIn) return;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    window.clearTimeout(fallbackTimerRef.current);
    setLoadState("loading");
    try {
      const response = await fetch("/api/ai/usage", {
        cache: "no-store",
        credentials: "include",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("usage_load_failed");
      setUsage(await response.json());
      setLoadState("ready");
    } catch (error) {
      if (error?.name === "AbortError") return;
      setUsage(null);
      setLoadState("error");
      showSubscriptionCheckFailure(subscriptionFailureMessageRef.current);
      fallbackTimerRef.current = window.setTimeout(() => {
        setUsage({
          dailyUsed: 0,
          extendedRequests: false,
          extendedUsed: 0,
          hourlyUsed: 0,
          isFallback: true,
          limits: {
            daily: 0,
            extended: 0,
            hourly: 0,
            monthly: 0,
            premium: 0,
            weekly: 0,
          },
          monthlyUsed: 0,
          plan: "free",
          premiumUsed: 0,
          usageResets: 3,
          weeklyUsed: 0,
        });
        setLoadState("ready");
      }, 3000);
    }
  }, [signedIn]);
  useEffect(() => {
    void loadUsage();
    window.addEventListener("munetios:aiusagechange", loadUsage);
    return () => {
      loadControllerRef.current?.abort();
      window.clearTimeout(fallbackTimerRef.current);
      window.removeEventListener("munetios:aiusagechange", loadUsage);
    };
  }, [loadUsage]);

  if (!signedIn)
    return (
      <p className="ai-settings-signed-out">{copy.aiSettingsSignInToSync}</p>
    );
  if (loadState === "error") {
    return (
      <div className="ai-settings-error grid justify-items-center gap-3 p-6! text-center">
        <icon className="text-4xl">error</icon>
        <h3 className="text-base font-bold">{copy.aiUsageLoadErrorTitle}</h3>
        <p>{copy.aiUsageLoadErrorDescription}</p>
        <button
          className="liquid-glass inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10! px-4 py-2 font-semibold"
          onClick={() => void loadUsage()}
          type="button"
        >
          <icon>refresh</icon>
          {copy.retry}
        </button>
      </div>
    );
  }
  if (appLoading || loadState === "loading" || !usage) {
    const loadingLabel = `${copy.loading}...`;
    return (
      <div className="ai-usage-panel" data-ai-usage-loading="true">
        <style>{`
          [data-ai-usage-loading="true"] .ai-usage-meter > span {
            animation: ai-usage-loading 1.2s ease-in-out infinite alternate;
          }
          @keyframes ai-usage-loading {
            from { width: 18%; opacity: .55; }
            to { width: 72%; opacity: 1; }
          }
        `}</style>
        {[copy.aiSettingsHourlyUsage, copy.aiSettingsDailyUsage].map(
          (label) => (
            <section className="ai-usage-card" key={label}>
              <div>
                <strong>{label}</strong>
                <output>{loadingLabel}</output>
              </div>
              <span
                aria-label={`${label}: ${loadingLabel}`}
                aria-valuetext={loadingLabel}
                className="ai-usage-meter"
                role="progressbar"
              >
                <span />
              </span>
            </section>
          ),
        )}
        <section className="ai-usage-actions">
          <div>
            <strong>{copy.aiSettingsUsageResets}</strong>
            <span>{loadingLabel}</span>
          </div>
        </section>
      </div>
    );
  }

  const locale = document.documentElement.lang || navigator.language;
  const formatReset = (value) => formatUserDateTime(value, { locale });
  const usageValue = (used, limit) =>
    limit === 0
      ? "0 / 0"
      : display === "count"
        ? limit === null
          ? `${used} / ∞`
          : `${used} / ${limit}`
        : limit === null
          ? "100%"
          : `${Math.max(0, Math.round((1 - used / limit) * 100))}%`;
  const buy = async () => {
    const response = await fetch("/api/ai/usage/purchase", {
      body: JSON.stringify({ quantity }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const payload = await response.json();
    if (response.ok && payload.checkoutUrl) {
      window.location.assign(payload.checkoutUrl);
    } else {
      showToast({ message: copy.aiSettingsPurchaseFailed, type: "error" });
    }
  };
  const resetUnitPrice = quantity >= 10 ? 3.99 : quantity >= 5 ? 4.49 : 4.99;
  const atLimit =
    usage.isFallback ||
    (usage.limits.hourly !== null && usage.hourlyUsed >= usage.limits.hourly) ||
    (usage.limits.daily !== null && usage.dailyUsed >= usage.limits.daily);
  const buyExtended = async () => {
    const response = await fetch("/api/ai/usage/purchase", {
      body: JSON.stringify({ kind: "extended" }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const payload = await response.json();
    if (response.ok && payload.checkoutUrl) {
      window.location.assign(payload.checkoutUrl);
    } else {
      showToast({ message: copy.aiSettingsPurchaseFailed, type: "error" });
    }
  };
  const invite = () =>
    showModal(({ close }) => <InviteFriendForm close={close} copy={copy} />, {
      ariaLabel: copy.aiSettingsInviteFriend,
      title: copy.aiSettingsInviteFriend,
      width: "32rem",
    });

  return (
    <div className="ai-usage-panel">
      <div className="ai-usage-toolbar">
        <strong>
          {copy.aiSettingsPlan}:{" "}
          {usage.plan === "proLite"
            ? "Pro Lite"
            : usage.plan === "pro"
              ? "Pro"
              : "Free"}
        </strong>
        <div>
          <button
            className={display === "percentage" ? "is-active" : ""}
            onClick={() => setDisplay("percentage")}
            type="button"
          >
            %
          </button>
          <button
            className={display === "count" ? "is-active" : ""}
            onClick={() => setDisplay("count")}
            type="button"
          >
            #
          </button>
        </div>
      </div>
      {usage.isFallback
        ? <section className="ai-usage-fallback-warning" role="alert">
            <icon>warning</icon>
            <span>{copy.aiUsageFallbackWarning}</span>
          </section>
        : null}
      {[
        [
          "hourly",
          copy.aiSettingsHourlyUsage,
          usage.hourlyUsed,
          usage.limits.hourly,
          usage.hourResetAt,
        ],
        [
          "daily",
          copy.aiSettingsDailyUsage,
          usage.dailyUsed,
          usage.limits.daily,
          usage.dayResetAt,
        ],
        ...(usage.isFallback
          ? [
              [
                "weekly",
                copy.aiSettingsWeeklyUsage,
                usage.weeklyUsed,
                usage.limits.weekly,
                null,
              ],
              [
                "monthly",
                copy.aiSettingsMonthlyUsage,
                usage.monthlyUsed,
                usage.limits.monthly,
                null,
              ],
              [
                "premium",
                copy.aiSettingsPremiumRequests,
                usage.premiumUsed,
                usage.limits.premium,
                null,
              ],
              [
                "extended",
                copy.aiSettingsExtendedRequests,
                usage.extendedUsed,
                usage.limits.extended,
                null,
              ],
            ]
          : []),
      ].map(([id, label, used, limit, resetAt]) => {
        const remaining =
          limit === 0
            ? 0
            : limit === null
              ? 100
              : Math.max(0, (1 - used / limit) * 100);
        return (
          <section className="ai-usage-card" key={id}>
            <div>
              <strong>{label}</strong>
              <output>{usageValue(used, limit)}</output>
            </div>
            <span className="ai-usage-meter">
              <span style={{ width: `${remaining}%` }} />
            </span>
            {resetAt
              ? <small>
                  {copy.aiSettingsResetsAt}: {formatReset(resetAt)}
                </small>
              : null}
          </section>
        );
      })}
      <section
        className="ai-usage-feature-limits"
        data-limit-reached={atLimit || undefined}
      >
        {[
          ["smart_toy", copy.aiSettingsAgent],
          ["code", copy.aiSidebarCode],
          ["psychology", copy.aiPricingProLiteFeatureAdvancedModels],
        ].map(([icon, label]) => (
          <span key={label}>
            <icon>{icon}</icon>
            {label}
            {atLimit ? <icon>lock</icon> : null}
          </span>
        ))}
      </section>
      <section className="ai-usage-actions">
        <div>
          <strong>{copy.aiSettingsUsageResets}</strong>
          <span>{usage.usageResets}</span>
        </div>
        <button onClick={invite} type="button">
          <icon>person_add</icon>
          {copy.aiSettingsInviteFriend}
        </button>
        <button
          disabled={usage.usageResets < 1}
          onClick={async () => {
            try {
              if (usage.isFallback) throw new Error("usage_reset_failed");
              const response = await fetch("/api/ai/usage", {
                body: JSON.stringify({ action: "reset" }),
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                method: "POST",
              });
              if (!response.ok) throw new Error("usage_reset_failed");
              setUsage(await response.json());
            } catch {
              showToast({ message: copy.accountRequestFailed, type: "error" });
            }
          }}
          type="button"
        >
          <icon>restart_alt</icon>
          {copy.aiSettingsUseReset}
        </button>
      </section>
      {!billingDisabled && usage.plan !== "pro"
        ? <section className="ai-usage-purchase">
            <div>
              <strong>{copy.aiSettingsBuyResets}</strong>
              <small>{copy.aiSettingsResetPrice}</small>
            </div>
            <input
              max="20"
              min="1"
              onChange={(event) => setQuantity(Number(event.target.value))}
              type="number"
              value={quantity}
            />
            <output>${(quantity * resetUnitPrice).toFixed(2)}</output>
            <button onClick={buy} type="button">
              {copy.aiSettingsContinueCheckout}
            </button>
          </section>
        : null}
      {!billingDisabled && usage.plan !== "pro"
        ? <section className="ai-usage-extended">
            <div>
              <strong>{copy.aiSettingsExtendedRequests}</strong>
              <small>$4.99</small>
            </div>
            <CustomToggle
              checked={usage.extendedRequests}
              className="ai-usage-extended-toggle"
              disabled={usage.extendedRequests}
              label={copy.aiSettingsExtendedRequests}
              onChange={(enabled) => enabled && void buyExtended()}
            />
          </section>
        : null}
    </div>
  );
}

function InviteFriendForm({ close, copy }) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="ai-invite-friend-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setSending(true);
        setError("");
        try {
          const response = await fetch("/api/ai/usage", {
            body: JSON.stringify({
              action: "invite",
              email: email.trim(),
            }),
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            method: "POST",
          });
          if (!response.ok) throw new Error("invite failed");
          showToast({
            message: copy.aiSettingsInviteSent,
            type: "success",
          });
          close();
        } catch {
          setError(copy.aiSettingsInviteFailed);
        } finally {
          setSending(false);
        }
      }}
    >
      <p>{copy.aiSettingsInviteEmailDescription}</p>
      <label>
        {copy.businessFeedbackEmail}
        <input
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      {error ? <p className="ai-settings-error">{error}</p> : null}
      <button disabled={sending} type="submit">
        {sending ? copy.aiSettingsInviteSending : copy.aiSettingsSendInvite}
      </button>
    </form>
  );
}

function SharedLinksManager({ copy }) {
  const [links, setLinks] = useState([]);
  const [state, setState] = useState("loading");
  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/ai/shared-links", {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) throw new Error("load_failed");
      const payload = await response.json();
      setLinks(Array.isArray(payload.links) ? payload.links : []);
      setState("ready");
    } catch {
      setLinks([]);
      setState("error");
    }
  }, []);
  useEffect(() => void load(), [load]);
  const remove = async (id) => {
    try {
      const response = await fetch("/api/ai/shared-links", {
        body: JSON.stringify({ id }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      });
      if (!response.ok) throw new Error("delete_failed");
      setLinks((current) => current.filter((link) => link.id !== id));
    } catch {
      showToast({
        message: copy.aiSettingsSharedLinksDeleteFailed,
        type: "error",
      });
    }
  };
  if (state === "loading")
    return (
      <LoadingSpinner
        className="ai-compact-loading-spinner"
        label={copy.accountProcessing}
        strokeWidth={3}
      />
    );
  if (state === "error") {
    return (
      <div className="ai-settings-error-state">
        <p>{copy.aiSettingsSharedLinksLoadFailed}</p>
        <button onClick={() => void load()} type="button">
          {copy.retry}
        </button>
      </div>
    );
  }
  return links.length
    ? <ul className="ai-settings-list">
        {links.map((link) => (
          <li key={link.id}>
            <span>
              <strong>{link.title || copy.aiChatShared}</strong>
              <small>{link.url}</small>
            </span>
            <button
              aria-label={copy.delete}
              onClick={() => void remove(link.id)}
              type="button"
            >
              <icon>delete</icon>
            </button>
          </li>
        ))}
      </ul>
    : <p className="ai-settings-empty">{copy.aiSettingsNoSharedLinks}</p>;
}

function ArchivedChatsManager({ copy, signedIn }) {
  const [chats, setChats] = useState([]);
  const [state, setState] = useState("loading");
  const load = useCallback(async () => {
    setState("loading");
    try {
      if (!signedIn) {
        setChats(
          listGuestConversations({ includeArchived: true }).filter(
            (chat) => chat.archived,
          ),
        );
        setState("ready");
        return;
      }
      const response = await fetch("/api/ai/conversations?archived=1", {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) throw new Error("load_failed");
      const payload = await response.json();
      setChats(
        (Array.isArray(payload.conversations)
          ? payload.conversations
          : []
        ).filter((chat) => chat.archived),
      );
      setState("ready");
    } catch {
      setChats([]);
      setState("error");
    }
  }, [signedIn]);
  useEffect(() => void load(), [load]);
  const unarchive = async (id) => {
    if (!signedIn) {
      updateGuestConversation(id, "unarchive");
      setChats((current) => current.filter((chat) => chat.id !== id));
      return;
    }
    const response = await fetch("/api/ai/conversations", {
      body: JSON.stringify({ action: "unarchive", id }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    if (response.ok)
      setChats((current) => current.filter((chat) => chat.id !== id));
  };
  if (state === "loading")
    return (
      <LoadingSpinner
        className="ai-compact-loading-spinner"
        label={copy.accountProcessing}
        strokeWidth={3}
      />
    );
  if (state === "error") {
    return (
      <div className="ai-settings-error-state">
        <p>{copy.aiSettingsArchivedChatsLoadFailed}</p>
        <button onClick={() => void load()} type="button">
          {copy.retry}
        </button>
      </div>
    );
  }
  return chats.length
    ? <ul className="ai-settings-list">
        {chats.map((chat) => (
          <li key={chat.id}>
            <span>{chat.title}</span>
            <button onClick={() => void unarchive(chat.id)} type="button">
              {copy.aiSettingsUnarchiveChat}
            </button>
          </li>
        ))}
      </ul>
    : <p className="ai-settings-empty">{copy.aiSettingsNoArchivedChats}</p>;
}

export function SettingsContent({
  appLoading: initialAppLoading = false,
  initialCopy,
  initialPanel = "general",
  signedIn,
}) {
  const [copy, setCopy] = useState(initialCopy);
  const [appLoading, setAppLoading] = useState(initialAppLoading);
  const [accountRevision, setAccountRevision] = useState(0);
  const [accountSignedIn, setAccountSignedIn] = useState(signedIn);
  const [activePanel, setActivePanel] = useState(initialPanel);
  const [settings, setSettings] = useState(aiSettingsDefaults);
  const [savedSettings, setSavedSettings] = useState(aiSettingsDefaults);
  const [loading, setLoading] = useState(signedIn);
  const [clipboardFailureMessage, setClipboardFailureMessage] = useState("");
  const [instructionError, setInstructionError] = useState("");
  const [plan, setPlan] = useState(signedIn ? null : "free");
  const [voices, setVoices] = useState([]);
  const [selfParentalControls, setSelfParentalControls] = useState(null);
  const [educationRole, setEducationRole] = useState("");
  const loadedRef = useRef(false);
  const saveTimerRef = useRef(null);
  const clipboardFailureCooldownRef = useRef(false);
  const clipboardFailureTimerRef = useRef(null);

  useEffect(() => {
    const shell = document.querySelector("munetios-ai-shell");
    const syncAppLoading = () =>
      setAppLoading(shell?.dataset.aiAppLoading === "true");
    const observer = shell ? new MutationObserver(syncAppLoading) : null;
    observer?.observe(shell, {
      attributeFilter: ["data-ai-app-loading"],
      attributes: true,
    });
    syncAppLoading();
    const markAppReady = () => setAppLoading(false);
    window.addEventListener("munetios:aiappready", markAppReady);
    return () => {
      observer?.disconnect();
      window.removeEventListener("munetios:aiappready", markAppReady);
    };
  }, []);

  useEffect(() => {
    const refreshCopy = () => setCopy(t());
    window.addEventListener("munetios:localechange", refreshCopy);
    window.addEventListener("munetios:languagechange", refreshCopy);
    return () => {
      window.removeEventListener("munetios:localechange", refreshCopy);
      window.removeEventListener("munetios:languagechange", refreshCopy);
    };
  }, []);

  useEffect(
    () => () => window.clearTimeout(clipboardFailureTimerRef.current),
    [],
  );

  useEffect(() => {
    const syncAccount = () => {
      window.clearTimeout(saveTimerRef.current);
      loadedRef.current = false;
      const nextSignedIn = hasSignedInCookie();
      setAccountSignedIn(nextSignedIn);
      setPlan(nextSignedIn ? null : "free");
      setAccountRevision((current) => current + 1);
    };
    window.addEventListener("munetios:authchange", syncAccount);
    return () => window.removeEventListener("munetios:authchange", syncAccount);
  }, []);

  useEffect(() => {
    const loadVoices = () =>
      setVoices(window.speechSynthesis?.getVoices() || []);
    loadVoices();
    window.speechSynthesis?.addEventListener?.("voiceschanged", loadVoices);
    return () =>
      window.speechSynthesis?.removeEventListener?.(
        "voiceschanged",
        loadVoices,
      );
  }, []);

  useEffect(() => {
    if (!accountSignedIn) {
      setSelfParentalControls(null);
      setEducationRole("");
      return;
    }
    let cancelled = false;
    fetchSelfParentalControls().then((controls) => {
      if (!cancelled) setSelfParentalControls(controls);
    });
    fetch("/api/account", { cache: "no-store", credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((account) => {
        if (!cancelled) setEducationRole(account?.education?.role || "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [accountSignedIn]);

  useEffect(() => {
    if (!accountSignedIn) {
      setSettings(aiSettingsDefaults);
      setSavedSettings(aiSettingsDefaults);
      loadedRef.current = true;
      setLoading(false);
      return;
    }
    loadedRef.current = false;
    setLoading(true);
    const controller = new AbortController();
    const settingsRequest = (async () => {
      const response = await fetch(
        `${settingsUrl}?accountRevision=${accountRevision}`,
        {
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error("settings_load_failed");
      const payload = await response.json();
      const next = { ...aiSettingsDefaults, ...payload.settings };
      setSettings(next);
      setSavedSettings(next);
    })();
    const subscriptionRequest = (async () => {
      const response = await fetch("/api/ai/usage", {
        cache: "no-store",
        credentials: "include",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("subscription_check_failed");
      setPlan((await response.json()).plan || "free");
    })();
    Promise.allSettled([settingsRequest, subscriptionRequest])
      .then(([settingsResult, subscriptionResult]) => {
        if (
          settingsResult.status === "rejected" &&
          settingsResult.reason?.name !== "AbortError"
        ) {
          showToast({ message: copy.aiSettingsLoadFailed, type: "error" });
        }
        if (
          subscriptionResult.status === "rejected" &&
          subscriptionResult.reason?.name !== "AbortError"
        ) {
          setPlan("free");
          showSubscriptionCheckFailure(copy.aiSubscriptionCheckFailed);
        }
      })
      .finally(() => {
        loadedRef.current = true;
        setLoading(false);
      });
    return () => controller.abort();
  }, [
    accountRevision,
    accountSignedIn,
    copy.aiSettingsLoadFailed,
    copy.aiSubscriptionCheckFailed,
  ]);

  useEffect(() => {
    if (plan === "pro" && activePanel === "usage") {
      setActivePanel("general");
    }
    if (
      activePanel === "agent" &&
      selfParentalControls?.allowAgentAi === false
    ) {
      setActivePanel("general");
    }
    if (
      educationRole === "student" &&
      ["agent", "usage"].includes(activePanel)
    ) {
      setActivePanel("general");
    }
  }, [activePanel, educationRole, plan, selfParentalControls]);

  const persist = useCallback(
    async (nextSettings, showFailure = true) => {
      if (!accountSignedIn || !loadedRef.current) return true;
      try {
        const response = await fetch(settingsUrl, {
          body: JSON.stringify({ settings: nextSettings }),
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        });
        if (!response.ok) throw new Error("save_failed");
        const payload = await response.json();
        const saved = { ...nextSettings, ...(payload.settings || {}) };
        setSavedSettings(saved);
        setSettings(saved);
        window.dispatchEvent(
          new CustomEvent("munetios:aisettingschange", { detail: saved }),
        );
        return true;
      } catch {
        if (showFailure) {
          showToast({
            messageKey: "failedUpdatingAccountSettings",
            type: "error",
          });
        }
        return false;
      }
    },
    [accountSignedIn],
  );

  const update = (
    patch,
    { defer = activePanel === "personalization" } = {},
  ) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      window.dispatchEvent(
        new CustomEvent("munetios:aisettingschange", { detail: next }),
      );
      if (!defer) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(() => void persist(next), 350);
      }
      return next;
    });
  };

  const updateInstructions = (key, value) => {
    if (unsafeInstructionPattern.test(value)) {
      setInstructionError(copy.aiSettingsUnsafeInstructions);
      return;
    }
    setInstructionError("");
    update({ [key]: value }, { defer: true });
  };

  const updateLocation = async (enabled) => {
    if (!enabled) return update({ location: false });
    if (!navigator.geolocation) return showLocationGuidance(copy);
    try {
      const permission = await navigator.permissions?.query?.({
        name: "geolocation",
      });
      if (permission?.state === "denied") {
        update({ location: false });
        showLocationGuidance(copy);
        return;
      }
    } catch {
      // The location request below provides the final permission result.
    }
    navigator.geolocation.getCurrentPosition(
      () => update({ location: true }),
      () => {
        update({ location: false });
        showLocationGuidance(copy);
      },
      { maximumAge: 300000, timeout: 10000 },
    );
  };

  const showClipboardFailureMessage = (message) => {
    if (clipboardFailureCooldownRef.current) return;
    clipboardFailureCooldownRef.current = true;
    setClipboardFailureMessage(message);
    window.clearTimeout(clipboardFailureTimerRef.current);
    clipboardFailureTimerRef.current = window.setTimeout(() => {
      clipboardFailureCooldownRef.current = false;
      setClipboardFailureMessage("");
    }, 2000);
  };

  const copyVersion = async () => {
    const version = process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";
    if (!document.hasFocus()) {
      showClipboardFailureMessage(copy.aiSettingsClipboardFocusFailed);
      return;
    }
    try {
      await navigator.clipboard.writeText(version);
      clipboardFailureCooldownRef.current = false;
      window.clearTimeout(clipboardFailureTimerRef.current);
      setClipboardFailureMessage("");
      showToast({ message: copy.aiSettingsVersionCopied, type: "success" });
    } catch {
      showClipboardFailureMessage(
        document.hasFocus()
          ? copy.meetClipboardFailed
          : copy.aiSettingsClipboardFocusFailed,
      );
    }
  };

  const confirmAction = (title, message, action, danger = false) => {
    showModal(
      ({ close }) => (
        <div className="ai-settings-confirm">
          <p>{message}</p>
          <div>
            <button onClick={close} type="button">
              {copy.cancel}
            </button>
            <button
              className={danger ? "is-danger" : ""}
              onClick={() => {
                close();
                void action();
              }}
              type="button"
            >
              {copy.confirm}
            </button>
          </div>
        </div>
      ),
      { ariaLabel: title, title },
    );
  };

  const renderGeneral = () => (
    <div className="ai-settings-stack">
      <CustomSelect
        copy={copy}
        label={copy.accountAppearanceTheme}
        onChange={(theme) => update({ theme })}
        options={[
          ["system", "accountAppearanceModeSystem"],
          ["light", "accountAppearanceModeLight"],
          ["dark", "accountAppearanceModeDark"],
        ]}
        value={settings.theme}
      />
      <div className="ai-settings-field">
        <span>{copy.accountLanguageUiLanguage}</span>
        <LanguageSelector
          align="left"
          buttonClassName="ai-settings-select-trigger"
          className="w-full"
          copy={copy}
          panelClassName="max-h-80 w-[min(24rem,calc(100vw-1rem))] overflow-y-auto"
        />
      </div>
      <Toggle
        checked={settings.automaticThinking}
        label={copy.aiSettingsAutomaticThinking}
        onChange={(automaticThinking) => update({ automaticThinking })}
      />
      <Toggle
        checked={settings.voiceInputComposer}
        label={copy.aiSettingsVoiceInputComposer}
        onChange={(voiceInputComposer) => update({ voiceInputComposer })}
      />
      <Toggle
        checked={settings.location}
        description={copy.aiSettingsLocationDescription}
        label={copy.accountPrivacyLocation}
        onChange={updateLocation}
      />
      <button
        className="ai-settings-version"
        onClick={() => void copyVersion()}
        type="button"
      >
        <span>
          <strong>{copy.aiSettingsAppVersion}</strong>
          <small>
            {appLoading
              ? `${copy.loading}...`
              : process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0"}
          </small>
        </span>
        <icon>content_copy</icon>
      </button>
      {clipboardFailureMessage
        ? <p className="ai-settings-clipboard-error" role="alert">
            {clipboardFailureMessage}
          </p>
        : null}
    </div>
  );

  const renderAppearance = () => (
    <div className="ai-settings-stack">
      <CustomSelect
        copy={copy}
        label={copy.aiSettingsChatFont}
        onChange={(chatFont) => update({ chatFont })}
        options={fontOptions}
        value={settings.chatFont}
      />
      <Slider
        label={copy.aiSettingsChatFontSize}
        max={24}
        min={12}
        onChange={(chatFontSize) => update({ chatFontSize })}
        value={settings.chatFontSize}
        valueLabel={`${settings.chatFontSize}px`}
      />
      <Slider
        label={copy.aiSettingsLineHeight}
        max={2.2}
        min={1.1}
        onChange={(lineHeight) => update({ lineHeight })}
        step={0.05}
        value={settings.lineHeight}
      />
      <Slider
        label={copy.aiSettingsBubbleRoundness}
        max={40}
        min={0}
        onChange={(bubbleRoundness) => update({ bubbleRoundness })}
        value={settings.bubbleRoundness}
        valueLabel={`${settings.bubbleRoundness}px`}
      />
      <CustomSelect
        copy={copy}
        label={copy.aiVoiceModeType}
        onChange={(voiceModeType) => update({ voiceModeType })}
        options={[
          ["prompt", "aiVoiceTypePrompt"],
          ["wrapper", "aiVoiceTypeWrapper"],
          ["fullscreen", "aiVoiceTypeFullscreen"],
        ]}
        value={settings.voiceModeType}
      />
    </div>
  );

  const renderPersonalization = () => (
    <div className="ai-settings-stack">
      <TextField
        label={copy.aiSettingsNickname}
        maxLength={80}
        onChange={(nickname) => update({ nickname }, { defer: true })}
        value={settings.nickname}
      />
      <CustomSelect
        copy={copy}
        label={copy.aiSettingsTone}
        onChange={(tone) => update({ tone }, { defer: true })}
        options={[
          ["balanced", "aiSettingsToneBalanced"],
          ["concise", "aiSettingsToneConcise"],
          ["friendly", "aiSettingsToneFriendly"],
          ["professional", "aiSettingsToneProfessional"],
          ["creative", "aiSettingsToneCreative"],
        ]}
        value={settings.tone}
      />
      <Toggle
        checked={settings.fastAnswers}
        label={copy.aiSettingsFastAnswers}
        onChange={(fastAnswers) => update({ fastAnswers }, { defer: true })}
      />
      <TextField
        label={copy.aiSettingsCustomIntroductions}
        maxLength={10000}
        multiline
        onChange={(value) => updateInstructions("customIntroductions", value)}
        placeholder={copy.aiSettingsCustomIntroductionsPlaceholder}
        value={settings.customIntroductions}
      />
      <div className="ai-settings-character-count">
        {settings.customIntroductions.length.toLocaleString()} / 10,000
      </div>
      {instructionError
        ? <p className="ai-settings-error">{instructionError}</p>
        : null}
      <section className="ai-settings-memory-card">
        <div>
          <strong>{copy.aiSettingsMemory}</strong>
          <small>{copy.aiSettingsMemoryDescription}</small>
        </div>
        <button
          onClick={() =>
            showModal(
              <MemoryManager
                copy={copy}
                initialMemories={settings.memories || []}
                onChange={(memories) => update({ memories }, { defer: true })}
              />,
              {
                ariaLabel: copy.aiSettingsMemory,
                title: copy.aiSettingsMemory,
                width: "42rem",
              },
            )
          }
          type="button"
        >
          {copy.aiSettingsViewMemory}
        </button>
      </section>
      <Toggle
        checked={settings.rememberChatHistory}
        label={copy.aiSettingsRememberHistory}
        onChange={(rememberChatHistory) =>
          update({ rememberChatHistory }, { defer: true })
        }
      />
      <Toggle
        checked={settings.automaticWebSearch}
        label={copy.aiSettingsAutomaticWebSearch}
        onChange={(automaticWebSearch) =>
          update({ automaticWebSearch }, { defer: true })
        }
      />
      <Toggle
        checked={settings.automaticImageGeneration}
        label={copy.aiSettingsAutomaticImageGeneration}
        onChange={(automaticImageGeneration) =>
          update({ automaticImageGeneration }, { defer: true })
        }
      />
      <div className="ai-settings-actions">
        <button
          onClick={() =>
            confirmAction(
              copy.aiSettingsDiscardTitle,
              copy.aiSettingsDiscardDescription,
              () => setSettings(savedSettings),
            )
          }
          type="button"
        >
          {copy.cancel}
        </button>
        <button
          className="is-primary"
          onClick={() => void persist(settings)}
          type="button"
        >
          {copy.aiChatSave}
        </button>
      </div>
    </div>
  );

  const renderAgent = () => (
    <div className="ai-settings-stack">
      <CustomSelect
        copy={copy}
        label={copy.aiSettingsApprovalPrompts}
        onChange={(agentApprovalMode) => {
          if (agentApprovalMode === "everything") {
            confirmAction(
              copy.aiSettingsApproveEverything,
              copy.aiSettingsApproveEverythingWarning,
              () => update({ agentApprovalMode: "everything" }),
              true,
            );
          } else update({ agentApprovalMode });
        }}
        options={[
          ["always-ask", "aiSettingsAlwaysAsk"],
          ["low-risk", "aiSettingsApproveLowRisk"],
          ["everything", "aiSettingsApproveEverything"],
        ]}
        value={settings.agentApprovalMode}
      />
    </div>
  );

  const renderPrivacy = () => (
    <div className="ai-settings-stack">
      <CustomSelect
        copy={copy}
        label={copy.aiSettingsAutoDelete}
        onChange={(autoDeleteChatHistory) => update({ autoDeleteChatHistory })}
        options={[
          ["never", "aiSettingsNever"],
          ["7-days", "aiSettingsAfter7Days"],
          ["30-days", "aiSettingsAfter30Days"],
          ["90-days", "aiSettingsAfter90Days"],
          ["1-year", "aiSettingsAfter1Year"],
        ]}
        value={settings.autoDeleteChatHistory}
      />
      <Toggle
        checked={settings.privacyPersonalization}
        label={copy.aiSettingsPersonalizedAi}
        onChange={(privacyPersonalization) =>
          update({ privacyPersonalization })
        }
      />
      {educationRole !== "student"
        ? <section className="ai-settings-memory-card">
            <div>
              <strong>{copy.aiSettingsSharedLinks}</strong>
              <small>{copy.aiSettingsSharedLinksDescription}</small>
            </div>
            <button
              onClick={() =>
                showModal(<SharedLinksManager copy={copy} />, {
                  ariaLabel: copy.aiSettingsSharedLinks,
                  title: copy.aiSettingsSharedLinks,
                  width: "46rem",
                })
              }
              type="button"
            >
              {copy.aiSettingsView}
            </button>
          </section>
        : null}
    </div>
  );

  const renderVoice = () => {
    const voiceOptions = [
      ["auto", "aiVoiceAutomatic"],
      ...voices
        .filter((voice) => voice.localService)
        .map((voice) => [
          `speech:${encodeURIComponent(voice.voiceURI)}`,
          voice.name,
        ]),
    ];
    return (
      <div className="ai-settings-stack">
        <CustomSelect
          copy={copy}
          label={copy.aiVoiceVersion}
          onChange={(voiceModeVersion) => update({ voiceModeVersion })}
          options={[
            ["new", "aiVoiceVersionNew"],
            ["classic", "aiVoiceVersionClassic"],
          ]}
          value={settings.voiceModeVersion}
        />
        {appLoading
          ? <div className="ai-settings-field">
              <span>{copy.aiVoiceChooseVoice}</span>
              <button
                className="ai-settings-select-trigger"
                disabled
                type="button"
              >
                <span>{copy.loading}...</span>
                <icon>expand_more</icon>
              </button>
            </div>
          : <CustomSelect
              copy={copy}
              label={copy.aiVoiceChooseVoice}
              onChange={(voiceModeVoice) => update({ voiceModeVoice })}
              options={voiceOptions}
              value={settings.voiceModeVoice}
            />}
        <Slider
          label={copy.aiVoiceSpeed}
          max={2}
          min={0.5}
          onChange={(voiceModeSpeed) => update({ voiceModeSpeed })}
          step={0.05}
          value={settings.voiceModeSpeed}
          valueLabel={`${settings.voiceModeSpeed}×`}
        />
        <Slider
          label={copy.aiVoicePitch}
          max={2}
          min={0.5}
          onChange={(voiceModePitch) => update({ voiceModePitch })}
          step={0.05}
          value={settings.voiceModePitch}
          valueLabel={`${settings.voiceModePitch}×`}
        />
      </div>
    );
  };

  const runConversationAction = async (method, action) => {
    try {
      if (!accountSignedIn) {
        if (action === "archive-all") archiveAllGuestConversations();
        if (action === "delete-all") deleteAllGuestConversations();
        return;
      }
      const response = await fetch("/api/ai/conversations", {
        body: JSON.stringify({ action }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method,
      });
      if (!response.ok) throw new Error("action_failed");
      window.dispatchEvent(new Event("munetios:aiconversationschange"));
    } catch {
      showToast({ message: copy.accountRequestFailed, type: "error" });
    }
  };

  const renderAdvanced = () => (
    <div className="ai-settings-stack">
      <section className="ai-settings-memory-card">
        <div>
          <strong>{copy.aiSettingsArchivedChats}</strong>
          <small>{copy.aiSettingsArchivedChatsDescription}</small>
        </div>
        <button
          onClick={() =>
            showModal(
              <ArchivedChatsManager copy={copy} signedIn={accountSignedIn} />,
              {
                ariaLabel: copy.aiSettingsArchivedChats,
                title: copy.aiSettingsArchivedChats,
                width: "46rem",
              },
            )
          }
          type="button"
        >
          {copy.aiSettingsView}
        </button>
      </section>
      {educationRole || selfParentalControls?.allowDeveloperMode === false
        ? null
        : <Toggle
            checked={settings.developerMode}
            label={copy.accountAdvancedDeveloperMode}
            onChange={async (developerMode) => {
              const next = { ...settings, developerMode };
              setSettings(next);
              if (!(await persist(next, false))) {
                setSettings(settings);
                showToast({
                  messageKey: "failedUpdatingAccountSettings",
                  type: "error",
                });
              }
            }}
          />}
      <button
        className="ai-settings-danger-action"
        onClick={() =>
          confirmAction(
            copy.aiSettingsArchiveAllChats,
            copy.aiSettingsArchiveAllConfirm,
            () => runConversationAction("PATCH", "archive-all"),
          )
        }
        type="button"
      >
        {copy.aiSettingsArchiveAllChats}
      </button>
      <button
        className="ai-settings-danger-action"
        onClick={() =>
          confirmAction(
            copy.aiSettingsDeleteAllChats,
            copy.aiSettingsDeleteAllConfirm,
            () => runConversationAction("DELETE", "delete-all"),
            true,
          )
        }
        type="button"
      >
        {copy.aiSettingsDeleteAllChats}
      </button>
    </div>
  );

  const visiblePanels = (
    accountSignedIn ? panels : panels.filter(([id]) => guestPanelIds.has(id))
  )
    .filter(
      ([id]) => educationRole !== "student" || !["agent", "usage"].includes(id),
    )
    .filter(([id]) => id !== "usage" || appLoading || (plan && plan !== "pro"))
    .filter(
      ([id]) => id !== "agent" || selfParentalControls?.allowAgentAi !== false,
    );
  const renderers = {
    advanced: renderAdvanced,
    agent: renderAgent,
    appearance: renderAppearance,
    general: renderGeneral,
    personalization: renderPersonalization,
    privacy: renderPrivacy,
    voice: renderVoice,
  };

  return (
    <div className="ai-settings-layout">
      <aside aria-label={copy.aiSettingsNavigation}>
        {visiblePanels.map(([id, icon, key]) => (
          <button
            aria-current={activePanel === id ? "page" : undefined}
            className={activePanel === id ? "is-active" : ""}
            key={id}
            onClick={() => setActivePanel(id)}
            type="button"
          >
            <icon>{icon}</icon>
            <span>{copy[key]}</span>
          </button>
        ))}
      </aside>
      <section
        className="ai-settings-content"
        style={{
          "--ai-chat-font-size": `${settings.chatFontSize}px`,
          "--ai-chat-line-height": settings.lineHeight,
          "--ai-chat-radius": `${settings.bubbleRoundness}px`,
        }}
      >
        <h2>{copy[visiblePanels.find(([id]) => id === activePanel)?.[2]]}</h2>
        {!accountSignedIn
          ? <p className="ai-settings-signed-out">
              {copy.aiSettingsSignInToSync}
            </p>
          : null}
        {loading && !appLoading
          ? <div className="ai-settings-loading">
              <LoadingSpinner
                className="ai-compact-loading-spinner"
                label={copy.accountProcessing}
                strokeWidth={3}
              />
            </div>
          : activePanel === "usage"
            ? <UsagePanel
                appLoading={appLoading}
                billingDisabled={educationRole === "student"}
                copy={copy}
                signedIn={accountSignedIn}
              />
            : renderers[activePanel]?.()}
      </section>
    </div>
  );
}

export function openAiSettingsModal({
  initialPanel = "general",
  signedIn = false,
} = {}) {
  const copy = t();
  const modalId = "munetios-ai-settings";
  if (typeof window !== "undefined" && window.location.hash !== "#settings") {
    const url = new URL(window.location.href);
    url.hash = "settings";
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }
  openSettingsModalCount += 1;
  showModal(
    <SettingsContent
      appLoading={
        document.querySelector("munetios-ai-shell")?.dataset.aiAppLoading ===
        "true"
      }
      initialCopy={copy}
      initialPanel={initialPanel}
      signedIn={signedIn}
    />,
    {
      ariaLabel: copy.settings,
      aiStyled: true,
      className: "ai-settings-modal",
      clickThrough: true,
      closeOnBackdrop: false,
      contentClassName: "overflow-hidden",
      height: "min(48rem, calc(100dvh - 1.5rem))",
      maxWidth: "1201px",
      modalId,
      onClose: () => {
        openSettingsModalCount = Math.max(0, openSettingsModalCount - 1);
        if (
          openSettingsModalCount > 0 ||
          window.location.hash !== "#settings"
        ) {
          return;
        }
        const url = new URL(window.location.href);
        url.hash = "";
        window.history.replaceState({}, "", `${url.pathname}${url.search}`);
      },
      title: copy.settings,
      width: "calc(100vw - 1.5rem)",
      zIndex: MODAL_STACKING_LAYER,
    },
  );
}

export function closeAiSettingsModal() {
  dismissModal("munetios-ai-settings");
}
