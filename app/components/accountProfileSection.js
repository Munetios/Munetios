"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentLocale } from "../i18n";
import { formatUserDate } from "../lib/dateTimePreferences";
import AccountAvatar from "./accountAvatar";
import { BirthdayDatePicker, CustomDropdown } from "./accountProfileControls";
import { showModal } from "./modal";
import { showToast } from "./toast";
import WorkspaceOptionsWrapper from "./workspaceOptionsWrapper";

const accountProfileUrl = "/api/account/profile";
const maximumBioLength = 1000;
const maximumImageSize = 5 * 1024 * 1024 * 1024;
const supportedImageTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function ProfileWorkspaces({ copy }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErrorKey, setLoadErrorKey] = useState("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    fetch("/api/workspaces", {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          const error = new Error("workspaces_load_failed");
          error.messageKey = "failedLoadWorkspaces";
          throw error;
        }
        return response.json();
      })
      .then((payload) => {
        if (!active) return;
        setWorkspaces(payload.workspaces || []);
        setLoadErrorKey("");
      })
      .catch((error) => {
        if (!active || error?.name === "AbortError") return;

        const messageKey = error?.messageKey || "failedLoadWorkspaces";
        setLoadErrorKey(messageKey);
        showToast({ messageKey, type: "error" });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return (
    <section className="mt-5 rounded-2xl border border-white/10 bg-white/5! p-4 sm:p-5">
      <h2 className="text-lg font-bold">{copy.accountProfileWorkspaces}</h2>
      <p className="mt-1 text-sm text-white/55">
        {copy.workspaceLockDescription}
      </p>
      <div className="mt-4 space-y-2">
        {loading
          ? <p className="text-sm text-white/60">{copy.loadingWorkspaces}</p>
          : null}
        {!loading && loadErrorKey
          ? <p className="text-sm text-rose-100" role="alert">
              {copy[loadErrorKey]}
            </p>
          : null}
        {!loading && !loadErrorKey && workspaces.length === 0
          ? <p className="text-sm text-white/60">{copy.noWorkspaces}</p>
          : null}
        {workspaces.map((workspace) => (
          <article
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-purple-950/20! p-3"
            key={workspace.id}
          >
            <icon>{workspace.locked ? "lock" : "workspaces"}</icon>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">
                {workspace.name || workspace.title}
              </span>
              {workspace.primary
                ? <span className="block text-xs text-purple-100/60">
                    {copy.workspaceMain}
                  </span>
                : null}
            </span>
            <WorkspaceOptionsWrapper
              copy={copy}
              onDeleted={(workspaceId) =>
                setWorkspaces((current) =>
                  current.filter((item) => item.id !== workspaceId),
                )
              }
              onSaved={(saved) =>
                setWorkspaces((current) =>
                  current.map((item) => (item.id === saved.id ? saved : item)),
                )
              }
              workspace={workspace}
            />
          </article>
        ))}
      </div>
    </section>
  );
}
const avatarColors = [
  "#7c3aed",
  "#9333ea",
  "#c026d3",
  "#db2777",
  "#4f46e5",
  "#2563eb",
  "#0f766e",
  "#b45309",
];
const avatarEmojis = ["😊", "✨", "🌙", "🚀", "🌻", "🎨", "💜", "🦋"];
const avatarFontFamilies = {
  cursive: '"Segoe Print", "Bradley Hand", cursive',
  googleSansFlex:
    '"Google Sans Flex", "Google Sans", Inter, ui-sans-serif, system-ui, sans-serif',
  monospace: '"Cascadia Mono", "SFMono-Regular", Consolas, monospace',
  serif: 'Georgia, "Times New Roman", serif',
};
const fieldClassName =
  "mt-2 w-full rounded-xl border border-white/10 bg-white/5! px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-purple-300/60 focus:bg-purple-950/30! disabled:cursor-not-allowed disabled:opacity-55";

function takeGraphemes(value, maximum = 1) {
  const normalizedValue = typeof value === "string" ? value : "";

  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    return Array.from(
      segmenter.segment(normalizedValue),
      ({ segment }) => segment,
    )
      .slice(0, maximum)
      .join("");
  }

  return Array.from(normalizedValue).slice(0, maximum).join("");
}

function getInitial(name) {
  const initial = takeGraphemes((name || "").trim(), 1);
  return initial ? initial.toLocaleUpperCase() : "Y";
}

function createDefaultAvatar(name) {
  return {
    color: "#7c3aed",
    font: "googleSansFlex",
    type: "letter",
    value: getInitial(name),
  };
}

function normalizeImageSource(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  if (
    (normalizedValue.startsWith("/") && !normalizedValue.startsWith("//")) ||
    normalizedValue.startsWith("blob:") ||
    /^data:image\/(?:gif|jpeg|png|webp);base64,/i.test(normalizedValue) ||
    normalizedValue.startsWith("https://") ||
    normalizedValue.startsWith("http://")
  ) {
    return normalizedValue;
  }

  return null;
}

function revokeObjectUrl(value) {
  if (typeof value === "string" && value.startsWith("blob:")) {
    URL.revokeObjectURL(value);
  }
}

function normalizeAvatar(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createDefaultAvatar(name);
  }

  const type = value.type === "emoji" ? "emoji" : "letter";
  const fallbackValue = type === "emoji" ? "😊" : getInitial(name);

  return {
    color: /^#[\da-f]{6}$/i.test(value.color || "") ? value.color : "#7c3aed",
    font: avatarFontFamilies[value.font] ? value.font : "googleSansFlex",
    type,
    value:
      takeGraphemes(value.value, type === "emoji" ? 2 : 1) || fallbackValue,
  };
}

