import { ResolveError, fetchJson, idString, isRecord, type FetchLike } from "./http.ts";

export interface XUser {
  /** Numeric X user id as a decimal string (the vault key). */
  id: string;
  handle: string;
  name: string | null;
}

export interface XTweet {
  id: string;
  text: string;
  author: XUser;
  /** Unix seconds, or null when the source does not say. */
  createdAt: number | null;
}

/** Pluggable X lookup. Handles are only ever used to find the numeric id. */
export interface XResolver {
  readonly name: string;
  userByHandle(handle: string): Promise<XUser>;
  tweet(tweetId: string): Promise<XTweet>;
  /** Optional reverse lookup (display only). */
  userById?(id: string): Promise<XUser>;
}

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const TWEET_ID = /^[0-9]{1,20}$/;

function checkHandle(h: string): string {
  const handle = h.replace(/^@/, "");
  if (!HANDLE.test(handle)) throw new ResolveError(`invalid X handle "${h}"`, 400);
  return handle;
}

function checkTweetId(id: string): string {
  if (!TWEET_ID.test(id)) throw new ResolveError(`invalid tweet id "${id}"`, 400);
  return id;
}

// ---- fxtwitter (default, public, no key) ---------------------------------------------------------

export interface FxTwitterOptions {
  fetch?: FetchLike;
  apiBase?: string;
  userAgent?: string;
}

function fxUser(v: unknown): XUser {
  if (!isRecord(v)) throw new ResolveError("fxtwitter: malformed user", 502);
  const id = idString(v.id);
  if (!id || typeof v.screen_name !== "string") throw new ResolveError("fxtwitter: malformed user", 502);
  return { id, handle: v.screen_name, name: typeof v.name === "string" ? v.name : null };
}

/** Public resolver backed by https://api.fxtwitter.com (FxEmbed). */
export function fxTwitterResolver(opts: FxTwitterOptions = {}): XResolver {
  const base = opts.apiBase ?? "https://api.fxtwitter.com";
  const get = async (path: string, what: string) => {
    const r = await fetchJson(
      opts.fetch ?? fetch,
      `${base}${path}`,
      { headers: { "user-agent": opts.userAgent ?? "anyfee-sdk" }, redirect: "manual" },
      what,
    );
    const code = isRecord(r.body) && typeof r.body.code === "number" ? r.body.code : r.status;
    if (code === 404 || r.status === 404 || (r.status >= 300 && r.status < 400)) throw new ResolveError(`${what}: not found`, 404);
    if (code === 401 || code === 403) throw new ResolveError(`${what}: private or unavailable`, 404);
    if (r.status === 429) throw new ResolveError(`${what}: rate limited`, 429);
    if (r.status !== 200 || !isRecord(r.body) || code !== 200) throw new ResolveError(`${what}: fxtwitter returned ${r.status}`, 502);
    return r.body;
  };
  return {
    name: "fxtwitter",
    async userByHandle(h) {
      const handle = checkHandle(h);
      const body = await get(`/${handle}`, `X user @${handle}`);
      return fxUser(body.user);
    },
    async tweet(tweetId) {
      const id = checkTweetId(tweetId);
      const body = await get(`/status/${id}`, `tweet ${id}`);
      const t = body.tweet;
      if (!isRecord(t)) throw new ResolveError(`tweet ${id}: not found`, 404);
      const tid = idString(t.id);
      const rawText = isRecord(t.raw_text) && typeof t.raw_text.text === "string" ? t.raw_text.text : null;
      const text = typeof t.text === "string" ? t.text : rawText;
      if (!tid || text === null) throw new ResolveError("fxtwitter: malformed tweet", 502);
      if (tid !== id) throw new ResolveError(`fxtwitter returned tweet ${tid} for ${id}`, 502);
      const createdAt = typeof t.created_timestamp === "number" ? t.created_timestamp : null;
      return { id: tid, text, author: fxUser(t.author), createdAt };
    },
  };
}

// ---- Official X API v2 (when a bearer token is configured) -----------------------------------

export interface XApiOptions {
  bearerToken: string;
  fetch?: FetchLike;
  apiBase?: string;
}

function v2User(v: unknown): XUser {
  if (!isRecord(v)) throw new ResolveError("X API: malformed user", 502);
  const id = idString(v.id);
  if (!id || typeof v.username !== "string") throw new ResolveError("X API: malformed user", 502);
  return { id, handle: v.username, name: typeof v.name === "string" ? v.name : null };
}

