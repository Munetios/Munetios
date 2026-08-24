import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { requireAuth } from "../../../../auth.js";
import {
  accountDataDirectory,
  getAccountData,
  getAccountLifecycle,
  setAccountData,
} from "../../../lib/authSecurity.js";
import {
  getDemoSettings,
  updateDemoSettings,
} from "../../../lib/demoSettings.js";
import {
  deleteDurableProfileImage,
  getDurableAccountData,
  getDurableProfileImage,
  saveDurableAccountData,
  saveDurableProfileImage,
} from "../../../lib/durableAuthStore.js";
import {
  enforceStudentRestriction,
  isStudentAccount,
} from "../../../lib/education.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const profileStore = globalThis.__munetiosAccountProfileStore || new Map();
const allowedAvatarFonts = new Set([
  "googleSansFlex",
  "serif",
  "monospace",
  "cursive",
]);
const imageTypes = new Map([
  ["image/gif", "gif"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const profileImageTokenPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const imageDataUrlPattern = /^data:image\/(?:gif|jpeg|png|webp);base64,/i;
const hexColorPattern = /^#[\da-f]{6}$/i;
const birthdayPattern = /^\d{4}-\d{2}-\d{2}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const maximumImageSize = 5 * 1024 * 1024 * 1024;
const maximumInlineImageLength = 5_600_000;
const profileImageDirectory = join(accountDataDirectory, "profile-images");

globalThis.__munetiosAccountProfileStore = profileStore;

function jsonResponse(payload, init = {}) {
  return Response.json(payload, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init.headers || {}),
    },
  });
}

function getFirstCharacter(value) {
  const normalizedValue = typeof value === "string" ? value.trim() : "";

  if (!normalizedValue) {
    return "Y";
  }

  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    return (
      segmenter.segment(normalizedValue)[Symbol.iterator]().next().value
        ?.segment || "Y"
    );
  }

  return Array.from(normalizedValue)[0] || "Y";
}

function createDefaultAvatar(name) {
  return {
    color: "#7c3aed",
    font: "googleSansFlex",
    type: "letter",
    value: getFirstCharacter(name).toLocaleUpperCase(),
  };
}

function getProfileKey(session) {
  return session.user.id;
}

function getStoredProfile(session) {
  return session.demo
    ? profileStore.get(getProfileKey(session)) || {}
    : getAccountData(session.user.id, "profile", {});
}

function setStoredProfile(session, profile) {
  if (session.demo) {
    profileStore.set(getProfileKey(session), profile);
    return profile;
  }
  return setAccountData(session.user.id, "profile", profile);
}

function getProfile(session) {
  const storedProfile = getStoredProfile(session);
  const name = storedProfile.name || session.user.name || "Your Name";
  const emailChangeAvailableAt = storedProfile.emailChangeAvailableAt || null;
  const canChangeEmail =
    !emailChangeAvailableAt ||
    Number.isNaN(new Date(emailChangeAvailableAt).getTime()) ||
    new Date(emailChangeAvailableAt) <= new Date();

  return {
    avatar:
      storedProfile.avatar ||
      (session.demo
        ? {
            color: "#7c3aed",
            font: "googleSansFlex",
            type: "letter",
            value: "M",
          }
        : createDefaultAvatar(name)),
    bio: storedProfile.bio || "",
    birthday: Object.hasOwn(storedProfile, "birthday")
      ? storedProfile.birthday
      : session.demo
        ? "1995-10-03"
        : session.user.birthDate || "",
    canChangeEmail,
    email: storedProfile.email || session.user.email || "---@munetios.com",
    emailChangeAvailableAt,
    gender: Object.hasOwn(storedProfile, "gender")
      ? storedProfile.gender
      : session.demo
        ? "preferNotToSay"
        : session.user.gender || "",
    demo: Boolean(session.demo),
    id: session.user.id,
    name,
    parentSupervision: Boolean(getDemoSettings(session)?.parentSupervision),
    profilePictureUrl: Object.hasOwn(storedProfile, "profilePictureUrl")
      ? storedProfile.profilePictureUrl
      : session.user.profilePictureUrl || session.user.avatarUrl || null,
  };
}

function invalidProfileResponse(
  message,
  status = 400,
  error = "invalid_profile",
) {
  return jsonResponse(
    {
      error,
      message,
    },
    { status },
  );
}

function normalizeText(value, maximumLength) {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length > maximumLength) {
    return null;
  }

  return normalizedValue;
}

function normalizeEmail(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  if (
    !normalizedValue ||
    normalizedValue.length > 254 ||
    !emailPattern.test(normalizedValue)
  ) {
    return null;
  }

  return normalizedValue;
}

function normalizeBirthday(value) {
  if (value === "") {
    return "";
  }

  if (typeof value !== "string" || !birthdayPattern.test(value)) {
    return null;
  }

  const birthday = new Date(`${value}T00:00:00.000Z`);
  const today = new Date();

  if (
    Number.isNaN(birthday.getTime()) ||
    birthday.toISOString().slice(0, 10) !== value ||
    birthday > today
  ) {
    return null;
  }

  return value;
}

