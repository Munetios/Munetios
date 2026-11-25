(() => {
  "use strict";
  const PREFIX = "munetios-meals:";
  const MEAL_KEY = PREFIX + "meal:";
  const IMAGE_KEY = PREFIX + "image:";
  const CHUNK_SIZE = 1024 * 1024;
  const CHUNKS = "mealSyncChunks";
  const validId = id => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
  const imageKey = (mealId, imageId, index) => `${IMAGE_KEY}${mealId}:${imageId}:${index}`;
  const imageReference = (blob) => ({ id: crypto.randomUUID(), size: blob.size, type: blob.type });
  const chunkCount = image => Math.ceil(image.size / CHUNK_SIZE);

  function validImage(image) {
    return image && validId(image.id) && Number.isSafeInteger(image.size) && image.size > 0 &&
      typeof image.type === "string" && image.type.startsWith("image/");
  }

  function complete(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error("mealStorageAborted"));
    });
  }

  function request(operation) {
    return new Promise((resolve, reject) => {
      operation.onsuccess = () => resolve(operation.result);
      operation.onerror = () => reject(operation.error);
    });
  }

  function encode(bytes) {
    let text = "";
    for (let index = 0; index < bytes.length; index += 32768) {
      text += String.fromCharCode(...bytes.subarray(index, index + 32768));
    }
    return btoa(text);
  }

  async function migrateImages(db, storeName) {
    const tx = db.transaction(storeName, "readwrite"), done = complete(tx);
    const store = tx.objectStore(storeName);
    for (const meal of await request(store.getAll())) {
      if (meal.imageBlob instanceof Blob && meal.imageBlob.size && !validImage(meal.imageSync)) {
        store.put({ ...meal, imageSync: imageReference(meal.imageBlob) });
      }
    }
    await done;
  }

  function createProvider({ db, storeName, getAccountId, refresh }) {
    let files = new Map();
    let pendingImages = new Set();

    return {
      id: "munetios-meals", prefix: PREFIX, paginated: true,
      async hash(data) {
        const { bytes, ...metadata } = data;
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(metadata)));
        return encode(new Uint8Array(digest));
      },
      async snapshot() {
        const meals = await request(db.transaction(storeName).objectStore(storeName).getAll());
        files = new Map();
        pendingImages = new Set();
        const images = [], records = [];
        for (const { imageBlob, ...meal } of meals) {
          if (!validId(meal.id)) continue;
          const updatedAt = Number(meal.updatedAt) || Date.parse(meal.createdAt) || 0;
          if (validImage(meal.imageSync)) {
            const image = meal.imageSync;
            if (imageBlob instanceof Blob && imageBlob.size === image.size) {
              files.set(imageKey(meal.id, image.id, ""), imageBlob);
              for (let index = 0; index < chunkCount(image); index++) {
                images.push({
                  key: imageKey(meal.id, image.id, index), updatedAt,
                  data: { mealId: meal.id, image, index }
                });
              }
            } else pendingImages.add(imageKey(meal.id, image.id, ""));
          }
          records.push({ key: MEAL_KEY + meal.id, data: { ...meal, updatedAt }, updatedAt });
        }
        return images.concat(records);
      },
      retainMissingItem(key) {
        return key.startsWith(IMAGE_KEY) && pendingImages.has(key.slice(0, key.lastIndexOf(":") + 1));
      },
      async loadItem(data) {
        if (!data.mealId || !data.image) return data;
        const file = files.get(imageKey(data.mealId, data.image.id, ""));
        if (!file) throw new Error("mealImageUnavailable");
        const bytes = await file.slice(data.index * CHUNK_SIZE, (data.index + 1) * CHUNK_SIZE).arrayBuffer();
        return { ...data, bytes: encode(new Uint8Array(bytes)) };
      },
      async apply(entries, { replace = false } = {}) {
        const accountId = getAccountId();
        if (!accountId) throw new Error("signedOut");
        const tx = db.transaction([storeName, CHUNKS], "readwrite"), done = complete(tx);
        const meals = tx.objectStore(storeName), chunks = tx.objectStore(CHUNKS);
        const stageKey = key => `${accountId}:${key}`;
        const affected = new Set();
        let changed = replace;
        try {
          if (replace) {
            meals.clear();
            chunks.clear();
          }
          for (const entry of entries) {
            const { key, data } = entry;
            if (key.startsWith(MEAL_KEY)) {
              const id = key.slice(MEAL_KEY.length);
              if (!validId(id)) throw new Error("invalidMeal");
              if (entry.deleted) {
                meals.delete(id);
                changed = true;
                continue;
              }
              if (data?.id !== id || typeof data.name !== "string" || (data.imageSync && !validImage(data.imageSync))) {
                throw new Error("invalidMeal");
              }
              const previous = await request(meals.get(id));
              const updatedAt = Number(entry.updatedAt) || 0;
              if (previous?.updatedAt > updatedAt) continue;
              const imageBlob = data.imageSync && previous?.imageSync?.id === data.imageSync.id ? previous.imageBlob : null;
              meals.put({ ...data, updatedAt, imageBlob });
              affected.add(id);
              changed = true;
            } else if (key.startsWith(IMAGE_KEY)) {
              if (entry.deleted) {
                chunks.delete(stageKey(key));
                continue;
              }
              const { mealId, image, index, bytes } = data || {};
              if (!validId(mealId) || !validImage(image) || !Number.isSafeInteger(index) ||
                  index < 0 || index >= chunkCount(image) || typeof bytes !== "string" ||
                  bytes.length > Math.ceil(CHUNK_SIZE / 3) * 4 || key !== imageKey(mealId, image.id, index)) {
                throw new Error("invalidMealImage");
              }
              const binary = Uint8Array.from(atob(bytes), char => char.charCodeAt(0));
              if (binary.byteLength !== Math.min(CHUNK_SIZE, image.size - index * CHUNK_SIZE)) {
                throw new Error("invalidMealImageSize");
              }
              chunks.put({ key: stageKey(key), index, blob: new Blob([binary]) });
              affected.add(mealId);
            }
          }
          for (const id of affected) {
            const meal = await request(meals.get(id));
            if (!meal || !validImage(meal.imageSync)) continue;
            const image = meal.imageSync;
            const prefix = stageKey(imageKey(id, image.id, ""));
            const range = IDBKeyRange.bound(prefix, prefix + "\uffff");
            if (!meal.imageBlob) {
              const parts = await request(chunks.getAll(range));
              if (parts.length !== chunkCount(image)) continue;
              parts.sort((a, b) => a.index - b.index);
              if (parts.some(({ index, blob }, position) => index !== position ||
                  blob.size !== Math.min(CHUNK_SIZE, image.size - index * CHUNK_SIZE))) continue;
              meal.imageBlob = new Blob(parts.map(part => part.blob), { type: image.type });
              meals.put(meal);
              changed = true;
            }
            chunks.delete(range);
          }
        } catch (error) {
          tx.abort();
          await done.catch(() => {});
          throw error;
        }
        await done;
        if (changed) await refresh();
        return changed;
      }
    };
  }

  window.MunetiosMealsSync = { CHUNKS, complete, createProvider, imageReference, migrateImages, validId };
})();
