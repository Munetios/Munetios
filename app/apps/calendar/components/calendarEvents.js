"use client";

import Image from "next/image";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { openColorPickerModal } from "../../../components/colorPickerModal";
import DatePicker from "../../../components/datePicker";
import DropdownWrapper from "../../../components/dropdownwrapper";
import { LOCATION_DENIED_STACKING_LAYER } from "../../../components/layering";
import { showModal } from "../../../components/modal";
import TimePicker from "../../../components/timePicker";
import { showToast } from "../../../components/toast";
import { getCurrentLocale } from "../../../i18n";
import {
  formatUserDate,
  formatUserTime,
  getFormattingLocale,
  getTimeZone,
  getUserCountry,
  loadDateTimePreferences,
} from "../../../lib/dateTimePreferences";
import { hasSignedInCookie } from "../../../lib/signedInCookie";
import { shareEncryptedCalendarItem } from "../lib/calendarCollaboration";
import {
  calendarCountries,
  calendarSettingsChangeEvent,
  loadCalendarSettings,
} from "../lib/calendarSettings";
import { calendarOperation } from "../lib/calendarSync";
import {
  loadEncryptedCalendarData,
  saveEncryptedCalendarData,
} from "../lib/encryptedCalendarVault";

const CalendarEventsContext = createContext(null);
const defaultColor = "#a855f7";
const holidayColors = {
  bank: "#2563eb",
  observance: "#7c3aed",
  optional: "#d97706",
  public: "#dc2626",
  school: "#059669",
};

function formatBirthdayAge(age, locale) {
  const number = new Intl.NumberFormat(locale).format(age);
  if (!/^en(?:-|$)/i.test(locale)) return number;
  const remainder = age % 100;
  if (remainder >= 11 && remainder <= 13) return `${number}th`;
  if (age % 10 === 1) return `${number}st`;
  if (age % 10 === 2) return `${number}nd`;
  if (age % 10 === 3) return `${number}rd`;
  return `${number}th`;
}

function accountBirthdayEvent(person, date, copy, locale) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(person.birthday || "")) return null;
  if (person.birthday.slice(5) !== date.slice(5)) return null;
  const year = Number(date.slice(0, 4));
  const birthYear = Number(person.birthday.slice(0, 4));
  const age = year - birthYear;
  if (!Number.isInteger(age) || age < 0) return null;
  return {
    color: "#ec4899",
    date,
    description: "",
    favorite: false,
    id: `account-birthday-${person.accountId}-${year}`,
    name: copy.calendarBirthdayAge
      .replace("{name}", person.name)
      .replace("{age}", formatBirthdayAge(age, locale)),
    readOnly: true,
    time: "",
    type: "birthday",
  };
}

function createScheduledMeetingId() {
  const values = crypto.getRandomValues(new Uint32Array(1));
  return String(values[0] % 100_000_000).padStart(8, "0");
}

function scheduledMeetingLink(meetingId) {
  return `/apps/meet?room=${encodeURIComponent(meetingId)}&rejoin=1`;
}

function createEventFormattingDate(date, time = "00:00") {
  const [year, month, day] = String(date || "")
    .split("-")
    .map(Number);
  const [hour, minute] = String(time || "00:00")
    .split(":")
    .map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour || 0, minute || 0, 0, 0));
}