function normalizeGender(value) {
  const normalizedValue = typeof value === "string" ? value.trim() : "";
  const normalizedKey = normalizedValue.toLowerCase().replace(/[\s_-]+/g, "");

  if (!normalizedValue) {
    return { customGender: "", gender: "" };
  }

  if (["woman", "female"].includes(normalizedKey)) {
    return { customGender: "", gender: "woman" };
  }

  if (["man", "male"].includes(normalizedKey)) {
    return { customGender: "", gender: "man" };
  }

  if (["nonbinary", "nonconforming"].includes(normalizedKey)) {
    return { customGender: "", gender: "nonBinary" };
  }

  if (["prefernottosay", "private", "undisclosed"].includes(normalizedKey)) {
    return { customGender: "", gender: "preferNotToSay" };
  }

  return { customGender: normalizedValue, gender: "custom" };
}

function normalizeProfile(payload, fallbackName) {
  const source =
    payload?.profile || payload?.account || payload?.data || payload || {};
  const name =
    source.name ||
    source.displayName ||
    source.fullName ||
    source.username ||
    fallbackName;
  const avatarPayload =
    source.avatarCustomization ||
    source.profilePictureCustomization ||
    source.avatarStyle ||
    (typeof source.avatar === "object" ? source.avatar : null);
  const imageSource =
    normalizeImageSource(source.profilePictureUrl) ||
    normalizeImageSource(source.profilePicture) ||
    normalizeImageSource(source.avatarUrl) ||
    normalizeImageSource(source.image) ||
    normalizeImageSource(source.picture) ||
    normalizeImageSource(
      typeof source.avatar === "string" ? source.avatar : null,
    );
  const { customGender, gender } = normalizeGender(source.gender);
  const birthdayValue = source.birthday || source.dateOfBirth;

  return {
    avatar: normalizeAvatar(avatarPayload, name),
    bio:
      typeof source.bio === "string"
        ? source.bio.slice(0, maximumBioLength)
        : "",
    birthday:
      typeof birthdayValue === "string" &&
      /^\d{4}-\d{2}-\d{2}/.test(birthdayValue)
        ? birthdayValue.slice(0, 10)
        : "",
    canChangeEmail: source.canChangeEmail !== false,
    customGender,
    email:
      source.email || source.mail || source.accountEmail || "---@munetios.com",
    emailChangeAvailableAt:
      typeof source.emailChangeAvailableAt === "string"
        ? source.emailChangeAvailableAt
        : null,
    demo: Boolean(source.demo),
    gender,
    name,
    parentSupervision: Boolean(source.parentSupervision),
    profilePictureFile: null,
    profilePictureUrl: imageSource,
  };
}

function createFallbackProfile(fallbackName) {
  return {
    avatar: createDefaultAvatar(fallbackName),
    bio: "",
    birthday: "",
    canChangeEmail: true,
    customGender: "",
    demo: false,
    email: "---@munetios.com",
    emailChangeAvailableAt: null,
    gender: "",
    name: fallbackName,
    parentSupervision: false,
    profilePictureFile: null,
    profilePictureUrl: null,
  };
}

function getGenderValue(profile) {
  if (profile.gender === "custom") {
    return profile.customGender.trim();
  }

  return profile.gender;
}

function getSavePayload(
  profile,
  profilePictureUrl = profile.profilePictureUrl,
) {
  return {
    avatar: profile.avatar,
    bio: profile.bio.trim(),
    birthday: profile.birthday,
    email: profile.email.trim(),
    gender: getGenderValue(profile),
    name: profile.name.trim(),
    profilePictureUrl,
  };
}

function getComparableProfile(profile) {
  return {
    ...getSavePayload(profile),
    selectedImage: profile.profilePictureFile
      ? {
          lastModified: profile.profilePictureFile.lastModified,
          name: profile.profilePictureFile.name,
          size: profile.profilePictureFile.size,
          type: profile.profilePictureFile.type,
        }
      : null,
  };
}

function getGenderLabel(profile, copy) {
  const labels = {
    custom: profile.customGender,
    man: copy.accountProfileGenderMan,
    nonBinary: copy.accountProfileGenderNonBinary,
    preferNotToSay: copy.accountProfileGenderPreferNotToSay,
    woman: copy.accountProfileGenderWoman,
  };

  return labels[profile.gender] || copy.accountProfileNotProvided;
}

function formatBirthday(value, copy) {
  if (!value) {
    return copy.accountProfileNotProvided;
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const preferredDate = formatUserDate(date, {
    locale: getCurrentLocale(),
  });
  if (preferredDate) return preferredDate;

  try {
    return new Intl.DateTimeFormat(getCurrentLocale(), {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  } catch {
    return value;
  }
}

function isUnderThirteen(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const today = new Date();
  let age = today.getFullYear() - year;
  const birthdayHasPassed =
    today.getMonth() + 1 > month ||
    (today.getMonth() + 1 === month && today.getDate() >= day);

  if (!birthdayHasPassed) {
    age -= 1;
  }

  return age < 13;
}

function ParentSupervisionVerification({ close, copy, onConfirm }) {
  const [parentEmail, setParentEmail] = useState("");
  const [parentPassword, setParentPassword] = useState("");
  const canConfirm =
    /^\S+@\S+\.\S+$/.test(parentEmail.trim()) && parentPassword.length > 0;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canConfirm) return;
        onConfirm();
        close();
      }}
    >
      <p className="text-sm leading-6 text-white/80">
        {copy.accountProfileUnder13Description}
      </p>
      <label className="block text-sm font-semibold text-white/80">
        {copy.accountProfileEmail}
        <input
          autoComplete="email"
          className={fieldClassName}
          onChange={(event) => setParentEmail(event.target.value)}
          required
          type="email"
          value={parentEmail}
        />
      </label>
      <label className="block text-sm font-semibold text-white/80">
        {copy.accountSecurityCurrentPassword}
        <input
          autoComplete="current-password"
          className={fieldClassName}
          onChange={(event) => setParentPassword(event.target.value)}
          required
          type="password"
          value={parentPassword}
        />
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          className="rounded-xl border border-white/10 bg-white/5! px-3 py-2 text-sm font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/10! hover:text-white"
          onClick={close}
          type="button"
        >
          {copy.accountProfileUnder13Cancel}
        </button>
        <button
          className="rounded-xl border border-purple-200/25 bg-purple-500/80! px-3 py-2 text-sm font-semibold text-white transition hover:border-purple-100/40 hover:bg-purple-400/90! disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!canConfirm}
          type="submit"
        >
          {copy.accountProfileUnder13Confirm}
        </button>
      </div>
    </form>
  );
}

