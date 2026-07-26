"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DatePicker from "../../../components/datePicker";
import DropdownWrapper from "../../../components/dropdownwrapper";
import { showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";
import { getCurrentLocale, t } from "../../../i18n";
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
  saveLocalEncryptedData,
  saveUnlockedAccountData,
  withTasksWorkspaceData,
} from "../lib/encryptedVault";

const defaultSettings = {
  autoArchiveCompleted: false,
  autoArchivePastDue: false,
  suggestCategories: true,
};
const viewKeys = {
  active: "tasksAllTasks",
  archived: "tasksArchived",
  completed: "tasksCompleted",
  favorites: "tasksFavorites",
  "in-progress": "tasksInProgress",
  shared: "tasksShared",
  trash: "tasksTrash",
};

function createEmptyDraft() {
  return {
    attachment: null,
    categoryId: "",
    description: "",
    dueDate: "",
    dueTime: "",
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
  const dateText = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  if (!task.dueTime) return dateText;
  const [hour, minute] = task.dueTime.split(":").map(Number);
  const hour12 =
    timeFormat === "12-hour"
      ? true
      : timeFormat === "24-hour"
        ? false
        : new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions()
            .hour12;
  const timeText = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    hour12,
    minute: "2-digit",
  }).format(new Date(2024, 0, 1, hour, minute));
  return `${dateText} · ${timeText}`;
}

