"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyDeveloperCss,
  developerSettingsChangeEvent,
  loadDeveloperSettings,
  saveDeveloperSettings,
} from "../lib/developerSettings";
import {
  appearanceDefaults,
  appearanceStorageKey,
  appearanceThemes,
  applyAppearanceSettings,
  getThemePalette,
  loadAppearanceSettings,
} from "./appearanceRuntime";
import CustomToggle from "./customToggle";
import DropdownWrapper from "./dropdownwrapper";
import { showModal } from "./modal";

const presetColors = [
  "#a855f7",
  "#7c3aed",
  "#2563eb",
  "#0ea5e9",
  "#14b8a6",
  "#22c55e",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#ffffff",
  "#000000",
];

const defaultFonts = [
  { labelKey: "accountAppearanceThemeFontLabel", value: "theme-font" },
  { label: "Google Sans Flex", value: "Google Sans Flex" },
  { label: "Google Sans", value: "Google Sans" },
  { label: "Inter", value: "Inter" },
  { label: "Poppins", value: "Poppins" },
  { label: "Roboto", value: "Roboto" },
  { label: "Open Sans", value: "Open Sans" },
  { label: "Lexend", value: "Lexend" },
  { labelKey: "accountAppearanceSystem", value: "system-ui" },
];

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function hexToHsv(hex) {
  const normalized = /^#[\da-f]{6}$/i.test(hex) ? hex.slice(1) : "a855f7";
  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }

  return {
    hue: hue < 0 ? hue + 360 : hue,
    saturation: max === 0 ? 0 : delta / max,
    value: max,
  };
}

function hsvToHex(hue, saturation, value) {
  const chroma = value * saturation;
  const section = hue / 60;
  const secondary = chroma * (1 - Math.abs((section % 2) - 1));
  const match = value - chroma;
  const [red, green, blue] =
    section < 1
      ? [chroma, secondary, 0]
      : section < 2
        ? [secondary, chroma, 0]
        : section < 3
          ? [0, chroma, secondary]
          : section < 4
            ? [0, secondary, chroma]
            : section < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  const toHex = (channel) =>
    Math.round((channel + match) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function SettingToggle({ checked, description, label, onChange }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-white/5! p-4">
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-semibold text-white">
          {label}
        </span>
        {description
          ? <span className="mt-1 block text-xs leading-5 text-white/60">
              {description}
            </span>
          : null}
      </span>
      <CustomToggle
        checked={checked}
        className="mt-0.5"
        label={label}
        onChange={onChange}
      />
    </div>
  );
}

function ThemeChangeConfirmation({ close, copy, onConfirm }) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-white/70">
        {copy.accountAppearanceThemeChangeDescription}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10!"
          onClick={close}
          type="button"
        >
          {copy.cancel}
        </button>
        <button
          className="liquid-glass rounded-xl border border-purple-200/20 bg-purple-700/60! px-4 py-2 text-sm font-bold text-white transition hover:bg-purple-600/75!"
          onClick={() => {
            close();
            onConfirm();
          }}
          type="button"
        >
          {copy.accountAppearanceThemeChangeAction}
        </button>
      </div>
    </div>
  );
}

function RangeSetting({
  badge,
  description,
  label,
  max,
  min,
  onChange,
  step = 1,
  suffix,
  value,
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5! p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-white">
            {label}
          </span>
          {description
            ? <span className="mt-1 block text-xs leading-5 text-white/60">
                {description}
              </span>
            : null}
        </span>
        <span className="flex items-center gap-2">
          {badge
            ? <span className="rounded-full border border-purple-200/15 bg-purple-400/10! px-2.5 py-1 text-xs font-semibold text-purple-100">
                {badge}
              </span>
            : null}
          <output className="min-w-14 text-right text-sm font-bold text-white">
            {value}
            {suffix}
          </output>
        </span>
      </div>
      <input
        aria-label={label}
        className="munetios-custom-slider mt-4 h-2 w-full cursor-pointer"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
        style={{
          "--slider-progress": `${((value - min) / (max - min)) * 100}%`,
        }}
      />
      <div
        aria-hidden="true"
        className="mt-1 flex justify-between text-[0.68rem] font-semibold text-white/45"
      >
        <span>
          {min}
          {suffix}
        </span>
        <span>
          {max}
          {suffix}
        </span>
      </div>
    </div>
  );
}

