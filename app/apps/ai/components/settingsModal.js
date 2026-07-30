"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { ColorPickerWrapper } from "../../../components/accountAppearanceSection";
import CustomToggle from "../../../components/customToggle";
import DropdownWrapper from "../../../components/dropdownwrapper";
import LanguageSelector from "../../../components/languageSelector";
import LoadingSpinner from "../../../components/loadingSpinner";
import { showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";
import { t } from "../../../i18n";
import { formatUserDateTime } from "../../../lib/dateTimePreferences";

const settingsUrl = "/api/ai/settings";
const unsafeInstructionPattern =
  /\b(bypass|jailbreak|ignore (all|any|previous|prior) (rules|instructions)|disable safety|unsafe tools?|evade safeguards?|override system)\b/i;
export const aiSettingsDefaults = {
  accentColor: "#a855f7",
  additionalInstructions: "",
  automaticThinking: true,
  bubbleRoundness: 24,
  chatFont: "account-default",
  chatFontSize: 16,
  customization: true,
  customIntroductions: "",
  extendedRequests: false,
  lineHeight: 1.55,
  location: false,
  memory: true,
  memories: [],
  moreAboutYou: "",
  nickname: "",
  pinnedTools: [],
  rememberChatHistory: true,
  selectedModel: "munet-1-instant",
  textColor: "#f7f2ff",
  theme: "account-default",
  tone: "balanced",
  traits: "",
  voiceInputComposer: true,
};
const panels = [
  ["general", "settings", "aiSettingsGeneral", true],
  ["appearance", "palette", "accountSettingsAppearance", true],
  ["personalization", "person", "aiSettingsPersonalization", true],
  ["usage", "monitoring", "aiSettingsUsage", true],
  ["plugins", "extension", "aiSettingsPlugins", false],
  ["voice", "graphic_eq", "aiVoiceMode", false],
  ["agent", "smart_toy", "aiSettingsAgent", false],
  ["privacy", "shield", "accountSettingsPrivacy", false],
  ["account", "account_circle", "account", false],
  ["advanced", "build", "accountSettingsAdvanced", false],
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
const composerToolSettings = [
  ["attach-files", "attach_file", "aiToolAttachFiles"],
  ["image-generation", "image", "aiToolImageGeneration"],
  ["web-search", "travel_explore", "aiToolWebSearch"],
  ["deep-research", "science", "aiToolDeepResearch"],
  ["canvas", "draw", "aiToolCanvas"],
  ["agent", "smart_toy", "aiToolAgent"],
  ["study-quizzes", "school", "aiToolStudyQuizzes"],
  ["plugins", "extension", "aiToolPlugins"],
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
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
    </label>
  );
}

function TextField({ label, multiline = false, onChange, placeholder, value }) {
  const Field = multiline ? "textarea" : "input";
  return (
    <div className="ai-settings-text-field">
      <span>{label}</span>
      <Field
        aria-label={label}
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
      <p>{copy.aiSettingsLocationDeniedText}</p>
    </div>,
    {
      ariaLabel: copy.aiSettingsLocationDeniedTitle,
      title: copy.aiSettingsLocationDeniedTitle,
      width: "44rem",
      zIndex: 5000,
    },
  );
}

function ConfirmMemoryDelete({ close, copy, memory, onDelete }) {
  const [confirmation, setConfirmation] = useState("");
  return (
    <form
      className="ai-memory-confirm"
      onSubmit={(event) => {
        event.preventDefault();
        if (confirmation !== copy.aiSettingsDeleteMemoryWord) return;
        onDelete(memory.id);
        close();
      }}
    >
      <p>{copy.aiSettingsDeleteMemoryDescription}</p>
      <label>
        {copy.aiSettingsDeleteMemoryType.replace(
          "{word}",
          copy.aiSettingsDeleteMemoryWord,
        )}
        <input
          onChange={(event) => setConfirmation(event.target.value)}
          value={confirmation}
        />
      </label>
      <button
        disabled={confirmation !== copy.aiSettingsDeleteMemoryWord}
        type="submit"
      >
        {copy.aiSettingsDeleteMemory}
      </button>
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
                        zIndex: 5200,
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

function UsagePanel({ copy, signedIn }) {
  const [usage, setUsage] = useState(null);
  const [loadState, setLoadState] = useState("loading");
  const [display, setDisplay] = useState("percentage");
  const [quantity, setQuantity] = useState(1);
  const loadUsage = useCallback(async () => {
    if (!signedIn) return;
    setLoadState("loading");
    try {
      const response = await fetch("/api/ai/usage", {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) throw new Error("usage_load_failed");
      setUsage(await response.json());
      setLoadState("ready");
    } catch {
      setUsage(null);
      setLoadState("error");
    }
  }, [signedIn]);
  useEffect(() => {
    void loadUsage();
    window.addEventListener("munetios:aiusagechange", loadUsage);
    return () =>
      window.removeEventListener("munetios:aiusagechange", loadUsage);
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
  if (loadState === "loading" || !usage) {
    return (
      <div className="ai-settings-loading">
        <LoadingSpinner label={copy.accountProcessing} />
      </div>
    );
  }

  const locale = document.documentElement.lang || navigator.language;
  const formatReset = (value) => formatUserDateTime(value, { locale });
  const usageValue = (used, limit) =>
    display === "count"
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
      ].map(([id, label, used, limit, resetAt]) => {
        const remaining =
          limit === null ? 100 : Math.max(0, (1 - used / limit) * 100);
        return (
          <section className="ai-usage-card" key={id}>
            <div>
              <strong>{label}</strong>
              <output>{usageValue(used, limit)}</output>
            </div>
            <span className="ai-usage-meter">
              <span style={{ width: `${remaining}%` }} />
            </span>
            <small>
              {copy.aiSettingsResetsAt}: {formatReset(resetAt)}
            </small>
          </section>
        );
      })}
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
            const response = await fetch("/api/ai/usage", {
              body: JSON.stringify({ action: "reset" }),
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              method: "POST",
            });
            if (response.ok) setUsage(await response.json());
          }}
          type="button"
        >
          <icon>restart_alt</icon>
          {copy.aiSettingsUseReset}
        </button>
      </section>
      {usage.plan !== "pro"
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
            <output>${(quantity * 4.99).toFixed(2)}</output>
            <button onClick={buy} type="button">
              {copy.aiSettingsContinueCheckout}
            </button>
          </section>
        : null}
      {usage.plan !== "pro"
        ? <section className="ai-usage-extended">
            <div>
              <strong>{copy.aiSettingsExtendedRequests}</strong>
              <small>$3.99</small>
            </div>
            <button
              disabled={usage.extendedRequests}
              onClick={buyExtended}
              type="button"
            >
              {usage.extendedRequests
                ? copy.aiSettingsEnabled
                : copy.aiSettingsChoose}
            </button>
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

function SettingsContent({ initialCopy, signedIn }) {
  const [copy, setCopy] = useState(initialCopy);
  const [activePanel, setActivePanel] = useState("general");
  const [settings, setSettings] = useState(aiSettingsDefaults);
  const [loading, setLoading] = useState(signedIn);
  const [instructionError, setInstructionError] = useState("");
  const loadedRef = useRef(false);
  const saveTimerRef = useRef(null);

  useEffect(() => {
    const refreshCopy = () => setCopy(t());
    const syncExternalSettings = (event) =>
      setSettings((current) => ({
        ...current,
        ...(event.detail || {}),
      }));
    window.addEventListener("munetios:localechange", refreshCopy);
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:aisettingschange", syncExternalSettings);
    return () => {
      window.removeEventListener("munetios:localechange", refreshCopy);
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener(
        "munetios:aisettingschange",
        syncExternalSettings,
      );
    };
  }, []);

  useEffect(() => {
    if (!signedIn) {
      loadedRef.current = true;
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    fetch(settingsUrl, {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("load failed");
        return response.json();
      })
      .then((payload) =>
        setSettings({ ...aiSettingsDefaults, ...payload.settings }),
      )
      .catch((error) => {
        if (error?.name !== "AbortError") {
          showToast({ message: copy.aiSettingsLoadFailed, type: "error" });
        }
      })
      .finally(() => {
        loadedRef.current = true;
        setLoading(false);
      });
    return () => controller.abort();
  }, [copy.aiSettingsLoadFailed, signedIn]);

  const save = useCallback(
    (nextSettings) => {
      if (!signedIn || !loadedRef.current) return;
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(async () => {
        try {
          const response = await fetch(settingsUrl, {
            body: JSON.stringify({ settings: nextSettings }),
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            method: "PATCH",
          });
          if (!response.ok) throw new Error("save failed");
          window.dispatchEvent(
            new CustomEvent("munetios:aisettingschange", {
              detail: nextSettings,
            }),
          );
        } catch {
          showToast({ message: copy.aiSettingsSaveFailed, type: "error" });
        }
      }, 350);
    },
    [copy.aiSettingsSaveFailed, signedIn],
  );

  const update = (patch) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      window.dispatchEvent(
        new CustomEvent("munetios:aisettingschange", { detail: next }),
      );
      save(next);
      return next;
    });
  };

  const updateInstructions = (key, value) => {
    if (unsafeInstructionPattern.test(value)) {
      setInstructionError(copy.aiSettingsUnsafeInstructions);
      return;
    }
    setInstructionError("");
    update({ [key]: value });
  };

  const updateLocation = async (enabled) => {
    if (!enabled) {
      update({ location: false });
      return;
    }
    if (!navigator.geolocation) {
      showLocationGuidance(copy);
      return;
    }
    try {
      const permission = await navigator.permissions?.query?.({
        name: "geolocation",
      });
      if (permission?.state === "denied") {
        showLocationGuidance(copy);
        update({ location: false });
        return;
      }
    } catch {
      // The geolocation request below remains the source of truth.
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

  const renderGeneral = () => (
    <div className="ai-settings-stack">
      <CustomSelect
        copy={copy}
        label={copy.accountAppearanceTheme}
        onChange={(theme) => update({ theme })}
        options={[
          ["account-default", "aiSettingsAccountDefault"],
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
        checked={settings.voiceInputComposer}
        label={copy.aiSettingsVoiceInputComposer}
        onChange={(voiceInputComposer) => update({ voiceInputComposer })}
      />
      <Toggle
        checked={settings.automaticThinking}
        label={copy.aiSettingsAutomaticThinking}
        onChange={(automaticThinking) => update({ automaticThinking })}
      />
      <Toggle
        checked={settings.location}
        description={copy.aiSettingsLocationDescription}
        label={copy.accountPrivacyLocation}
        onChange={updateLocation}
      />
      <section className="ai-settings-pinned-tools">
        <div>
          <strong>{copy.aiSettingsPinnedTools}</strong>
          <small>{copy.aiSettingsPinnedToolsDescription}</small>
        </div>
        <div className="ai-settings-pinned-tools-grid">
          {composerToolSettings.map(([id, icon, key]) => {
            const selected = settings.pinnedTools.includes(id);
            return (
              <button
                aria-pressed={selected}
                key={id}
                onClick={() =>
                  update({
                    pinnedTools: selected
                      ? settings.pinnedTools.filter((tool) => tool !== id)
                      : [...settings.pinnedTools, id],
                  })
                }
                type="button"
              >
                <icon>{icon}</icon>
                <span>{copy[key]}</span>
                <icon>{selected ? "keep" : "keep_off"}</icon>
              </button>
            );
          })}
        </div>
      </section>
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
      <ColorPickerWrapper
        copy={copy}
        customColors={[]}
        onAddColor={() => undefined}
        onPrimaryChange={(textColor) => update({ textColor })}
        primary={settings.textColor}
        title={copy.aiSettingsTextColor}
      />
      <ColorPickerWrapper
        copy={copy}
        customColors={[]}
        onAddColor={() => undefined}
        onPrimaryChange={(accentColor) => update({ accentColor })}
        primary={settings.accentColor}
        title={copy.accountAppearanceAccentColor}
      />
    </div>
  );

  const renderPersonalization = () => (
    <div className="ai-settings-stack">
      <TextField
        label={copy.aiSettingsNickname}
        onChange={(nickname) => update({ nickname })}
        value={settings.nickname}
      />
      <Toggle
        checked={settings.customization}
        label={copy.aiSettingsCustomization}
        onChange={(customization) => update({ customization })}
      />
      <CustomSelect
        copy={copy}
        label={copy.aiSettingsTone}
        onChange={(tone) => update({ tone })}
        options={[
          ["balanced", "aiSettingsToneBalanced"],
          ["concise", "aiSettingsToneConcise"],
          ["friendly", "aiSettingsToneFriendly"],
          ["professional", "aiSettingsToneProfessional"],
          ["creative", "aiSettingsToneCreative"],
        ]}
        value={settings.tone}
      />
      <TextField
        label={copy.aiSettingsCustomIntroductions}
        multiline
        onChange={(value) => updateInstructions("customIntroductions", value)}
        placeholder={copy.aiSettingsCustomIntroductionsPlaceholder}
        value={settings.customIntroductions}
      />
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
                onChange={(memories) => update({ memories })}
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
        checked={settings.memory}
        label={copy.aiSettingsMemoryToggle}
        onChange={(memory) => update({ memory })}
      />
      <Toggle
        checked={settings.rememberChatHistory}
        label={copy.aiSettingsRememberHistory}
        onChange={(rememberChatHistory) => update({ rememberChatHistory })}
      />
      <TextField
        label={copy.aiSettingsAdditionalInstructions}
        multiline
        onChange={(value) =>
          updateInstructions("additionalInstructions", value)
        }
        value={settings.additionalInstructions}
      />
      <TextField
        label={copy.aiSettingsMoreAboutYou}
        multiline
        onChange={(moreAboutYou) => update({ moreAboutYou })}
        value={settings.moreAboutYou}
      />
      <TextField
        label={copy.aiSettingsTraits}
        onChange={(traits) => update({ traits })}
        value={settings.traits}
      />
    </div>
  );
  const visiblePanels = signedIn
    ? panels
    : panels.filter(([id]) => guestPanelIds.has(id));

  return (
    <div className="ai-settings-layout">
      <aside aria-label={copy.aiSettingsNavigation}>
        {visiblePanels.map(([id, icon, key, enabled]) => {
          const panelEnabled = signedIn ? enabled : true;
          return (
            <button
              aria-current={activePanel === id ? "page" : undefined}
              className={activePanel === id ? "is-active" : ""}
              disabled={!panelEnabled}
              key={id}
              onClick={() => panelEnabled && setActivePanel(id)}
              type="button"
            >
              <icon>{icon}</icon>
              <span>{copy[key]}</span>
            </button>
          );
        })}
      </aside>
      <section
        className="ai-settings-content"
        style={{
          "--ai-chat-accent": settings.accentColor,
          "--ai-chat-font-size": `${settings.chatFontSize}px`,
          "--ai-chat-line-height": settings.lineHeight,
          "--ai-chat-radius": `${settings.bubbleRoundness}px`,
          "--ai-chat-text": settings.textColor,
        }}
      >
        <h2>{copy[visiblePanels.find(([id]) => id === activePanel)?.[2]]}</h2>
        {!signedIn
          ? <p className="ai-settings-signed-out">
              {copy.aiSettingsSignInToSync}
            </p>
          : null}
        {loading
          ? <div className="ai-settings-loading">
              <LoadingSpinner label={copy.accountProcessing} />
            </div>
          : activePanel === "general"
            ? renderGeneral()
            : activePanel === "appearance"
              ? renderAppearance()
              : activePanel === "personalization"
                ? renderPersonalization()
                : activePanel === "usage"
                  ? <UsagePanel copy={copy} signedIn={signedIn} />
                  : <p className="ai-settings-coming-soon">
                      {copy.aiSettingsComingSoon}
                    </p>}
      </section>
    </div>
  );
}

export function openAiSettingsModal({ signedIn = false } = {}) {
  const copy = t();
  showModal(<SettingsContent initialCopy={copy} signedIn={signedIn} />, {
    ariaLabel: copy.settings,
    contentClassName: "overflow-hidden",
    height: "min(48rem, calc(100dvh - 1.5rem))",
    title: copy.settings,
    width: "min(68rem, calc(100vw - 1.5rem))",
  });
}
