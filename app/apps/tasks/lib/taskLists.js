export const defaultTaskListId = "my-tasks";
export const defaultTaskListSlug = "my-tasks";
const cachePrefix = "munetios.tasks.lists";

export function createDefaultTaskList() {
  return {
    createdAt: "system",
    id: defaultTaskListId,
    slug: defaultTaskListSlug,
    system: true,
  };
}

export function normalizeTaskLists(lists) {
  const normalized = Array.isArray(lists)
    ? lists
        .filter(
          (list) =>
            list &&
            typeof list.id === "string" &&
            typeof list.slug === "string",
        )
        .map((list) => ({
          ...list,
          name: typeof list.name === "string" ? list.name.trim() : "",
        }))
    : [];
  const withoutDefault = normalized.filter(
    (list) => list.id !== defaultTaskListId,
  );
  const savedDefault = normalized.find(
    (list) => list.id === defaultTaskListId,
  );
  return [
    {
      ...createDefaultTaskList(),
      ...savedDefault,
      id: defaultTaskListId,
      slug: defaultTaskListSlug,
      system: true,
    },
    ...withoutDefault,
  ];
}

export function normalizeTasksForLists(tasks, lists) {
  const listIds = new Set(normalizeTaskLists(lists).map((list) => list.id));
  return (Array.isArray(tasks) ? tasks : []).map((task) => ({
    ...task,
    listId: listIds.has(task?.listId) ? task.listId : defaultTaskListId,
  }));
}

export function getTaskListName(list, copy) {
  return list?.name || copy.tasksMyTasks;
}

export function getTaskListHref(list) {
  return list?.system
    ? "/apps/tasks"
    : `/apps/tasks/list/${encodeURIComponent(list.slug)}/`;
}

export function createTaskListSlug(name, lists) {
  const base =
    String(name || "")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "list";
  const existing = new Set(
    normalizeTaskLists(lists).map((list) => list.slug.toLocaleLowerCase()),
  );
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function cacheTaskLists(workspaceId, lists) {
  if (typeof window === "undefined") return;
  const safeLists = normalizeTaskLists(lists).map(
    ({ createdAt, id, name, slug, system, updatedAt }) => ({
      createdAt,
      id,
      name,
      slug,
      system,
      updatedAt,
    }),
  );
  window.localStorage.setItem(
    `${cachePrefix}.${workspaceId || "default"}`,
    JSON.stringify(safeLists),
  );
  window.dispatchEvent(
    new CustomEvent("munetios:tasklistschange", { detail: safeLists }),
  );
}

export function readCachedTaskLists(workspaceId) {
  if (typeof window === "undefined") return [createDefaultTaskList()];
  try {
    return normalizeTaskLists(
      JSON.parse(
        window.localStorage.getItem(
          `${cachePrefix}.${workspaceId || "default"}`,
        ) || "[]",
      ),
    );
  } catch {
    return [createDefaultTaskList()];
  }
}
