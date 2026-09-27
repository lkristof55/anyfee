// Same-origin API (/api/resolve, /api/health) and the configurable attester (/api/attest/*).

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function call(url, init) {
  let r;
  try {
    r = await fetch(url, init);
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new ApiError(0, "network", "Could not reach the server. Check your connection and try again.");
  }
  let body = null;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  if (!r.ok) {
    const err = body?.error;
    throw new ApiError(r.status, err?.code ?? "http_" + r.status, err?.message ?? `The server answered ${r.status}.`);
  }
  return body;
}

// Short-lived cache so typing, routing and re-rendering do not ask twice for the same thing.
const cache = new Map();

/** Resolves user input to an identity + vault state. Never cached for more than a few seconds. */
export async function resolve(q, { signal, fresh = false } = {}) {
  const key = q.trim();
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 4000) return hit.value;
  const value = await call(`/api/resolve?q=${encodeURIComponent(key)}`, { signal, headers: { accept: "application/json" } });
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function health() {
  return call("/api/health", { headers: { accept: "application/json" } });
}

const ATTESTER_KEY = "anyfee.attesterUrl";

/** Attester base URL (no trailing slash). Default: this site. */
export function attesterUrl() {
  try {
    const v = localStorage.getItem(ATTESTER_KEY);
    if (v) return v;
  } catch {
    /* storage blocked */
  }
  return location.origin;
}

export function setAttesterUrl(v) {
  const clean = (v || "").trim().replace(/\/+$/, "");
  try {
    if (!clean || clean === location.origin) localStorage.removeItem(ATTESTER_KEY);
    else localStorage.setItem(ATTESTER_KEY, clean);
  } catch {
    /* storage blocked */
  }
  return clean || location.origin;
}

export function attesterHealth(base = attesterUrl()) {
  return call(`${base}/api/health`, { headers: { accept: "application/json" } });
}

export function attestX(tweetUrl, claimant, base = attesterUrl()) {
  return call(`${base}/api/attest/x`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ tweetUrl, claimant }),
  });
}

/** Display-only X profile (avatar, name) from the public fxtwitter API. Failure is silent. */
export async function xProfile(handle) {
  try {
    const r = await fetch(`https://api.fxtwitter.com/${encodeURIComponent(handle)}`, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json();
    const u = j?.user;
    if (!u || typeof u.screen_name !== "string") return null;
    return {
      name: typeof u.name === "string" ? u.name : null,
      avatarUrl: typeof u.avatar_url === "string" && u.avatar_url.startsWith("https://pbs.twimg.com/") ? u.avatar_url.replace("_normal.", "_200x200.") : null,
    };
  } catch {
    return null;
  }
}