function formatEmailAvailability(value, copy) {
  if (!value) {
    return copy.accountProfileEmailChangeHint;
  }

  const availableDate = new Date(value);

  if (Number.isNaN(availableDate.getTime())) {
    return copy.accountProfileEmailChangeHint;
  }
  const preferredDate = formatUserDate(availableDate, {
    locale: getCurrentLocale(),
  });
  if (preferredDate) {
    return copy.accountProfileEmailLocked.replace("{date}", preferredDate);
  }

  let formattedDate = value;

  try {
    formattedDate = new Intl.DateTimeFormat(getCurrentLocale(), {
      dateStyle: "long",
    }).format(availableDate);
  } catch {
    formattedDate = value;
  }

  return copy.accountProfileEmailLocked.replace("{date}", formattedDate);
}

function Skeleton({ className = "" }) {
  return (
    <span
      aria-hidden="true"
      className={`block bg-white/10! ${className}`}
      style={{
        animation: "shimmer 1.5s linear infinite",
        backgroundImage:
          "linear-gradient(90deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.24) 50%, rgba(255,255,255,0.08) 100%)",
        backgroundSize: "200% 100%",
      }}
    />
  );
}

function ProfileAvatar({
  className = "h-20 w-20",
  copy,
  failed = false,
  loading = false,
  profile,
}) {
  if (loading || failed) {
    return (
      <span
        aria-label={copy.accountProfilePictureLoading}
        className={`block shrink-0 overflow-hidden rounded-full ${className}`}
        role="img"
      >
        <Skeleton className="h-full w-full rounded-full" />
      </span>
    );
  }

  return (
    <AccountAvatar
      account={profile}
      alt={copy.accountProfileAlt}
      className={`${className} overflow-hidden rounded-full text-[clamp(1.5rem,5vw,2.75rem)] shadow-xl shadow-purple-950/30`}
    />
  );
}

