"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import DropdownWrapper from "../../../components/dropdownwrapper";
import { showToast } from "../../../components/toast";
import { hasSignedInCookie } from "../../../lib/signedInCookie";
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
  defaultTaskListId,
  getTaskListHref,
  getTaskListName,
  readCachedTaskLists,
} from "../lib/taskLists";

const navigationItems = [
  { href: "/apps/tasks/favorites", icon: "star", key: "tasksFavorites" },
  {
    href: "/apps/tasks/categories",
    icon: "category",
    key: "tasksCategories",
  },
  { href: "/apps/tasks/shared", icon: "group", key: "tasksShared" },
  {
    href: "/apps/tasks/completed",
    icon: "task_alt",
    key: "tasksCompleted",
  },
  { href: "/apps/tasks/drafts", icon: "draft", key: "tasksDrafts" },
  {
    href: "/apps/tasks/in-progress",
    icon: "pending_actions",
    key: "tasksInProgress",
  },
  { href: "/apps/tasks/archived", icon: "archive", key: "tasksArchived" },
  { href: "/apps/tasks/trash", icon: "delete", key: "tasksTrash" },
];

async function updateStoredList(update) {
  const workspaceId = getActiveTasksWorkspaceId();
  const signedIn = hasSignedInCookie();
  const document = signedIn
    ? getUnlockedAccountData()
      ? await refreshUnlockedAccountData()
      : await ensureAccountVaultUnlocked()
    : await readLocalEncryptedData();
  const scopedData = getTasksWorkspaceData(document, workspaceId);
  const nextScopedData = update(scopedData);
  const nextDocument = withTasksWorkspaceData(
    document,
    nextScopedData,
    workspaceId,
  );
  if (signedIn) {
    await saveUnlockedAccountData(nextDocument);
  } else {
    await saveLocalEncryptedData(nextDocument);
  }
  cacheTaskLists(workspaceId, nextScopedData.lists);
  window.dispatchEvent(
    new CustomEvent("munetios:taskschange", {
      detail: { action: "list-update", tasks: nextScopedData.tasks },
    }),
  );
  const channel = new BroadcastChannel("munetios-tasks-sync");
  channel.postMessage({ action: "list-update", updatedAt: Date.now() });
  channel.close();
  return nextScopedData;
}

