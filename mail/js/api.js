// Same-origin JSON API client for /api/mail/v1 with upload progress and cancellation.
const BASE = "/api/mail/v1";

export class ApiError extends Error {
    constructor(code, status, data = {}) { super(code); this.code = code; this.status = status; this.data = data; }
}

let onSignedOut = () => {};
export function setSignedOutHandler(handler) { onSignedOut = handler; }

export async function api(path, { method = "GET", body, signal, raw = false, headers = {} } = {}) {
    let response;
    try {
        response = await fetch(BASE + path, {
            method, signal, credentials: "same-origin", cache: "no-store",
            headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    } catch (error) {
        if (error?.name === "AbortError") throw error;
        throw new ApiError("offline", 0);
    }
    if (raw && response.ok) return response;
    const data = (response.headers.get("Content-Type") || "").includes("json") ? await response.json().catch(() => ({})) : {};
    if (!response.ok) {
        if (response.status === 401) onSignedOut();
        throw new ApiError(data.error || "unavailable", response.status, data);
    }
    return data;
}

export const get = (path, options) => api(path, options);
export const post = (path, body = {}, options) => api(path, { ...options, method: "POST", body });
export const put = (path, body = {}, options) => api(path, { ...options, method: "PUT", body });
export const del = (path, options) => api(path, { ...options, method: "DELETE" });

// Uploads raw bytes with progress (XMLHttpRequest exposes upload progress; fetch does not).
export function upload(path, blob, { headers = {}, onProgress, signal } = {}) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", BASE + path);
        xhr.withCredentials = true;
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
        xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(event.loaded, event.total); };
        xhr.onload = () => {
            let data = {};
            try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
            if (xhr.status >= 200 && xhr.status < 300) resolve(data);
            else { if (xhr.status === 401) onSignedOut(); reject(new ApiError(data.error || "unavailable", xhr.status, data)); }
        };
        xhr.onerror = () => reject(new ApiError("offline", 0));
        xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
        signal?.addEventListener("abort", () => xhr.abort(), { once: true });
        xhr.send(blob);
    });
}

export async function fetchBlob(path) {
    const response = await api(path, { raw: true });
    return response.blob();
}

export const idempotencyKey = () => crypto.randomUUID();