function ProfilePictureEditor({ close, copy, onApply, profile }) {
  const initialAvatar = normalizeAvatar(profile.avatar, profile.name);
  const fileInputRef = useRef(null);
  const editorObjectUrlRef = useRef(null);
  const appliedObjectUrlRef = useRef(false);
  const [mode, setMode] = useState(
    profile.profilePictureUrl ? "upload" : "customize",
  );
  const [avatarType, setAvatarType] = useState(initialAvatar.type);
  const [character, setCharacter] = useState(initialAvatar.value);
  const [font, setFont] = useState(initialAvatar.font);
  const [color, setColor] = useState(initialAvatar.color);
  const [imageSource, setImageSource] = useState(
    profile.profilePictureUrl || "",
  );
  const [selectedFile, setSelectedFile] = useState(
    profile.profilePictureFile || null,
  );
  const [fileError, setFileError] = useState("");

  useEffect(
    () => () => {
      if (editorObjectUrlRef.current && !appliedObjectUrlRef.current) {
        URL.revokeObjectURL(editorObjectUrlRef.current);
      }
    },
    [],
  );

  const previewProfile = {
    ...profile,
    avatar: {
      color,
      font,
      type: avatarType,
      value:
        character || (avatarType === "emoji" ? "😊" : getInitial(profile.name)),
    },
    profilePictureUrl: mode === "upload" ? imageSource : null,
  };

  const chooseAvatarType = (nextType) => {
    setAvatarType(nextType);
    setCharacter((currentCharacter) => {
      if (nextType === "emoji") {
        return currentCharacter && currentCharacter !== getInitial(profile.name)
          ? currentCharacter
          : "😊";
      }

      return /^[\p{L}\p{N}]$/u.test(currentCharacter)
        ? currentCharacter.toLocaleUpperCase()
        : getInitial(profile.name);
    });
  };

  const readImage = (file) => {
    setFileError("");

    if (!file || !file.size || !supportedImageTypes.has(file.type)) {
      setFileError(copy.accountProfileUploadInvalid);
      return;
    }

    if (file.size > maximumImageSize) {
      setFileError(copy.accountProfileUploadTooLarge);
      return;
    }

    if (editorObjectUrlRef.current) {
      URL.revokeObjectURL(editorObjectUrlRef.current);
    }

    const objectUrl = URL.createObjectURL(file);
    editorObjectUrlRef.current = objectUrl;
    setSelectedFile(file);
    setImageSource(objectUrl);
    setMode("upload");
  };

  const applyPicture = () => {
    const nextCharacter =
      takeGraphemes(character.trim(), avatarType === "emoji" ? 2 : 1) ||
      (avatarType === "emoji" ? "😊" : getInitial(profile.name));

    const nextProfilePictureUrl =
      mode === "upload" ? imageSource || null : null;

    appliedObjectUrlRef.current =
      Boolean(editorObjectUrlRef.current) &&
      nextProfilePictureUrl === editorObjectUrlRef.current;
    onApply({
      avatar: {
        color,
        font,
        type: avatarType,
        value: nextCharacter,
      },
      profilePictureFile: mode === "upload" ? selectedFile : null,
      profilePictureUrl: nextProfilePictureUrl,
    });
    close();
  };

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-white/65">
        {copy.accountProfilePictureModalDescription}
      </p>

      <div className="grid gap-4 md:grid-cols-[11rem_minmax(0,1fr)]">
        <section
          aria-label={copy.accountProfilePicturePreview}
          className="liquid-glass flex min-h-44 flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-purple-950/25! p-4 text-center"
        >
          <ProfileAvatar
            className="h-28 w-28"
            copy={copy}
            profile={previewProfile}
          />
          <p className="max-w-full truncate text-sm font-bold">
            {profile.name || copy.accountNameFallback}
          </p>
        </section>

        <div className="min-w-0 space-y-4">
          <div
            aria-label={copy.accountProfilePictureModalTitle}
            className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/5! p-1"
            role="tablist"
          >
            <button
              aria-selected={mode === "customize"}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                mode === "customize"
                  ? "bg-purple-500/55! text-white"
                  : "text-white/60 hover:bg-white/5! hover:text-white"
              }`}
              onClick={() => setMode("customize")}
              role="tab"
              type="button"
            >
              {copy.accountProfileCustomizeTab}
            </button>
            <button
              aria-selected={mode === "upload"}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                mode === "upload"
                  ? "bg-purple-500/55! text-white"
                  : "text-white/60 hover:bg-white/5! hover:text-white"
              }`}
              onClick={() => setMode("upload")}
              role="tab"
              type="button"
            >
              {copy.accountProfileUploadTab}
            </button>
          </div>

          {mode === "customize"
            ? <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    aria-pressed={avatarType === "letter"}
                    className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                      avatarType === "letter"
                        ? "border-purple-200/35 bg-purple-500/35! text-white"
                        : "border-white/10 bg-white/5! text-white/65 hover:border-white/20 hover:text-white"
                    }`}
                    onClick={() => chooseAvatarType("letter")}
                    type="button"
                  >
                    {copy.accountProfilePictureLetter}
                  </button>
                  <button
                    aria-pressed={avatarType === "emoji"}
                    className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                      avatarType === "emoji"
                        ? "border-purple-200/35 bg-purple-500/35! text-white"
                        : "border-white/10 bg-white/5! text-white/65 hover:border-white/20 hover:text-white"
                    }`}
                    onClick={() => chooseAvatarType("emoji")}
                    type="button"
                  >
                    {copy.accountProfilePictureEmoji}
                  </button>
                </div>

                <label className="block text-sm font-semibold text-white/75">
                  {copy.accountProfilePictureCharacter}
                  <input
                    className={fieldClassName}
                    onChange={(event) =>
                      setCharacter(
                        takeGraphemes(
                          event.target.value,
                          avatarType === "emoji" ? 2 : 1,
                        ),
                      )
                    }
                    placeholder={copy.accountProfileCharacterPlaceholder}
                    type="text"
                    value={character}
                  />
                </label>

                {avatarType === "emoji"
                  ? <div>
                      <p className="text-sm font-semibold text-white/75">
                        {copy.accountProfilePictureChooseEmoji}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {avatarEmojis.map((emoji) => (
                          <button
                            aria-label={emoji}
                            aria-pressed={character === emoji}
                            className={`flex h-10 w-10 items-center justify-center rounded-xl border text-xl transition ${
                              character === emoji
                                ? "border-purple-200/45 bg-purple-500/35!"
                                : "border-white/10 bg-white/5! hover:border-white/20 hover:bg-white/10!"
                            }`}
                            key={emoji}
                            onClick={() => setCharacter(emoji)}
                            type="button"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  : null}

                <div>
                  <p className="text-sm font-semibold text-white/75">
                    {copy.accountProfilePictureFont}
                  </p>
                  <CustomDropdown
                    className="mt-2"
                    copy={copy}
                    label={copy.accountProfilePictureFont}
                    onChange={setFont}
                    options={[
                      {
                        label: copy.accountProfileFontGoogleSans,
                        value: "googleSansFlex",
                      },
                      {
                        label: copy.accountProfileFontSerif,
                        value: "serif",
                      },
                      {
                        label: copy.accountProfileFontMonospace,
                        value: "monospace",
                      },
                      {
                        label: copy.accountProfileFontCursive,
                        value: "cursive",
                      },
                    ]}
                    value={font}
                  />
                </div>

                <fieldset>
                  <legend className="text-sm font-semibold text-white/75">
                    {copy.accountProfilePictureColor}
                  </legend>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {avatarColors.map((avatarColor) => (
                      <button
                        aria-label={`${copy.accountProfilePictureColor} ${avatarColor}`}
                        aria-pressed={
                          color.toLowerCase() === avatarColor.toLowerCase()
                        }
                        className={`h-9 w-9 rounded-full border-2 transition hover:scale-105 ${
                          color.toLowerCase() === avatarColor.toLowerCase()
                            ? "border-white shadow-lg shadow-purple-950/40"
                            : "border-white/15"
                        }`}
                        key={avatarColor}
                        onClick={() => setColor(avatarColor)}
                        style={{ backgroundColor: avatarColor }}
                        type="button"
                      />
                    ))}
                    <label className="relative flex h-9 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-white/40">
                      <span className="sr-only">
                        {copy.accountProfilePictureColor}
                      </span>
                      <input
                        aria-label={copy.accountProfilePictureColor}
                        className="h-12 w-12 cursor-pointer border-0 bg-transparent! p-0"
                        onChange={(event) => setColor(event.target.value)}
                        type="color"
                        value={color}
                      />
                    </label>
                  </div>
                </fieldset>
              </div>
            : <div className="space-y-3">
                <input
                  accept="image/gif,image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    readImage(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                  ref={fileInputRef}
                  type="file"
                />
                <button
                  className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-purple-200/30 bg-purple-500/10! p-4 text-center transition hover:border-purple-200/50 hover:bg-purple-500/15!"
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-500/20! text-purple-100">
                    <icon>upload</icon>
                  </span>
                  <span className="text-sm font-bold">
                    {copy.accountProfilePictureChooseImage}
                  </span>
                  <span className="text-xs leading-5 text-white/50">
                    {copy.accountProfilePictureImageHint}
                    <span className="block">
                      {copy.accountProfileUploadTooLarge}
                    </span>
                  </span>
                </button>

                {imageSource
                  ? <button
                      className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5! px-3 py-2 text-sm font-semibold text-white/70 transition hover:border-white/20 hover:text-white"
                      onClick={() => {
                        if (editorObjectUrlRef.current) {
                          URL.revokeObjectURL(editorObjectUrlRef.current);
                          editorObjectUrlRef.current = null;
                        }
                        setSelectedFile(null);
                        setImageSource("");
                        setMode("customize");
                      }}
                      type="button"
                    >
                      <icon>delete</icon>
                      {copy.accountProfilePictureRemoveImage}
                    </button>
                  : null}

                {fileError
                  ? <p className="text-sm leading-6 text-rose-200" role="alert">
                      {fileError}
                    </p>
                  : null}
              </div>}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          className="rounded-xl border border-white/10 bg-white/5! px-4 py-2.5 text-sm font-semibold text-white/70 transition hover:border-white/20 hover:bg-white/10! hover:text-white"
          onClick={close}
          type="button"
        >
          {copy.modalCancel}
        </button>
        <button
          className="rounded-xl border border-purple-200/25 bg-purple-500/80! px-4 py-2.5 text-sm font-bold text-white transition hover:border-purple-100/40 hover:bg-purple-400/90! disabled:cursor-not-allowed disabled:opacity-55"
          disabled={mode === "upload" && !imageSource}
          onClick={applyPicture}
          type="button"
        >
          {copy.accountProfilePictureApply}
        </button>
      </div>
    </div>
  );
}