function normalizeProfilePictureUrl(value) {
  if (value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  if (
    imageDataUrlPattern.test(trimmedValue) &&
    trimmedValue.length <= maximumInlineImageLength
  ) {
    return trimmedValue;
  }

  if (
    (trimmedValue.startsWith("/") && !trimmedValue.startsWith("//")) ||
    trimmedValue.startsWith("https://") ||
    trimmedValue.startsWith("http://")
  ) {
    return trimmedValue;
  }

  return undefined;
}

function normalizeAvatar(value, fallbackName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const type = value.type === "emoji" ? "emoji" : "letter";
  const rawValue = typeof value.value === "string" ? value.value.trim() : "";
  const avatarValue = Array.from(rawValue).slice(0, 12).join("");
  const font = allowedAvatarFonts.has(value.font)
    ? value.font
    : "googleSansFlex";
  const color = hexColorPattern.test(value.color || "")
    ? value.color.toLowerCase()
    : "#7c3aed";

  return {
    color,
    font,
    type,
    value:
      avatarValue ||
      (type === "emoji"
        ? "😊"
        : getFirstCharacter(fallbackName).toLocaleUpperCase()),
  };
}

function addOneMonth(value) {
  const nextDate = new Date(value);
  const originalDay = nextDate.getUTCDate();

  nextDate.setUTCDate(1);
  nextDate.setUTCMonth(nextDate.getUTCMonth() + 1);

  const lastDayOfNextMonth = new Date(
    Date.UTC(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, 0),
  ).getUTCDate();

  nextDate.setUTCDate(Math.min(originalDay, lastDayOfNextMonth));
  return nextDate;
}

async function removeImageFile(imageFile) {
  if (!imageFile?.path) {
    return;
  }

  try {
    await rm(imageFile.path, { force: true });
  } catch {
    // A stale profile image should not block a profile update.
  }
  await deleteDurableProfileImage(imageFile.token);
}

async function hydrateStoredProfile(session) {
  if (session.demo) return;
  const durableProfile = await getDurableAccountData(
    session.user.id,
    "profile",
  );
  if (durableProfile)
    setAccountData(session.user.id, "profile", durableProfile);
}

async function serveProfileImage(token) {
  if (!profileImageTokenPattern.test(token)) {
    return new Response(null, { status: 404 });
  }

  for (const [contentType, extension] of imageTypes) {
    const imagePath = join(profileImageDirectory, `${token}.${extension}`);

    try {
      const imageStats = await stat(imagePath);
      if (!imageStats.isFile()) continue;
      const imageStream = Readable.toWeb(createReadStream(imagePath));

      return new Response(imageStream, {
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "Content-Length": String(imageStats.size),
          "Content-Type": contentType,
          "Cross-Origin-Resource-Policy": "same-origin",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      // The token may belong to one of the other supported image formats.
    }
  }

  const durableImage = await getDurableProfileImage(token);
  if (durableImage) {
    return new Response(durableImage.stream, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Type": durableImage.contentType,
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return new Response(null, { status: 404 });
}

export async function GET(request) {
  const requestUrl = new URL(request.url);
  const imageToken = requestUrl.searchParams.get("image");

  if (imageToken) {
    return serveProfileImage(imageToken);
  }

  const { response, session } = await requireAuth(request);

  if (response) {
    return response;
  }

  await hydrateStoredProfile(session);

  return jsonResponse(getProfile(session));
}

export async function PUT(request) {
  const { response, session } = await requireAuth(request);

  if (response) {
    return response;
  }
  await hydrateStoredProfile(session);
  const educationResponse = enforceStudentRestriction(session, "profile");
  if (educationResponse) return educationResponse;
  if (
    getDemoSettings(session)?.archived ||
    (!session.demo && getAccountLifecycle(session.user.id).archived)
  )
    return invalidProfileResponse(
      "Profile changes are not saved for an archived user.",
      403,
      "archived_user",
    );

  const contentType = (request.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const fileExtension = imageTypes.get(contentType);
  const declaredLength = Number(request.headers.get("content-length") || 0);

  if (!fileExtension) {
    return invalidProfileResponse(
      "Choose a PNG, JPG, WEBP, or GIF image.",
      415,
      "unsupported_image",
    );
  }

  if (Number.isFinite(declaredLength) && declaredLength > maximumImageSize) {
    return invalidProfileResponse(
      "Image must be 5 GB or smaller.",
      413,
      "image_too_large",
    );
  }

  if (!request.body) {
    return invalidProfileResponse("Image data is required.");
  }

  await mkdir(profileImageDirectory, { recursive: true });

  const token = crypto.randomUUID();
  const filePath = join(profileImageDirectory, `${token}.${fileExtension}`);
  let streamedLength = 0;
  const sizeLimiter = new Transform({
    transform(chunk, _encoding, callback) {
      streamedLength += chunk.length;

      if (streamedLength > maximumImageSize) {
        const error = new Error("Image exceeds the 5 GB limit.");
        error.code = "IMAGE_TOO_LARGE";
        callback(error);
        return;
      }

      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(request.body),
      sizeLimiter,
      createWriteStream(filePath, { flags: "wx" }),
    );
  } catch (error) {
    await removeImageFile({ path: filePath });

    if (error?.code === "IMAGE_TOO_LARGE") {
      return invalidProfileResponse(
        "Image must be 5 GB or smaller.",
        413,
        "image_too_large",
      );
    }

    return invalidProfileResponse(
      "Failed to upload the profile picture.",
      500,
      "image_upload_failed",
    );
  }

  const storedProfile = getStoredProfile(session);
  const previousImageFile = storedProfile.imageFile;
  const imageFile = {
    contentType,
    path: filePath,
    size: streamedLength,
    token,
  };

  await saveDurableProfileImage(
    token,
    Readable.toWeb(createReadStream(filePath)),
    contentType,
  );

  const nextProfile = {
    ...storedProfile,
    imageFile,
    profilePictureUrl: `/api/account/profile?image=${encodeURIComponent(token)}`,
  };
  setStoredProfile(session, nextProfile);
  await saveDurableAccountData(session.user.id, "profile", nextProfile);

  await removeImageFile(previousImageFile);

  return jsonResponse(getProfile(session));
}

export async function PATCH(request) {
  const { response, session } = await requireAuth(request);

  if (response) {
    return response;
  }
  await hydrateStoredProfile(session);
  if (
    getDemoSettings(session)?.archived ||
    (!session.demo && getAccountLifecycle(session.user.id).archived)
  )
    return invalidProfileResponse(
      "Profile changes are not saved for an archived user.",
      403,
      "archived_user",
    );

  let payload;

  try {
    payload = await request.json();
  } catch {
    return invalidProfileResponse("Invalid request body.");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return invalidProfileResponse("Invalid profile details.");
  }

  if (isStudentAccount(session.user.id)) {
    const bio = normalizeText(payload.bio ?? "", 1000);
    if (bio === null) {
      return invalidProfileResponse("Bio must be 1000 characters or less.");
    }
    setStoredProfile(session, { ...getStoredProfile(session), bio });
    return jsonResponse(getProfile(session));
  }

  const currentProfile = getProfile(session);
  const storedProfile = getStoredProfile(session);
  const name = normalizeText(payload.name, 80);
  const email = normalizeEmail(payload.email);
  const bio = normalizeText(payload.bio ?? "", 1000);
  const gender = normalizeText(payload.gender ?? "", 60);
  const requestedBirthday = normalizeBirthday(payload.birthday ?? "");
  const enableParentSupervision =
    session.demo && payload.enableParentSupervision === true;
  const birthday =
    getDemoSettings(session)?.parentSupervision && !enableParentSupervision
      ? currentProfile.birthday
      : requestedBirthday;
  const profilePictureUrl = normalizeProfilePictureUrl(
    payload.profilePictureUrl ?? null,
  );
  const avatar = normalizeAvatar(payload.avatar, name || session.user.name);

  if (!name) {
    return invalidProfileResponse("Name is required.");
  }

  if (!email) {
    return invalidProfileResponse("A valid email address is required.");
  }

  if (bio === null) {
    return invalidProfileResponse("Bio must be 1000 characters or less.");
  }

  if (gender === null) {
    return invalidProfileResponse("Gender must be 60 characters or less.");
  }

  if (requestedBirthday === null) {
    return invalidProfileResponse("Birthday must be a valid date.");
  }

  if (!requestedBirthday) {
    return invalidProfileResponse("Birthday is required.");
  }

  if (profilePictureUrl === undefined) {
    return invalidProfileResponse("Profile picture must be a supported image.");
  }

  if (!avatar) {
    return invalidProfileResponse("Avatar customization is invalid.");
  }

  const emailChanged =
    email.toLocaleLowerCase() !== currentProfile.email.toLocaleLowerCase();
  let emailChangeAvailableAt = storedProfile.emailChangeAvailableAt || null;

  if (emailChanged) {
    const changeAvailableDate = emailChangeAvailableAt
      ? new Date(emailChangeAvailableAt)
      : null;

    if (
      changeAvailableDate &&
      !Number.isNaN(changeAvailableDate.getTime()) &&
      changeAvailableDate > new Date()
    ) {
      return jsonResponse(
        {
          emailChangeAvailableAt,
          error: "email_change_locked",
          message: "Email can only be changed once per month.",
        },
        { status: 429 },
      );
    }

    emailChangeAvailableAt = addOneMonth(new Date()).toISOString();
  }

  const keepsStoredImage =
    Boolean(storedProfile.imageFile) &&
    profilePictureUrl === storedProfile.profilePictureUrl;

  const nextProfile = {
    avatar,
    bio,
    birthday,
    email,
    emailChangeAvailableAt,
    gender,
    imageFile: keepsStoredImage ? storedProfile.imageFile : null,
    name,
    profilePictureUrl,
  };
  setStoredProfile(session, nextProfile);
  await saveDurableAccountData(session.user.id, "profile", nextProfile);

  if (enableParentSupervision) {
    updateDemoSettings(session, { parentSupervision: true });
  }

  if (!keepsStoredImage) {
    await removeImageFile(storedProfile.imageFile);
  }

  return jsonResponse(getProfile(session));
}
