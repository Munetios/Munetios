"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { showModal } from "./modal";
import { showToast } from "./toast";

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (!value) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(
    units.length - 1,
    Math.floor(Math.log(value) / Math.log(1024)),
  );
  const amount = value / 1024 ** unitIndex;
  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

function DeleteStorageFileModal({ close, copy, file, onDelete }) {
  const [deleting, setDeleting] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-sm leading-6 text-white/72">
        {copy.accountStorageDeleteConfirmBody.replace("{name}", file.name)}
      </p>
      <div className="flex justify-end gap-2">
        <button
          className="rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/10!"
          disabled={deleting}
          onClick={close}
          type="button"
        >
          {copy.cancel}
        </button>
        <button
          className="rounded-xl border border-rose-200/20 bg-rose-500/20! px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/30!"
          disabled={deleting}
          onClick={async () => {
            setDeleting(true);
            const deleted = await onDelete(file.id);
            setDeleting(false);
            if (deleted) close();
          }}
          type="button"
        >
          {deleting ? copy.accountProcessing : copy.delete}
        </button>
      </div>
    </div>
  );
}

function StorageUpgradeModal({ copy }) {
  return (
    <div className="liquid-glass rounded-2xl border border-purple-200/20 bg-purple-500/15! p-5 text-center">
      <icon className="text-3xl text-purple-200">schedule</icon>
      <strong className="mt-2 block text-lg">{copy.comingSoon}</strong>
      <p className="mt-2 text-sm text-white/65">96 GB</p>
    </div>
  );
}

