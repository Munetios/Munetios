"use client";

import { useEffect, useRef, useState } from "react";

const avatarFonts = {
  cursive: "cursive",
  googleSansFlex: '"Google Sans Flex", system-ui, sans-serif',
  monospace: "ui-monospace, monospace",
  serif: "ui-serif, serif",
};

function getInitials(account) {
  const value =
    account?.avatar?.value ||
    account?.avatarLetter ||
    account?.name ||
    account?.displayName ||
    account?.email ||
    "M";
  const parts = String(value).trim().split(/\s+/u).filter(Boolean);
  const initials =
    parts.length > 1
      ? `${Array.from(parts[0])[0] || ""}${Array.from(parts.at(-1))[0] || ""}`
      : Array.from(parts[0] || "").slice(0, 2).join("");
  return initials.toLocaleUpperCase() || "M";
}

function withRetryToken(source, attempt) {
  if (!attempt || source.startsWith("data:") || source.startsWith("blob:")) {
    return source;
  }
  const separator = source.includes("?") ? "&" : "?";
  return `${source}${separator}avatarRetry=${attempt}`;
}

export default function AccountAvatar({
  account,
  alt = "",
  className = "h-10 w-10 rounded-full",
  fallbackClassName = "bg-purple-600! text-white",
  imageClassName = "object-cover",
}) {
  const source =
    account?.profilePictureUrl ||
    account?.avatarUrl ||
    account?.picture ||
    null;
  const [attempt, setAttempt] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const retryTimerRef = useRef(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry state must reset when the active account image changes.
  useEffect(() => {
    setAttempt(0);
    setImageFailed(false);
  }, [account?.avatarUrl, account?.picture, account?.profilePictureUrl]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
    };
  }, []);

  const retryImage = () => {
    if (attempt >= 4) {
      setImageFailed(true);
      return;
    }
    retryTimerRef.current = window.setTimeout(
      () => setAttempt((current) => current + 1),
      400 * (attempt + 1),
    );
  };

  if (source && !imageFailed) {
    return (
      // biome-ignore lint/performance/noImgElement: Authenticated profile image URLs require cookie-aware retries.
      <img
        alt={alt}
        className={`${className} ${imageClassName}`}
        key={`${source}:${attempt}`}
        onError={retryImage}
        referrerPolicy="no-referrer"
        src={withRetryToken(source, attempt)}
      />
    );
  }

  const avatar = account?.avatar;
  const value =
    avatar?.type === "emoji"
      ? avatar.value || "😊"
      : avatar?.value || getInitials(account);

  return (
    <span
      aria-label={alt}
      className={`inline-flex shrink-0 items-center justify-center font-bold ${className} ${fallbackClassName}`}
      role="img"
      style={{
        backgroundColor: avatar?.color || "#7c3aed",
        fontFamily: avatarFonts[avatar?.font] || avatarFonts.googleSansFlex,
      }}
    >
      {value}
    </span>
  );
}
