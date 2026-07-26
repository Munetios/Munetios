const store = globalThis.__munetiosDemoSettingsStore || new Map();

globalThis.__munetiosDemoSettingsStore = store;

const defaultSettings = {
  archived: false,
  eligibleFamilies: true,
  eligibleTrustedPeople: true,
  parentSupervision: false,
  plan: "business-pro",
  storageTotalGb: 10240,
  storageUsedGb: 12.5,
};

export function getDemoSettings(session) {
  if (!session?.demo) return null;
  const key = session.user.id;
  if (!store.has(key)) store.set(key, { ...defaultSettings });
  const settings = store.get(key);
  if (!Number.isFinite(Number(settings.storageTotalGb))) {
    settings.storageTotalGb = defaultSettings.storageTotalGb;
    settings.storageUsedGb = defaultSettings.storageUsedGb;
    delete settings.storagePreset;
  }
  return settings;
}

export function updateDemoSettings(session, patch) {
  const current = getDemoSettings(session);
  if (!current) return null;
  const next = { ...current };

  if (Object.hasOwn(patch, "archived")) next.archived = Boolean(patch.archived);
  if (Object.hasOwn(patch, "eligibleFamilies"))
    next.eligibleFamilies = Boolean(patch.eligibleFamilies);
  if (Object.hasOwn(patch, "eligibleTrustedPeople"))
    next.eligibleTrustedPeople = Boolean(patch.eligibleTrustedPeople);
  if (Object.hasOwn(patch, "parentSupervision"))
    next.parentSupervision = Boolean(patch.parentSupervision);
  if (
    ["personal", "business-free", "business-standard", "business-pro"].includes(
      patch.plan,
    )
  )
    next.plan = patch.plan;
  if (next.parentSupervision) next.plan = "personal";
  if (Number.isFinite(Number(patch.storageTotalGb)))
    next.storageTotalGb = Math.min(
      10240,
      Math.max(1, Number(patch.storageTotalGb)),
    );
  if (Number.isFinite(Number(patch.storageUsedGb)))
    next.storageUsedGb = Math.min(
      next.storageTotalGb,
      Math.max(0, Number(patch.storageUsedGb)),
    );

  store.set(session.user.id, next);
  return next;
}

export function formatDemoStorage(gigabytes) {
  if (gigabytes >= 1024) {
    const terabytes = gigabytes / 1024;
    return `${Number(terabytes.toFixed(terabytes >= 10 ? 0 : 1))}TB`;
  }
  return `${Number(gigabytes.toFixed(gigabytes >= 10 ? 0 : 1))}GB`;
}

export function getDemoStorage(settings) {
  return {
    totalLabel: formatDemoStorage(settings.storageTotalGb),
    usedLabel: formatDemoStorage(settings.storageUsedGb),
  };
}

export function removeDemoSettings(session) {
  if (session?.demo) store.delete(session.user.id);
}

export function demoPlanLabel(plan) {
  return (
    {
      personal: "Personal",
      "business-free": "Business Free",
      "business-standard": "Business Standard",
      "business-pro": "Business Pro",
    }[plan] || "Business Pro"
  );
}