function ProfilePreview({ copy, loadState, profile }) {
  const unavailable = loadState === "error";
  const loading = loadState === "loading";

  return (
    <aside
      aria-label={copy.accountProfilePreviewAriaLabel}
      className="xl:sticky xl:top-24 xl:self-start"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/20! text-purple-100">
          <icon>visibility</icon>
        </span>
        <h2 className="text-sm font-bold">{copy.accountProfilePreview}</h2>
      </div>

      <div className="liquid-glass overflow-hidden rounded-2xl border border-white/10 bg-purple-950/25! shadow-2xl shadow-purple-950/25">
        <div className="h-24 bg-gradient-to-br from-purple-600/40 via-fuchsia-500/15 to-indigo-500/25!" />
        <div className="px-4 pb-5">
          <div className="-mt-12">
            <ProfileAvatar
              className="h-24 w-24 border-4 border-purple-950/80"
              copy={copy}
              failed={unavailable}
              loading={loading}
              profile={profile}
            />
          </div>

          {loading
            ? <output
                aria-label={copy.accountProfileLoading}
                className="mt-4 block space-y-3"
              >
                <Skeleton className="h-5 w-2/3 rounded-lg" />
                <Skeleton className="h-4 w-4/5 rounded-lg" />
                <Skeleton className="h-16 w-full rounded-xl" />
              </output>
            : null}

          {unavailable
            ? <div className="mt-4 rounded-xl border border-rose-300/15 bg-rose-950/25! p-3">
                <p className="text-sm font-semibold text-rose-100">
                  {copy.accountProfilePreviewLoadFailed}
                </p>
              </div>
            : null}

          {!loading && !unavailable
            ? <div className="mt-4">
                <h3 className="break-words text-xl font-bold leading-7">
                  {profile.name || copy.accountNameFallback}
                </h3>
                <p className="mt-1 break-all text-sm text-white/55">
                  {profile.email || copy.accountProfileNotProvided}
                </p>

                <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-white/72">
                  {profile.bio || copy.accountProfileNotProvided}
                </p>

                <dl className="mt-4 grid gap-2">
                  <div className="rounded-xl border border-white/10 bg-white/5! p-3">
                    <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/45">
                      <icon>cake</icon>
                      {copy.accountProfileBirthday}
                    </dt>
                    <dd className="mt-1 text-sm font-semibold text-white/80">
                      {formatBirthday(profile.birthday, copy)}
                    </dd>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5! p-3">
                    <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/45">
                      <icon>person</icon>
                      {copy.accountProfileGender}
                    </dt>
                    <dd className="mt-1 break-words text-sm font-semibold text-white/80">
                      {getGenderLabel(profile, copy)}
                    </dd>
                  </div>
                </dl>
              </div>
            : null}
        </div>
      </div>
    </aside>
  );
}

