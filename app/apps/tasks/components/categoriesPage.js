"use client";

import { useCallback, useEffect, useState } from "react";
import { showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";
import { t } from "../../../i18n";
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

const categoryColors = [
  "#8b5cf6",
  "#a855f7",
  "#ec4899",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
];

function announceCategories(categories) {
  window.dispatchEvent(
    new CustomEvent("munetios:taskcategorieschange", { detail: categories }),
  );
  return categories;
}

function createLocalCategory({ color, name }) {
  const now = new Date().toISOString();
  return {
    color,
    createdAt: now,
    id: `category-${crypto.randomUUID()}`,
    name,
    updatedAt: now,
  };
}

function AddCategoryForm({ close, copy, onCreate }) {
  const [color, setColor] = useState(categoryColors[0]);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName || saving) return;

    setSaving(true);
    const created = await onCreate({ color, name: normalizedName });
    setSaving(false);
    if (created) close();
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <label className="block text-sm font-semibold text-white/85">
        {copy.tasksCategoryName}
        <input
          autoComplete="off"
          className="mt-2 w-full rounded-2xl border border-white/10 bg-white/8! px-4 py-3 text-white outline-none transition placeholder:text-white/35 focus:border-purple-300/55"
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          placeholder={copy.tasksCategoryName}
          required
          value={name}
        />
      </label>
      <fieldset className="border-0 p-0">
        <legend className="mb-2 text-sm font-semibold text-white/85">
          {copy.tasksCategoryColor}
        </legend>
        <div className="flex flex-wrap gap-2">
          {categoryColors.map((categoryColor) => (
            <button
              aria-label={`${copy.tasksCategoryColor} ${categoryColor}`}
              aria-pressed={color === categoryColor}
              className="h-9 w-9 rounded-full border-2 transition hover:scale-105"
              key={categoryColor}
              onClick={() => setColor(categoryColor)}
              style={{
                backgroundColor: categoryColor,
                borderColor: color === categoryColor ? "white" : "transparent",
              }}
              type="button"
            />
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end gap-2">
        <button
          className="rounded-full border border-white/10 bg-white/5! px-4 py-2 text-sm font-semibold text-white/75 transition hover:bg-white/10! hover:text-white"
          onClick={close}
          type="button"
        >
          {copy.cancel}
        </button>
        <button
          className="rounded-full border border-purple-200/25 bg-purple-500/80! px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-400/90! disabled:opacity-50"
          disabled={!name.trim() || saving}
          type="submit"
        >
          {copy.tasksAddCategory}
        </button>
      </div>
    </form>
  );
}

function DeleteCategoryConfirmation({ category, close, copy, onDelete }) {
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-white/75">
        {copy.tasksDeleteCategoryWarning.replace("{name}", category.name)}
      </p>
      <div className="flex justify-end gap-2">
        <button
          className="rounded-full border border-white/10 bg-white/5! px-4 py-2 text-sm font-semibold text-white/75 transition hover:bg-white/10! hover:text-white"
          onClick={close}
          type="button"
        >
          {copy.cancel}
        </button>
        <button
          className="rounded-full border border-rose-200/25 bg-rose-500/70! px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-400/80! disabled:opacity-50"
          disabled={deleting}
          onClick={async () => {
            setDeleting(true);
            const deleted = await onDelete(category);
            setDeleting(false);
            if (deleted) close();
          }}
          type="button"
        >
          {copy.tasksDeleteCategory}
        </button>
      </div>
    </div>
  );
}

export default function TasksCategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [copy, setCopy] = useState(() => t("en"));
  const [loading, setLoading] = useState(true);
  const [storageMode, setStorageMode] = useState("local");

  const loadCategories = useCallback(async () => {
    setLoading(true);
    try {
      const sessionResponse = await fetch("/api/signedin", {
        cache: "no-store",
        credentials: "include",
      });
      const session = await sessionResponse.json();
      const signedIn = Boolean(
        sessionResponse.ok && session.authenticated && session.signedIn,
      );

      if (!signedIn) {
        setStorageMode("local");
        const data = await readLocalEncryptedData();
        const scopedData = getTasksWorkspaceData(data);
        const needsMigration =
          Object.keys(data.workspaces || {}).length === 0 &&
          ((data.categories || []).length > 0 || (data.tasks || []).length > 0);
        if (needsMigration) {
          await saveLocalEncryptedData(
            withTasksWorkspaceData(data, scopedData),
          );
        }
        setCategories(scopedData.categories);
        return;
      }

      setStorageMode("account");
      try {
        const data = await ensureAccountVaultUnlocked();
        const scopedData = getTasksWorkspaceData(data);
        const needsMigration =
          Object.keys(data.workspaces || {}).length === 0 &&
          ((data.categories || []).length > 0 || (data.tasks || []).length > 0);
        if (needsMigration) {
          await saveUnlockedAccountData(
            withTasksWorkspaceData(data, scopedData),
          );
        }
        setCategories(scopedData.categories);
      } catch {
        setStorageMode("local");
        const data = await readLocalEncryptedData();
        const scopedData = getTasksWorkspaceData(data);
        setCategories(scopedData.categories);
      }
    } catch {
      // Authentication and the shared Tasks shell can both request this data
      // during startup. Keep the page usable while the next auth refresh retries.
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const refreshCopy = () => setCopy(t());
    refreshCopy();
    void loadCategories();
    window.addEventListener("munetios:authchange", loadCategories);
    window.addEventListener("munetios:workspacechange", loadCategories);
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);
    return () => {
      window.removeEventListener("munetios:authchange", loadCategories);
      window.removeEventListener("munetios:workspacechange", loadCategories);
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
    };
  }, [loadCategories]);

  const createCategory = async ({ color, name }) => {
    if (
      categories.some(
        (category) =>
          category.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      showToast({ messageKey: "tasksCategoryExists", type: "error" });
      return false;
    }

    const category = createLocalCategory({ color, name });

    try {
      if (storageMode === "account") {
        try {
          let data = getUnlockedAccountData();
          if (!data) {
            data = await ensureAccountVaultUnlocked();
          }
          const scopedData = getTasksWorkspaceData(data);
          await saveUnlockedAccountData(
            withTasksWorkspaceData(
              data,
              {
                ...scopedData,
                categories: [...categories, category],
              },
              getActiveTasksWorkspaceId(),
            ),
          );
        } catch {
          setStorageMode("local");
          const data = await readLocalEncryptedData();
          const scopedData = getTasksWorkspaceData(data);
          await saveLocalEncryptedData(
            withTasksWorkspaceData(data, {
              ...scopedData,
              categories: [...categories, category],
            }),
          );
        }
      } else {
        const data = await readLocalEncryptedData();
        const scopedData = getTasksWorkspaceData(data);
        await saveLocalEncryptedData(
          withTasksWorkspaceData(data, {
            ...scopedData,
            categories: [...categories, category],
          }),
        );
      }

      announceCategories([...categories, category]);
      setCategories((current) => [...current, category]);
      showToast({ messageKey: "tasksCategoryAdded", type: "success" });
      return true;
    } catch {
      showToast({ messageKey: "fetchError", type: "error" });
      return false;
    }
  };

  const deleteCategory = async (category) => {
    try {
      if (storageMode === "account") {
        let data = getUnlockedAccountData();
        if (!data) {
          data = await ensureAccountVaultUnlocked();
        }
        const scopedData = getTasksWorkspaceData(data);
        await saveUnlockedAccountData(
          withTasksWorkspaceData(data, {
            ...scopedData,
            categories: categories.filter((item) => item.id !== category.id),
          }),
        );
      } else {
        const data = await readLocalEncryptedData();
        const scopedData = getTasksWorkspaceData(data);
        await saveLocalEncryptedData(
          withTasksWorkspaceData(data, {
            ...scopedData,
            categories: categories.filter((item) => item.id !== category.id),
          }),
        );
      }

      announceCategories(categories.filter((item) => item.id !== category.id));
      setCategories((current) =>
        current.filter((item) => item.id !== category.id),
      );
      showToast({ messageKey: "tasksCategoryDeleted", type: "success" });
      return true;
    } catch {
      showToast({ messageKey: "fetchError", type: "error" });
      return false;
    }
  };

  const openAddCategory = () => {
    showModal(
      ({ close }) => (
        <AddCategoryForm close={close} copy={copy} onCreate={createCategory} />
      ),
      {
        ariaLabel: copy.tasksAddCategory,
        title: copy.tasksAddCategory,
        zIndex: 100000002,
      },
    );
  };

  const openDeleteCategory = (category) => {
    showModal(
      ({ close }) => (
        <DeleteCategoryConfirmation
          category={category}
          close={close}
          copy={copy}
          onDelete={deleteCategory}
        />
      ),
      {
        ariaLabel: copy.tasksDeleteCategory,
        title: copy.tasksDeleteCategory,
        zIndex: 100000002,
      },
    );
  };

  return (
    <section className="tasks-categories-page">
      <div className="tasks-categories-heading liquid-glass">
        <div>
          <h1>{copy.tasksCategories}</h1>
          <p>{copy.tasksCategoriesDescription}</p>
        </div>
        <button onClick={openAddCategory} type="button">
          <icon>add</icon>
          {copy.tasksAddCategory}
        </button>
      </div>

      <p className="tasks-categories-storage-note">
        <icon>{storageMode === "account" ? "encrypted" : "devices"}</icon>
        {storageMode === "account"
          ? `${copy.privacyEncryptionTitle} · ${copy.tasksCategoryAccountStorage}`
          : `${copy.privacyEncryptionTitle} · ${copy.tasksCategoryLocalStorage}`}
      </p>

      {loading
        ? <output
            aria-label={copy.tasksCategories}
            className="tasks-categories-loading"
          >
            <span className="spinner-container">
              <svg
                aria-hidden="true"
                className="google-spinner"
                viewBox="0 0 50 50"
              >
                <circle
                  className="spinner-circle"
                  cx="25"
                  cy="25"
                  fill="none"
                  r="20"
                  strokeWidth="5"
                />
              </svg>
            </span>
          </output>
        : categories.length === 0
          ? <div className="tasks-categories-empty liquid-glass">
              <icon className="tasks-categories-empty-icon">category</icon>
              <p>{copy.tasksNoCategories}</p>
              <button onClick={openAddCategory} type="button">
                {copy.tasksAddCategory}
              </button>
            </div>
          : <ul className="tasks-categories-grid">
              {categories.map((category) => (
                <li
                  className="tasks-category-card liquid-glass"
                  key={category.id}
                >
                  <span
                    aria-hidden="true"
                    className="tasks-category-color"
                    style={{ backgroundColor: category.color }}
                  />
                  <span className="tasks-category-name">{category.name}</span>
                  <button
                    aria-label={`${copy.tasksDeleteCategory}: ${category.name}`}
                    onClick={() => openDeleteCategory(category)}
                    title={copy.tasksDeleteCategory}
                    type="button"
                  >
                    <icon>delete</icon>
                  </button>
                </li>
              ))}
            </ul>}
    </section>
  );
}
