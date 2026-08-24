"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DatePicker from "../../../components/datePicker";
import DropdownWrapper from "../../../components/dropdownwrapper";
import { showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";
import { getCurrentLocale, t } from "../../../i18n";
import {
  formatUserDate,
  formatUserTime,
  loadDateTimePreferences,
} from "../../../lib/dateTimePreferences";
import { hasSignedInCookie } from "../../../lib/signedInCookie";
import {
  fetchEncryptedCollaborations,
  shareEncryptedTask,
  updateEncryptedCollaboration,
} from "../lib/collaborationCrypto";
import {
  ensureAccountVaultUnlocked,
  getActiveTasksWorkspaceId,
  getTasksWorkspaceData,
  getUnlockedAccountData,
  readLocalEncryptedData,
  refreshUnlockedAccountData,
  saveLocalEncryptedData,
  saveUnlockedAccountData,
  withTasksWorkspaceData,
} from "../lib/encryptedVault";
import {
  cacheTaskLists,
  createTaskListSlug,
  defaultTaskListId,
  defaultTaskListSlug,
  getTaskListHref,
  getTaskListName,
  normalizeTaskLists,
} from "../lib/taskLists";

const defaultSettings = {
  autoArchiveCompleted: false,
  autoArchivePastDue: false,
  suggestCategories: true,
};
const viewKeys = {
  active: "tasksAllTasks",
  archived: "tasksArchived",
  completed: "tasksCompleted",
  drafts: "tasksDrafts",
  favorites: "tasksFavorites",
  "in-progress": "tasksInProgress",
  shared: "tasksShared",
  "teacher-assigned": "educationTeacherAssigned",
  trash: "tasksTrash",
};
const categorySuggestionKeywords = {
  finance: ["bank", "bill", "budget", "invoice", "money", "pay", "tax"],
  health: ["appointment", "doctor", "exercise", "fitness", "gym", "medicine"],
  home: ["buy", "clean", "cook", "family", "grocery", "house", "shop"],
  personal: ["birthday", "call", "errand", "personal", "remember"],
  school: ["assignment", "class", "exam", "homework", "school", "study"],
  travel: ["book", "flight", "hotel", "passport", "trip", "travel"],
  work: [
    "client",
    "email",
    "meeting",
    "presentation",
    "project",
    "report",
    "work",
  ],
  shopping: [
    "buy",
    "errand",
    "grocery",
    "groceries",
    "list",
    "market",
    "purchase",
    "shop",
    "store",
  ],
  groceries: [
    "buy",
    "errand",
    "grocery",
    "groceries",
    "list",
    "market",
    "shopping",
    "store",
  ],
  grocery: [
    "buy",
    "errand",
    "grocery",
    "groceries",
    "list",
    "market",
    "shopping",
    "store",
  ],
};

function suggestionWords(value) {
  return (
    String(value || "")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || []
  );
}

function getLocalCategorySuggestion(categories, topic) {
  const topicWords = new Set(suggestionWords(topic));
  let best = null;
  let bestScore = 0;
  for (const category of categories) {
    const nameWords = suggestionWords(category.name);
    const aliases = nameWords.flatMap(
      (word) => categorySuggestionKeywords[word] || [],
    );
    const score = [...nameWords, ...aliases].reduce(
      (total, word) => total + (topicWords.has(word) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return best;
}

function isTaskPastDue(task, now = new Date()) {
  if (!task.dueDate) return false;
  const due = task.dueTime
    ? new Date(`${task.dueDate}T${task.dueTime}:00`)
    : new Date(`${task.dueDate}T23:59:59.999`);
  return !Number.isNaN(due.getTime()) && due.getTime() < now.getTime();
}

function getAutomaticallyArchivedTasks(tasks, settings) {
  const now = new Date();
  const archivedAt = now.toISOString();
  return tasks.map((task) => {
    if (task.archived || task.trashedAt) return task;
    const shouldArchiveCompleted =
      settings.autoArchiveCompleted && task.status === "completed";
    const shouldArchivePastDue =
      settings.autoArchivePastDue &&
      task.status !== "completed" &&
      isTaskPastDue(task, now);
    return shouldArchiveCompleted || shouldArchivePastDue
      ? { ...task, archived: true, archivedAt: task.archivedAt || archivedAt }
      : task;
  });
}

function createEmptyDraft(listId = defaultTaskListId) {
  return {
    attachment: null,
    categoryId: "",
    description: "",
    dueDate: "",
    dueTime: "",
    listId,
    name: "",
    options: [],
  };
}

function createTask(draft, existing) {
  const now = new Date().toISOString();
  return {
    archived: false,
    attachment: draft.attachment,
    categoryId: draft.categoryId,
    completedAt: null,
    createdAt: existing?.createdAt || now,
    description: draft.description.trim(),
    dueDate: draft.dueDate,
    dueTime: draft.dueTime,
    favorite: existing?.favorite || false,
    id: existing?.id || `task-${crypto.randomUUID()}`,
    listId: draft.listId || existing?.listId || defaultTaskListId,
    name: draft.name.trim(),
    options: draft.options
      .filter((item) => item.label.trim())
      .map((item) => ({
        ...item,
        subtasks: (item.subtasks || []).filter((subtask) =>
          subtask.label.trim(),
        ),
      })),
    sharedWith: existing?.sharedWith || [],
    status: existing?.status || "active",
    trashedAt: null,
    updatedAt: now,
  };
}

function formatDueDate(task, locale, timeFormat) {
  if (!task.dueDate) return "";
  const [year, month, day] = task.dueDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const preferences = {
    ...loadDateTimePreferences(),
    timeFormat,
  };
  const dateText = formatUserDate(date, { locale, preferences });
  if (!task.dueTime) return dateText;
  const [hour, minute] = task.dueTime.split(":").map(Number);
  const timeText = formatUserTime(new Date(2024, 0, 1, hour, minute), {
    locale,
    preferences,
  });
  return `${dateText} · ${timeText}`;
}

function TimePicker({ copy, locale, onChange, timeFormat, value }) {
  const [hour = "", minute = ""] = String(value || "").split(":");
  const preferences = {
    ...loadDateTimePreferences(),
    timeFormat,
  };
  const hours = Array.from({ length: 24 }, (_, index) => ({
    label: formatUserTime(new Date(2024, 0, 1, index), {
      locale,
      preferences,
    }),
    value: String(index).padStart(2, "0"),
  }));
  const minutes = Array.from({ length: 12 }, (_, index) => ({
    label: String(index * 5).padStart(2, "0"),
    value: String(index * 5).padStart(2, "0"),
  }));
  const selector = (label, options, selected, select) => (
    <DropdownWrapper
      align="left"
      ariaLabel={label}
      buttonClassName="tasks-time-trigger"
      panelClassName="max-h-72 w-32 overflow-y-auto"
      triggerAs="div"
      trigger={
        <>
          <span>
            {options.find((option) => option.value === selected)?.label ||
              label}
          </span>
          <icon>expand_more</icon>
        </>
      }
    >
      {options.map((option) => (
        <button
          aria-checked={option.value === selected}
          className="tasks-time-option"
          key={option.value}
          onClick={() => select(option.value)}
          role="menuitemradio"
          type="button"
        >
          {option.label}
          {option.value === selected ? <icon>check</icon> : null}
        </button>
      ))}
    </DropdownWrapper>
  );
  return (
    <fieldset className="tasks-time-picker">
      <legend>{copy.tasksDueTime}</legend>
      <div>
        {selector(copy.tasksHour, hours, hour, (nextHour) =>
          onChange(`${nextHour}:${minute || "00"}`),
        )}
        <span>:</span>
        {selector(copy.tasksMinute, minutes, minute, (nextMinute) =>
          onChange(`${hour || "09"}:${nextMinute}`),
        )}
      </div>
    </fieldset>
  );
}

function OptionsEditor({ copy, items, onChange }) {
  const updateOption = (optionId, transform) =>
    onChange(
      items.map((item) => (item.id === optionId ? transform(item) : item)),
    );

  return (
    <div className="tasks-dynamic-items">
      {items.map((item, index) => (
        <div className="tasks-option-editor" key={item.id}>
          <div className="tasks-dynamic-row">
            <icon>radio_button_unchecked</icon>
            <input
              aria-label={`${copy.tasksAddOption} ${index + 1}`}
              maxLength={160}
              onChange={(event) =>
                updateOption(item.id, (current) => ({
                  ...current,
                  label: event.target.value,
                }))
              }
              placeholder={copy.tasksAddOption}
              value={item.label}
            />
            <button
              aria-label={copy.billingRemovePaymentMethod}
              onClick={() =>
                onChange(items.filter((current) => current.id !== item.id))
              }
              type="button"
            >
              <icon>close</icon>
            </button>
          </div>
          <div className="tasks-option-subtasks">
            {(item.subtasks || []).map((subtask, subtaskIndex) => (
              <div className="tasks-dynamic-row" key={subtask.id}>
                <icon>subdirectory_arrow_right</icon>
                <input
                  aria-label={`${copy.tasksAddSubtask} ${subtaskIndex + 1}`}
                  maxLength={160}
                  onChange={(event) =>
                    updateOption(item.id, (current) => ({
                      ...current,
                      subtasks: (current.subtasks || []).map(
                        (currentSubtask) =>
                          currentSubtask.id === subtask.id
                            ? { ...currentSubtask, label: event.target.value }
                            : currentSubtask,
                      ),
                    }))
                  }
                  placeholder={copy.tasksAddSubtask}
                  value={subtask.label}
                />
                <button
                  aria-label={copy.billingRemovePaymentMethod}
                  onClick={() =>
                    updateOption(item.id, (current) => ({
                      ...current,
                      subtasks: (current.subtasks || []).filter(
                        (currentSubtask) => currentSubtask.id !== subtask.id,
                      ),
                    }))
                  }
                  type="button"
                >
                  <icon>close</icon>
                </button>
              </div>
            ))}
            <button
              className="tasks-add-nested-subtask"
              onClick={() =>
                updateOption(item.id, (current) => ({
                  ...current,
                  subtasks: [
                    ...(current.subtasks || []),
                    {
                      done: false,
                      id: crypto.randomUUID(),
                      label: "",
                    },
                  ],
                }))
              }
              type="button"
            >
              <icon>account_tree</icon>
              {copy.tasksAddSubtask}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ShareForm({ close, copy, onShare, task }) {
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState("view");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="tasks-share-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!email.trim() || saving) return;
        setSaving(true);
        setError("");
        try {
          await onShare(task, email.trim(), permission);
          close();
        } catch (shareError) {
          if (shareError.message === "sensitive_verification_required") {
            showModal(
              ({ close: closeVerification }) => (
                <TaskSensitiveVerification
                  close={closeVerification}
                  copy={copy}
                  onVerified={async () => {
                    await onShare(task, email.trim(), permission);
                    close();
                  }}
                />
              ),
              {
                ariaLabel: copy.securityVerifyTitle,
                title: copy.securityVerifyTitle,
              },
            );
            setSaving(false);
            return;
          }
          setError(
            shareError.message === "recipient_tasks_key_unavailable"
              ? copy.tasksShareRecipientUnavailable
              : copy.tasksShareFailed,
          );
          setSaving(false);
        }
      }}
    >
      <label>
        {copy.authEmailAddress}
        <input
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <fieldset>
        <legend>{copy.tasksPermission}</legend>
        <div className="tasks-permission-options">
          {[
            ["view", copy.tasksViewOnly],
            ["edit", copy.tasksCanEdit],
          ].map(([value, label]) => (
            <button
              aria-pressed={permission === value}
              key={value}
              onClick={() => setPermission(value)}
              type="button"
            >
              <icon>{value === "view" ? "visibility" : "edit"}</icon>
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      {error ? <p className="tasks-form-error">{error}</p> : null}
      <div className="tasks-form-actions">
        <button onClick={close} type="button">
          {copy.cancel}
        </button>
        <button disabled={saving || !email.trim()} type="submit">
          {copy.tasksSendShare}
        </button>
      </div>
    </form>
  );
}

function TaskSensitiveVerification({ close, copy, onVerified }) {
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [value, setValue] = useState("");
  const [working, setWorking] = useState(false);
  useEffect(() => {
    fetch("/api/account/security", {
      cache: "no-store",
      credentials: "include",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) =>
        setTwoFactorEnabled(Boolean(payload?.twoFactorEnabled)),
      )
      .catch(() => undefined);
  }, []);
  return (
    <form
      className="tasks-share-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setWorking(true);
        try {
          const response = await fetch("/api/account/security", {
            body: JSON.stringify({
              action: "verify_sensitive",
              ...(twoFactorEnabled ? { code: value } : { password: value }),
            }),
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            method: "POST",
          });
          if (!response.ok) throw new Error("verification_failed");
          await onVerified();
          close();
        } catch {
          showToast({ messageKey: "failedCheckAccount", type: "error" });
          setWorking(false);
        }
      }}
    >
      <p>{copy.securityVerifyDescription}</p>
      <label>
        {twoFactorEnabled
          ? copy.authVerificationCode
          : copy.accountSecurityCurrentPassword}
        <input
          autoComplete={twoFactorEnabled ? "one-time-code" : "current-password"}
          onChange={(event) => setValue(event.target.value)}
          required
          type={twoFactorEnabled ? "text" : "password"}
          value={value}
        />
      </label>
      <button disabled={working} type="submit">
        {copy.authRecoveryVerify}
      </button>
    </form>
  );
}

function DeleteSharedChoice({ close, copy, onCopy, onDelete }) {
  return (
    <div className="tasks-shared-delete-choice">
      <p>{copy.tasksSharedDeleteWarning}</p>
      <div className="tasks-form-actions">
        <button onClick={close} type="button">
          {copy.cancel}
        </button>
        <button
          onClick={() => {
            onCopy();
            close();
          }}
          type="button"
        >
          {copy.tasksMakeCopy}
        </button>
        <button
          className="is-danger"
          onClick={() => {
            onDelete();
            close();
          }}
          type="button"
        >
          {copy.tasksDeleteForever}
        </button>
      </div>
    </div>
  );
}

function AddListForm({ close, copy, lists, onCreate }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const duplicate = lists.some(
    (list) =>
      getTaskListName(list, copy).toLocaleLowerCase() ===
      name.trim().toLocaleLowerCase(),
  );
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!name.trim() || duplicate || saving) return;
        setSaving(true);
        const created = await onCreate(name.trim());
        setSaving(false);
        if (created) close();
      }}
    >
      <label className="block text-sm font-semibold text-white/85">
        {copy.tasksListName}
        <input
          autoComplete="off"
          className="mt-2 w-full rounded-2xl border border-white/10 bg-white/8! px-4 py-3 text-white outline-none focus:border-purple-300/55"
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          placeholder={copy.tasksListNamePlaceholder}
          required
          value={name}
        />
      </label>
      {duplicate
        ? <p className="text-sm text-rose-200">{copy.tasksListAlreadyExists}</p>
        : null}
      <div className="flex justify-end gap-2">
        <button
          className="rounded-full border border-white/10 bg-white/5! px-4 py-2 text-sm font-semibold text-white/75"
          onClick={close}
          type="button"
        >
          {copy.cancel}
        </button>
        <button
          className="rounded-full border border-purple-200/25 bg-purple-500/50! px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!name.trim() || duplicate || saving}
          type="submit"
        >
          {saving ? copy.tasksAddingList : copy.tasksAddList}
        </button>
      </div>
    </form>
  );
}

function MoveTaskToListForm({ close, copy, currentListId, lists, onMove }) {
  return (
    <div className="grid gap-2">
      {lists.map((list) => (
        <button
          aria-pressed={list.id === currentListId}
          className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5! px-4 py-3 text-left text-sm text-white/85 hover:bg-white/10!"
          disabled={list.id === currentListId}
          key={list.id}
          onClick={async () => {
            await onMove(list.id);
            close();
          }}
          type="button"
        >
          <span>{getTaskListName(list, copy)}</span>
          {list.id === currentListId ? <icon>check</icon> : null}
        </button>
      ))}
    </div>
  );
}

function getTaskOptions(task, copy) {
  const options = (task.options || []).map((option, index) => ({
    ...option,
    subtasks:
      index === 0
        ? [...(option.subtasks || []), ...(task.subtasks || [])]
        : option.subtasks || [],
  }));
  if (options.length === 0 && (task.subtasks || []).length > 0) {
    options.push({
      done: false,
      id: `${task.id}-legacy-option`,
      label: copy.tasksAddOption,
      subtasks: task.subtasks,
    });
  }
  return options;
}

function TaskPrintDocument({ category, copy, locale, task, timeFormat }) {
  const options = getTaskOptions(task, copy);
  return (
    <article aria-hidden="true" className="tasks-print-document">
      <header className="tasks-print-header">
        <div>
          <strong>Munetios</strong>
          <span>Tasks</span>
        </div>
        {category
          ? <span className="tasks-print-category">
              <i style={{ backgroundColor: category.color }} />
              {category.name}
            </span>
          : null}
      </header>
      <main>
        <h1>{task.name}</h1>
        {task.description
          ? <p className="tasks-print-description">{task.description}</p>
          : null}
        {options.length > 0
          ? <ul className="tasks-print-options">
              {options.map((option) => (
                <li key={option.id}>
                  <span
                    aria-hidden="true"
                    className={option.done ? "is-complete" : ""}
                  >
                    {option.done ? "✓" : ""}
                  </span>
                  <strong>{option.label}</strong>
                  {(option.subtasks || []).length > 0
                    ? <ul>
                        {option.subtasks.map((subtask) => (
                          <li key={subtask.id}>
                            <span
                              aria-hidden="true"
                              className={subtask.done ? "is-complete" : ""}
                            >
                              {subtask.done ? "✓" : ""}
                            </span>
                            {subtask.label}
                          </li>
                        ))}
                      </ul>
                    : null}
                </li>
              ))}
            </ul>
          : null}
      </main>
      {task.dueDate
        ? <footer className="tasks-print-due">
            <strong>{copy.tasksDueDate}</strong>
            <span>{formatDueDate(task, locale, timeFormat)}</span>
          </footer>
        : null}
    </article>
  );
}

function TaskCard({
  categories,
  canMoveDown,
  canMoveUp,
  copy,
  lists,
  onAction,
  onToggleItem,
  onToggleTeacherAssignment,
  sharedItem,
  task,
  teacherAssignment = false,
  timeFormat,
  locale,
  view,
}) {
  const category = categories.find((item) => item.id === task.categoryId);
  const canEdit =
    !teacherAssignment && (!sharedItem || sharedItem.permission === "edit");
  const options = getTaskOptions(task, copy);
  return (
    <article
      className={`tasks-card liquid-glass ${task.attachment?.dataUrl ? "has-image" : ""}`}
    >
      {task.attachment?.dataUrl
        ? // biome-ignore lint/performance/noImgElement: encrypted task image data is stored as a local data URL.
          <img
            alt={task.attachment.name || task.name}
            className="tasks-card-image"
            src={task.attachment.dataUrl}
          />
        : null}
      <div className="tasks-card-body">
        <div className="tasks-card-heading">
          <div>
            <div className="tasks-card-meta">
              {category
                ? <span>
                    <i style={{ backgroundColor: category.color }} />
                    {category.name}
                  </span>
                : null}
              {sharedItem
                ? <span>
                    <icon>group</icon>
                    {sharedItem.ownerName || sharedItem.email} ·{" "}
                    {canEdit ? copy.tasksCanEdit : copy.tasksViewOnly}
                  </span>
                : null}
              {teacherAssignment
                ? <span>
                    <icon>school</icon>
                    {copy.educationTeacherAssigned} · {copy.tasksViewOnly}
                  </span>
                : null}
            </div>
            <h2>{task.name}</h2>
            {task.description ? <p>{task.description}</p> : null}
          </div>
          <div className="tasks-card-actions">
            {teacherAssignment
              ? <button
                  aria-label={
                    task.completed
                      ? copy.tasksInProgress
                      : copy.tasksMoveCompleted
                  }
                  aria-pressed={task.completed}
                  onClick={() => onToggleTeacherAssignment(task)}
                  title={
                    task.completed
                      ? copy.tasksInProgress
                      : copy.tasksMoveCompleted
                  }
                  type="button"
                >
                  <icon>
                    {task.completed ? "check_circle" : "radio_button_unchecked"}
                  </icon>
                  <span>
                    {task.completed
                      ? copy.tasksCompleted
                      : copy.educationMarkComplete}
                  </span>
                </button>
              : null}
            {!sharedItem && !teacherAssignment
              ? <button
                  aria-label={copy.tasksShare}
                  onClick={() => onAction("share", task)}
                  title={copy.tasksShare}
                  type="button"
                >
                  <icon>share</icon>
                  <span>{copy.tasksShare}</span>
                </button>
              : null}
            {!teacherAssignment
              ? <button
                  aria-label={copy.tasksFavorite}
                  aria-pressed={task.favorite}
                  disabled={!canEdit}
                  onClick={() => onAction("favorite", task, sharedItem)}
                  title={copy.tasksFavorite}
                  type="button"
                >
                  <icon>{task.favorite ? "star" : "star_border"}</icon>
                </button>
              : null}
            {!teacherAssignment
              ? <DropdownWrapper
                  align="right"
                  ariaLabel={copy.tasksMoreActions}
                  buttonClassName="tasks-card-more"
                  panelClassName="tasks-card-action-menu w-64"
                  trigger={<icon>more_vert</icon>}
                  zIndex={100000004}
                  triggerAs="div"
                  triggerGlass={false}
                >
                  {view === "trash"
                    ? <>
                        <button
                          data-dropdown-close
                          onClick={() => onAction("restore", task)}
                          type="button"
                        >
                          <icon>restore</icon>
                          {copy.tasksRestore}
                        </button>
                        <button
                          className="is-danger"
                          data-dropdown-close
                          onClick={() => onAction("delete-forever", task)}
                          type="button"
                        >
                          <icon>delete_forever</icon>
                          {copy.tasksDeleteForever}
                        </button>
                      </>
                    : view === "archived"
                      ? <>
                          <button
                            data-dropdown-close
                            disabled={!canEdit}
                            onClick={() =>
                              onAction("unarchive", task, sharedItem)
                            }
                            type="button"
                          >
                            <icon>unarchive</icon>
                            {copy.tasksRestore}
                          </button>
                          <button
                            data-dropdown-close
                            disabled={!canEdit}
                            onClick={() => onAction("edit", task, sharedItem)}
                            type="button"
                          >
                            <icon>edit</icon>
                            {copy.tasksEdit}
                          </button>
                        </>
                      : <>
                          {task.status === "draft"
                            ? <button
                                data-dropdown-close
                                disabled={!canEdit}
                                onClick={() =>
                                  onAction("activate", task, sharedItem)
                                }
                                type="button"
                              >
                                <icon>play_circle</icon>
                                {copy.tasksAllTasks}
                              </button>
                            : null}
                          {task.status === "completed"
                            ? <button
                                data-dropdown-close
                                disabled={!canEdit}
                                onClick={() =>
                                  onAction("in-progress", task, sharedItem)
                                }
                                type="button"
                              >
                                <icon>pending_actions</icon>
                                {copy.tasksInProgress}
                              </button>
                            : <button
                                data-dropdown-close
                                disabled={!canEdit}
                                onClick={() =>
                                  onAction("complete", task, sharedItem)
                                }
                                type="button"
                              >
                                <icon>task_alt</icon>
                                {copy.tasksMoveCompleted}
                              </button>}
                          {!sharedItem && lists.length > 1
                            ? <button
                                data-dropdown-close
                                onClick={() => onAction("move-to-list", task)}
                                type="button"
                              >
                                <icon>drive_file_move</icon>
                                {copy.tasksMoveToList}
                              </button>
                            : null}
                          <button
                            data-dropdown-close
                            onClick={() => onAction("print", task, sharedItem)}
                            type="button"
                          >
                            <icon>print</icon>
                            {copy.tasksPrint}
                          </button>
                          <button
                            data-dropdown-close
                            disabled={!canEdit}
                            onClick={() => onAction("edit", task, sharedItem)}
                            type="button"
                          >
                            <icon>edit</icon>
                            {copy.tasksEdit}
                          </button>
                          {!sharedItem
                            ? <>
                                <button
                                  data-dropdown-close
                                  disabled={!canMoveUp}
                                  onClick={() => onAction("move-up", task)}
                                  type="button"
                                >
                                  <icon>arrow_upward</icon>
                                  {copy.tasksMoveUp}
                                </button>
                                <button
                                  data-dropdown-close
                                  disabled={!canMoveDown}
                                  onClick={() => onAction("move-down", task)}
                                  type="button"
                                >
                                  <icon>arrow_downward</icon>
                                  {copy.tasksMoveDown}
                                </button>
                                <button
                                  data-dropdown-close
                                  onClick={() => onAction("archive", task)}
                                  type="button"
                                >
                                  <icon>archive</icon>
                                  {copy.tasksArchive}
                                </button>
                                <button
                                  className="is-danger"
                                  data-dropdown-close
                                  onClick={() => onAction("trash", task)}
                                  type="button"
                                >
                                  <icon>delete</icon>
                                  {copy.tasksMoveTrash}
                                </button>
                              </>
                            : null}
                        </>}
                </DropdownWrapper>
              : null}
          </div>
        </div>
        {options.length
          ? <ul className="tasks-card-options">
              {options.map((item) => (
                <li key={item.id}>
                  <button
                    aria-pressed={item.done}
                    disabled={!canEdit}
                    onClick={() =>
                      onToggleItem(task, "options", item.id, sharedItem)
                    }
                    type="button"
                  >
                    <icon>
                      {item.done ? "check_circle" : "radio_button_unchecked"}
                    </icon>
                    <span>{item.label}</span>
                  </button>
                  {(item.subtasks || []).length > 0
                    ? <ul>
                        {item.subtasks.map((subtask) => (
                          <li className="is-subtask" key={subtask.id}>
                            <button
                              aria-pressed={subtask.done}
                              disabled={!canEdit}
                              onClick={() =>
                                onToggleItem(
                                  task,
                                  "subtasks",
                                  subtask.id,
                                  sharedItem,
                                  item.id,
                                )
                              }
                              type="button"
                            >
                              <icon>
                                {subtask.done
                                  ? "check_box"
                                  : "check_box_outline_blank"}
                              </icon>
                              <span>{subtask.label}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    : null}
                </li>
              ))}
            </ul>
          : null}
        {task.dueDate
          ? <div className="tasks-card-due">
              <icon>event</icon>
              {formatDueDate(task, locale, timeFormat)}
            </div>
          : null}
      </div>
    </article>
  );
}

export default function TasksWorkspace({
  listSlug = defaultTaskListSlug,
  view = "active",
}) {
  const [copy, setCopy] = useState(() => t("en"));
  const [categorySuggestionId, setCategorySuggestionId] = useState("");
  const [contentSuggestion, setContentSuggestion] = useState(null);
  const [locale, setLocale] = useState("en");
  const [timeFormat, setTimeFormat] = useState("auto");
  const [data, setData] = useState({
    categories: [],
    lists: normalizeTaskLists(),
    settings: defaultSettings,
    tasks: [],
  });
  const [draft, setDraft] = useState(createEmptyDraft);
  const [editing, setEditing] = useState(null);
  const [editingShared, setEditingShared] = useState(null);
  const [loading, setLoading] = useState(true);
  const [printTask, setPrintTask] = useState(null);
  const [query, setQuery] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [aiFeaturesAllowed, setAiFeaturesAllowed] = useState(true);
  const [shared, setShared] = useState([]);
  const [teacherAssignments, setTeacherAssignments] = useState([]);
  const [storageMode, setStorageMode] = useState("local");
  const [vaultData, setVaultData] = useState(null);
  const [workspaceId, setWorkspaceId] = useState("default");
  const fileInputRef = useRef(null);
  const composerRef = useRef(null);
  const suggestionRequestRef = useRef(null);
  const syncChannelRef = useRef(null);
  const currentList = useMemo(
    () =>
      data.lists.find((list) => list.slug === listSlug) ||
      data.lists.find((list) => list.id === defaultTaskListId) ||
      normalizeTaskLists()[0],
    [data.lists, listSlug],
  );

  useEffect(() => {
    const applyOrganizationPolicy = (organization) => {
      if (!organization) return;
      setAiFeaturesAllowed(
        organization.policies?.AIFeaturesEnabled !== false &&
          organization.appAccess?.ai !== false,
      );
    };
    applyOrganizationPolicy(window.__munetiosOrganizationAccess);
    const onPolicy = (event) => applyOrganizationPolicy(event.detail);
    window.addEventListener("munetios:organization-policy", onPolicy);
    return () =>
      window.removeEventListener("munetios:organization-policy", onPolicy);
  }, []);

  useEffect(() => {
    if (!printTask) return undefined;

    const previousTitle = document.title;
    let secondFrame = null;
    const finishPrinting = () => {
      document.title = previousTitle;
      setPrintTask(null);
    };
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        document.title = `${printTask.name} · Munetios Tasks`;
        window.print();
        finishPrinting();
      });
    });

    window.addEventListener("afterprint", finishPrinting, { once: true });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      window.removeEventListener("afterprint", finishPrinting);
      document.title = previousTitle;
    };
  }, [printTask]);

  const load = useCallback(async () => {
    const activeWorkspaceId = getActiveTasksWorkspaceId();
    setWorkspaceId(activeWorkspaceId);
    try {
      const isSignedIn = hasSignedInCookie();
      setSignedIn(isSignedIn);
      if (isSignedIn) {
        try {
          const accountData = getUnlockedAccountData()
            ? await refreshUnlockedAccountData()
            : await ensureAccountVaultUnlocked();
          const scopedData = getTasksWorkspaceData(
            accountData,
            activeWorkspaceId,
          );
          const needsMigration =
            Object.keys(accountData.workspaces || {}).length === 0 &&
            ((accountData.categories || []).length > 0 ||
              (accountData.tasks || []).length > 0);
          const rawAccountWorkspace =
            accountData.workspaces?.[activeWorkspaceId];
          const needsListMigration =
            !Array.isArray(rawAccountWorkspace?.lists) ||
            (rawAccountWorkspace?.tasks || []).some((task) => !task.listId);
          const shouldMigrate = needsMigration || needsListMigration;
          const resolvedAccountData = shouldMigrate
            ? withTasksWorkspaceData(accountData, scopedData, activeWorkspaceId)
            : accountData;
          if (shouldMigrate) {
            await saveUnlockedAccountData(resolvedAccountData);
          }
          setStorageMode("account");
          setVaultData(resolvedAccountData);
          setData({
            categories: scopedData.categories,
            lists: scopedData.lists,
            settings: { ...defaultSettings, ...scopedData.settings },
            tasks: scopedData.tasks,
          });
          cacheTaskLists(activeWorkspaceId, scopedData.lists);
          return;
        } catch {
          setStorageMode("account");
          setVaultData(null);
          setData({
            categories: [],
            lists: normalizeTaskLists(),
            settings: defaultSettings,
            tasks: [],
          });
          return;
        }
      }
      setStorageMode("local");
      const localData = await readLocalEncryptedData();
      const scopedData = getTasksWorkspaceData(localData, activeWorkspaceId);
      const needsMigration =
        Object.keys(localData.workspaces || {}).length === 0 &&
        ((localData.categories || []).length > 0 ||
          (localData.tasks || []).length > 0);
      const rawLocalWorkspace = localData.workspaces?.[activeWorkspaceId];
      const needsListMigration =
        !Array.isArray(rawLocalWorkspace?.lists) ||
        (rawLocalWorkspace?.tasks || []).some((task) => !task.listId);
      const shouldMigrate = needsMigration || needsListMigration;
      const resolvedLocalData = shouldMigrate
        ? withTasksWorkspaceData(localData, scopedData, activeWorkspaceId)
        : localData;
      if (shouldMigrate) {
        await saveLocalEncryptedData(resolvedLocalData);
      }
      setVaultData(resolvedLocalData);
      setData({
        categories: scopedData.categories,
        lists: scopedData.lists,
        settings: { ...defaultSettings, ...scopedData.settings },
        tasks: scopedData.tasks,
      });
      cacheTaskLists(activeWorkspaceId, scopedData.lists);
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(
    async (nextData, action = "update") => {
      const sourceDocument =
        vaultData ||
        getUnlockedAccountData() ||
        (await readLocalEncryptedData());
      const nextVaultData = withTasksWorkspaceData(
        sourceDocument,
        nextData,
        workspaceId,
      );
      if (storageMode === "account") {
        if (!getUnlockedAccountData()) await ensureAccountVaultUnlocked();
        await saveUnlockedAccountData(nextVaultData);
      } else {
        await saveLocalEncryptedData(nextVaultData);
      }
      setVaultData(nextVaultData);
      setData(nextData);
      cacheTaskLists(workspaceId, nextData.lists);
      syncChannelRef.current?.postMessage({ action, updatedAt: Date.now() });
      window.dispatchEvent(
        new CustomEvent("munetios:taskschange", {
          detail: { action, tasks: nextData.tasks },
        }),
      );
    },
    [storageMode, vaultData, workspaceId],
  );

  const createList = useCallback(
    async (name) => {
      const now = new Date().toISOString();
      const list = {
        createdAt: now,
        id: `list-${crypto.randomUUID()}`,
        name,
        slug: createTaskListSlug(name, data.lists),
        system: false,
        updatedAt: now,
      };
      await save({ ...data, lists: [...data.lists, list] }, "list-create");
      window.location.assign(getTaskListHref(list));
      return true;
    },
    [data, save],
  );

  const openAddList = useCallback(() => {
    showModal(
      ({ close }) => (
        <AddListForm
          close={close}
          copy={copy}
          lists={data.lists}
          onCreate={createList}
        />
      ),
      {
        ariaLabel: copy.tasksAddList,
        title: copy.tasksAddList,
        width: "540px",
        zIndex: 100000005,
      },
    );
  }, [copy, createList, data.lists]);

  useEffect(() => {
    if (loading) return;
    const url = new URL(window.location.href);
    const shouldAddList = url.searchParams.has("addList");
    if (!shouldAddList) return;

    url.searchParams.delete("addList");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    openAddList();
  }, [loading, openAddList]);

  useEffect(() => {
    if (
      !loading &&
      view === "list" &&
      !data.lists.some((list) => list.slug === listSlug)
    ) {
      window.location.replace("/apps/tasks");
    }
  }, [data.lists, listSlug, loading, view]);

  const refreshShared = useCallback(async () => {
    if (!signedIn) {
      setShared([]);
      return;
    }
    try {
      const collaboration = await fetchEncryptedCollaborations();
      setShared(collaboration.received.filter((item) => item.task));
      const updates = collaboration.owned.filter((item) => item.task);
      if (updates.length > 0) {
        setData((current) => {
          let changed = false;
          const tasks = current.tasks.map((task) => {
            const update = updates.find(
              (item) =>
                item.taskId === task.id &&
                new Date(item.updatedAt).getTime() >
                  new Date(task.updatedAt || 0).getTime(),
            );
            if (!update) return task;
            changed = true;
            return {
              ...update.task,
              sharedWith: task.sharedWith || [],
              updatedAt: update.updatedAt,
            };
          });
          if (changed) {
            const next = { ...current, tasks };
            void save(next, "collaboration");
            return next;
          }
          return current;
        });
      }
    } catch {
      setShared([]);
    }
  }, [save, signedIn]);

  const refreshTeacherAssignments = useCallback(async () => {
    if (!signedIn || view !== "teacher-assigned") {
      setTeacherAssignments([]);
      return;
    }
    try {
      const response = await fetch("/api/education/assignments", {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) throw new Error("assignment_load_failed");
      const payload = await response.json();
      setTeacherAssignments(
        Array.isArray(payload.assignments) ? payload.assignments : [],
      );
    } catch {
      setTeacherAssignments([]);
      showToast({
        messageKey: "educationAssignmentsLoadFailed",
        type: "error",
      });
    }
  }, [signedIn, view]);

  useEffect(() => {
    void refreshTeacherAssignments();
  }, [refreshTeacherAssignments]);

  useEffect(() => {
    void load();
    const channel = new BroadcastChannel("munetios-tasks-sync");
    syncChannelRef.current = channel;
    channel.onmessage = () => void load();
    const refreshCopy = () => {
      setCopy(t());
      setLocale(getCurrentLocale());
      try {
        const preferences = JSON.parse(
          window.localStorage.getItem("munetios.accountLanguageTime") || "{}",
        );
        setTimeFormat(preferences.timeFormat || "auto");
      } catch {
        setTimeFormat("auto");
      }
    };
    const search = (event) => setQuery(String(event.detail || ""));
    const refresh = () => void load();
    const refreshWorkspace = () => void load();
    refreshCopy();
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);
    window.addEventListener("munetios:taskssearch", search);
    window.addEventListener("munetios:taskschange", refresh);
    window.addEventListener("munetios:workspacechange", refreshWorkspace);
    window.addEventListener("munetios:language-time-change", refreshCopy);
    return () => {
      channel.close();
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
      window.removeEventListener("munetios:taskssearch", search);
      window.removeEventListener("munetios:taskschange", refresh);
      window.removeEventListener("munetios:workspacechange", refreshWorkspace);
      window.removeEventListener("munetios:language-time-change", refreshCopy);
    };
  }, [load]);

  useEffect(() => {
    const refreshSettings = (event) => {
      const settings = event.detail;
      if (!settings || typeof settings !== "object") return;
      setData((current) => ({
        ...current,
        settings: { ...defaultSettings, ...settings },
      }));
    };
    window.addEventListener("munetios:taskssettingschange", refreshSettings);
    return () =>
      window.removeEventListener(
        "munetios:taskssettingschange",
        refreshSettings,
      );
  }, []);

  useEffect(() => {
    if (loading) return undefined;
    const focusComposer = () => {
      composerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      requestAnimationFrame(() =>
        composerRef.current?.querySelector("input[aria-label]")?.focus(),
      );
    };
    window.addEventListener("munetios:taskscreate", focusComposer);
    if (window.location.hash === "#new") focusComposer();
    return () =>
      window.removeEventListener("munetios:taskscreate", focusComposer);
  }, [loading]);

  useEffect(() => {
    void refreshShared();
    const interval = window.setInterval(refreshShared, 3_000);
    return () => window.clearInterval(interval);
  }, [refreshShared]);

  useEffect(() => {
    if (!signedIn) return undefined;
    const interval = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(interval);
  }, [load, signedIn]);

  useEffect(() => {
    const tasks = getAutomaticallyArchivedTasks(data.tasks, data.settings);
    if (tasks.some((task, index) => task !== data.tasks[index])) {
      void save({ ...data, tasks }, "auto-archive");
    }
  }, [data, save]);

  useEffect(() => {
    if (!data.settings.autoArchivePastDue) return undefined;
    const interval = window.setInterval(() => {
      const tasks = getAutomaticallyArchivedTasks(data.tasks, data.settings);
      if (tasks.some((task, index) => task !== data.tasks[index])) {
        void save({ ...data, tasks }, "auto-archive-past-due");
      }
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [data, save]);

  const visibleTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const tasks =
      view === "shared"
        ? shared.map((item) => item.task)
        : view === "teacher-assigned"
          ? teacherAssignments.map((assignment) => ({
              ...assignment,
              name: assignment.title,
              status: assignment.completed ? "completed" : "active",
            }))
          : data.tasks;
    return tasks.filter((task) => {
      const matchesView =
        view === "shared" || view === "teacher-assigned"
          ? true
          : view === "trash"
            ? Boolean(task.trashedAt)
            : !task.trashedAt &&
              (view === "favorites"
                ? task.favorite
                : view === "archived"
                  ? task.archived
                  : view === "completed"
                    ? task.status === "completed" && !task.archived
                    : view === "in-progress"
                      ? task.status === "in-progress" && !task.archived
                      : view === "drafts"
                        ? task.status === "draft" && !task.archived
                        : !task.archived &&
                          task.status !== "completed" &&
                          task.listId === currentList.id);
      return (
        matchesView &&
        (!normalizedQuery ||
          `${task.name} ${task.description}`
            .toLocaleLowerCase()
            .includes(normalizedQuery))
      );
    });
  }, [currentList.id, data.tasks, query, shared, teacherAssignments, view]);

  const toggleTeacherAssignment = async (task) => {
    try {
      const response = await fetch("/api/education/assignments", {
        body: JSON.stringify({
          assignmentId: task.id,
          completed: !task.completed,
        }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      if (!response.ok) throw new Error("assignment_update_failed");
      const payload = await response.json();
      setTeacherAssignments((current) =>
        current.map((assignment) =>
          assignment.id === payload.assignment.id
            ? payload.assignment
            : assignment,
        ),
      );
    } catch {
      showToast({
        messageKey: "educationAssignmentUpdateFailed",
        type: "error",
      });
    }
  };

  const updateTask = async (task, sharedItem) => {
    if (sharedItem) {
      await updateEncryptedCollaboration(sharedItem, task);
      setShared((current) =>
        current.map((item) =>
          item.id === sharedItem.id ? { ...item, task } : item,
        ),
      );
      return;
    }
    await save({
      ...data,
      tasks: data.tasks.map((item) => (item.id === task.id ? task : item)),
    });
  };

  const submitTask = async (event, status = editing?.status || "active") => {
    event.preventDefault();
    if (!draft.name.trim()) return;
    try {
      const task = {
        ...createTask(
          {
            ...draft,
            listId: editing?.listId || currentList.id,
          },
          editing,
        ),
        status,
      };
      if (editingShared) {
        await updateTask(task, editingShared);
      } else {
        await save(
          {
            ...data,
            tasks: editing
              ? data.tasks.map((item) => (item.id === editing.id ? task : item))
              : [task, ...data.tasks],
          },
          editing ? "edit" : "create",
        );
      }
      setDraft(createEmptyDraft(currentList.id));
      setCategorySuggestionId("");
      setContentSuggestion(null);
      setEditing(null);
      setEditingShared(null);
      showToast({
        message: editing ? copy.tasksTaskUpdated : copy.tasksTaskCreated,
        type: "success",
      });
    } catch {
      showToast({
        message: editing ? copy.tasksUpdateFailed : copy.tasksCreateFailed,
        type: "error",
      });
    }
  };

  const startEditing = (task, sharedItem = null) => {
    setCategorySuggestionId("");
    setContentSuggestion(null);
    const options = (task.options || []).map((option, index) => ({
      ...option,
      subtasks:
        index === 0
          ? [...(option.subtasks || []), ...(task.subtasks || [])]
          : option.subtasks || [],
    }));
    if (options.length === 0 && (task.subtasks || []).length > 0) {
      options.push({
        done: false,
        id: crypto.randomUUID(),
        label: copy.tasksAddOption,
        subtasks: task.subtasks,
      });
    }
    setEditing(task);
    setEditingShared(sharedItem);
    setDraft({
      attachment: task.attachment || null,
      categoryId: task.categoryId || "",
      description: task.description || "",
      dueDate: task.dueDate || "",
      dueTime: task.dueTime || "",
      listId: task.listId || defaultTaskListId,
      name: task.name || "",
      options,
    });
    requestAnimationFrame(() =>
      composerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      }),
    );
  };

  const mutateTask = async (task, changes, sharedItem) => {
    await updateTask(
      { ...task, ...changes, updatedAt: new Date().toISOString() },
      sharedItem,
    );
  };

  const trashTask = async (task) => {
    const deleteNow = () =>
      void save({
        ...data,
        tasks: data.tasks.filter((item) => item.id !== task.id),
      });
    const moveToTrash = () =>
      void mutateTask(task, { trashedAt: new Date().toISOString() });
    if ((task.sharedWith || []).some((item) => item.permission === "edit")) {
      showModal(
        ({ close }) => (
          <DeleteSharedChoice
            close={close}
            copy={copy}
            onCopy={() => {
              const copyTask = {
                ...task,
                id: `task-${crypto.randomUUID()}`,
                name: `${task.name} (${copy.tasksCopy})`,
                sharedWith: [],
                updatedAt: new Date().toISOString(),
              };
              void save({
                ...data,
                tasks: [
                  copyTask,
                  ...data.tasks.filter((item) => item.id !== task.id),
                ],
              });
            }}
            onDelete={deleteNow}
          />
        ),
        {
          ariaLabel: copy.tasksSharedDeleteTitle,
          title: copy.tasksSharedDeleteTitle,
          width: "640px",
          zIndex: 100000002,
        },
      );
      return;
    }
    moveToTrash();
  };

  const performAction = async (action, task, sharedItem) => {
    if (action === "print") {
      setPrintTask(task);
      return;
    }
    if (action === "move-to-list") {
      showModal(
        ({ close }) => (
          <MoveTaskToListForm
            close={close}
            copy={copy}
            currentListId={task.listId || defaultTaskListId}
            lists={data.lists}
            onMove={(listId) => mutateTask(task, { listId }, sharedItem)}
          />
        ),
        {
          ariaLabel: copy.tasksMoveToList,
          title: copy.tasksMoveToList,
          width: "520px",
          zIndex: 100000005,
        },
      );
      return;
    }
    if (action === "share") {
      if (!signedIn) {
        window.location.assign("/signin?callbackUrl=%2Fapps%2Ftasks%2Fshared");
        return;
      }
      showModal(
        ({ close }) => (
          <ShareForm
            close={close}
            copy={copy}
            onShare={async (sharedTask, email, permission) => {
              await shareEncryptedTask({
                email,
                permission,
                task: sharedTask,
              });
              await mutateTask(sharedTask, {
                sharedWith: [
                  ...(sharedTask.sharedWith || []).filter(
                    (item) => item.email !== email,
                  ),
                  { email, permission },
                ],
              });
              showToast({ message: copy.tasksShareSent, type: "success" });
            }}
            task={task}
          />
        ),
        {
          ariaLabel: copy.tasksShare,
          title: copy.tasksShare,
          width: "560px",
          zIndex: 100000002,
        },
      );
      return;
    }
    if (action === "edit") {
      startEditing(task, sharedItem);
      return;
    }
    if (action === "move-up" || action === "move-down") {
      const visibleIndex = visibleTasks.findIndex(
        (item) => item.id === task.id,
      );
      const targetVisibleIndex =
        action === "move-up" ? visibleIndex - 1 : visibleIndex + 1;
      if (
        visibleIndex < 0 ||
        targetVisibleIndex < 0 ||
        targetVisibleIndex >= visibleTasks.length
      ) {
        return;
      }
      const currentIndex = data.tasks.findIndex((item) => item.id === task.id);
      const nextIndex = data.tasks.findIndex(
        (item) => item.id === visibleTasks[targetVisibleIndex].id,
      );
      const tasks = [...data.tasks];
      [tasks[currentIndex], tasks[nextIndex]] = [
        tasks[nextIndex],
        tasks[currentIndex],
      ];
      await save({ ...data, tasks }, "reorder");
      return;
    }
    if (action === "trash") {
      await trashTask(task);
      return;
    }
    if (action === "delete-forever") {
      await save({
        ...data,
        tasks: data.tasks.filter((item) => item.id !== task.id),
      });
      return;
    }
    if (action === "favorite") {
      await mutateTask(task, { favorite: !task.favorite }, sharedItem);
      if (!task.favorite) {
        showToast({ message: "Favorited the Task.", type: "success" });
      }
      return;
    }
    if (action === "complete") {
      await mutateTask(
        task,
        {
          archived: data.settings.autoArchiveCompleted ? true : task.archived,
          archivedAt: data.settings.autoArchiveCompleted
            ? task.archivedAt || new Date().toISOString()
            : task.archivedAt,
          completedAt: new Date().toISOString(),
          status: "completed",
        },
        sharedItem,
      );
      return;
    }
    if (action === "in-progress") {
      await mutateTask(
        task,
        {
          archived: false,
          archivedAt: null,
          completedAt: null,
          status: "in-progress",
        },
        sharedItem,
      );
      return;
    }
    if (action === "archive") {
      await mutateTask(task, {
        archived: true,
        archivedAt: new Date().toISOString(),
      });
      return;
    }
    if (action === "restore") {
      await mutateTask(task, { archived: false, trashedAt: null });
    }
    if (action === "unarchive") {
      await mutateTask(task, { archived: false, archivedAt: null }, sharedItem);
    }
    if (action === "activate") {
      await mutateTask(
        task,
        { completedAt: null, status: "active" },
        sharedItem,
      );
    }
  };

  const handleAction = async (action, task, sharedItem) => {
    try {
      await performAction(action, task, sharedItem);
    } catch {
      showToast({
        message:
          action === "share" ? copy.tasksShareFailed : copy.tasksActionFailed,
        type: "error",
      });
    }
  };

  const toggleItem = async (
    task,
    field,
    itemId,
    sharedItem,
    optionId = null,
  ) => {
    let nextOptions = task.options || [];
    if (field === "subtasks") {
      nextOptions = nextOptions.map((option, index) => ({
        ...option,
        subtasks:
          index === 0
            ? [...(option.subtasks || []), ...(task.subtasks || [])]
            : option.subtasks || [],
      }));
      if (nextOptions.length === 0 && (task.subtasks || []).length > 0) {
        nextOptions = [
          {
            done: false,
            id: `${task.id}-legacy-option`,
            label: copy.tasksAddOption,
            subtasks: task.subtasks,
          },
        ];
      }
      nextOptions = nextOptions.map((option) =>
        option.id === optionId
          ? {
              ...option,
              subtasks: (option.subtasks || []).map((subtask) =>
                subtask.id === itemId
                  ? { ...subtask, done: !subtask.done }
                  : subtask,
              ),
            }
          : option,
      );
    } else {
      nextOptions = nextOptions.map((item) =>
        item.id === itemId ? { ...item, done: !item.done } : item,
      );
    }
    const allChecked =
      nextOptions.length > 0 &&
      nextOptions.every(
        (option) =>
          option.done &&
          (option.subtasks || []).every((subtask) => subtask.done),
      );
    const completedAt = allChecked ? new Date().toISOString() : null;
    await mutateTask(
      task,
      {
        archived:
          allChecked && data.settings.autoArchiveCompleted
            ? true
            : task.archived && task.status !== "completed",
        archivedAt:
          allChecked && data.settings.autoArchiveCompleted
            ? task.archivedAt || completedAt
            : null,
        completedAt,
        options: nextOptions,
        status: allChecked ? "completed" : "in-progress",
        subtasks: [],
      },
      sharedItem,
    );
  };

  const suggestCategory = useCallback(async () => {
    if (
      !data.settings.suggestCategories ||
      !aiFeaturesAllowed ||
      !draft.name.trim()
    ) {
      return;
    }
    setContentSuggestion(null);
    suggestionRequestRef.current?.abort();
    const controller = new AbortController();
    suggestionRequestRef.current = controller;
    const topic = `${draft.name} ${draft.description}`.trim();
    const localSuggestion = draft.categoryId
      ? null
      : getLocalCategorySuggestion(data.categories, topic);
    if (localSuggestion) {
      setCategorySuggestionId(localSuggestion.id);
      setDraft((current) =>
        current.categoryId
          ? current
          : { ...current, categoryId: localSuggestion.id },
      );
    }
    try {
      const response = await fetch("/api/tasks/suggestions", {
        body: JSON.stringify({
          categories: data.categories.map((category) => category.name),
          topic,
        }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: controller.signal,
      });
      if (!response.ok) return;
      const result = await response.json();
      if (
        result.contentSuggestion?.description &&
        Array.isArray(result.contentSuggestion?.options)
      ) {
        setContentSuggestion(result.contentSuggestion);
      }
      const category = data.categories.find(
        (item) => item.name === result.suggestion,
      );
      if (category) {
        setCategorySuggestionId(category.id);
        setDraft((current) =>
          current.categoryId && current.categoryId !== localSuggestion?.id
            ? current
            : { ...current, categoryId: category.id },
        );
      }
    } catch {
      // Suggestions are optional and never block task creation.
    } finally {
      if (suggestionRequestRef.current === controller) {
        suggestionRequestRef.current = null;
      }
    }
  }, [
    data.categories,
    data.settings.suggestCategories,
    aiFeaturesAllowed,
    draft.categoryId,
    draft.description,
    draft.name,
  ]);

  useEffect(() => {
    if (!draft.name.trim()) {
      suggestionRequestRef.current?.abort();
      suggestionRequestRef.current = null;
      return undefined;
    }
    const timer = window.setTimeout(() => void suggestCategory(), 500);
    return () => window.clearTimeout(timer);
  }, [draft.name, suggestCategory]);

  useEffect(() => () => suggestionRequestRef.current?.abort(), []);

  if (loading) {
    return (
      <output className="tasks-workspace-loading">
        {copy.loadingWorkspaces}
      </output>
    );
  }

  if (view === "shared" && !signedIn) {
    return (
      <section className="tasks-workspace">
        <header className="tasks-list-heading">
          <div>
            <h1>{copy.tasksShared}</h1>
            <p>{copy.tasksSyncRequiresSignIn}</p>
          </div>
          <a
            className="tasks-sign-in"
            href="/signin?callbackUrl=%2Fapps%2Ftasks%2Fshared"
          >
            {copy.signIn}
          </a>
        </header>
      </section>
    );
  }

  const selectedCategory = data.categories.find(
    (category) => category.id === draft.categoryId,
  );
  const suggestedCategory = data.categories.find(
    (category) => category.id === categorySuggestionId,
  );

  return (
    <section className="tasks-workspace">
      {printTask
        ? <TaskPrintDocument
            category={data.categories.find(
              (category) => category.id === printTask.categoryId,
            )}
            copy={copy}
            locale={locale}
            task={printTask}
            timeFormat={timeFormat}
          />
        : null}
      {view === "active" || view === "list" || editing
        ? <form
            className="tasks-composer liquid-glass"
            onSubmit={submitTask}
            ref={composerRef}
          >
            <div className="tasks-composer-title">
              <div>
                <span>{editing ? copy.tasksEdit : copy.tasksCreateTask}</span>
                <small>
                  <icon>
                    {storageMode === "account" ? "encrypted" : "devices"}
                  </icon>
                  {copy.tasksEndToEndEncrypted}
                </small>
              </div>
              {editing
                ? <button
                    onClick={() => {
                      setEditing(null);
                      setEditingShared(null);
                      setDraft(createEmptyDraft(currentList.id));
                      setCategorySuggestionId("");
                      setContentSuggestion(null);
                    }}
                    type="button"
                  >
                    {copy.cancel}
                  </button>
                : null}
            </div>
            <div className="tasks-composer-grid">
              <button
                aria-label={copy.tasksInsertImage}
                className="tasks-image-button"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                {draft.attachment?.dataUrl
                  ? // biome-ignore lint/performance/noImgElement: the preview is a local encrypted task image.
                    <img alt="" src={draft.attachment.dataUrl} />
                  : <>
                      <icon className="tasks-image-button-icon">
                        add_photo_alternate
                      </icon>
                      <span>{copy.tasksInsertImage}</span>
                    </>}
              </button>
              <input
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file || file.size > 2_000_000) {
                    if (file)
                      showToast({
                        message: copy.tasksImageTooLarge,
                        type: "error",
                      });
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () =>
                    setDraft((current) => ({
                      ...current,
                      attachment: {
                        dataUrl: String(reader.result),
                        name: file.name,
                        type: file.type,
                      },
                    }));
                  reader.readAsDataURL(file);
                }}
                ref={fileInputRef}
                type="file"
              />
              <div className="tasks-composer-fields">
                <input
                  aria-label={copy.tasksTaskName}
                  maxLength={160}
                  onBlur={suggestCategory}
                  onChange={(event) => {
                    const usedSuggestion =
                      draft.categoryId === categorySuggestionId;
                    if (usedSuggestion) setCategorySuggestionId("");
                    setContentSuggestion(null);
                    setDraft((current) => ({
                      ...current,
                      categoryId: usedSuggestion ? "" : current.categoryId,
                      name: event.target.value,
                    }));
                  }}
                  placeholder={copy.tasksTaskName}
                  required
                  value={draft.name}
                />
                <textarea
                  aria-label={copy.tasksDescription}
                  maxLength={2000}
                  onChange={(event) => {
                    const usedSuggestion =
                      draft.categoryId === categorySuggestionId;
                    if (usedSuggestion) setCategorySuggestionId("");
                    setContentSuggestion(null);
                    setDraft((current) => ({
                      ...current,
                      categoryId: usedSuggestion ? "" : current.categoryId,
                      description: event.target.value,
                    }));
                  }}
                  placeholder={copy.tasksDescription}
                  rows={3}
                  value={draft.description}
                />
                {contentSuggestion
                  ? <div
                      aria-live="polite"
                      className="tasks-content-suggestions"
                    >
                      <span>
                        <icon>auto_awesome</icon>
                        Suggestions
                      </span>
                      {!draft.description.trim()
                        ? <button
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                description: contentSuggestion.description,
                              }))
                            }
                            type="button"
                          >
                            {contentSuggestion.description}
                          </button>
                        : null}
                      <div>
                        {contentSuggestion.options.map((label) => (
                          <button
                            key={label}
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                options: current.options.some(
                                  (option) => option.label === label,
                                )
                                  ? current.options
                                  : [
                                      ...current.options,
                                      {
                                        done: false,
                                        id: crypto.randomUUID(),
                                        label,
                                        subtasks: [],
                                      },
                                    ],
                              }))
                            }
                            type="button"
                          >
                            + {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  : null}
                {!aiFeaturesAllowed
                  ? <div className="tasks-content-suggestions opacity-50">
                      <span>
                        <icon>block</icon>
                        {copy.organizationAiSuggestionsBlocked}
                      </span>
                    </div>
                  : null}
              </div>
            </div>
            <div className="tasks-composer-controls">
              <div className="tasks-category-control">
                <span>{copy.tasksCategories}</span>
                <DropdownWrapper
                  align="left"
                  ariaLabel={copy.tasksCategories}
                  buttonClassName="tasks-category-trigger"
                  className="w-full"
                  panelClassName="max-h-72 w-[min(22rem,calc(100vw-1rem))] overflow-y-auto"
                  trigger={
                    <>
                      <span className="truncate">
                        {selectedCategory?.name || copy.tasksNoCategory}
                      </span>
                      <icon>expand_more</icon>
                    </>
                  }
                  triggerAs="div"
                >
                  {[
                    { id: "", name: copy.tasksNoCategory },
                    ...data.categories,
                  ].map((category) => (
                    <button
                      aria-checked={category.id === draft.categoryId}
                      className="tasks-category-option"
                      key={category.id || "none"}
                      onClick={() => {
                        setCategorySuggestionId("");
                        setDraft((current) => ({
                          ...current,
                          categoryId: category.id,
                        }));
                      }}
                      role="menuitemradio"
                      type="button"
                    >
                      <span>{category.name}</span>
                      {category.id === draft.categoryId
                        ? <icon>check</icon>
                        : null}
                    </button>
                  ))}
                </DropdownWrapper>
                {suggestedCategory
                  ? <small
                      aria-live="polite"
                      className="tasks-category-suggestion"
                    >
                      <icon>auto_awesome</icon>
                      Suggested: {suggestedCategory.name}
                    </small>
                  : null}
              </div>
              <DatePicker
                copy={copy}
                label={copy.tasksDueDate}
                maximumYear={new Date().getFullYear() + 20}
                minimumYear={new Date().getFullYear()}
                onChange={(dueDate) =>
                  setDraft((current) => ({ ...current, dueDate }))
                }
                value={draft.dueDate}
              />
              <TimePicker
                copy={copy}
                locale={locale}
                onChange={(dueTime) =>
                  setDraft((current) => ({ ...current, dueTime }))
                }
                timeFormat={timeFormat}
                value={draft.dueTime}
              />
            </div>
            <OptionsEditor
              copy={copy}
              items={draft.options}
              onChange={(options) =>
                setDraft((current) => ({ ...current, options }))
              }
            />
            <div className="tasks-composer-footer">
              <div>
                <button
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      options: [
                        ...current.options,
                        {
                          done: false,
                          id: crypto.randomUUID(),
                          label: "",
                          subtasks: [],
                        },
                      ],
                    }))
                  }
                  type="button"
                >
                  <icon>add_circle</icon>
                  {copy.tasksAddOption}
                </button>
              </div>
              <button
                disabled={!draft.name.trim()}
                onClick={(event) => submitTask(event, "draft")}
                type="button"
              >
                {copy.tasksDrafts}
              </button>
              <button disabled={!draft.name.trim()} type="submit">
                {editing ? copy.tasksSaveTask : copy.tasksCreateTask}
              </button>
            </div>
          </form>
        : null}

      <header className="tasks-list-heading">
        <div>
          <h1>
            {view === "active" || view === "list"
              ? getTaskListName(currentList, copy)
              : copy[viewKeys[view]]}
          </h1>
          <p>
            {view === "teacher-assigned"
              ? copy.educationTeacherAssignedDescription
              : copy.tasksListDescription}
          </p>
        </div>
        <span>{visibleTasks.length}</span>
      </header>

      {visibleTasks.length === 0
        ? <div className="tasks-empty liquid-glass">
            <icon className="tasks-empty-icon">
              {view === "shared" ? "group" : "checklist"}
            </icon>
            <h2>{copy.tasksNoTasks}</h2>
            <p>{copy.tasksNoTasksDescription}</p>
          </div>
        : <div className="tasks-list">
            {visibleTasks.map((task, index) => {
              const sharedItem =
                view === "shared"
                  ? shared.find((item) => item.task?.id === task.id)
                  : null;
              return (
                <TaskCard
                  categories={data.categories}
                  canMoveDown={
                    view !== "shared" && index < visibleTasks.length - 1
                  }
                  canMoveUp={view !== "shared" && index > 0}
                  copy={copy}
                  key={sharedItem?.id || task.id}
                  lists={data.lists}
                  onAction={handleAction}
                  onToggleItem={toggleItem}
                  onToggleTeacherAssignment={toggleTeacherAssignment}
                  sharedItem={sharedItem}
                  task={task}
                  teacherAssignment={view === "teacher-assigned"}
                  timeFormat={timeFormat}
                  locale={locale}
                  view={view}
                />
              );
            })}
          </div>}
    </section>
  );
}