export default function AccountProfileSection({
  copy,
  managedStudent = false,
}) {
  const fallbackNameRef = useRef(copy.accountNameFallback);
  const requestControllerRef = useRef(null);
  const draftObjectUrlRef = useRef(null);
  const [loadState, setLoadState] = useState("loading");
  const [savedProfile, setSavedProfile] = useState(() =>
    createFallbackProfile(copy.accountNameFallback),
  );
  const [profile, setProfile] = useState(() =>
    createFallbackProfile(copy.accountNameFallback),
  );
  const [saving, setSaving] = useState(false);
  const [emailLockClock, setEmailLockClock] = useState(() => Date.now());

  const loadProfile = useCallback(async () => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoadState("loading");

    try {
      const response = await fetch(accountProfileUrl, {
        cache: "no-store",
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = new Error(`Profile request failed: ${response.status}`);
        error.status = response.status;
        throw error;
      }

      const payload = await response.json();
      const nextProfile = normalizeProfile(payload, fallbackNameRef.current);

      revokeObjectUrl(draftObjectUrlRef.current);
      draftObjectUrlRef.current = null;
      setSavedProfile(nextProfile);
      setProfile(nextProfile);
      setLoadState("ready");
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }

      const fallbackProfile = createFallbackProfile(fallbackNameRef.current);
      revokeObjectUrl(draftObjectUrlRef.current);
      draftObjectUrlRef.current = null;
      setSavedProfile(fallbackProfile);
      setProfile(fallbackProfile);
      setLoadState("error");
      showToast({
        messageKey: "accountProfileLoadFailed",
        type: "error",
      });
    }
  }, []);

  useEffect(() => {
    fallbackNameRef.current = copy.accountNameFallback;
  }, [copy.accountNameFallback]);

  const [profileError, setProfileError] = useState(null);

  useEffect(() => {
    loadProfile();

    return () => {
      requestControllerRef.current?.abort();
      revokeObjectUrl(draftObjectUrlRef.current);
    };
  }, [loadProfile]);

  useEffect(() => {
    if (loadState === "error") {
      setProfileError(copy.accountProfileLoadFailed);
      return;
    }

    setProfileError(null);
  }, [copy.accountProfileLoadFailed, loadState]);

  useEffect(() => {
    const availableAt = new Date(
      profile.emailChangeAvailableAt || "",
    ).getTime();

    if (Number.isNaN(availableAt) || availableAt <= emailLockClock) {
      return undefined;
    }

    const maximumTimerDelay = 2_147_000_000;
    const timer = window.setTimeout(
      () => setEmailLockClock(Date.now()),
      Math.min(availableAt - emailLockClock, maximumTimerDelay),
    );

    return () => window.clearTimeout(timer);
  }, [emailLockClock, profile.emailChangeAvailableAt]);

  const hasChanges = useMemo(
    () =>
      JSON.stringify(getComparableProfile(profile)) !==
      JSON.stringify(getComparableProfile(savedProfile)),
    [profile, savedProfile],
  );

  const updateField = (field, value) => {
    setProfile((currentProfile) => ({
      ...currentProfile,
      [field]: value,
    }));
  };

  const enableDemoParentSupervision = async (birthday) => {
    setSaving(true);

    try {
      const response = await fetch(accountProfileUrl, {
        body: JSON.stringify({
          ...getSavePayload({ ...profile, birthday }),
          enableParentSupervision: true,
        }),
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });

      if (!response.ok) {
        throw new Error(
          `Demo parent supervision update failed: ${response.status}`,
        );
      }

      const nextProfile = normalizeProfile(
        await response.json(),
        fallbackNameRef.current,
      );
      setProfile(nextProfile);
      setSavedProfile(nextProfile);
      window.dispatchEvent(new Event("munetios:demo-settingschange"));
    } catch {
      showToast({
        messageKey: "accountProfileSaveFailed",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const updateBirthday = (birthday) => {
    if (
      !isUnderThirteen(birthday) ||
      isUnderThirteen(profile.birthday) ||
      profile.parentSupervision
    ) {
      updateField("birthday", birthday);
      return;
    }

    showModal(
      ({ close }) =>
        profile.demo
          ? <div className="space-y-4">
              <p className="text-sm leading-6 text-white/80">
                {copy.accountProfileUnder13Description}
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  className="rounded-xl border border-white/10 bg-white/5! px-3 py-2 text-sm font-semibold text-white/75 transition hover:border-white/20 hover:bg-white/10! hover:text-white"
                  onClick={close}
                  type="button"
                >
                  {copy.accountProfileUnder13Cancel}
                </button>
                <button
                  className="rounded-xl border border-purple-200/25 bg-purple-500/80! px-3 py-2 text-sm font-semibold text-white transition hover:border-purple-100/40 hover:bg-purple-400/90!"
                  onClick={() => {
                    void enableDemoParentSupervision(birthday);
                    close();
                  }}
                  type="button"
                >
                  {copy.accountProfileUnder13Confirm}
                </button>
              </div>
            </div>
          : <ParentSupervisionVerification
              close={close}
              copy={copy}
              onConfirm={() => updateField("birthday", birthday)}
            />,
      {
        ariaLabel: copy.accountProfileUnder13Title,
        title: copy.accountProfileUnder13Title,
      },
    );
  };

  const openPictureEditor = () => {
    if (loadState === "loading") {
      return;
    }

    showModal(
      ({ close }) => (
        <ProfilePictureEditor
          close={close}
          copy={copy}
          onApply={({ avatar, profilePictureFile, profilePictureUrl }) => {
            if (
              draftObjectUrlRef.current &&
              draftObjectUrlRef.current !== profilePictureUrl
            ) {
              revokeObjectUrl(draftObjectUrlRef.current);
            }
            draftObjectUrlRef.current = profilePictureFile
              ? profilePictureUrl
              : null;
            setProfile((currentProfile) => ({
              ...currentProfile,
              avatar,
              profilePictureFile,
              profilePictureUrl,
            }));
          }}
          profile={profile}
        />
      ),
      {
        ariaLabel: copy.accountProfilePictureModalTitle,
        contentClassName:
          "max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain pr-1",
        title: copy.accountProfilePictureModalTitle,
        width: "46rem",
      },
    );
  };

  const saveProfile = async (event) => {
    event.preventDefault();

    if (
      saving ||
      loadState === "loading" ||
      !profile.name.trim() ||
      !/^\S+@\S+\.\S+$/.test(profile.email.trim()) ||
      !profile.birthday ||
      (profile.gender === "custom" && !profile.customGender.trim())
    ) {
      if (!profile.birthday) {
        showToast({
          messageKey: "accountProfileBirthdayRequired",
          type: "error",
        });
      }
      return;
    }

    setSaving(true);

    if (loadState === "error") {
      showToast({
        messageKey: "accountProfileSaveFailed",
        type: "error",
      });
      setSaving(false);
      return;
    }

    try {
      let profilePictureUrl = profile.profilePictureUrl;

      if (profile.profilePictureFile) {
        const uploadResponse = await fetch(accountProfileUrl, {
          body: profile.profilePictureFile,
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": profile.profilePictureFile.type,
          },
          method: "PUT",
        });

        if (!uploadResponse.ok) {
          throw new Error(
            `Profile image upload failed: ${uploadResponse.status}`,
          );
        }

        const uploadPayload = await uploadResponse.json();
        const uploadedProfile = normalizeProfile(
          uploadPayload,
          fallbackNameRef.current,
        );
        profilePictureUrl = uploadedProfile.profilePictureUrl;
      }

      const response = await fetch(accountProfileUrl, {
        body: JSON.stringify(getSavePayload(profile, profilePictureUrl)),
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));

        if (errorPayload?.error === "email_change_locked") {
          const emailChangeAvailableAt =
            errorPayload.emailChangeAvailableAt ||
            profile.emailChangeAvailableAt;
          setProfile((currentProfile) => ({
            ...currentProfile,
            canChangeEmail: false,
            email: savedProfile.email,
            emailChangeAvailableAt,
          }));
          showToast({
            message: formatEmailAvailability(emailChangeAvailableAt, copy),
            type: "error",
          });
          return;
        }

        throw new Error(`Profile update failed: ${response.status}`);
      }

      const payload = await response.json();
      const nextProfile = normalizeProfile(payload, fallbackNameRef.current);

      revokeObjectUrl(draftObjectUrlRef.current);
      draftObjectUrlRef.current = null;
      setSavedProfile(nextProfile);
      setProfile(nextProfile);
      showToast({
        messageKey: "accountProfileSaveSuccess",
        type: "success",
      });
      window.dispatchEvent(
        new CustomEvent("munetios:profilechange", {
          detail: nextProfile,
        }),
      );
    } catch {
      showToast({
        messageKey: "accountProfileSaveFailed",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const formDisabled = loadState === "loading" || saving;
  const managedFieldDisabled = managedStudent || formDisabled;
  const canSave =
    !formDisabled &&
    hasChanges &&
    Boolean(profile.name.trim()) &&
    /^\S+@\S+\.\S+$/.test(profile.email.trim()) &&
    Boolean(profile.birthday) &&
    (profile.gender !== "custom" || Boolean(profile.customGender.trim()));
  const emailLocked =
    !profile.canChangeEmail &&
    Boolean(profile.emailChangeAvailableAt) &&
    new Date(profile.emailChangeAvailableAt).getTime() > emailLockClock;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="mb-5">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-purple-200/70">
          {copy.accountSettingsProfile}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
          {copy.accountProfileTitle}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">
          {copy.accountProfileDescription}
        </p>
      </header>
      {managedStudent
        ? <p className="mb-5 rounded-xl border border-purple-200/15 bg-purple-500/10! p-3 text-sm text-purple-100">
            {copy.educationSettingsManagedByTeacher}
          </p>
        : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)]">
        <section
          aria-labelledby="accountProfileDetailsHeading"
          className="rounded-2xl border border-white/10 bg-white/5! p-4 sm:p-5"
        >
          <h2 className="sr-only" id="accountProfileDetailsHeading">
            {copy.accountProfileTitle}
          </h2>

          {profileError
            ? <div className="mb-4 flex flex-col gap-3 rounded-xl border border-rose-300/15 bg-rose-950/25! p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm leading-6 text-rose-100" role="alert">
                  {profileError}
                </p>
                <button
                  className="shrink-0 rounded-xl border border-rose-200/20 bg-rose-500/15! px-3 py-2 text-sm font-bold text-rose-100 transition hover:bg-rose-500/25!"
                  onClick={loadProfile}
                  type="button"
                >
                  {copy.retry}
                </button>
              </div>
            : null}

          <form className="space-y-5" onSubmit={saveProfile}>
            <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5! p-4 sm:flex-row sm:items-center">
              <button
                aria-label={copy.accountProfileChangePicture}
                className="group relative w-fit shrink-0 rounded-full disabled:cursor-not-allowed"
                disabled={managedFieldDisabled}
                onClick={openPictureEditor}
                type="button"
              >
                <ProfileAvatar
                  className="h-20 w-20"
                  copy={copy}
                  failed={loadState === "error"}
                  loading={loadState === "loading"}
                  profile={profile}
                />
                {loadState === "ready"
                  ? <span className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-purple-950 bg-purple-500! text-white shadow-lg transition group-hover:bg-purple-400!">
                      <icon>edit</icon>
                    </span>
                  : null}
              </button>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold">
                  {copy.accountProfilePicture}
                </h3>
                <p className="mt-1 text-sm leading-6 text-white/55">
                  {copy.accountProfilePictureModalDescription}
                </p>
              </div>
              <button
                className="rounded-xl border border-purple-200/25 bg-purple-500/20! px-3 py-2 text-sm font-bold text-purple-50 transition hover:border-purple-200/40 hover:bg-purple-500/30! disabled:cursor-not-allowed disabled:opacity-50"
                disabled={managedFieldDisabled}
                onClick={openPictureEditor}
                type="button"
              >
                {copy.accountProfileChangePicture}
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-white/80">
                {copy.accountProfileName}
                <input
                  autoComplete="name"
                  className={fieldClassName}
                  disabled={managedFieldDisabled || profile.parentSupervision}
                  maxLength={80}
                  onChange={(event) => updateField("name", event.target.value)}
                  placeholder={copy.accountProfileNamePlaceholder}
                  required
                  type="text"
                  value={profile.name}
                />
              </label>

              <label className="block text-sm font-semibold text-white/80">
                {copy.accountProfileEmail}
                <input
                  autoComplete="email"
                  className={fieldClassName}
                  disabled={managedFieldDisabled || emailLocked}
                  maxLength={254}
                  onChange={(event) => updateField("email", event.target.value)}
                  placeholder={copy.accountProfileNotProvided}
                  required
                  type="email"
                  value={profile.email}
                />
                <span className="mt-1.5 block text-xs leading-5 text-white/40">
                  {emailLocked
                    ? formatEmailAvailability(
                        profile.emailChangeAvailableAt,
                        copy,
                      )
                    : copy.accountProfileEmailChangeHint}
                </span>
              </label>

              <div className="text-sm font-semibold text-white/80">
                <p>{copy.accountProfileBirthday}</p>
                <BirthdayDatePicker
                  copy={copy}
                  disabled={managedFieldDisabled || profile.parentSupervision}
                  onChange={updateBirthday}
                  required
                  value={profile.birthday}
                />
                <span className="mt-1.5 block text-xs leading-5 text-white/40">
                  {profile.parentSupervision
                    ? copy.accountProfileBirthdayParentManaged
                    : copy.accountProfileBirthdayHint}
                </span>
              </div>

              <div>
                <p className="text-sm font-semibold text-white/80">
                  {copy.accountProfileGender}
                </p>
                <CustomDropdown
                  className="mt-2"
                  copy={copy}
                  disabled={managedFieldDisabled}
                  label={copy.accountProfileGender}
                  onChange={(nextGender) => {
                    setProfile((currentProfile) => ({
                      ...currentProfile,
                      customGender:
                        nextGender === "custom"
                          ? currentProfile.customGender
                          : "",
                      gender: nextGender,
                    }));
                  }}
                  options={[
                    {
                      label: copy.accountProfileGenderSelect,
                      value: "",
                    },
                    {
                      label: copy.accountProfileGenderWoman,
                      value: "woman",
                    },
                    {
                      label: copy.accountProfileGenderMan,
                      value: "man",
                    },
                    {
                      label: copy.accountProfileGenderNonBinary,
                      value: "nonBinary",
                    },
                    {
                      label: copy.accountProfileGenderPreferNotToSay,
                      value: "preferNotToSay",
                    },
                    {
                      label: copy.accountProfileGenderCustom,
                      value: "custom",
                    },
                  ]}
                  value={profile.gender}
                />
                {profile.gender === "custom"
                  ? <input
                      aria-label={copy.accountProfileGenderCustom}
                      className={fieldClassName}
                      disabled={managedFieldDisabled}
                      maxLength={60}
                      onChange={(event) =>
                        updateField("customGender", event.target.value)
                      }
                      placeholder={copy.accountProfileCustomGenderPlaceholder}
                      required
                      type="text"
                      value={profile.customGender}
                    />
                  : null}
              </div>
            </div>

            <label className="block text-sm font-semibold text-white/80">
              <span className="flex items-center justify-between gap-3">
                <span>{copy.accountProfileBio}</span>
                <span className="text-xs font-medium text-white/40">
                  {profile.bio.length} / {maximumBioLength}
                </span>
              </span>
              <textarea
                className={`${fieldClassName} min-h-28 resize-y`}
                disabled={formDisabled}
                maxLength={maximumBioLength}
                onChange={(event) => updateField("bio", event.target.value)}
                placeholder={copy.accountProfileBioPlaceholder}
                rows={4}
                value={profile.bio}
              />
            </label>

            <div className="flex justify-end border-t border-white/10 pt-4">
              <button
                className="inline-flex min-w-32 items-center justify-center gap-2 rounded-xl border border-purple-200/25 bg-purple-500/80! px-4 py-2.5 text-sm font-bold text-white transition hover:border-purple-100/40 hover:bg-purple-400/90! disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canSave}
                type="submit"
              >
                {saving
                  ? <span
                      aria-hidden="true"
                      className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white"
                    />
                  : <icon>save</icon>}
                {saving ? copy.accountProfileSaving : copy.accountProfileSave}
              </button>
            </div>
          </form>
        </section>

        <ProfilePreview copy={copy} loadState={loadState} profile={profile} />
      </div>
      <ProfileWorkspaces copy={copy} />
    </div>
  );
}