function getGlassLevelKey(value) {
  if (value <= 1) return "accountAppearanceBlurLevelLessGlass";
  if (value <= 5) return "accountAppearanceBlurLevelLiquidGlass";
  if (value <= 12) return "accountAppearanceBlurLevelGlassmorph";
  if (value <= 24) return "accountAppearanceBlurLevelHeavyGlass";
  return "accountAppearanceBlurLevelFrostedGlass";
}

export function ColorControl({
  colors = presetColors,
  copy,
  label,
  onAddColor,
  onChange,
  value,
}) {
  const fieldRef = useRef(null);
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [eyeDropperAvailable, setEyeDropperAvailable] = useState(false);
  const [newColor, setNewColor] = useState(value);

  useEffect(() => {
    setHsv(hexToHsv(value));
    setNewColor(value);
  }, [value]);
  useEffect(() => setEyeDropperAvailable(Boolean(window.EyeDropper)), []);

  const setColor = (nextHsv) => {
    setHsv(nextHsv);
    onChange(hsvToHex(nextHsv.hue, nextHsv.saturation, nextHsv.value));
  };
  const addColor = () => {
    const normalized = newColor.trim().toLowerCase();
    if (!/^#[\da-f]{6}$/i.test(normalized)) return;
    onAddColor(normalized);
    onChange(normalized);
    setNewColor(normalized);
  };

  const updateField = (event) => {
    const rect = fieldRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextHsv = {
      ...hsv,
      saturation: clamp((event.clientX - rect.left) / rect.width),
      value: 1 - clamp((event.clientY - rect.top) / rect.height),
    };
    setColor(nextHsv);
  };

  const pickScreenColor = async () => {
    if (!window.EyeDropper) return;
    document.documentElement.classList.add("appearance-eyedropper-active");
    try {
      const result = await new window.EyeDropper().open();
      if (result?.sRGBHex) onChange(result.sRGBHex.toLowerCase());
    } catch {
      return;
    } finally {
      document.documentElement.classList.remove("appearance-eyedropper-active");
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-black/10! p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-white/80">{label}</span>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-8 w-8 rounded-lg border border-white/20 shadow-inner"
            style={{ backgroundColor: value }}
          />
          <button
            aria-label={copy.accountAppearancePickScreenColor}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/10! text-white transition hover:bg-white/15! disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!eyeDropperAvailable}
            onClick={pickScreenColor}
            title={copy.accountAppearancePickScreenColor}
            type="button"
          >
            <icon>colorize</icon>
          </button>
        </div>
      </div>
      <div
        className="appearance-color-field relative h-40 w-full overflow-hidden rounded-xl border border-white/15"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          updateField(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            updateField(event);
          }
        }}
        ref={fieldRef}
        style={{ "--picker-hue": hsv.hue }}
      >
        <span
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.65)]"
          style={{
            left: `${hsv.saturation * 100}%`,
            top: `${(1 - hsv.value) * 100}%`,
          }}
        />
      </div>
      <input
        aria-label={copy.accountAppearanceHue}
        className="appearance-hue-slider mt-3 h-3 w-full cursor-pointer rounded-full"
        max="360"
        min="0"
        onChange={(event) =>
          setColor({ ...hsv, hue: Number(event.target.value) })
        }
        type="range"
        value={Math.round(hsv.hue)}
      />
      <div className="mt-3 grid grid-cols-6 gap-2">
        {colors.map((color) => (
          <button
            aria-label={color}
            className={`aspect-square rounded-lg border transition hover:scale-105 ${value === color ? "border-white ring-2 ring-[var(--accent)]" : "border-white/15"}`}
            key={color}
            onClick={() => onChange(color)}
            style={{ backgroundColor: color }}
            type="button"
          />
        ))}
      </div>
      <input
        aria-label={label}
        className="mt-3 h-10 w-full rounded-xl border border-white/10 bg-white/10! px-3 text-sm font-semibold uppercase text-white outline-none focus:border-purple-300/50"
        maxLength={7}
        onChange={(event) => {
          const nextValue = event.target.value;
          setNewColor(nextValue);
          if (/^#[\da-f]{6}$/i.test(nextValue)) {
            onChange(nextValue.toLowerCase());
          }
        }}
        value={newColor}
      />
      <div className="mt-3 rounded-2xl border border-white/10 bg-black/10! p-3">
        <span className="mb-2 block text-sm font-semibold text-white/80">
          {copy.accountAppearanceAddCustomColor}
        </span>
        <div className="flex gap-2">
          <input
            aria-label={copy.accountAppearanceAddCustomColor}
            className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/10! px-3 text-sm font-semibold uppercase text-white outline-none focus:border-purple-300/50"
            maxLength={7}
            onChange={(event) => setNewColor(event.target.value)}
            value={newColor}
          />
          <button
            className="flex h-10 items-center gap-2 rounded-xl bg-[var(--accent)]! px-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!/^#[\da-f]{6}$/i.test(newColor.trim())}
            onClick={addColor}
            type="button"
          >
            <icon>add</icon>
            {copy.accountAppearanceAddColor}
          </button>
        </div>
      </div>
    </div>
  );
}