/** Resolver backed by the official X API v2 (`X_BEARER_TOKEN`). */
export function xApiResolver(opts: XApiOptions): XResolver {
  const base = opts.apiBase ?? "https://api.x.com";
  const get = async (path: string, what: string) => {
    const r = await fetchJson(opts.fetch ?? fetch, `${base}${path}`, { headers: { authorization: `Bearer ${opts.bearerToken}` } }, what);
    if (r.status === 429) throw new ResolveError(`${what}: X API rate limited`, 429);
    if (r.status === 404) throw new ResolveError(`${what}: not found`, 404);
    if (r.status === 401 || r.status === 403) throw new ResolveError(`${what}: X API rejected the bearer token (${r.status})`, 502);
    if (r.status !== 200 || !isRecord(r.body)) throw new ResolveError(`${what}: X API returned ${r.status}`, 502);
    // X API v2 answers 200 + {errors:[…]} for missing/suspended resources.
    if (!isRecord(r.body.data)) throw new ResolveError(`${what}: not found`, 404);
    return r.body;
  };
  return {
    name: "x-api-v2",
    async userByHandle(h) {
      const handle = checkHandle(h);
      const body = await get(`/2/users/by/username/${handle}`, `X user @${handle}`);
      return v2User(body.data);
    },
    async userById(id) {
      const body = await get(`/2/users/${checkTweetId(id)}`, `X user #${id}`);
      return v2User(body.data);
    },
    async tweet(tweetId) {
      const id = checkTweetId(tweetId);
      const body = await get(
        `/2/tweets/${id}?expansions=author_id&tweet.fields=created_at,author_id,note_tweet&user.fields=username,name`,
        `tweet ${id}`,
      );
      const d = body.data as Record<string, unknown>;
      const tid = idString(d.id);
      const authorId = idString(d.author_id);
      const note = isRecord(d.note_tweet) && typeof d.note_tweet.text === "string" ? d.note_tweet.text : null;
      const text = note ?? (typeof d.text === "string" ? d.text : null);
      if (!tid || !authorId || text === null) throw new ResolveError("X API: malformed tweet", 502);
      if (tid !== id) throw new ResolveError(`X API returned tweet ${tid} for ${id}`, 502);
      const users = isRecord(body.includes) && Array.isArray(body.includes.users) ? body.includes.users : [];
      const authorRaw = users.find((u) => isRecord(u) && idString(u.id) === authorId);
      const author = authorRaw ? v2User(authorRaw) : { id: authorId, handle: "", name: null };
      const createdAt = typeof d.created_at === "string" ? Math.floor(Date.parse(d.created_at) / 1000) : null;
      return { id: tid, text, author, createdAt: Number.isFinite(createdAt) ? createdAt : null };
    },
  };
}

/** Official API when a bearer token is given, otherwise fxtwitter. */
export function defaultXResolver(opts: { bearerToken?: string | undefined; fetch?: FetchLike } = {}): XResolver {
  return opts.bearerToken
    ? xApiResolver({ bearerToken: opts.bearerToken, ...(opts.fetch ? { fetch: opts.fetch } : {}) })
    : fxTwitterResolver(opts.fetch ? { fetch: opts.fetch } : {});
}

/** Extracts the numeric status id from an x.com / twitter.com / fxtwitter status URL. */
export function parseTweetUrl(input: string): { tweetId: string; handle: string | null } {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new ResolveError("tweetUrl is not a valid URL", 400);
  }
  const host = url.hostname.toLowerCase().replace(/^(www|mobile)\./, "");
  if (!["x.com", "twitter.com", "fxtwitter.com", "vxtwitter.com", "fixupx.com", "fixvx.com"].includes(host)) {
    throw new ResolveError("tweetUrl must be an x.com or twitter.com status link", 400);
  }
  const seg = url.pathname.split("/").filter(Boolean);
  // /<handle>/status/<id>[/…]  or  /i/web/status/<id>  or  /i/status/<id>
  const idx = seg.findIndex((p) => p === "status" || p === "statuses");
  const id = idx >= 0 ? seg[idx + 1] : undefined;
  if (!id || !TWEET_ID.test(id)) throw new ResolveError("tweetUrl has no status id", 400);
  const handle = idx === 1 && seg[0] && seg[0] !== "i" && HANDLE.test(seg[0]) ? seg[0] : null;
  return { tweetId: id, handle };
}
