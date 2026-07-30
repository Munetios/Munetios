"use client";

import { useState } from "react";
import DropdownWrapper from "./dropdownwrapper";
import { showModal } from "./modal";
import { showToast } from "./toast";

const workspaceUrl = "/api/workspaces";

function interpolate(value, replacements) {
  return Object.entries(replacements).reduce(
    (result, [key, replacement]) =>
      result.replaceAll(`{${key}}`, String(replacement)),
    String(value || ""),
  );
}

async function workspaceRequest(options) {
  const response = await fetch(workspaceUrl, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || `workspace_request_${response.status}`);
  }

  return response.json();
}

function WorkspaceLockForm({
  close,
  copy,
  demo,
  onSaved,
  workspace,
}) {
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setWorking(true);
        try {
          const payload = await workspaceRequest({
            body: JSON.stringify({
              action: "lock",
              locked: !workspace.locked,
              password,
              workspaceId: workspace.id,
            }),
            method: "PATCH",
          });
          onSaved(payload.workspace);
          showToast({ messageKey: "workspaceLockSaved", type: "success" });
          close();
        } catch {
          showToast({ messageKey: "workspaceUpdateFailed", type: "error" });
          setWorking(false);
        }
      }}
    >
      <p className="text-sm leading-6 text-white/70">
        {copy.workspaceLockDescription}
      </p>
      {!demo
        ? <label className="block text-sm font-semibold">
            {copy.accountSecurityCurrentPassword}
            <input
              autoComplete="current-password"
              className="mt-2 w-full rounded-xl border border-white/10 bg-purple-950/35! px-3 py-2.5 text-white outline-none transition focus:border-purple-300/55"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
        : null}
      <button
        className="liquid-glass flex w-full items-center justify-center gap-2 rounded-xl border border-purple-200/20 bg-purple-600/50! px-4 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-55"
        disabled={(!demo && !password) || working}
        type="submit"
      >
        {working ? <icon className="animate-spin">progress_activity</icon> : null}
        {workspace.locked ? copy.workspaceUnlock : copy.workspaceLock}
      </button>
    </form>
  );
}

export default function WorkspaceOptionsWrapper({
  copy,
  demo = false,
  onDeleted,
  onSaved,
  workspace,
}) {
  const workspaceName = workspace.name || workspace.title || copy.workspaceFallback;
  const [name, setName] = useState(workspaceName);
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const saveName = async (event) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || nextName === workspaceName || renaming) {
      return;
    }

    setRenaming(true);
    try {
      const payload = await workspaceRequest({
        body: JSON.stringify({
          action: "rename",
          name: nextName,
          workspaceId: workspace.id,
        }),
        method: "PATCH",
      });
      onSaved(payload.workspace);
      setName(payload.workspace.name || payload.workspace.title);
      showToast({ messageKey: "workspaceRenamed", type: "success" });
    } catch {
      showToast({ messageKey: "workspaceRenameFailed", type: "error" });
    } finally {
      setRenaming(false);
    }
  };

  const openLock = () => {
    showModal(
      ({ close }) => (
        <WorkspaceLockForm
          close={close}
          copy={copy}
          demo={demo}
          onSaved={onSaved}
          workspace={workspace}
        />
      ),
      {
        ariaLabel: workspace.locked
          ? copy.workspaceUnlock
          : copy.workspaceLock,
        title: workspace.locked ? copy.workspaceUnlock : copy.workspaceLock,
        zIndex: 100000004,
      },
    );
  };

  const deleteWorkspace = async () => {
    if (deleting || workspace.primary) {
      return;
    }

    setDeleting(true);
    try {
      await workspaceRequest({
        body: JSON.stringify({ workspaceId: workspace.id }),
        method: "DELETE",
      });
      onDeleted(workspace.id);
      showToast({ messageKey: "workspaceDeleted", type: "success" });
    } catch {
      showToast({ messageKey: "workspaceDeleteFailed", type: "error" });
      setDeleting(false);
    }
  };

  return (
    <DropdownWrapper
      ariaLabel={interpolate(copy.workspaceMoreOptions, {
        name: workspaceName,
      })}
      buttonClassName="h-9! w-9 justify-center px-0!"
      panelClassName="w-[min(22rem,calc(100vw-1rem))] p-3!"
      trigger={<icon>more_vert</icon>}
      triggerAs="button"
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-purple-200/20 bg-purple-500/20!">
            <icon>{workspace.locked ? "lock" : "workspaces"}</icon>
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">
              {workspaceName}
            </p>
            {workspace.primary
              ? <p className="text-xs text-purple-100/65">
                  {copy.workspaceMain}
                </p>
              : null}
          </div>
        </div>

        <form className="space-y-2" onSubmit={saveName}>
          <label className="block text-xs font-semibold text-white/70">
            {copy.workspaceName}
            <input
              autoComplete="off"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-purple-950/30! px-3 py-2.5 text-sm text-white outline-none transition focus:border-purple-300/55"
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              required
              type="text"
              value={name}
            />
          </label>
          <button
            className="liquid-glass flex w-full items-center justify-center gap-2 rounded-xl border border-purple-200/20 bg-purple-600/40! px-3 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
            disabled={
              renaming || !name.trim() || name.trim() === workspaceName
            }
            type="submit"
          >
            {renaming
              ? <icon className="animate-spin">progress_activity</icon>
              : <icon>edit</icon>}
            {copy.workspaceRename}
          </button>
        </form>

        <button
          className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5! px-3 py-2.5 text-left text-sm font-semibold text-white transition hover:bg-white/10!"
          onClick={openLock}
          role="menuitem"
          type="button"
        >
          <icon>{workspace.locked ? "lock_open" : "lock"}</icon>
          {workspace.locked ? copy.workspaceUnlock : copy.workspaceLock}
        </button>

        {workspace.primary
          ? <p className="rounded-xl border border-purple-200/15 bg-purple-500/10! p-3 text-xs leading-5 text-purple-50/70">
              {copy.workspaceMainProtected}
            </p>
          : confirmingDelete
            ? <div className="space-y-2 rounded-xl border border-rose-300/20 bg-rose-950/30! p-3">
                <p className="text-xs leading-5 text-rose-50/80">
                  {interpolate(copy.workspaceDeleteWarning, {
                    name: workspaceName,
                  })}
                </p>
                <div className="flex gap-2">
                  <button
                    className="flex-1 rounded-xl border border-white/10 bg-white/5! px-3 py-2 text-xs font-bold"
                    onClick={() => setConfirmingDelete(false)}
                    type="button"
                  >
                    {copy.cancel}
                  </button>
                  <button
                    className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-rose-300/25 bg-rose-600/45! px-3 py-2 text-xs font-bold text-rose-50 disabled:opacity-55"
                    disabled={deleting}
                    onClick={deleteWorkspace}
                    type="button"
                  >
                    {deleting
                      ? <icon className="animate-spin">progress_activity</icon>
                      : null}
                    {copy.workspaceDelete}
                  </button>
                </div>
              </div>
            : <button
                className="flex w-full items-center gap-2 rounded-xl border border-rose-300/15 bg-rose-950/20! px-3 py-2.5 text-left text-sm font-semibold text-rose-100 transition hover:bg-rose-900/30!"
                onClick={() => setConfirmingDelete(true)}
                type="button"
              >
                <icon>delete</icon>
                {copy.workspaceDelete}
              </button>}
      </div>
    </DropdownWrapper>
  );
}