export default function AccountStorageSection({
  copy,
  deletedAccount = false,
  managedStudent = false,
}) {
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [storage, setStorage] = useState({
    availableBytes: 0,
    files: [],
    totalBytes: 0,
    usedBytes: 0,
  });
  const filesRef = useRef(null);

  const loadStorage = useCallback(async () => {
    if (deletedAccount) {
      setStorage({ availableBytes: 0, files: [], totalBytes: 0, usedBytes: 0 });
      setLoadFailed(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch("/api/storage", {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) throw new Error("storage_load_failed");
      const payload = await response.json();
      setStorage({
        availableBytes: Math.max(0, Number(payload.availableBytes) || 0),
        files: Array.isArray(payload.files) ? payload.files : [],
        totalBytes: Math.max(0, Number(payload.totalBytes) || 0),
        usedBytes: Math.max(0, Number(payload.usedBytes) || 0),
      });
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [deletedAccount]);

  useEffect(() => {
    void loadStorage();
    window.addEventListener("munetios:accountstoragechange", loadStorage);
    return () =>
      window.removeEventListener("munetios:accountstoragechange", loadStorage);
  }, [loadStorage]);

  const deleteFile = async (fileId) => {
    try {
      const response = await fetch(
        `/api/storage?${new URLSearchParams({ fileId })}`,
        { credentials: "include", method: "DELETE" },
      );
      if (!response.ok) throw new Error("file_delete_failed");
      const payload = await response.json();
      setStorage({
        availableBytes: Math.max(0, Number(payload.availableBytes) || 0),
        files: Array.isArray(payload.files) ? payload.files : [],
        totalBytes: Math.max(0, Number(payload.totalBytes) || 0),
        usedBytes: Math.max(0, Number(payload.usedBytes) || 0),
      });
      window.dispatchEvent(new Event("munetios:accountstoragechange"));
      showToast({ messageKey: "accountStorageDeleted", type: "success" });
      return true;
    } catch {
      showToast({ messageKey: "accountStorageDeleteFailed", type: "error" });
      return false;
    }
  };

  const usagePercent = storage.totalBytes
    ? Math.min(100, (storage.usedBytes / storage.totalBytes) * 100)
    : 0;
  const storageIsFull = deletedAccount || storage.availableBytes <= 100;
  const storageIsAlmostFull =
    !storageIsFull && storage.availableBytes <= 10 * 1024 ** 3;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">{copy.accountSettingsStorage}</h1>
        <p className="mt-1 text-sm leading-6 text-white/62">
          {copy.accountSettingsStorageDescription}
        </p>
      </header>

      <section className="liquid-glass rounded-2xl border border-white/10 bg-white/5! p-3">
        {!loading && !loadFailed && (storageIsFull || storageIsAlmostFull)
          ? <output
              className={`mb-3 rounded-xl border p-3 text-sm font-semibold ${storageIsFull ? "border-rose-300/25 bg-rose-500/15! text-rose-100" : "border-amber-300/25 bg-amber-500/15! text-amber-100"}`}
            >
              {storageIsFull
                ? copy.storageFullWarning
                : copy.storageAlmostFullWarning}
            </output>
          : null}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="text-sm text-white/58">{copy.storageUsed}</span>
            <strong className="mt-1 block text-xl">
              {formatBytes(storage.usedBytes)} /{" "}
              {formatBytes(storage.totalBytes)}
            </strong>
          </div>
          <div className="text-right">
            <span className="text-sm text-white/58">
              {copy.accountStorageAvailable}
            </span>
            <strong className="mt-1 block text-base">
              {formatBytes(storage.availableBytes)}
            </strong>
          </div>
        </div>
        <div
          aria-label={`${copy.storageUsed}: ${Math.round(usagePercent)}%`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(usagePercent)}
          className="mt-3 h-2 overflow-hidden rounded-full bg-white/10!"
          role="progressbar"
        >
          <span
            className="block h-full rounded-full bg-purple-400/75! transition-[width]"
            style={{ width: `${usagePercent}%` }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="liquid-glass rounded-xl border border-purple-200/20 px-3 py-2 text-sm font-semibold hover:bg-white/10!"
            onClick={() => {
              showToast({
                messageKey: "accountStorageFreeUpToast",
                type: "info",
              });
              filesRef.current?.focus();
              filesRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
              });
            }}
            type="button"
          >
            {copy.accountStorageFreeUp}
          </button>
          {!managedStudent
            ? <button
                className="liquid-glass rounded-xl border border-purple-200/20 bg-purple-600/45! px-3 py-2 text-sm font-bold hover:bg-purple-500/55!"
                onClick={() =>
                  showModal(() => <StorageUpgradeModal copy={copy} />, {
                    ariaLabel: copy.aiProfileUpgradePlan,
                    title: copy.aiProfileUpgradePlan,
                    width: "min(46rem, calc(100vw - 1rem))",
                  })
                }
                type="button"
              >
                {copy.aiProfileUpgradePlan}
              </button>
            : null}
        </div>
      </section>

      <section
        aria-label={copy.accountStorageFiles}
        className="space-y-2 outline-none"
        ref={filesRef}
        tabIndex={-1}
      >
        <h2 className="text-lg font-bold">{copy.accountStorageFiles}</h2>
        {loading
          ? <p className="text-sm text-white/58">
              {copy.accountStorageLoading}
            </p>
          : null}
        {!loading && loadFailed
          ? <p className="rounded-xl border border-rose-300/20 bg-rose-500/10! p-3 text-sm text-rose-100">
              Failed to load files
            </p>
          : null}
        {!loading && !loadFailed && !storage.files.length
          ? <p className="rounded-xl border border-white/10 bg-white/5! p-3 text-sm text-white/58">
              {copy.accountStorageNoFiles}
            </p>
          : null}
        {storage.files.map((file) => (
          <article
            className="liquid-glass flex items-center gap-3 rounded-xl border border-white/10 bg-white/5! p-2.5"
            key={file.id}
          >
            <span className="grid h-10 w-10 min-w-10 place-items-center rounded-xl bg-white/8!">
              <icon>
                {file.contentType?.startsWith("image/")
                  ? "image"
                  : file.contentType?.startsWith("video/")
                    ? "movie"
                    : "draft"}
              </icon>
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-sm">{file.name}</strong>
              <small className="mt-0.5 block text-white/52">
                {formatBytes(file.size)}
              </small>
            </span>
            <button
              aria-label={`${copy.delete}: ${file.name}`}
              className="grid h-10 w-10 min-h-10 min-w-10 place-items-center rounded-xl border border-rose-200/15 bg-rose-500/15! text-rose-100 hover:bg-rose-500/25!"
              onClick={() =>
                showModal(
                  ({ close }) => (
                    <DeleteStorageFileModal
                      close={close}
                      copy={copy}
                      file={file}
                      onDelete={deleteFile}
                    />
                  ),
                  {
                    ariaLabel: copy.accountStorageDeleteConfirmTitle,
                    title: copy.accountStorageDeleteConfirmTitle,
                    width: "min(430px, 100%)",
                  },
                )
              }
              type="button"
            >
              <icon>delete</icon>
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}