function TaskListOptionsWrapper({ copy, list, lists, onNavigate }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(() => getTaskListName(list, copy));
  const [saving, setSaving] = useState(false);
  const duplicate = lists.some(
    (item) =>
      item.id !== list.id &&
      getTaskListName(item, copy).toLocaleLowerCase() ===
        name.trim().toLocaleLowerCase(),
  );

  const rename = async (event) => {
    event.preventDefault();
    if (!name.trim() || duplicate || saving) return;
    setSaving(true);
    try {
      await updateStoredList((scopedData) => ({
        ...scopedData,
        lists: scopedData.lists.map((item) =>
          item.id === list.id
            ? {
                ...item,
                name: name.trim(),
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      }));
    } catch {
      showToast({ message: copy.tasksUpdateFailed, type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (list.system || saving) return;
    setSaving(true);
    try {
      await updateStoredList((scopedData) => ({
        ...scopedData,
        lists: scopedData.lists.filter((item) => item.id !== list.id),
        tasks: scopedData.tasks.map((task) =>
          task.listId === list.id
            ? {
                ...task,
                listId: defaultTaskListId,
                updatedAt: new Date().toISOString(),
              }
            : task,
        ),
      }));
      onNavigate?.();
      window.location.assign("/apps/tasks");
    } catch {
      setSaving(false);
      showToast({ message: copy.tasksUpdateFailed, type: "error" });
    }
  };

  return (
    <DropdownWrapper
      align="right"
      ariaLabel={copy.tasksListMoreOptions.replace(
        "{name}",
        getTaskListName(list, copy),
      )}
      buttonClassName="tasks-sidebar-list-more"
      panelClassName="w-80 max-w-[calc(100vw-1rem)]"
      trigger={<icon>more_vert</icon>}
      triggerAs="button"
      triggerGlass={false}
      zIndex={100000005}
    >
      <form
        className="grid gap-3 p-2"
        data-dropdown-keep-open="true"
        onSubmit={rename}
      >
        <label className="grid gap-2 text-sm font-semibold text-white/85">
          {copy.tasksListName}
          <input
            autoComplete="off"
            className="w-full rounded-xl border border-white/10 bg-white/10! px-3 py-2.5 text-white outline-none focus:border-purple-300/55"
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </label>
        {duplicate
          ? <p className="text-sm text-rose-200">
              {copy.tasksListAlreadyExists}
            </p>
          : null}
        {list.system
          ? <p className="text-xs leading-5 text-white/60">
              {copy.tasksDefaultListProtected}
            </p>
          : null}
        <button
          className="rounded-xl border border-purple-200/20 bg-purple-500/40! px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!name.trim() || duplicate || saving}
          type="submit"
        >
          {copy.tasksRenameList}
        </button>
        {!list.system
          ? confirmDelete
            ? <div className="grid gap-2 rounded-xl border border-rose-200/15 bg-rose-500/10! p-3">
                <p className="text-sm leading-5 text-white/75">
                  {copy.tasksDeleteListWarning.replace(
                    "{name}",
                    getTaskListName(list, copy),
                  )}
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    className="rounded-lg px-3 py-2 text-sm text-white/70"
                    onClick={() => setConfirmDelete(false)}
                    type="button"
                  >
                    {copy.cancel}
                  </button>
                  <button
                    className="rounded-lg border border-rose-200/20 bg-rose-500/40! px-3 py-2 text-sm font-semibold text-white"
                    disabled={saving}
                    onClick={remove}
                    type="button"
                  >
                    {copy.tasksDeleteList}
                  </button>
                </div>
              </div>
            : <button
                className="rounded-xl border border-rose-200/15 bg-rose-500/15! px-3 py-2.5 text-sm font-semibold text-rose-100"
                onClick={() => setConfirmDelete(true)}
                type="button"
              >
                {copy.tasksDeleteList}
              </button>
          : null}
      </form>
    </DropdownWrapper>
  );
}

export default function TasksSidebar({ copy, expanded, onNavigate }) {
  const pathname = usePathname();
  const [lists, setLists] = useState(() => readCachedTaskLists("default"));
  const [studentAccount, setStudentAccount] = useState(false);

  useEffect(() => {
    const refresh = (event) => {
      setLists(
        Array.isArray(event?.detail)
          ? event.detail
          : readCachedTaskLists(getActiveTasksWorkspaceId()),
      );
    };
    refresh();
    window.addEventListener("munetios:tasklistschange", refresh);
    window.addEventListener("munetios:workspacechange", refresh);
    return () => {
      window.removeEventListener("munetios:tasklistschange", refresh);
      window.removeEventListener("munetios:workspacechange", refresh);
    };
  }, []);

  useEffect(() => {
    if (!hasSignedInCookie()) return;
    fetch("/api/account", { cache: "no-store", credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((account) =>
        setStudentAccount(account?.education?.role === "student"),
      )
      .catch(() => setStudentAccount(false));
  }, []);

  return (
    <aside
      aria-label={copy.tasksSidebarNavigation}
      className="tasks-sidebar liquid-glass"
      data-expanded={expanded ? "true" : "false"}
    >
      <nav
        aria-label={copy.tasksSidebarNavigation}
        className="tasks-sidebar-navigation"
      >
        {navigationItems.map((item) => {
          const isCurrent =
            item.href === "/apps/tasks"
              ? pathname === item.href
              : pathname.startsWith(item.href);
          const content = (
            <>
              <span className="tasks-sidebar-icon">
                <icon>{item.icon}</icon>
              </span>
              <span className="tasks-nav-label">{copy[item.key]}</span>
            </>
          );

          return (
            <Link
              aria-current={isCurrent ? "page" : undefined}
              aria-label={copy[item.key]}
              className="tasks-sidebar-item"
              href={item.href}
              key={item.key}
              onClick={onNavigate}
              title={copy[item.key]}
            >
              {content}
            </Link>
          );
        })}
        {expanded
          ? <section
              aria-label={copy.tasksLists}
              className="tasks-sidebar-lists"
            >
              <header>
                <span>{copy.tasksLists}</span>
                <Link
                  aria-label={copy.tasksAddList}
                  className="tasks-sidebar-add-list"
                  href="/apps/tasks?addList=1"
                  onClick={onNavigate}
                  title={copy.tasksAddList}
                >
                  <icon>add</icon>
                </Link>
              </header>
              <div>
                {studentAccount
                  ? <div className="tasks-sidebar-list-row">
                      <Link
                        aria-current={
                          pathname.startsWith("/apps/tasks/teacher-assigned")
                            ? "page"
                            : undefined
                        }
                        aria-label={copy.educationTeacherAssigned}
                        className="tasks-sidebar-item"
                        href="/apps/tasks/teacher-assigned"
                        onClick={onNavigate}
                        title={copy.educationTeacherAssigned}
                      >
                        <span className="tasks-sidebar-icon">
                          <icon>assignment_turned_in</icon>
                        </span>
                        <span className="tasks-nav-label">
                          {copy.educationTeacherAssigned}
                        </span>
                      </Link>
                    </div>
                  : null}
                {lists.map((list) => {
                  const href = getTaskListHref(list);
                  const isCurrent = list.system
                    ? pathname === "/apps/tasks"
                    : pathname.startsWith(
                        `/apps/tasks/list/${encodeURIComponent(list.slug)}`,
                      );
                  return (
                    <div className="tasks-sidebar-list-row" key={list.id}>
                      <Link
                        aria-current={isCurrent ? "page" : undefined}
                        aria-label={getTaskListName(list, copy)}
                        className="tasks-sidebar-item"
                        href={href}
                        onClick={onNavigate}
                        title={getTaskListName(list, copy)}
                      >
                        <span className="tasks-sidebar-icon">
                          <icon>{list.system ? "checklist" : "list_alt"}</icon>
                        </span>
                        <span className="tasks-nav-label">
                          {getTaskListName(list, copy)}
                        </span>
                      </Link>
                      <TaskListOptionsWrapper
                        copy={copy}
                        list={list}
                        lists={lists}
                        onNavigate={onNavigate}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          : null}
      </nav>
    </aside>
  );
}