function getCurrentCalendarTime() {
  const preferences = loadDateTimePreferences();
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: getTimeZone(preferences),
  })
    .formatToParts(new Date())
    .reduce((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.hour || "00"}:${parts.minute || "00"}`;
}

function getCurrentCalendarDate() {
  const preferences = loadDateTimePreferences();
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: getTimeZone(preferences),
    year: "numeric",
  })
    .formatToParts(new Date())
    .reduce((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatEventDate(event, locale, preferences) {
  return formatUserDate(createEventFormattingDate(event.date, event.time), {
    dateStyle: "medium",
    locale,
    preferences,
    timeZone: "UTC",
  });
}

function formatEventTime(event, locale, preferences) {
  if (!event.time) return "";
  return formatUserTime(createEventFormattingDate(event.date, event.time), {
    locale,
    preferences,
    timeZone: "UTC",
  });
}

function escapePrintHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safePrintStyleValue(value, fallback) {
  const styleValue = String(value || "")
    .replace(/<\/style/giu, "")
    .trim();
  return styleValue && styleValue !== "transparent" ? styleValue : fallback;
}

function activeWorkspaceId() {
  return window.localStorage.getItem("munetiosActiveWorkspace") || "personal";
}

async function loadEncryptionType() {
  if (!hasSignedInCookie()) return "end_to_end";
  try {
    const response = await fetch("/api/account/data-controls", {
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) return "end_to_end";
    const payload = await response.json();
    return payload.settings?.encryptionType === "encrypted_at_rest"
      ? "managed"
      : "end_to_end";
  } catch {
    return "end_to_end";
  }
}

function ContextDropdown({ context, copy, favorite, onAction, onClose }) {
  return (
    <div
      className="calendar-context-anchor"
      style={{ left: context.x, top: context.y }}
    >
      <DropdownWrapper
        align="left"
        ariaLabel={copy.calendarToolbarCreateEvent}
        buttonClassName="calendar-context-trigger"
        defaultOpen
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        panelClassName="calendar-context-menu"
        trigger={<span />}
        triggerAs="button"
        triggerGlass={false}
      >
        {[
          ["create", "add", copy.calendarToolbarCreateEvent],
          ["share", "share", copy.calendarToolbarShare],
          ["print", "print", copy.calendarToolbarPrint],
          [
            "favorite",
            favorite ? "star" : "star_border",
            favorite ? copy.calendarUnfavorite : copy.calendarFavorite,
          ],
        ].map(([action, icon, label]) => (
          <button
            data-dropdown-close
            key={action}
            onClick={() => onAction(action)}
            type="button"
          >
            <icon>{icon}</icon>
            <span>{label}</span>
          </button>
        ))}
      </DropdownWrapper>
    </div>
  );
}

function plainDescription(value) {
  if (!value) return "";
  if (typeof document === "undefined") {
    return String(value)
      .replace(/<[^>]*>/gu, " ")
      .trim();
  }
  const container = document.createElement("div");
  container.innerHTML = String(value);
  return (container.innerText || container.textContent || "").trim();
}

function showLocationPermissionModal(copy) {
  showModal({
    ariaLabel: copy.calendarLocationPermissionTitle,
    closeOnBackdrop: false,
    content: (
      <div className="calendar-location-permission">
        <Image
          alt={copy.calendarLocationPermissionTitle}
          height={512}
          src="/calendar/location-permission-denied.png"
          width={512}
        />
        <ol>
          <li>{copy.aiLocationStepOne}</li>
          <li>{copy.aiLocationStepTwo}</li>
          <li>{copy.aiLocationStepThree}</li>
        </ol>
      </div>
    ),
    contentClassName: "calendar-location-permission-content",
    maxWidth: "min(34rem, calc(100vw - 2rem))",
    modalType: "calendar-location-denied",
    title: copy.calendarLocationPermissionTitle,
    zIndex: LOCATION_DENIED_STACKING_LAYER,
  });
}

function EventForm({
  close,
  copy,
  date,
  event = null,
  initialTime = "",
  onSaved = null,
  onSave,
  submitLabel = "",
  type = "event",
}) {
  const [color, setColor] = useState(event?.color || defaultColor);
  const [description, setDescription] = useState(
    event?.description || plainDescription(event?.descriptionHtml),
  );
  const [eventDate, setEventDate] = useState(event?.date || date);
  const [eventType, setEventType] = useState(event?.type || type);
  const [name, setName] = useState(event?.name || "");
  const [guestInput, setGuestInput] = useState("");
  const [guests, setGuests] = useState(
    Array.isArray(event?.guests) ? event.guests : [],
  );
  const [location, setLocation] = useState(event?.location || "");
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [time, setTime] = useState(
    () => event?.time || initialTime || getCurrentCalendarTime(),
  );
  const isBirthday = eventType === "birthday";
  const useCurrentLocation = () => {
    if (locating) return;
    if (!navigator.geolocation) {
      showToast({
        messageKey: "accountLanguageLocationFetchFailed",
        toastId: "calendar-location-unavailable",
        type: "error",
      });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation(
          `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`,
        );
        setLocating(false);
      },
      (error) => {
        setLocating(false);
        if (error.code === error.PERMISSION_DENIED) {
          showLocationPermissionModal(copy);
          return;
        }
        showToast({
          messageKey: "accountLanguageLocationFetchFailed",
          toastId: "calendar-location-unavailable",
          type: "error",
        });
      },
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 },
    );
  };
  const submit = async (formEvent) => {
    formEvent.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const meetingId =
        eventType === "meeting"
          ? event?.meetingId || createScheduledMeetingId()
          : "";
      const pendingGuest = guestInput.trim().toLocaleLowerCase();
      const nextGuests = /^\S+@\S+\.\S+$/u.test(pendingGuest)
        ? [...new Set([...guests, pendingGuest])]
        : guests;
      await onSave({
        ...event,
        color,
        date: eventDate,
        description: isBirthday ? "" : description.trim(),
        descriptionHtml: "",
        guests: isBirthday ? [] : nextGuests,
        location: isBirthday ? "" : location.trim(),
        meetingId,
        meetingLink: meetingId ? scheduledMeetingLink(meetingId) : "",
        name: name.trim(),
        time: isBirthday ? "" : time,
        type: eventType,
      });
      if (onSaved) await onSaved();
      else close();
    } catch {
      setSaving(false);
    }
  };
  return (
    <form className="calendar-event-form" onSubmit={submit}>
      <label>
        <span>{copy.calendarEventName}</span>
        <input
          maxLength={120}
          onChange={(item) => setName(item.target.value)}
          required
          value={name}
        />
      </label>
      {!isBirthday
        ? <>
            <label>
              <span>{copy.calendarEventDescription}</span>
              <textarea
                maxLength={40_000}
                onChange={(item) => setDescription(item.target.value)}
                rows={5}
                value={description}
              />
            </label>
            <label>
              <span>{copy.accountPrivacyLocation}</span>
              <div className="calendar-location-entry">
                <input
                  maxLength={240}
                  onChange={(item) => setLocation(item.target.value)}
                  value={location}
                />
                <button
                  className="liquid-glass"
                  disabled={locating}
                  onClick={useCurrentLocation}
                  type="button"
                >
                  <icon>{locating ? "progress_activity" : "my_location"}</icon>
                  <span>{copy.calendarUseCurrentLocation}</span>
                </button>
              </div>
            </label>
            <label>
              <span>{copy.calendarEventGuests}</span>
              <div className="calendar-guest-entry">
                <input
                  onChange={(item) => setGuestInput(item.target.value)}
                  placeholder={copy.authEmailAddress}
                  type="email"
                  value={guestInput}
                />
                <button
                  disabled={!/^\S+@\S+\.\S+$/u.test(guestInput.trim())}
                  onClick={() => {
                    const email = guestInput.trim().toLocaleLowerCase();
                    setGuests((current) => [...new Set([...current, email])]);
                    setGuestInput("");
                  }}
                  type="button"
                >
                  {copy.add}
                </button>
              </div>
            </label>
            {guests.length
              ? <div className="calendar-guest-list">
                  {guests.map((guest) => (
                    <span key={guest}>
                      {guest}
                      <button
                        aria-label={`${copy.remove}: ${guest}`}
                        onClick={() =>
                          setGuests((current) =>
                            current.filter((email) => email !== guest),
                          )
                        }
                        type="button"
                      >
                        <icon>close</icon>
                      </button>
                    </span>
                  ))}
                </div>
              : null}
          </>
        : null}
      <DatePicker
        copy={copy}
        label={copy.calendarDate}
        maximumYear={new Date().getFullYear() + 20}
        onChange={setEventDate}
        value={eventDate}
      />
      {!isBirthday
        ? <TimePicker
            copy={copy}
            label={copy.calendarTime}
            minuteStep={1}
            onChange={setTime}
            value={time}
          />
        : null}
      <button
        className="calendar-color-button liquid-glass"
        onClick={() =>
          openColorPickerModal({ copy, onSelect: setColor, value: color })
        }
        type="button"
      >
        <span style={{ backgroundColor: color }} />
        {copy.calendarEventColor}
      </button>
      {!isBirthday
        ? <fieldset className="calendar-event-type-picker">
            <legend>{copy.calendarEventType}</legend>
            <div>
              {[
                ["event", "event", copy.calendarEvent],
                ["appointment", "event_available", copy.calendarAppointment],
                ["meeting", "video_call", copy.calendarMeeting],
              ].map(([value, icon, label]) => (
                <button
                  aria-pressed={eventType === value}
                  key={value}
                  onClick={() => setEventType(value)}
                  type="button"
                >
                  <icon>{icon}</icon>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </fieldset>
        : null}
      <div className="calendar-event-form-actions">
        <button onClick={close} type="button">
          {copy.cancel}
        </button>
        <button disabled={!name.trim() || saving} type="submit">
          {saving ? `${copy.loading}...` : submitLabel || copy.calendarDone}
        </button>
      </div>
    </form>
  );
}

function SelectedDatesEventFlow({
  close,
  copy,
  dates,
  locale,
  onSave,
  preferences,
}) {
  const [index, setIndex] = useState(0);
  const date = dates[index];
  const isLast = index === dates.length - 1;
  return (
    <div className="calendar-selected-date-flow">
      <div className="calendar-selected-date-progress">
        <span>
          {formatUserDate(createEventFormattingDate(date), {
            dateStyle: "full",
            locale,
            preferences,
            timeZone: "UTC",
          })}
        </span>
        <strong>
          {index + 1}/{dates.length}
        </strong>
      </div>
      <EventForm
        close={close}
        copy={copy}
        date={date}
        key={date}
        onSave={onSave}
        onSaved={() => {
          if (isLast) close();
          else setIndex((current) => current + 1);
        }}
        submitLabel={isLast ? copy.calendarDone : copy.calendarNextSelectedDate}
      />
    </div>
  );
}

function ShareForm({ close, copy, event, onShare }) {
  const [error, setError] = useState("");
  const [recipient, setRecipient] = useState("");
  const [sharing, setSharing] = useState(false);
  return (
    <form
      className="calendar-share-form"
      onSubmit={async (submitEvent) => {
        submitEvent.preventDefault();
        if (!recipient.trim() || sharing) return;
        setError("");
        setSharing(true);
        try {
          await onShare(event, recipient.trim());
          close();
        } catch {
          setError(copy.calendarShareInviteFailed);
          setSharing(false);
        }
      }}
    >
      <label>
        <span>{copy.calendarShareWith}</span>
        <input
          onChange={(item) => setRecipient(item.target.value)}
          placeholder={copy.familyMemberEmail}
          required
          type="text"
          value={recipient}
        />
      </label>
      {error
        ? <p className="calendar-form-error" role="alert">
            {error}
          </p>
        : null}
      <div className="calendar-event-form-actions">
        <button disabled={sharing} onClick={close} type="button">
          {copy.cancel}
        </button>
        <button disabled={!recipient.trim() || sharing} type="submit">
          {sharing ? `${copy.loading}...` : copy.tasksSendShare}
        </button>
      </div>
    </form>
  );
}

function DeleteConfirmation({ close, copy, message, onConfirm }) {
  const [deleting, setDeleting] = useState(false);
  return (
    <div className="calendar-delete-confirmation">
      <p>{message}</p>
      <div className="calendar-event-form-actions">
        <button disabled={deleting} onClick={close} type="button">
          {copy.cancel}
        </button>
        <button
          disabled={deleting}
          onClick={async () => {
            setDeleting(true);
            try {
              await onConfirm();
              close();
            } catch {
              setDeleting(false);
            }
          }}
          type="button"
        >
          {deleting ? `${copy.loading}...` : copy.delete}
        </button>
      </div>
    </div>
  );
}

function EventDetails({
  copy,
  event,
  locale,
  onDelete,
  onEdit,
  onShare,
  onToggleFavorite,
  preferences,
}) {
  const [favorite, setFavorite] = useState(event.favorite === true);
  const formattedDate = formatEventDate(event, locale, preferences);
  const formattedTime = formatEventTime(event, locale, preferences);
  return (
    <article className="calendar-event-details">
      <span
        className="calendar-event-detail-color"
        style={{ backgroundColor: event.color }}
      />
      <h3>{event.name}</h3>
      {event.description || event.descriptionHtml
        ? <p className="calendar-event-description">
            {event.description || plainDescription(event.descriptionHtml)}
          </p>
        : null}
      {event.location
        ? <p className="calendar-event-kind">
            <icon>location_on</icon>
            <span>{event.location}</span>
          </p>
        : null}
      {event.guests?.length
        ? <div className="calendar-event-guests">
            <strong>{copy.calendarEventGuests}</strong>
            {event.guests.map((guest) => (
              <span key={guest}>{guest}</span>
            ))}
          </div>
        : null}
      <time dateTime={`${event.date}T${event.time || "00:00"}`}>
        {[formattedDate, formattedTime].filter(Boolean).join(" · ")}
      </time>
      {event.type === "holiday" || event.readOnly
        ? event.note
          ? <small>{event.note}</small>
          : null
        : <small>
            {event.encryptionType === "managed"
              ? copy.accountAdvancedPrivacyManagedEncryption
              : copy.accountAdvancedEndToEndEncrypted}
          </small>}
      {event.type === "appointment"
        ? <p className="calendar-event-kind">
            <icon>event_available</icon>
            <span>{copy.calendarAppointment}</span>
          </p>
        : null}
      {event.type === "meeting"
        ? <p className="calendar-event-kind">
            <icon>video_call</icon>
            <span>{copy.calendarMeeting}</span>
          </p>
        : null}
      {event.type === "meeting" && event.meetingLink
        ? <button
            className="calendar-meeting-join"
            onClick={() => window.location.assign(event.meetingLink)}
            type="button"
          >
            <icon>videocam</icon>
            {copy.meetJoinMeeting}
          </button>
        : null}
      {event.type === "holiday" || event.readOnly
        ? null
        : <div className="calendar-event-form-actions">
            <button
              onClick={() => {
                const next = !favorite;
                setFavorite(next);
                void onToggleFavorite({ ...event, favorite: next }).catch(() =>
                  setFavorite(!next),
                );
              }}
              type="button"
            >
              <icon>{favorite ? "star" : "star_border"}</icon>
              {favorite ? copy.calendarUnfavorite : copy.calendarFavorite}
            </button>
            <button onClick={() => onShare(event)} type="button">
              <icon>share</icon>
              {copy.calendarToolbarShare}
            </button>
            <button onClick={() => onEdit(event)} type="button">
              <icon>edit</icon>
              {copy.aiChatEdit}
            </button>
            <button onClick={() => onDelete(event)} type="button">
              <icon>delete</icon>
              {copy.delete}
            </button>
          </div>}
    </article>
  );
}

const eventStyles = `
  .calendar-loading-content { align-items:center; display:flex; justify-content:center; min-height:26rem; }
  .calendar-loading-content > span { animation:calendar-load-pulse 1s ease-in-out infinite alternate; color:#e9d5ff; }
  @keyframes calendar-load-pulse { from { opacity:.4; } to { opacity:1; } }
  .calendar-month-day { position:relative; }
  .calendar-month-day.is-selected { background:rgb(126 34 206 / .32); box-shadow:inset 0 0 0 1px rgb(216 180 254 / .5); }
  .calendar-day-hit { background:transparent; border:0; inset:0; position:absolute; width:100%; z-index:0; }
  .calendar-date-favorite { color:#facc15; font-size:14px; inset-inline-end:7px; position:absolute; top:7px; z-index:1; }
  .calendar-day-events { display:grid; gap:3px; margin-top:1.65rem; position:relative; z-index:1; }
  .calendar-event-chip { align-items:center; background:rgb(17 9 35 / .01); border:1px solid rgb(255 255 255 / .1); border-radius:7px; color:white; display:flex; font-size:.72rem; gap:5px; max-width:100%; overflow:hidden; padding:3px 5px; text-align:left; }
  .calendar-event-chip > i { border-radius:999px; height:7px; width:7px; }
  .calendar-event-chip > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .calendar-quick-create.liquid-glass { backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px); background:rgb(45 16 75 / .5); border:1px solid rgb(255 255 255 / .14); border-radius:16px; box-shadow:0 18px 55px rgb(0 0 0 / .35); display:grid; gap:12px; max-height:calc(100vh - 16px); max-width:calc(100vw + 16px); overflow:auto; padding:16px; position:fixed; width:428px; z-index:100000002; }
  .calendar-quick-create input,.calendar-event-form input,.calendar-event-form textarea,.calendar-share-form input { background:rgb(255 255 255 / .08); border:1px solid rgb(255 255 255 / .12); border-radius:12px; color:white; padding:11px 12px; width:100%; }
  .calendar-quick-actions,.calendar-event-form-actions { display:flex; gap:8px; justify-content:flex-end; }
  .calendar-quick-actions button,.calendar-event-form-actions button,.calendar-color-button { border:1px solid rgb(255 255 255 / .12); border-radius:11px; padding:8px 12px; display: flex; align-items: center; gap:9px; }
  .calendar-event-form,.calendar-share-form { display:grid; gap:14px; }
  .calendar-event-form label,.calendar-share-form label { display:grid; gap:7px; }
  .calendar-description-link-row,.calendar-guest-entry,.calendar-location-entry { display:grid; gap:7px; grid-template-columns:minmax(0,1fr) auto; }
  .calendar-description-link-row button,.calendar-guest-entry button,.calendar-location-entry button { border:1px solid rgb(255 255 255 / .12); border-radius:11px; padding:8px 12px; }
  .calendar-location-entry button { align-items:center; backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px); display:inline-flex; gap:7px; white-space:nowrap; }
  .calendar-location-entry button icon { font-size:1.15rem; }
  .calendar-location-entry button:disabled icon { animation:calendar-location-spin .8s linear infinite; }
  .calendar-location-permission { display:grid; gap:1rem; font-family:var(--app-font); }
  .calendar-location-permission img { height:auto; margin:auto; max-height:min(17rem,42dvh); object-fit:contain; width:min(100%,18rem); }
  .calendar-location-permission ol { display:grid; gap:.65rem; margin:0; padding-inline-start:1.4rem; }
  @keyframes calendar-location-spin { to { transform:rotate(360deg) !important; } }
  .calendar-guest-list { display:flex; flex-wrap:wrap; gap:6px; }
  .calendar-guest-list > span { align-items:center; background:rgb(126 34 206 / .24); border:1px solid rgb(216 180 254 / .2); border-radius:999px; display:inline-flex; font-size:.78rem; gap:5px; padding:5px 7px 5px 10px; }
  .calendar-guest-list button { align-items:center; border:0; display:inline-flex; justify-content:center; padding:0; }
  .calendar-event-description { line-height:1.55; margin:0; overflow-wrap:anywhere; white-space:pre-wrap; }
  .calendar-selected-date-flow { display:grid; gap:14px; }
  .calendar-selected-date-progress { align-items:center; background:rgb(126 34 206 / .22); border:1px solid rgb(216 180 254 / .36); border-radius:12px; display:flex; gap:12px; justify-content:space-between; padding:10px 12px; }
  .calendar-event-guests { display:flex; flex-wrap:wrap; gap:6px; }
  .calendar-event-guests strong { flex-basis:100%; }
  .calendar-event-guests span { background:rgb(126 34 206 / .2); border-radius:999px; font-size:.78rem; padding:5px 9px; }
  .calendar-time-picker > legend { margin-bottom:7px; }
  .calendar-time-picker > div { align-items:center; display:flex; gap:7px; }
  .calendar-color-button { align-items:center; display:flex; gap:9px; justify-content:flex-start; }
  .calendar-color-button > span,.calendar-event-detail-color { border-radius:999px; height:16px; width:16px; }
  .calendar-event-type-picker { border:0; margin:0; padding:0; }
  .calendar-event-type-picker > legend { margin-bottom:7px; }
  .calendar-event-type-picker > div { display:grid; gap:8px; grid-template-columns:repeat(3,minmax(0,1fr)); }
  .calendar-event-type-picker button { align-items:center; border:1px solid rgb(255 255 255 / .12); border-radius:11px; display:flex; gap:7px; justify-content:center; padding:9px 10px; }
  .calendar-event-type-picker button span {  white-space:nowrap; text-overflow:ellipsis; overflow:hidden; max-width:100%; width:100%; }
  .calendar-event-type-picker button[aria-pressed="true"] { background:rgb(126 34 206 / .55); border-color:rgb(216 180 254 / .42); }
  .calendar-context-anchor { height:1px; position:fixed; width:1px; z-index:100000001; }
  .calendar-context-anchor .calendar-context-trigger { height:1px; opacity:0; padding:0; width:1px; }
  .calendar-context-menu button { color:white; }
  .calendar-search-results { backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px); background:rgb(45 16 75 / .92); border:1px solid rgb(255 255 255 / .14); border-radius:16px; left:50%; max-height:min(28rem,70vh); overflow:auto; padding:8px; position:fixed; top:76px; transform:translateX(-50%) !important; width:min(42rem,calc(100vw - 16px)); z-index:100000002; }
  .calendar-search-results button { align-items:center; border-radius:11px; display:flex; gap:9px; padding:10px; text-align:left; width:100%; }
  .calendar-search-results button > i,.calendar-event-list button > i { background:currentColor; border-radius:999px; flex:0 0 auto; height:9px; width:9px; }
  .calendar-event-list { display:grid; gap:7px; }
  .calendar-event-list button { align-items:center; background:rgb(255 255 255 / .06); border:1px solid rgb(255 255 255 / .1); border-radius:12px; color:white; display:grid; gap:8px; grid-template-columns:auto 1fr auto; padding:11px; text-align:left; width:100%; }
  .calendar-event-list time { color:rgb(233 213 255 / .72); font-size:.8rem; }
  .calendar-event-details { display:grid; gap:12px; }
  .calendar-event-details h3 { font-size:1.2rem; }
  .calendar-event-details small { color:rgb(233 213 255 / .72); }
  .calendar-event-kind { align-items:center; color:#d8b4fe; display:flex; font-size:.82rem; gap:7px; margin:0; }
  .calendar-meeting-join { align-items:center; align-self:start; background:#7e22ce; border:1px solid rgb(216 180 254 / .36); border-radius:11px; color:white; display:inline-flex; gap:8px; justify-content:center; padding:9px 13px; width:max-content; }
  .calendar-form-error { color:#fecdd3; font-size:.82rem; margin:0; }
  .calendar-delete-confirmation { display:grid; gap:16px; }
`;

export function CalendarEventsProvider({ children, copy }) {
  const [calendarData, setCalendarData] = useState(null);
  const [context, setContext] = useState(null);
  const [datePreferences, setDatePreferences] = useState(() =>
    loadDateTimePreferences(),
  );
  const [holidayLocation, setHolidayLocation] = useState({
    country: "US",
    region: "",
  });
  const [holidayLocale, setHolidayLocale] = useState("en");
  const [holidaysByDate, setHolidaysByDate] = useState({});
  const [calendarSettings, setCalendarSettings] = useState(() =>
    loadCalendarSettings(),
  );
  const [familyBirthdays, setFamilyBirthdays] = useState([]);
  const [holidayYears, setHolidayYears] = useState(() => [
    new Date().getFullYear(),
  ]);
  const [loading, setLoading] = useState(true);
  const [quickCreate, setQuickCreate] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDates, setSelectedDates] = useState([]);
  const [workspaceId, setWorkspaceId] = useState("personal");
  const familyShareSignatureRef = useRef("");
  const hasLoadedCalendarRef = useRef(false);

  useEffect(() => {
    const changeSelectionMode = (event) => {
      const active = event.detail?.active === true;
      setSelectionMode(active);
      setQuickCreate(null);
      if (!active) setSelectedDates([]);
    };
    window.addEventListener(
      "munetios:calendarselectmodechange",
      changeSelectionMode,
    );
    return () =>
      window.removeEventListener(
        "munetios:calendarselectmodechange",
        changeSelectionMode,
      );
  }, []);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("munetios:calendarselectionchange", {
        detail: { active: selectionMode, dates: selectedDates },
      }),
    );
  }, [selectedDates, selectionMode]);

  useEffect(() => {
    const refresh = (event) =>
      setCalendarSettings(event?.detail || loadCalendarSettings());
    window.addEventListener(calendarSettingsChangeEvent, refresh);
    return () =>
      window.removeEventListener(calendarSettingsChangeEvent, refresh);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const loadFamilyBirthdays = async () => {
      if (!hasSignedInCookie()) {
        setFamilyBirthdays([]);
        return;
      }
      try {
        const [accountResponse, familyResponse] = await Promise.all([
          fetch("/api/account", {
            cache: "no-store",
            credentials: "include",
            signal: controller.signal,
          }),
          fetch("/api/account/family", {
            cache: "no-store",
            credentials: "include",
            signal: controller.signal,
          }),
        ]);
        if (!accountResponse.ok || !familyResponse.ok) return;
        const account = await accountResponse.json();
        const family = await familyResponse.json();
        const people = [
          family.owner,
          ...(Array.isArray(family.members) ? family.members : []),
          {
            accountId: account.id,
            birthday: account.birthday || account.birthDate || "",
            email: account.email || "",
            name: account.name || account.email || "",
            self: true,
          },
        ].filter(Boolean);
        const uniquePeople = [
          ...new Map(
            people
              .filter((person) => person.accountId && person.name)
              .map((person) => [person.accountId, person]),
          ).values(),
        ];
        setFamilyBirthdays(uniquePeople);
      } catch (error) {
        if (error?.name !== "AbortError") setFamilyBirthdays([]);
      }
    };
    void loadFamilyBirthdays();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const detectLocation = async () => {
      const preferences = loadDateTimePreferences();
      const selectedCountry = getUserCountry(preferences);
      if (preferences.country !== "auto") {
        setHolidayLocation({ country: selectedCountry, region: "" });
        return;
      }
      try {
        const response = await fetch("/api/country", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("country_load_failed");
        const payload = await response.json();
        setHolidayLocation({
          country: payload.detectedCountry || selectedCountry,
          region: payload.detectedRegion || "",
        });
      } catch (error) {
        if (error?.name !== "AbortError") {
          setHolidayLocation({ country: selectedCountry, region: "" });
        }
      }
    };
    const refreshLocation = () => {
      setDatePreferences(loadDateTimePreferences());
      void detectLocation();
    };
    const refreshLocale = () => {
      const preferences = loadDateTimePreferences();
      setHolidayLocale(getFormattingLocale(getCurrentLocale(), preferences));
    };
    refreshLocale();
    setDatePreferences(loadDateTimePreferences());
    void detectLocation();
    window.addEventListener("munetios:language-time-change", refreshLocation);
    window.addEventListener("munetios:languagechange", refreshLocale);
    window.addEventListener("munetios:localechange", refreshLocale);
    return () => {
      controller.abort();
      window.removeEventListener(
        "munetios:language-time-change",
        refreshLocation,
      );
      window.removeEventListener("munetios:languagechange", refreshLocale);
      window.removeEventListener("munetios:localechange", refreshLocale);
    };
  }, []);

  useEffect(() => {
    const syncYears = (event) => {
      const year = Number(event.detail?.year);
      if (!Number.isInteger(year)) return;
      setHolidayYears((current) => [
        ...new Set([...current, year - 1, year, year + 1]),
      ]);
    };
    window.addEventListener("munetios:calendarperiodchange", syncYears);
    return () =>
      window.removeEventListener("munetios:calendarperiodchange", syncYears);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const loadHolidays = async () => {
      const selectedCountries = calendarSettings.allHolidayCountries
        ? calendarCountries.map(([country]) => country)
        : calendarSettings.holidayCountries.length
          ? calendarSettings.holidayCountries
          : [holidayLocation.country];
      const yearlyResults = await Promise.all(
        selectedCountries.flatMap((country) =>
          holidayYears.map(async (year) => {
            const query = new URLSearchParams({
              country,
              locale: holidayLocale,
              year: String(year),
            });
            if (country === holidayLocation.country && holidayLocation.region) {
              query.set("region", holidayLocation.region);
            }
            try {
              const response = await fetch(`/api/calendar/holidays?${query}`, {
                cache: "no-store",
                signal: controller.signal,
              });
              if (!response.ok) return [];
              const payload = await response.json();
              return Array.isArray(payload.holidays)
                ? payload.holidays.map((holiday) => ({ ...holiday, country }))
                : [];
            } catch {
              return [];
            }
          }),
        ),
      );
      if (controller.signal.aborted) return;
      const grouped = {};
      for (const holiday of yearlyResults.flat()) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday.date || "")) continue;
        const entry = {
          ...holiday,
          color: holidayColors[holiday.type] || holidayColors.observance,
          id: `holiday-${holiday.country || "country"}-${holiday.date}-${holiday.name}-${holiday.type}`,
          type: "holiday",
        };
        grouped[holiday.date] = [...(grouped[holiday.date] || []), entry];
      }
      setHolidaysByDate(grouped);
    };
    void loadHolidays();
    return () => controller.abort();
  }, [calendarSettings, holidayLocale, holidayLocation, holidayYears]);

  const load = useCallback(
    async ({ background = false } = {}) => {
      if (!background && !hasLoadedCalendarRef.current) setLoading(true);
      const nextWorkspaceId = activeWorkspaceId();
      const signedIn = hasSignedInCookie();
      const nextData = await loadEncryptedCalendarData(signedIn, {
        sharedCalendarName: copy.calendarSharedCalendar,
        workspaceId: nextWorkspaceId,
      });
      if (signedIn) {
        const checks = await Promise.allSettled([
          calendarOperation("load/events"),
          calendarOperation("load/favorites"),
        ]);
        if (nextData.syncError || checks[0].status === "rejected") {
          showToast({
            messageKey: "calendarLoadEventsFailed",
            toastId: "calendar-load-events-failed",
            type: "error",
          });
        }
        if (nextData.syncError || checks[1].status === "rejected") {
          showToast({
            messageKey: "calendarLoadFavoritesFailed",
            toastId: "calendar-load-favorites-failed",
            type: "error",
          });
        }
      }
      setWorkspaceId(nextWorkspaceId);
      setCalendarData(nextData);
      hasLoadedCalendarRef.current = true;
      setLoading(false);
    },
    [copy.calendarSharedCalendar],
  );

  useEffect(() => {
    void load();
    const refreshWorkspace = () => void load();
    const refreshVault = () => void load({ background: true });
    const syncFilters = (event) => {
      const detail = event.detail || {};
      setWorkspaceId(detail.workspaceId || activeWorkspaceId());
      setCalendarData((current) =>
        current
          ? {
              ...current,
              activeCalendarId:
                detail.activeCalendarId || current.activeCalendarId,
              showHolidays: detail.showHolidays !== false,
            }
          : current,
      );
    };
    window.addEventListener("munetios:workspacechange", refreshWorkspace);
    window.addEventListener("munetios:calendarvaultchange", refreshVault);
    window.addEventListener("munetios:calendarfilterschange", syncFilters);
    return () => {
      window.removeEventListener("munetios:workspacechange", refreshWorkspace);
      window.removeEventListener("munetios:calendarvaultchange", refreshVault);
      window.removeEventListener("munetios:calendarfilterschange", syncFilters);
    };
  }, [load]);

  const workspaceCalendars = useMemo(
    () =>
      (calendarData?.calendars || []).filter(
        (calendar) => calendar.workspaceId === workspaceId,
      ),
    [calendarData, workspaceId],
  );
  const activeCalendar =
    workspaceCalendars.find(
      (calendar) => calendar.id === calendarData?.activeCalendarId,
    ) || workspaceCalendars[0];
  const events = useMemo(() => activeCalendar?.events || [], [activeCalendar]);
  const workspaceEvents = useMemo(
    () =>
      workspaceCalendars.flatMap((calendar) =>
        (calendar.events || []).map((event) => ({
          ...event,
          calendarId: calendar.id,
        })),
      ),
    [workspaceCalendars],
  );
  const favoriteDates = useMemo(
    () => activeCalendar?.favoriteDates || [],
    [activeCalendar],
  );

  useEffect(() => {
    if (!hasSignedInCookie() || !workspaceCalendars.length) return;
    const recipients = familyBirthdays.filter(
      (person) => !person.self && person.email,
    );
    const ownedCalendars = workspaceCalendars.filter(
      (calendar) => !calendar.shared,
    );
    if (!recipients.length || !ownedCalendars.length) return;
    const signature = JSON.stringify({
      calendars: ownedCalendars.map((calendar) => [
        calendar.id,
        calendar.updatedAt,
      ]),
      recipients: recipients.map((person) => person.accountId).sort(),
    });
    if (familyShareSignatureRef.current === signature) return;
    familyShareSignatureRef.current = signature;
    void Promise.all(
      recipients.flatMap((person) =>
        ownedCalendars.map((calendar) =>
          shareEncryptedCalendarItem({
            email: person.email,
            item: calendar,
            itemType: "calendar",
          }),
        ),
      ),
    ).catch(() => {
      familyShareSignatureRef.current = "";
      showToast({
        messageKey: "calendarShareInviteFailed",
        toastId: "calendar-family-share-failed",
        type: "error",
      });
    });
  }, [familyBirthdays, workspaceCalendars]);

  const persistCalendars = useCallback(
    async (nextCalendars, activeId = calendarData?.activeCalendarId) => {
      if (!calendarData) return;
      const saved = await saveEncryptedCalendarData(
        {
          ...calendarData,
          activeCalendarId: activeId,
          calendars: nextCalendars,
        },
        hasSignedInCookie(),
      );
      setCalendarData(saved);
      window.dispatchEvent(new Event("munetios:calendarvaultchange"));
    },
    [calendarData],
  );

  const saveEvent = useCallback(
    async (draft, { validateOperation = true } = {}) => {
      if (!activeCalendar) return;
      const updating = Boolean(draft.id);
      if (validateOperation) {
        try {
          await calendarOperation(updating ? "update/event" : "create/event", {
            method: "POST",
          });
        } catch (error) {
          showToast({
            messageKey: updating
              ? "calendarUpdateEventFailed"
              : "calendarCreateEventFailed",
            toastId: updating
              ? "calendar-update-event-failed"
              : "calendar-create-event-failed",
            type: "error",
          });
          throw error;
        }
      }
      const now = new Date().toISOString();
      const encryptionType =
        draft.encryptionType || (await loadEncryptionType());
      const guests = Array.isArray(draft.guests)
        ? [
            ...new Set(
              draft.guests
                .map((guest) => String(guest).trim().toLowerCase())
                .filter(Boolean),
            ),
          ]
        : [];
      const nextEvent = {
        createdAt: draft.createdAt || now,
        favorite: draft.favorite === true,
        guests,
        id: draft.id || crypto.randomUUID(),
        sharedWith: [
          ...new Set([
            ...(Array.isArray(draft.sharedWith) ? draft.sharedWith : []),
            ...(hasSignedInCookie() ? guests : []),
          ]),
        ],
        updatedAt: now,
        workspaceId,
        ...draft,
        encryptionType,
      };
      const nextCalendars = calendarData.calendars.map((calendar) =>
        calendar.id === activeCalendar.id
          ? {
              ...calendar,
              events: [
                ...(calendar.events || []).filter(
                  (item) => item.id !== nextEvent.id,
                ),
                nextEvent,
              ],
              updatedAt: now,
            }
          : calendar,
      );
      try {
        await persistCalendars(nextCalendars, activeCalendar.id);
      } catch (error) {
        showToast({
          messageKey: updating
            ? "calendarUpdateEventFailed"
            : "calendarCreateEventFailed",
          toastId: updating
            ? "calendar-update-event-sync-failed"
            : "calendar-create-event-sync-failed",
          type: "error",
        });
        throw error;
      }
      if (hasSignedInCookie() && guests.length) {
        try {
          await Promise.all(
            guests.map((email) =>
              shareEncryptedCalendarItem({
                email,
                item: nextEvent,
                itemType: "event",
              }),
            ),
          );
        } catch {
          showToast({
            messageKey: "calendarShareInviteFailed",
            toastId: "calendar-guest-invite-failed",
            type: "error",
          });
        }
      }
      setQuickCreate(null);
    },
    [activeCalendar, calendarData, persistCalendars, workspaceId],
  );

  const openEventModal = useCallback(
    (date, event = null, type = "event") =>
      showModal(
        ({ close }) => (
          <EventForm
            close={close}
            copy={copy}
            date={date}
            event={event}
            onSave={saveEvent}
            type={type}
          />
        ),
        {
          ariaLabel:
            type === "birthday"
              ? copy.calendarAddBirthday
              : event
                ? copy.calendarEditEvent
                : copy.calendarToolbarCreateEvent,
          title:
            type === "birthday"
              ? copy.calendarAddBirthday
              : event
                ? copy.calendarEditEvent
                : copy.calendarToolbarCreateEvent,
          width: "min(38rem, calc(100vw - 1rem))",
        },
      ),
    [copy, saveEvent],
  );

  const openShare = useCallback(
    (event, { itemType = "event", persist = true } = {}) => {
      if (!hasSignedInCookie()) {
        showToast({
          messageKey: "calendarSignInToShare",
          toastId: "calendar-sign-in-to-share",
          type: "warning",
        });
        return;
      }
      return showModal(
        ({ close }) => (
          <ShareForm
            close={close}
            copy={copy}
            event={event}
            onShare={async (sharedEvent, recipient) => {
              if (!sharedEvent) return;
              try {
                await calendarOperation("share/invite", { method: "POST" });
                await shareEncryptedCalendarItem({
                  email: recipient,
                  item: sharedEvent,
                  itemType,
                });
                if (persist && itemType === "event") {
                  await saveEvent(
                    {
                      ...sharedEvent,
                      sharedWith: [
                        ...new Set([
                          ...(sharedEvent.sharedWith || []),
                          recipient,
                        ]),
                      ],
                    },
                    { validateOperation: false },
                  );
                }
              } catch (error) {
                showToast({
                  messageKey: "calendarShareInviteFailed",
                  toastId: "calendar-share-invite-failed",
                  type: "error",
                });
                throw error;
              }
            }}
          />
        ),
        {
          ariaLabel: copy.calendarToolbarShare,
          title: copy.calendarToolbarShare,
          width: "min(30rem, calc(100vw - 1rem))",
        },
      );
    },
    [copy, saveEvent],
  );

  const toggleFavorite = useCallback(
    async (event) => {
      try {
        await calendarOperation("update/favorites", { method: "POST" });
        await saveEvent(event, { validateOperation: false });
      } catch {
        showToast({
          messageKey: "calendarUpdateFavoritesFailed",
          toastId: "calendar-update-favorites-failed",
          type: "error",
        });
        return;
      }
    },
    [saveEvent],
  );

  const deleteEvent = useCallback(
    async (event) => {
      if (!activeCalendar || !calendarData) return;
      try {
        await calendarOperation("delete/event", { method: "POST" });
      } catch (error) {
        showToast({
          messageKey: "calendarDeleteEventFailed",
          toastId: "calendar-delete-event-failed",
          type: "error",
        });
        throw error;
      }
      const now = new Date().toISOString();
      const nextCalendars = calendarData.calendars.map((calendar) =>
        calendar.id === activeCalendar.id
          ? {
              ...calendar,
              events: (calendar.events || []).filter(
                (item) => item.id !== event.id,
              ),
              updatedAt: now,
            }
          : calendar,
      );
      try {
        await persistCalendars(nextCalendars, activeCalendar.id);
      } catch (error) {
        showToast({
          messageKey: "calendarDeleteEventFailed",
          toastId: "calendar-delete-event-sync-failed",
          type: "error",
        });
        throw error;
      }
    },
    [activeCalendar, calendarData, persistCalendars],
  );

  const isFavoriteDate = useCallback(
    (date) => favoriteDates.includes(date),
    [favoriteDates],
  );

  const toggleFavoriteDate = useCallback(
    async (date) => {
      if (!activeCalendar || !calendarData) return;
      try {
        await calendarOperation("update/favorites", { method: "POST" });
      } catch {
        showToast({
          messageKey: "calendarUpdateFavoritesFailed",
          toastId: "calendar-update-favorite-date-failed",
          type: "error",
        });
        return;
      }
      const nextFavoriteDates = isFavoriteDate(date)
        ? favoriteDates.filter((favoriteDate) => favoriteDate !== date)
        : [...favoriteDates, date];
      const now = new Date().toISOString();
      const nextCalendars = calendarData.calendars.map((calendar) =>
        calendar.id === activeCalendar.id
          ? {
              ...calendar,
              favoriteDates: nextFavoriteDates,
              updatedAt: now,
            }
          : calendar,
      );
      try {
        await persistCalendars(nextCalendars, activeCalendar.id);
      } catch {
        showToast({
          messageKey: "calendarUpdateFavoritesFailed",
          toastId: "calendar-update-favorite-date-sync-failed",
          type: "error",
        });
        return;
      }
    },
    [
      activeCalendar,
      calendarData,
      favoriteDates,
      isFavoriteDate,
      persistCalendars,
    ],
  );

  const openDetails = useCallback(
    (event) =>
      showModal(
        ({ close }) => (
          <EventDetails
            copy={copy}
            event={event}
            locale={holidayLocale}
            onDelete={(selectedEvent) =>
              showModal(
                ({ close: closeConfirmation }) => (
                  <DeleteConfirmation
                    close={closeConfirmation}
                    copy={copy}
                    message={copy.calendarDeleteEventWarning.replace(
                      "{name}",
                      selectedEvent.name,
                    )}
                    onConfirm={async () => {
                      await deleteEvent(selectedEvent);
                      close();
                    }}
                  />
                ),
                {
                  ariaLabel: copy.calendarDeleteEvent,
                  title: copy.calendarDeleteEvent,
                  width: "min(30rem, calc(100vw - 1rem))",
                },
              )
            }
            onEdit={(selectedEvent) => {
              close();
              openEventModal(
                selectedEvent.date,
                selectedEvent,
                selectedEvent.type,
              );
            }}
            onShare={openShare}
            onToggleFavorite={toggleFavorite}
            preferences={datePreferences}
          />
        ),
        {
          ariaLabel: copy.calendarViewEvent,
          title: copy.calendarViewEvent,
          width: "min(34rem, calc(100vw - 1rem))",
        },
      ),
    [
      copy,
      datePreferences,
      deleteEvent,
      holidayLocale,
      openEventModal,
      openShare,
      toggleFavorite,
    ],
  );

  const openListModal = useCallback(
    (title, listedEvents) =>
      showModal(
        <div className="calendar-event-list">
          {listedEvents.length
            ? listedEvents.map((event) => (
                <button
                  key={event.id}
                  onClick={() => openDetails(event)}
                  type="button"
                >
                  <i style={{ backgroundColor: event.color }} />
                  <span>{event.name}</span>
                  <time dateTime={event.date}>
                    {formatEventDate(event, holidayLocale, datePreferences)}
                  </time>
                </button>
              ))
            : <p>{copy.calendarContentNoEvents}</p>}
        </div>,
        { ariaLabel: title, title, width: "min(38rem, calc(100vw - 1rem))" },
      ),
    [copy.calendarContentNoEvents, datePreferences, holidayLocale, openDetails],
  );

  const openFavoritesModal = useCallback(
    () =>
      showModal(
        ({ close }) => (
          <div className="calendar-event-list">
            {favoriteDates.map((date) => (
              <button
                key={`date-${date}`}
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("munetios:calendardatechange", {
                      detail: `${date}T12:00:00`,
                    }),
                  );
                  close();
                }}
                type="button"
              >
                <icon>star</icon>
                <span>{copy.calendarFavoriteDate}</span>
                <time dateTime={date}>
                  {formatUserDate(createEventFormattingDate(date), {
                    dateStyle: "medium",
                    locale: holidayLocale,
                    preferences: datePreferences,
                    timeZone: "UTC",
                  })}
                </time>
              </button>
            ))}
            {events
              .filter((event) => event.favorite)
              .map((event) => (
                <button
                  key={event.id}
                  onClick={() => openDetails(event)}
                  type="button"
                >
                  <i style={{ backgroundColor: event.color }} />
                  <span>{event.name}</span>
                  <time dateTime={event.date}>
                    {formatEventDate(event, holidayLocale, datePreferences)}
                  </time>
                </button>
              ))}
            {!favoriteDates.length && !events.some((event) => event.favorite)
              ? <p>{copy.calendarContentNoEvents}</p>
              : null}
          </div>
        ),
        {
          ariaLabel: copy.tasksFavorites,
          title: copy.tasksFavorites,
          width: "min(38rem, calc(100vw - 1rem))",
        },
      ),
    [copy, datePreferences, events, favoriteDates, holidayLocale, openDetails],
  );

  useEffect(() => {
    const search = (event) => setSearchQuery(String(event.detail || "").trim());
    const favorites = () => openFavoritesModal();
    const allEvents = () => openListModal(copy.calendarEvents, events);
    const addBirthday = () =>
      openEventModal(new Date().toISOString().slice(0, 10), null, "birthday");
    window.addEventListener("munetios:calendarsearch", search);
    window.addEventListener("munetios:calendarfavorites", favorites);
    window.addEventListener("munetios:calendarevents", allEvents);
    window.addEventListener("munetios:calendaraddbirthday", addBirthday);
    return () => {
      window.removeEventListener("munetios:calendarsearch", search);
      window.removeEventListener("munetios:calendarfavorites", favorites);
      window.removeEventListener("munetios:calendarevents", allEvents);
      window.removeEventListener("munetios:calendaraddbirthday", addBirthday);
    };
  }, [copy, events, openEventModal, openFavoritesModal, openListModal]);

  const onDayClick = useCallback(
    (date, rect, time = "") => {
      setContext(null);
      if (selectionMode) {
        setQuickCreate(null);
        setSelectedDates((current) =>
          current.includes(date)
            ? current.filter((selectedDate) => selectedDate !== date)
            : [...current, date].sort(),
        );
        return;
      }
      setQuickCreate({
        date,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 436)),
        time,
        top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 560)),
      });
    },
    [selectionMode],
  );
  const onDayContext = useCallback((date, x, y) => {
    setQuickCreate(null);
    setContext({
      date,
      id: crypto.randomUUID(),
      x: Math.max(8, Math.min(x, window.innerWidth - 224)),
      y: Math.max(8, Math.min(y, window.innerHeight - 224)),
    });
  }, []);
  const collectEventsForDate = useCallback(
    (sourceEvents, date) => {
      const regular = sourceEvents.filter((event) => event.date === date);
      const birthdayMatches = sourceEvents.filter(
        (event) =>
          event.type === "birthday" && event.date?.slice(5) === date.slice(5),
      );
      const accountBirthdays = familyBirthdays
        .map((person) =>
          accountBirthdayEvent(person, date, copy, holidayLocale),
        )
        .filter(Boolean);
      const holidays = calendarData?.showHolidays
        ? holidaysByDate[date] || []
        : [];
      return [
        ...regular,
        ...birthdayMatches.filter((event) => event.date !== date),
        ...accountBirthdays,
        ...holidays,
      ];
    },
    [
      calendarData?.showHolidays,
      copy,
      familyBirthdays,
      holidayLocale,
      holidaysByDate,
    ],
  );
  const eventsForDate = useCallback(
    (date) => collectEventsForDate(events, date),
    [collectEventsForDate, events],
  );
  const listEventsForDate = useCallback(
    (date) => collectEventsForDate(workspaceEvents, date),
    [collectEventsForDate, workspaceEvents],
  );

  const openSelectedEventFlow = useCallback(
    (dates) => {
      const nextDates = [...new Set(dates)].sort();
      if (!nextDates.length) {
        openEventModal(getCurrentCalendarDate());
        return;
      }
      showModal(
        ({ close }) => (
          <SelectedDatesEventFlow
            close={close}
            copy={copy}
            dates={nextDates}
            locale={holidayLocale}
            onSave={saveEvent}
            preferences={datePreferences}
          />
        ),
        {
          ariaLabel: copy.calendarToolbarCreateEvent,
          title: copy.calendarToolbarCreateEvent,
          width: "min(38rem, calc(100vw - 1rem))",
        },
      );
    },
    [copy, datePreferences, holidayLocale, openEventModal, saveEvent],
  );

  const shareSelectedDates = useCallback(
    (dates) => {
      const nextDates = [...new Set(dates)].sort();
      if (!nextDates.length) return;
      const now = new Date().toISOString();
      const sharedEvents = nextDates.flatMap((date) => {
        const matchingEvents = eventsForDate(date).filter(
          (event) => event.type !== "holiday" && !event.readOnly,
        );
        if (matchingEvents.length) {
          return matchingEvents.map((event) => ({
            ...event,
            date,
            id: crypto.randomUUID(),
            readOnly: false,
            sharedWith: [],
          }));
        }
        return [
          {
            color: defaultColor,
            date,
            description: "",
            id: crypto.randomUUID(),
            name: formatUserDate(createEventFormattingDate(date), {
              dateStyle: "full",
              locale: holidayLocale,
              preferences: datePreferences,
              timeZone: "UTC",
            }),
            time: "",
            type: "shared-date",
          },
        ];
      });
      openShare(
        {
          color: defaultColor,
          createdAt: now,
          events: sharedEvents,
          favoriteDates: nextDates,
          id: crypto.randomUUID(),
          name: copy.calendarSelectedDates,
          updatedAt: now,
          workspaceId,
        },
        { itemType: "calendar", persist: false },
      );
    },
    [
      copy.calendarSelectedDates,
      datePreferences,
      eventsForDate,
      holidayLocale,
      openShare,
      workspaceId,
    ],
  );

  const printDates = useCallback(
    (dates) => {
      const nextDates = [...new Set(dates)].sort();
      if (!nextDates.length) return;
      const printWindow = window.open(
        "",
        "_blank",
        "popup=yes,width=960,height=760,resizable=yes,scrollbars=yes",
      );
      if (!printWindow) {
        showToast({
          messageKey: "calendarPrintPopupFailed",
          toastId: "calendar-print-popup-failed",
          type: "error",
        });
        return;
      }
      try {
        printWindow.opener = null;
        const root = document.documentElement;
        const rootStyle = window.getComputedStyle(root);
        const bodyStyle = window.getComputedStyle(document.body);
        const background = safePrintStyleValue(
          rootStyle.getPropertyValue("--app-background") ||
            bodyStyle.backgroundColor,
          "#150822",
        );
        const foreground = safePrintStyleValue(
          rootStyle.getPropertyValue("--foreground") || bodyStyle.color,
          "#ffffff",
        );
        const accent = safePrintStyleValue(
          rootStyle.getPropertyValue("--accent-color") ||
            rootStyle.getPropertyValue("--accent"),
          "#a855f7",
        );
        const fontFamily = safePrintStyleValue(
          rootStyle.getPropertyValue("--app-font") || bodyStyle.fontFamily,
          "Google Sans Flex, sans-serif",
        );
        const appearanceVariableNames = [
          "--accent",
          "--purple",
          "--background",
          "--background-secondary",
          "--app-background",
          "--foreground",
          "--app-font",
          "--app-text-scale",
          "--font-ss01",
          "--font-ss08",
          "--liquid-glass-blur",
          "--theme-radius",
          "--theme-container-radius",
          "--theme-spacing-unit",
          "--theme-transition",
          "--theme-hover-y",
          "--theme-primary",
          "--theme-on-primary",
          "--theme-surface",
          "--theme-surface-container",
          "--theme-surface-container-high",
          "--theme-on-surface",
          "--theme-outline",
          "--theme-primary-container",
          "--radius-sm",
          "--radius-md",
          "--radius-lg",
          "--radius-xl",
          "--radius-2xl",
          "--radius-3xl",
          "--spacing",
        ];
        const appearanceVariables = appearanceVariableNames
          .map((name) => {
            const value = rootStyle.getPropertyValue(name).trim();
            return value
              ? `${name}:${safePrintStyleValue(value, "initial")}`
              : "";
          })
          .filter(Boolean)
          .join(";");
        const theme = root.dataset.munetiosTheme || "munetios-default";
        const themeMode = root.dataset.munetiosThemeMode || "dark";
        const direction = root.dir || document.body.dir || "ltr";
        const appearanceClasses = [
          "compact-mode",
          "reduce-motion",
          "reduce-transparency",
          "theme-no-glass",
        ].filter((className) => root.classList.contains(className));
        const customRadius = root.hasAttribute("data-custom-border-radius");
        const daySections = nextDates
          .map((date) => {
            const title = formatUserDate(createEventFormattingDate(date), {
              dateStyle: "full",
              locale: holidayLocale,
              preferences: datePreferences,
              timeZone: "UTC",
            });
            const dayEvents = eventsForDate(date);
            const items = dayEvents.length
              ? dayEvents
                  .map((event) => {
                    const time = formatEventTime(
                      event,
                      holidayLocale,
                      datePreferences,
                    );
                    return `<li><i style="background:${escapePrintHtml(event.color || defaultColor)}"></i><div><strong>${escapePrintHtml(event.name)}</strong>${time ? `<time>${escapePrintHtml(time)}</time>` : ""}${event.location ? `<small>${escapePrintHtml(event.location)}</small>` : ""}</div></li>`;
                  })
                  .join("")
              : `<li class="empty">${escapePrintHtml(copy.calendarContentNoEvents)}</li>`;
            return `<section class="liquid-glass"><h2>${escapePrintHtml(title)}</h2><ul>${items}</ul></section>`;
          })
          .join("");
        printWindow.document.write(
          `<!doctype html><html class="${escapePrintHtml(appearanceClasses.join(" "))}" data-munetios-theme="${escapePrintHtml(theme)}" data-munetios-theme-mode="${escapePrintHtml(themeMode)}"${customRadius ? " data-custom-border-radius" : ""} dir="${escapePrintHtml(direction)}" lang="${escapePrintHtml(holidayLocale)}"><head><meta charset="utf-8"><meta name="color-scheme" content="${escapePrintHtml(themeMode)}"><title>${escapePrintHtml(copy.calendarSelectedDates)}</title><link id="munetios-beautiful-css" rel="stylesheet" href="https://api.munetios.com/beautiful-css/beautiful.css"><style>:root{${appearanceVariables};color-scheme:${themeMode}}*{box-sizing:border-box;font-feature-settings:"ss01" var(--font-ss01,1),"ss08" var(--font-ss08,1)}html{min-height:100%;background:${background}}body{min-height:100%;background:${background};background-attachment:fixed;color:${foreground};font-family:${fontFamily};font-size:calc(16px * var(--app-text-scale,1));margin:0;padding:40px;-webkit-print-color-adjust:exact;print-color-adjust:exact}h1{color:${accent};font-size:2rem;margin:0 0 28px}section{break-inside:avoid;border:1px solid var(--theme-outline,color-mix(in srgb,${foreground} 24%,transparent));border-radius:var(--theme-container-radius,var(--theme-radius,16px));margin:0 0 18px;padding:20px;background:color-mix(in srgb,var(--theme-surface-container,${background}) 76%,transparent);backdrop-filter:blur(min(var(--liquid-glass-blur,3px),3px))}h2{color:var(--theme-on-surface,${foreground});font-size:1.15rem;margin:0 0 12px}ul{display:grid;gap:var(--theme-spacing-unit,9px);list-style:none;margin:0;padding:0}li{align-items:flex-start;display:flex;gap:10px}li i{border-radius:999px;display:block;flex:0 0 10px;height:10px;margin-top:5px;width:10px}li div{display:grid;gap:2px}time,small,.empty{color:color-mix(in srgb,${foreground} 72%,transparent)}@media print{html,body{background:${background}!important}body{padding:0}section{break-inside:avoid}}</style></head><body><h1>${escapePrintHtml(copy.calendarSelectedDates)}</h1>${daySections}</body></html>`,
        );
        printWindow.document.close();
        let printStarted = false;
        const startPrint = () => {
          if (printStarted || printWindow.closed) return;
          printStarted = true;
          printWindow.focus();
          printWindow.print();
        };
        const beautifulStylesheet = printWindow.document.getElementById(
          "munetios-beautiful-css",
        );
        beautifulStylesheet?.addEventListener("load", startPrint, {
          once: true,
        });
        beautifulStylesheet?.addEventListener("error", startPrint, {
          once: true,
        });
        printWindow.setTimeout(startPrint, 1500);
      } catch {
        printWindow.close();
        showToast({
          messageKey: "calendarPrintPopupFailed",
          toastId: "calendar-print-failed",
          type: "error",
        });
      }
    },
    [copy, datePreferences, eventsForDate, holidayLocale],
  );

  useEffect(() => {
    const createEvent = (event) =>
      openSelectedEventFlow(event.detail?.selectedDates || []);
    const share = (event) =>
      shareSelectedDates(event.detail?.selectedDates || []);
    const print = (event) => printDates(event.detail?.selectedDates || []);
    window.addEventListener("munetios:calendarcreateevent", createEvent);
    window.addEventListener("munetios:calendarshare", share);
    window.addEventListener("munetios:calendarprint", print);
    return () => {
      window.removeEventListener("munetios:calendarcreateevent", createEvent);
      window.removeEventListener("munetios:calendarshare", share);
      window.removeEventListener("munetios:calendarprint", print);
    };
  }, [openSelectedEventFlow, printDates, shareSelectedDates]);

  const searchResults = searchQuery
    ? events.filter((event) =>
        `${event.name} ${event.description || ""}`
          .toLocaleLowerCase()
          .includes(searchQuery.toLocaleLowerCase()),
      )
    : [];

  const contextAction = (action) => {
    const date = context.date;
    const dateEvents = eventsForDate(date).filter(
      (event) => event.type !== "holiday",
    );
    setContext(null);
    if (action === "create") openEventModal(date);
    if (action === "share")
      openShare(
        dateEvents[0] || {
          color: defaultColor,
          date,
          id: `shared-date-${date}`,
          name: date,
          sharedWith: [],
          time: "",
          type: "shared-date",
        },
      );
    if (action === "print") printDates([date]);
    if (action === "favorite") {
      void toggleFavoriteDate(date);
    }
  };

  return (
    <CalendarEventsContext.Provider
      value={{
        eventsForDate,
        isSelectedDate: (date) => selectedDates.includes(date),
        listEventsForDate,
        isFavoriteDate,
        loading,
        onDayClick,
        onDayContext,
        openDetails,
        selectedDates,
        selectionMode,
        selectedTimeCell: quickCreate
          ? { date: quickCreate.date, time: quickCreate.time }
          : null,
      }}
    >
      <style>{eventStyles}</style>
      {children}
      {quickCreate
        ? <section
            aria-label={copy.calendarToolbarCreateEvent}
            className="calendar-quick-create liquid-glass"
            style={{
              left: quickCreate.left,
              maxHeight: `calc(100vh - ${quickCreate.top + 8}px)`,
              top: quickCreate.top,
            }}
          >
            <strong>{copy.calendarToolbarCreateEvent}</strong>
            <EventForm
              close={() => setQuickCreate(null)}
              copy={copy}
              date={quickCreate.date}
              initialTime={quickCreate.time}
              onSave={saveEvent}
            />
          </section>
        : null}
      {context
        ? <ContextDropdown
            context={context}
            copy={copy}
            favorite={isFavoriteDate(context.date)}
            key={context.id}
            onAction={contextAction}
            onClose={() => setContext(null)}
          />
        : null}
      {searchQuery
        ? <section
            aria-label={copy.search}
            className="calendar-search-results liquid-glass"
          >
            {searchResults.length
              ? searchResults.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => openDetails(event)}
                    type="button"
                  >
                    <i style={{ backgroundColor: event.color }} />
                    <span>{event.name}</span>
                    <time dateTime={event.date}>
                      {formatEventDate(event, holidayLocale, datePreferences)}
                    </time>
                  </button>
                ))
              : <p>{copy.aiSearchNoResults}</p>}
          </section>
        : null}
    </CalendarEventsContext.Provider>
  );
}

export function useCalendarEvents() {
  return useContext(CalendarEventsContext);
}
