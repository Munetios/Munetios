export const developerSettingsStorageKey = "munetios.account.advanced";
export const developerSettingsChangeEvent = "munetios:advanced-settings-change";

export const developerSettingsDefaults = {
  byokProviders: [],
  customCss: "",
  developerMode: false,
  encryption: "managed",
  showHiddenItems: false,
};

export function loadDeveloperSettings() {
  if (typeof window === "undefined") return developerSettingsDefaults;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(developerSettingsStorageKey) || "{}",
    );
    return {
      ...developerSettingsDefaults,
      ...stored,
      byokProviders: Array.isArray(stored.byokProviders)
        ? stored.byokProviders
        : [],
      customCss: String(stored.customCss || ""),
    };
  } catch {
    return developerSettingsDefaults;
  }
}

export function saveDeveloperSettings(settings) {
  const next = { ...developerSettingsDefaults, ...settings };
  window.localStorage.setItem(
    developerSettingsStorageKey,
    JSON.stringify(next),
  );
  document.documentElement.toggleAttribute(
    "data-developer-mode",
    next.developerMode,
  );
  document.documentElement.toggleAttribute(
    "data-show-hidden-items",
    next.developerMode && next.showHiddenItems,
  );
  window.dispatchEvent(
    new CustomEvent(developerSettingsChangeEvent, { detail: next }),
  );
  return next;
}

export function applyDeveloperCss(settings = loadDeveloperSettings()) {
  const styleId = "munetios-developer-css";
  let style = document.getElementById(styleId);
  const css = settings.developerMode ? String(settings.customCss || "") : "";
  if (!css) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head.append(style);
  }
  style.textContent = css;
}