function ColorPickerDropdown({
  colors,
  copy,
  label,
  onAddColor,
  onChange,
  value,
}) {
  return (
    <DropdownWrapper
      align="right"
      ariaLabel={`${copy.accountAppearanceOpenColorPicker}: ${label}`}
      buttonClassName="h-auto! w-full justify-between bg-white/8! p-3!"
      className="w-full"
      panelClassName="w-[min(32rem,calc(100vw-1rem))] p-3!"
      trigger={
        <>
          <span className="min-w-0 text-left">
            <span className="block text-sm font-semibold">{label}</span>
            <span className="block text-xs uppercase text-white/60">
              {value}
            </span>
          </span>
          <span
            aria-hidden="true"
            className="h-10 w-10 shrink-0 rounded-xl border border-white/20 shadow-inner"
            style={{ backgroundColor: value }}
          />
        </>
      }
    >
      <div data-dropdown-keep-open="true">
        <ColorControl
          colors={colors}
          copy={copy}
          label={label}
          onAddColor={onAddColor}
          onChange={onChange}
          value={value}
        />
      </div>
    </DropdownWrapper>
  );
}

export function ColorPickerWrapper({
  additionalColors = [],
  copy,
  customColors,
  gradientAngle,
  mode = null,
  onAddColor,
  onAddGradientColor,
  onAdditionalColorChange,
  onGradientAngleChange,
  onModeChange,
  onPrimaryChange,
  onRemoveGradientColor,
  onSecondaryChange,
  primary,
  secondary = null,
  title,
}) {
  const colors = Array.from(new Set([...presetColors, ...customColors]));

  return (
    <div className="liquid-glass rounded-3xl border border-white/10 bg-white/5! p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold text-white">{title}</h2>
        {mode
          ? <div className="flex rounded-xl border border-white/10 bg-white/5! p-1">
              {[
                ["gradient", copy.accountAppearanceGradient],
                ["solid", copy.accountAppearanceSolid],
              ].map(([value, label]) => (
                <button
                  aria-pressed={mode === value}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${mode === value ? "bg-[var(--accent)]! text-white" : "text-white/60 hover:bg-white/10!"}`}
                  key={value}
                  onClick={() => onModeChange(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          : null}
      </div>
      <div className="space-y-3">
        <ColorPickerDropdown
          colors={colors}
          copy={copy}
          label={
            secondary
              ? copy.accountAppearancePrimaryColor
              : copy.accountAppearanceAccentColor
          }
          onAddColor={onAddColor}
          onChange={onPrimaryChange}
          value={primary}
        />
        {mode === "gradient"
          ? additionalColors.map((color, index) => (
              <div
                className="flex items-center gap-2"
                key={`${index}-${color}`}
              >
                <ColorPickerDropdown
                  colors={colors}
                  copy={copy}
                  label={`${copy.accountAppearanceGradientColor} ${index + 2}`}
                  onAddColor={onAddColor}
                  onChange={(nextColor) =>
                    onAdditionalColorChange(index, nextColor)
                  }
                  value={color}
                />
                <button
                  aria-label={copy.accountAppearanceRemoveGradientColor}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/8! text-white/70 transition hover:bg-rose-500/25! hover:text-white"
                  onClick={() => onRemoveGradientColor(index)}
                  title={copy.accountAppearanceRemoveGradientColor}
                  type="button"
                >
                  <icon>delete</icon>
                </button>
              </div>
            ))
          : null}
        {mode === "gradient" && secondary
          ? <ColorPickerDropdown
              colors={colors}
              copy={copy}
              label={copy.accountAppearanceSecondaryColor}
              onAddColor={onAddColor}
              onChange={onSecondaryChange}
              value={secondary}
            />
          : null}
        {mode === "gradient"
          ? <button
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/5! px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10!"
              onClick={onAddGradientColor}
              type="button"
            >
              <icon>add</icon>
              {copy.accountAppearanceAddGradientColor}
            </button>
          : null}
        {mode === "gradient"
          ? <label className="block rounded-2xl border border-white/10 bg-black/10! p-3">
              <span className="flex items-center justify-between gap-3 text-sm font-semibold text-white/80">
                {copy.accountAppearanceGradientPosition}
                <span>{gradientAngle}°</span>
              </span>
              <input
                className="munetios-custom-slider mt-3 w-full"
                max="360"
                min="0"
                onChange={(event) =>
                  onGradientAngleChange(Number(event.target.value))
                }
                style={{
                  "--slider-progress": `${(gradientAngle / 360) * 100}%`,
                }}
                type="range"
                value={gradientAngle}
              />
            </label>
          : null}
      </div>
    </div>
  );
}

function FontSelector({ copy, detectedFonts, onChange, value }) {
  const options = defaultFonts.map((font) => ({
    ...font,
    label: font.label || copy[font.labelKey],
  }));
  const selected =
    options.find((font) => font.value === value) ||
    detectedFonts.find((font) => font === value);

  return (
    <DropdownWrapper
      align="left"
      ariaLabel={copy.accountAppearanceFontFamily}
      buttonClassName="h-11 w-full justify-between rounded-xl border border-white/10 bg-white/10! px-3 text-left hover:border-purple-200/35 hover:bg-white/15!"
      className="w-full"
      panelClassName="max-h-80 w-[min(28rem,calc(100vw-1rem))] overflow-y-auto"
      trigger={
        <>
          <span className="min-w-0 truncate">
            {typeof selected === "string" ? selected : selected?.label}
          </span>
          <icon>expand_more</icon>
        </>
      }
    >
      <div className="space-y-1">
        {options.map((font) => (
          <button
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10!"
            key={font.value}
            onClick={() => onChange(font.value)}
            role="menuitem"
            style={{
              fontFamily: font.value === "theme-font" ? undefined : font.value,
            }}
            type="button"
          >
            <span>{font.label}</span>
            {font.value === value ? <icon>check</icon> : null}
          </button>
        ))}
        {detectedFonts.length
          ? <>
              <p className="px-3 pb-1 pt-3 text-xs font-bold uppercase tracking-wider text-white/50">
                {copy.accountAppearanceInstalledFonts}
              </p>
              {detectedFonts.map((font) => (
                <button
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10!"
                  key={font}
                  onClick={() => onChange(font)}
                  role="menuitem"
                  style={{ fontFamily: `"${font}", system-ui` }}
                  type="button"
                >
                  <span>{font}</span>
                  {font === value ? <icon>check</icon> : null}
                </button>
              ))}
            </>
          : null}
      </div>
    </DropdownWrapper>
  );
}

function ThemeModeSelector({ copy, onChange, value }) {
  const options = [
    {
      icon: "brightness_auto",
      label: copy.accountAppearanceModeSystem,
      value: "system",
    },
    {
      icon: "light_mode",
      label: copy.accountAppearanceModeLight,
      value: "light",
    },
    { icon: "dark_mode", label: copy.accountAppearanceModeDark, value: "dark" },
    ...(value === "custom"
      ? [
          {
            icon: "palette",
            label: copy.accountAppearanceModeCustom,
            value: "custom",
          },
        ]
      : []),
  ];
  const selected =
    options.find((option) => option.value === value) || options[0];

  return (
    <DropdownWrapper
      align="left"
      ariaLabel={copy.accountAppearanceColorMode}
      buttonClassName="h-11 w-full justify-between bg-white/10! px-3!"
      className="w-full sm:w-72"
      panelClassName="w-[min(18rem,calc(100vw-1rem))]"
      trigger={
        <>
          <span className="flex min-w-0 items-center gap-2">
            <icon>{selected.icon}</icon>
            <span className="truncate">{selected.label}</span>
          </span>
          <icon>expand_more</icon>
        </>
      }
    >
      <div className="space-y-1">
        {options.map((option) => (
          <button
            aria-checked={option.value === value}
            className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10!"
            key={option.value}
            onClick={() => onChange(option.value)}
            role="menuitemradio"
            type="button"
          >
            <span className="flex items-center gap-2">
              <icon>{option.icon}</icon>
              {option.label}
            </span>
            {option.value === value ? <icon>check</icon> : null}
          </button>
        ))}
      </div>
    </DropdownWrapper>
  );
}

export default function AccountAppearanceSection({ copy }) {
  const [settings, setSettings] = useState(appearanceDefaults);
  const [detectedFonts, setDetectedFonts] = useState([]);
  const [detectingFonts, setDetectingFonts] = useState(false);
  const [fontApiAvailable, setFontApiAvailable] = useState(false);
  const [, setSystemThemeRevision] = useState(0);
  const fontDetectionRequestRef = useRef(0);
  const [developerSettings, setDeveloperSettings] = useState(null);

  useEffect(() => {
    setSettings(loadAppearanceSettings());
    setDeveloperSettings(loadDeveloperSettings());
    const refreshDeveloperSettings = (event) =>
      setDeveloperSettings(event.detail || loadDeveloperSettings());
    window.addEventListener(
      developerSettingsChangeEvent,
      refreshDeveloperSettings,
    );
    return () =>
      window.removeEventListener(
        developerSettingsChangeEvent,
        refreshDeveloperSettings,
      );
  }, []);

  const saveSettings = (patch) => {
    setSettings((current) => {
      const resolvedPatch =
        typeof patch === "function" ? patch(current) : patch;
      const next = { ...current, ...resolvedPatch };
      window.localStorage.setItem(appearanceStorageKey, JSON.stringify(next));
      applyAppearanceSettings(next);
      window.dispatchEvent(
        new CustomEvent("munetios:appearance-change", { detail: next }),
      );
      return next;
    });
  };

  const detectFonts = useCallback(async () => {
    if (typeof window.queryLocalFonts !== "function") return;

    const requestId = fontDetectionRequestRef.current + 1;
    fontDetectionRequestRef.current = requestId;
    setDetectingFonts(true);
    let timeoutId = null;

    try {
      const fonts = await Promise.race([
        window.queryLocalFonts(),
        new Promise((_, reject) => {
          timeoutId = window.setTimeout(
            () => reject(new Error("Font detection timed out.")),
            10_000,
          );
        }),
      ]);
      if (requestId !== fontDetectionRequestRef.current) return;

      const names = Array.from(
        new Set(
          fonts
            .map((font) => font.fullName || font.family)
            .filter((font) => typeof font === "string" && font.trim())
            .filter(
              (font) =>
                !defaultFonts.some(
                  (defaultFont) =>
                    defaultFont.value.toLowerCase() === font.toLowerCase(),
                ),
            ),
        ),
      ).sort((first, second) => {
        const firstOpenAi = first.toLowerCase().startsWith("openai");
        const secondOpenAi = second.toLowerCase().startsWith("openai");
        if (firstOpenAi !== secondOpenAi) return firstOpenAi ? 1 : -1;
        return first.localeCompare(second, "en", { sensitivity: "base" });
      });
      setDetectedFonts(names);
    } catch {
      return;
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (requestId === fontDetectionRequestRef.current) {
        setDetectingFonts(false);
      }
    }
  }, []);

  useEffect(
    () => () => {
      fontDetectionRequestRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    setFontApiAvailable(Boolean(window.queryLocalFonts));
  }, []);

  useEffect(() => {
    const colorSchemeMedia = window.matchMedia("(prefers-color-scheme: light)");
    const refreshSystemTheme = () =>
      setSystemThemeRevision((value) => value + 1);
    colorSchemeMedia.addEventListener("change", refreshSystemTheme);
    return () =>
      colorSchemeMedia.removeEventListener("change", refreshSystemTheme);
  }, []);

  useEffect(() => {
    const applySyncedSettings = (event) => {
      setSettings(event.detail || loadAppearanceSettings());
    };

    window.addEventListener("munetios:appearance-sync", applySyncedSettings);
    return () =>
      window.removeEventListener(
        "munetios:appearance-sync",
        applySyncedSettings,
      );
  }, []);

  const themes = appearanceThemes;
  const currentTheme =
    appearanceThemes.find((theme) => theme.id === settings.theme) ||
    appearanceThemes[0];
  const addCustomColor = (color) => {
    saveSettings((current) => ({
      customColors: Array.from(
        new Set([...(current.customColors || []), color]),
      ),
    }));
  };
  const confirmCustomBackgroundReplacement = (onConfirm) => {
    if (settings.themeMode !== "custom") {
      onConfirm();
      return;
    }

    showModal({
      ariaLabel: copy.accountAppearanceThemeChangeTitle,
      content: ({ close }) => (
        <ThemeChangeConfirmation
          close={close}
          copy={copy}
          onConfirm={onConfirm}
        />
      ),
      title: copy.accountAppearanceThemeChangeTitle,
    });
  };
  const selectThemeMode = (themeMode) => {
    if (themeMode === "custom") return;
    confirmCustomBackgroundReplacement(() => {
      const palette = getThemePalette(currentTheme, themeMode);
      saveSettings({
        backgroundColor: palette.background,
        backgroundColorSecondary: palette.backgroundSecondary,
        gradientColors: [],
        themeMode,
      });
    });
  };
  const selectTheme = (theme) => {
    confirmCustomBackgroundReplacement(() => {
      const themeMode =
        settings.themeMode === "custom" ? "system" : settings.themeMode;
      const palette = getThemePalette(theme, themeMode);
      saveSettings({
        accentColor: theme.accent,
        backgroundColor: palette.background,
        backgroundColorSecondary: palette.backgroundSecondary,
        gradientColors: [],
        theme: theme.id,
        themeMode,
      });
    });
  };
  const displayedBackground =
    settings.themeMode === "custom"
      ? {
          background: settings.backgroundColor,
          backgroundSecondary: settings.backgroundColorSecondary,
        }
      : getThemePalette(currentTheme, settings.themeMode);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white">
          {copy.accountSettingsAppearance}
        </h1>
        <p className="mt-2 text-sm leading-6 text-white/65">
          {copy.accountSettingsAppearanceDescription}
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-base font-bold text-white">
          {copy.accountAppearanceTheme}
        </h2>
        <div className="mb-4">
          <ThemeModeSelector
            copy={copy}
            onChange={selectThemeMode}
            value={settings.themeMode}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {themes.map((theme) => {
            const palette = getThemePalette(
              theme,
              settings.themeMode === "custom" ? "system" : settings.themeMode,
            );

            return (
              <button
                aria-pressed={settings.theme === theme.id}
                className={`appearance-theme-card overflow-hidden rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 ${settings.theme === theme.id ? "border-purple-200/60 ring-2 ring-[var(--accent)]" : "border-white/10"}`}
                key={theme.id}
                onClick={() => selectTheme(theme)}
                style={{
                  background: `linear-gradient(135deg, ${palette.background}, ${palette.backgroundSecondary})`,
                  color: palette.foreground,
                }}
                type="button"
              >
                <span className="mb-5 flex gap-2">
                  <span className="h-8 flex-1 rounded-lg border border-current/15 bg-white/10" />
                  <span
                    className="h-8 w-8 rounded-lg"
                    style={{ backgroundColor: theme.accent }}
                  />
                </span>
                <span className="flex items-center justify-between gap-3 text-sm font-bold">
                  {theme.name || copy[theme.labelKey]}
                  {settings.theme === theme.id
                    ? <icon>check_circle</icon>
                    : null}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-8 grid gap-5 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-base font-bold text-white">
            {copy.accountAppearanceFontFamily}
          </h2>
          <FontSelector
            copy={copy}
            detectedFonts={detectedFonts}
            onChange={(fontFamily) => saveSettings({ fontFamily })}
            value={settings.fontFamily}
          />
          <button
            className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/10! px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/15! disabled:opacity-50"
            disabled={!fontApiAvailable || detectingFonts}
            onClick={detectFonts}
            type="button"
          >
            <icon>font_download</icon>
            {detectingFonts
              ? copy.accountAppearanceDetectingFonts
              : copy.accountAppearanceDetectFonts}
          </button>
          <p className="mt-2 text-xs leading-5 text-white/55">
            {copy.accountAppearanceFontPrivacy}
          </p>
        </div>
        <div className="grid gap-3">
          <SettingToggle
            checked={settings.reduceMotion}
            label={copy.accountAppearanceReduceMotion}
            onChange={(reduceMotion) => saveSettings({ reduceMotion })}
          />
          <SettingToggle
            checked={settings.reduceTransparency}
            label={copy.accountAppearanceReduceTransparency}
            onChange={(reduceTransparency) =>
              saveSettings({ reduceTransparency })
            }
          />
          <div className="grid grid-cols-2 gap-3">
            <SettingToggle
              checked={settings.ss01}
              label={copy.accountAppearanceSs01}
              onChange={(ss01) => saveSettings({ ss01 })}
            />
            <SettingToggle
              checked={settings.ss08}
              label={copy.accountAppearanceSs08}
              onChange={(ss08) => saveSettings({ ss08 })}
            />
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-base font-bold text-white">
          {copy.accountAppearanceLiquidGlassCustomizations}
        </h2>
        <p className="mb-3 text-sm leading-6 text-white/60">
          {copy.accountAppearanceLiquidGlassCustomizationsDescription}
        </p>
        <RangeSetting
          badge={copy[getGlassLevelKey(settings.glassBlur)]}
          description={copy.accountAppearanceBlurDescription}
          label={copy.accountAppearanceBlur}
          max={100}
          min={1}
          onChange={(glassBlur) => saveSettings({ glassBlur })}
          suffix="px"
          value={settings.glassBlur}
        />
      </section>

      {developerSettings?.developerMode
        ? <section className="liquid-glass mt-8 rounded-2xl border border-amber-300/20 bg-amber-500/8! p-4">
            <h2 className="text-base font-bold text-white">
              {copy.developerCssInjectTitle}
            </h2>
            <p className="mt-1 text-xs leading-5 text-amber-100/80">
              {copy.developerCssInjectWarning}
            </p>
            <textarea
              className="mt-3 min-h-40 w-full resize-y rounded-xl border border-white/10 bg-black/30! p-3 font-mono text-xs text-white"
              onChange={(event) => {
                const next = saveDeveloperSettings({
                  ...developerSettings,
                  customCss: event.target.value,
                });
                setDeveloperSettings(next);
                applyDeveloperCss(next);
              }}
              placeholder={copy.developerCssInjectPlaceholder}
              spellCheck={false}
              value={developerSettings.customCss}
            />
          </section>
        : null}

      <section className="mt-8">
        <h2 className="mb-1 text-base font-bold text-white">
          {copy.accountAppearanceCustomizeLayout}
        </h2>
        <p className="mb-3 text-sm leading-6 text-white/60">
          {copy.accountAppearanceCustomizeLayoutDescription}
        </p>
        <div className="grid gap-3 lg:grid-cols-2">
          <RangeSetting
            description={copy.accountAppearanceTextSizeDescription}
            label={copy.accountAppearanceTextSize}
            max={1000}
            min={25}
            onChange={(textSize) => saveSettings({ textSize })}
            step={5}
            suffix="%"
            value={settings.textSize}
          />
          <RangeSetting
            description={
              copy.accountAppearanceAccountSettingsPaddingDescription
            }
            label={copy.accountAppearanceAccountSettingsPadding}
            max={32}
            min={8}
            onChange={(accountSettingsPadding) =>
              saveSettings({ accountSettingsPadding })
            }
            suffix="px"
            value={settings.accountSettingsPadding}
          />
          <SettingToggle
            checked={settings.compactMode}
            description={copy.accountAppearanceCompactModeDescription}
            label={copy.accountAppearanceCompactMode}
            onChange={(compactMode) => saveSettings({ compactMode })}
          />
          <SettingToggle
            checked={settings.customBorderRadius}
            description={copy.accountAppearanceCustomizeBorderRadiusDescription}
            label={copy.accountAppearanceCustomizeBorderRadius}
            onChange={(customBorderRadius) =>
              saveSettings({ customBorderRadius })
            }
          />
          {settings.customBorderRadius
            ? <RangeSetting
                label={copy.accountAppearanceBorderRadius}
                max={50}
                min={0}
                onChange={(borderRadius) => saveSettings({ borderRadius })}
                suffix="px"
                value={settings.borderRadius}
              />
            : null}
        </div>
      </section>

      <section className="mt-8 grid gap-5 lg:grid-cols-2">
        <ColorPickerWrapper
          copy={copy}
          customColors={settings.customColors || []}
          onAddColor={addCustomColor}
          onPrimaryChange={(accentColor) => saveSettings({ accentColor })}
          primary={settings.accentColor}
          title={copy.accountAppearanceAccentColor}
        />
        <ColorPickerWrapper
          additionalColors={settings.gradientColors || []}
          copy={copy}
          customColors={settings.customColors || []}
          gradientAngle={settings.gradientAngle}
          mode={settings.backgroundMode}
          onAddColor={addCustomColor}
          onAddGradientColor={() =>
            saveSettings((current) => ({
              backgroundColor:
                current.themeMode === "custom"
                  ? current.backgroundColor
                  : displayedBackground.background,
              backgroundColorSecondary:
                current.themeMode === "custom"
                  ? current.backgroundColorSecondary
                  : displayedBackground.backgroundSecondary,
              gradientColors: [
                ...(current.gradientColors || []),
                current.accentColor || "#a855f7",
              ],
              themeMode: "custom",
            }))
          }
          onAdditionalColorChange={(index, nextColor) =>
            saveSettings((current) => ({
              backgroundColor:
                current.themeMode === "custom"
                  ? current.backgroundColor
                  : displayedBackground.background,
              backgroundColorSecondary:
                current.themeMode === "custom"
                  ? current.backgroundColorSecondary
                  : displayedBackground.backgroundSecondary,
              gradientColors: (current.gradientColors || []).map(
                (color, colorIndex) =>
                  colorIndex === index ? nextColor : color,
              ),
              themeMode: "custom",
            }))
          }
          onGradientAngleChange={(gradientAngle) =>
            saveSettings({ gradientAngle })
          }
          onModeChange={(backgroundMode) => saveSettings({ backgroundMode })}
          onPrimaryChange={(backgroundColor) =>
            saveSettings((current) => ({
              backgroundColor,
              backgroundColorSecondary:
                current.themeMode === "custom"
                  ? current.backgroundColorSecondary
                  : displayedBackground.backgroundSecondary,
              themeMode: "custom",
            }))
          }
          onRemoveGradientColor={(index) =>
            saveSettings((current) => ({
              gradientColors: (current.gradientColors || []).filter(
                (_, colorIndex) => colorIndex !== index,
              ),
            }))
          }
          onSecondaryChange={(backgroundColorSecondary) =>
            saveSettings((current) => ({
              backgroundColor:
                current.themeMode === "custom"
                  ? current.backgroundColor
                  : displayedBackground.background,
              backgroundColorSecondary,
              themeMode: "custom",
            }))
          }
          primary={displayedBackground.background}
          secondary={displayedBackground.backgroundSecondary}
          title={copy.accountAppearanceBackgroundColor}
        />
      </section>

      <p className="mt-3 text-xs leading-5 text-white/55">
        {copy.accountAppearanceAutomaticContrast}
      </p>

      <section className="mt-8">
        <SettingToggle
          checked={settings.resizeViewportOnPinch}
          description={copy.accountAppearancePinchResizeDescription}
          label={copy.accountAppearancePinchResize}
          onChange={(resizeViewportOnPinch) =>
            saveSettings({ resizeViewportOnPinch })
          }
        />
      </section>

      <p className="sr-only" aria-live="polite">
        {copy[currentTheme.labelKey]}
      </p>
    </div>
  );
}