function TimePicker({ copy, locale, onChange, timeFormat, value }) {
  const [hour = "", minute = ""] = String(value || "").split(":");
  const hour12 =
    timeFormat === "12-hour"
      ? true
      : timeFormat === "24-hour"
        ? false
        : new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions()
            .hour12;
  const hours = Array.from({ length: 24 }, (_, index) => ({
    label: new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      hour12,
    }).format(new Date(2024, 0, 1, index)),
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

function TaskCard({
  categories,
  canMoveDown,
  canMoveUp,
  copy,
  onAction,
  onToggleItem,
  sharedItem,
  task,
  timeFormat,
  locale,
  view,
}) {
  const category = categories.find((item) => item.id === task.categoryId);
  const canEdit = !sharedItem || sharedItem.permission === "edit";
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
            </div>
            <h2>{task.name}</h2>
            {task.description ? <p>{task.description}</p> : null}
          </div>
          <div className="tasks-card-actions">
            {!sharedItem
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
            <button
              aria-label={copy.tasksFavorite}
              aria-pressed={task.favorite}
              disabled={!canEdit}
              onClick={() => onAction("favorite", task, sharedItem)}
              title={copy.tasksFavorite}
              type="button"
            >
              <icon>{task.favorite ? "star" : "star_border"}</icon>
            </button>
            <DropdownWrapper
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
                : <>
                    <button
                      data-dropdown-close
                      disabled={!canEdit}
                      onClick={() => onAction("complete", task, sharedItem)}
                      type="button"
                    >
                      <icon>task_alt</icon>
                      {copy.tasksMoveCompleted}
                    </button>
                    <button
                      data-dropdown-close
                      onClick={() => window.print()}
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

export default function TasksWorkspace({ view = "active" }) {
  const [copy, setCopy] = useState(() => t("en"));
  const [locale, setLocale] = useState("en");
  const [timeFormat, setTimeFormat] = useState("auto");
  const [data, setData] = useState({
    categories: [],
    settings: defaultSettings,
    tasks: [],
  });
  const [draft, setDraft] = useState(createEmptyDraft);
  const [editing, setEditing] = useState(null);
  const [editingShared, setEditingShared] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [shared, setShared] = useState([]);
  const [storageMode, setStorageMode] = useState("local");
  const [vaultData, setVaultData] = useState(null);
  const [workspaceId, setWorkspaceId] = useState("default");
  const fileInputRef = useRef(null);
  const composerRef = useRef(null);
  const syncChannelRef = useRef(null);

  const load = useCallback(async () => {
    const activeWorkspaceId = getActiveTasksWorkspaceId();
    setWorkspaceId(activeWorkspaceId);
    try {
      const sessionResponse = await fetch("/api/signedin", {
        cache: "no-store",
        credentials: "include",
      });
      const session = await sessionResponse.json();
      if (sessionResponse.ok && session.authenticated && session.signedIn) {
        try {
          const accountData = await ensureAccountVaultUnlocked();
          const scopedData = getTasksWorkspaceData(
            accountData,
            activeWorkspaceId,
          );
          const needsMigration =
            Object.keys(accountData.workspaces || {}).length === 0 &&
            ((accountData.categories || []).length > 0 ||
              (accountData.tasks || []).length > 0);
          const resolvedAccountData = needsMigration
            ? withTasksWorkspaceData(accountData, scopedData, activeWorkspaceId)
            : accountData;
          if (needsMigration) {
            await saveUnlockedAccountData(resolvedAccountData);
          }
          setStorageMode("account");
          setVaultData(resolvedAccountData);
          setData({
            categories: scopedData.categories,
            settings: { ...defaultSettings, ...scopedData.settings },
            tasks: scopedData.tasks,
          });
          return;
        } catch {
          // The device can keep working from its encrypted local vault.
        }
      }
      setStorageMode("local");
      const localData = await readLocalEncryptedData();
      const scopedData = getTasksWorkspaceData(localData, activeWorkspaceId);
      const needsMigration =
        Object.keys(localData.workspaces || {}).length === 0 &&
        ((localData.categories || []).length > 0 ||
          (localData.tasks || []).length > 0);
      const resolvedLocalData = needsMigration
        ? withTasksWorkspaceData(localData, scopedData, activeWorkspaceId)
        : localData;
      if (needsMigration) {
        await saveLocalEncryptedData(resolvedLocalData);
      }
      setVaultData(resolvedLocalData);
      setData({
        categories: scopedData.categories,
        settings: { ...defaultSettings, ...scopedData.settings },
        tasks: scopedData.tasks,
      });
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
      if (storageMode === "account" && getUnlockedAccountData()) {
        await saveUnlockedAccountData(nextVaultData);
      } else {
        await saveLocalEncryptedData(nextVaultData);
      }
      setVaultData(nextVaultData);
      setData(nextData);
      syncChannelRef.current?.postMessage({ action, updatedAt: Date.now() });
      window.dispatchEvent(
        new CustomEvent("munetios:taskschange", {
          detail: { action, tasks: nextData.tasks },
        }),
      );
    },
    [storageMode, vaultData, workspaceId],
  );

  const refreshShared = useCallback(async () => {
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
  }, [save]);

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
    void refreshShared();
    const interval = window.setInterval(refreshShared, 3_000);
    return () => window.clearInterval(interval);
  }, [refreshShared]);

  const visibleTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const tasks =
      view === "shared" ? shared.map((item) => item.task) : data.tasks;
    return tasks.filter((task) => {
      const matchesView =
        view === "shared"
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
                      : !task.archived && task.status !== "completed");
      return (
        matchesView &&
        (!normalizedQuery ||
          `${task.name} ${task.description}`
            .toLocaleLowerCase()
            .includes(normalizedQuery))
      );
    });
  }, [data.tasks, query, shared, view]);

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

  const submitTask = async (event) => {
    event.preventDefault();
    if (!draft.name.trim()) return;
    const task = createTask(draft, editing);
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
    setDraft(createEmptyDraft());
    setEditing(null);
    setEditingShared(null);
    showToast({
      message: editing ? copy.tasksTaskUpdated : copy.tasksTaskCreated,
      type: "success",
    });
  };

  const startEditing = (task, sharedItem = null) => {
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

  const handleAction = async (action, task, sharedItem) => {
    if (action === "share") {
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
      return;
    }
    if (action === "complete") {
      await mutateTask(
        task,
        {
          completedAt: new Date().toISOString(),
          status: "completed",
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
    await mutateTask(
      task,
      {
        options: nextOptions,
        status:
          task.status === "active" && field === "subtasks"
            ? "in-progress"
            : task.status,
        subtasks: [],
      },
      sharedItem,
    );
  };

  const suggestCategory = useCallback(async () => {
    if (
      !data.settings.suggestCategories ||
      !draft.name.trim() ||
      data.categories.length === 0
    ) {
      return;
    }
    try {
      const response = await fetch("/api/tasks/suggestions", {
        body: JSON.stringify({
          categories: data.categories.map((category) => category.name),
          topic: `${draft.name} ${draft.description}`.trim(),
        }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = await response.json();
      const category = data.categories.find(
        (item) => item.name === result.suggestion,
      );
      if (category)
        setDraft((current) => ({ ...current, categoryId: category.id }));
    } catch {
      // Suggestions are optional and never block task creation.
    }
  }, [
    data.categories,
    data.settings.suggestCategories,
    draft.description,
    draft.name,
  ]);

  if (loading) {
    return (
      <output className="tasks-workspace-loading">
        {copy.loadingWorkspaces}
      </output>
    );
  }

  const selectedCategory = data.categories.find(
    (category) => category.id === draft.categoryId,
  );

  return (
    <section className="tasks-workspace">
      {view === "active" || editing
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
                      setDraft(createEmptyDraft());
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
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder={copy.tasksTaskName}
                  required
                  value={draft.name}
                />
                <textarea
                  aria-label={copy.tasksDescription}
                  maxLength={2000}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder={copy.tasksDescription}
                  rows={3}
                  value={draft.description}
                />
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
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          categoryId: category.id,
                        }))
                      }
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
              <button disabled={!draft.name.trim()} type="submit">
                {editing ? copy.tasksSaveTask : copy.tasksCreateTask}
              </button>
            </div>
          </form>
        : null}

      <header className="tasks-list-heading">
        <div>
          <h1>{copy[viewKeys[view]]}</h1>
          <p>{copy.tasksListDescription}</p>
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
                  onAction={handleAction}
                  onToggleItem={toggleItem}
                  sharedItem={sharedItem}
                  task={task}
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
