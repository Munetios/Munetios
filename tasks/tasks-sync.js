(() => {
  "use strict";

  const prefix = "munetios-tasks:";
  const categoriesKey = prefix + "categories";
  const encoder = new TextEncoder();
  const taskKey = async (id) => prefix + "task:" + Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(id))),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  const byId = (items) => new Map(items.map((item) => [String(item.id), item]));
  const changed = (a, b) => JSON.stringify(a) !== JSON.stringify(b);

  function validate(kind, items) {
    const label = kind === "tasks" ? "title" : "name";
    if (!Array.isArray(items) || items.some((item) =>
      !item || !["string", "number"].includes(typeof item.id) || typeof item[label] !== "string"
    ) || byId(items).size !== items.length) throw new Error("Invalid Tasks data");
    return items;
  }

  function create({ account, accountId, read, write, replace, defaults, onApply }) {
    let pending = Promise.resolve();
    const view = new Map();
    let snapshotStamps = new Map();
    let categoryStamp = 0;
    const run = (action) => {
      const task = pending.then(() => navigator.locks
        ? navigator.locks.request(prefix + (accountId ?? "guest"), action)
        : action());
      pending = task.catch(() => {});
      return task;
    };
    const enabled = () => accountId !== null && String(account.state.account?.id) === accountId;
    const schedule = () => { if (enabled()) account.sync.schedule(500); };
    const fresh = (kind) => kind === "categories" ? structuredClone(defaults) : [];
    const entries = (state) => new Map(state.stamps);
    const stateOf = async (kind) => {
      const value = await read(kind);
      const state = Array.isArray(value) || !value
        ? { items: value ?? fresh(kind), updatedAt: 0, stamps: [] }
        : value;
      validate(kind, state.items);
      return state;
    };
    const put = (kind, state) => write(kind, accountId === null ? state.items : state);
    const remember = (kind, items) => {
      view.set(kind, structuredClone(items));
      return items;
    };
    const taskStamp = (stamps, id, item) => stamps.get(id) ?? (Date.parse(item.createdAt) || 0);

    function load(kind) {
      return run(async () => remember(kind, (await stateOf(kind)).items));
    }

    function save(kind, items) {
      const next = byId(structuredClone(validate(kind, items)));
      const previous = byId(view.get(kind) ?? []);
      const ids = [...new Set([...previous.keys(), ...next.keys()])].filter((id) =>
        changed(previous.get(id), next.get(id)));
      if (!ids.length) return Promise.resolve();
      const submitted = remember(kind, [...next.values()]);
      return run(async () => {
        const state = await stateOf(kind);
        const current = byId(state.items);
        const stamps = entries(state);
        const updatedAt = Math.max(Date.now(), state.updatedAt + 1);
        for (const id of ids) {
          if (next.has(id)) current.set(id, next.get(id));
          else current.delete(id);
          if (kind === "tasks" && accountId !== null) stamps.set(id, updatedAt);
        }
        await put(kind, { items: [...current.values()], updatedAt, stamps: [...stamps] });
        schedule();
      }).catch((error) => {
        if (!changed(view.get(kind), submitted)) remember(kind, [...previous.values()]);
        throw error;
      });
    }

    function clear(rotateKey = false) {
      return run(async () => {
        const tasks = await stateOf("tasks");
        const categories = await stateOf("categories");
        const updatedAt = Math.max(Date.now(), tasks.updatedAt + 1, categories.updatedAt + 1);
        const empty = [];
        const initial = fresh("categories");
        const stamps = tasks.items.map((item) => [String(item.id), updatedAt]);
        await replace(
          accountId === null ? empty : { items: empty, updatedAt, stamps },
          accountId === null ? initial : { items: initial, updatedAt, stamps: [] },
          rotateKey,
        );
        onApply(remember("tasks", empty), remember("categories", initial));
        schedule();
      });
    }

    const provider = {
      id: "munetios-tasks", prefix, preserveLocal: true, paginated: true, enabled,
      snapshot: () => run(async () => {
        const tasks = await stateOf("tasks");
        const categories = await stateOf("categories");
        const stamps = entries(tasks);
        const items = await Promise.all(tasks.items.map(async (data) => {
          const id = String(data.id);
          return { key: await taskKey(id), data, updatedAt: taskStamp(stamps, id, data) };
        }));
        snapshotStamps = new Map(items.map((item) => [item.key, item.updatedAt]));
        categoryStamp = categories.updatedAt;
        if (categoryStamp) items.push({ key: categoriesKey, data: categories.items, updatedAt: categoryStamp });
        return items;
      }),
      apply: (items) => run(async () => {
        if (!enabled()) return false;
        const tasks = await stateOf("tasks");
        const categories = await stateOf("categories");
        const stamps = entries(tasks);
        const current = new Map(await Promise.all(tasks.items.map(async (item) => [await taskKey(String(item.id)), item])));
        let tasksChanged = false;
        let categoriesChanged = false;
        for (const item of items) {
          if (item.key === categoriesKey) {
            if (categoryStamp !== categories.updatedAt) continue;
            categories.items = item.deleted ? fresh("categories") : validate("categories", item.data);
            categories.updatedAt = item.deleted ? 0 : item.updatedAt || 1;
            categoriesChanged = true;
            continue;
          }
          const existing = current.get(item.key);
          if ((existing && taskStamp(stamps, String(existing.id), existing)) !== snapshotStamps.get(item.key)) continue;
          if (item.deleted) {
            if (!existing) continue;
            current.delete(item.key);
            stamps.delete(String(existing.id));
          } else {
            const [task] = validate("tasks", [item.data]);
            const id = String(task.id);
            if (await taskKey(id) !== item.key) throw new Error("Invalid synced task identifier");
            if (!existing && (stamps.get(id) || 0) > (item.updatedAt || 0)) continue;
            current.set(item.key, task);
            stamps.set(id, item.updatedAt || 1);
          }
          tasks.updatedAt = Math.max(tasks.updatedAt, item.updatedAt || 0);
          tasksChanged = true;
        }
        if (tasksChanged) await put("tasks", { ...tasks, items: [...current.values()], stamps: [...stamps] });
        if (categoriesChanged) await put("categories", categories);
        return tasksChanged || categoriesChanged;
      }),
    };

    function refresh() {
      return run(async () => {
        if (!enabled()) return;
        const tasks = (await stateOf("tasks")).items;
        const categories = (await stateOf("categories")).items;
        onApply(remember("tasks", tasks), remember("categories", categories));
      });
    }

    return { load, save, clear, provider, refresh };
  }

  window.MunetiosTasksSync = { create, validate };
})();
