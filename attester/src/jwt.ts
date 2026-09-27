// RS256 JWT verification with a caching, rotation-aware JWKS client. Uses WebCrypto only, so it
// runs unchanged on Node 22+, Netlify/Lambda, Deno and Workers.
import { fromBase64 } from "@anyfee/sdk";
import type { FetchLike } from "@anyfee/sdk";

export class AttestError extends Error {
  override name = "AttestError";
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface Jwk {
  kty?: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

export interface JwksCacheOptions {
  url: string;
  fetch?: FetchLike;
  /** Default freshness when the response has no Cache-Control max-age. */
  ttlMs?: number;
  /** Minimum time between fetches triggered by an unknown `kid` (bounds refetch abuse). */
  minRefetchIntervalMs?: number;
  nowMs?: () => number;
}

const RSA_ALG = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

/** Caches JWKS keys by `kid`; refetches when stale or when an unknown `kid` shows up (rotation). */
export class JwksCache {
  readonly url: string;
  private readonly fetchImpl: FetchLike;
  private readonly ttlMs: number;
  private readonly minRefetchIntervalMs: number;
  private readonly nowMs: () => number;
  private keys = new Map<string, CryptoKey>();
  private freshUntil = 0;
  private lastFetchAt = -Infinity;
  private inflight: Promise<void> | null = null;
  /** Number of network fetches so far (observability/tests). */
  fetchCount = 0;

  constructor(opts: JwksCacheOptions) {
    this.url = opts.url;
    this.fetchImpl = opts.fetch ?? fetch;
    this.ttlMs = opts.ttlMs ?? 10 * 60_000;
    this.minRefetchIntervalMs = opts.minRefetchIntervalMs ?? 30_000;
    this.nowMs = opts.nowMs ?? Date.now;
  }

  private async refresh(): Promise<void> {
    if (!this.inflight) {
      this.inflight = this.doFetch().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async doFetch(): Promise<void> {
    this.lastFetchAt = this.nowMs();
    this.fetchCount++;
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    } catch (e) {
      throw new AttestError("jwks_unavailable", `could not fetch JWKS: ${(e as Error).message}`, 502);
    }
    if (res.status !== 200) throw new AttestError("jwks_unavailable", `JWKS endpoint returned ${res.status}`, 502);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new AttestError("jwks_unavailable", "JWKS is not JSON", 502);
    }
    const list = (body as { keys?: unknown }).keys;
    if (!Array.isArray(list)) throw new AttestError("jwks_unavailable", "JWKS has no keys array", 502);
    const next = new Map<string, CryptoKey>();
    for (const jwk of list as Jwk[]) {
      if (!jwk || jwk.kty !== "RSA" || typeof jwk.kid !== "string" || !jwk.n || !jwk.e) continue;
      if (jwk.use && jwk.use !== "sig") continue;
      if (jwk.alg && jwk.alg !== "RS256") continue;
      if (fromBase64(jwk.n).length < 256) continue; // < 2048-bit modulus
      try {
        const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, RSA_ALG, false, ["verify"]);
        next.set(jwk.kid, key);
      } catch {
        /* skip malformed key */
      }
    }
    if (next.size === 0) throw new AttestError("jwks_unavailable", "JWKS contains no usable RS256 keys", 502);
    const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1];
    const ttl = maxAge ? Math.min(Math.max(Number(maxAge) * 1000, 60_000), 60 * 60_000) : this.ttlMs;
    this.keys = next;
    this.freshUntil = this.nowMs() + ttl;
  }

  async getKey(kid: string): Promise<CryptoKey> {
    const now = this.nowMs();
    if (now >= this.freshUntil) {
      try {
        await this.refresh();
      } catch (e) {
        // Stale-if-error: keep verifying with the last good keys if GitHub's JWKS is briefly down.
        if (this.keys.size === 0) throw e;
      }
    }
    let key = this.keys.get(kid);
    if (!key && this.nowMs() - this.lastFetchAt >= this.minRefetchIntervalMs) {
      await this.refresh(); // possible key rotation
      key = this.keys.get(kid);
    }
    if (!key) throw new AttestError("unknown_kid", "token signed with an unknown key id", 401);
    return key;
  }
}

export interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

export interface VerifyJwtOptions {
  jwks: JwksCache;
  issuer: string;
  nowSecs: number;
  skewSecs: number;
}

function decodeSegment(seg: string, what: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(seg)) throw new AttestError("malformed_token", `token ${what} is not base64url`, 400);
  let v: unknown;
  try {
    v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fromBase64(seg)));
  } catch {
    throw new AttestError("malformed_token", `token ${what} is not JSON`, 400);
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new AttestError("malformed_token", `token ${what} is not an object`, 400);
  return v as Record<string, unknown>;
}

/**
 * Verifies a compact RS256 JWT: header alg pinned to RS256 (no `none`/HS*), key by `kid` from the
 * JWKS, signature over the exact received bytes, `iss` exact match, `exp`/`nbf`/`iat` with skew.
 * The audience and all other claims are the caller's policy.
 */
export async function verifyJwtRs256(token: string, opts: VerifyJwtOptions): Promise<{ header: JwtHeader; payload: Record<string, unknown> }> {
  if (typeof token !== "string" || token.length > 16_384) throw new AttestError("malformed_token", "token missing or too large", 400);
  const parts = token.split(".");
  if (parts.length !== 3) throw new AttestError("malformed_token", "token is not a compact JWS", 400);
  const [h, p, s] = parts as [string, string, string];
  const header = decodeSegment(h, "header") as JwtHeader;
  if (header.alg !== "RS256") throw new AttestError("unsupported_alg", `token alg must be RS256, got ${String(header.alg)}`, 401);
  if (typeof header.kid !== "string" || !header.kid) throw new AttestError("malformed_token", "token header has no kid", 400);
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new AttestError("malformed_token", "token signature is not base64url", 400);
  const key = await opts.jwks.getKey(header.kid);
  const ok = await crypto.subtle.verify(RSA_ALG, key, new Uint8Array(fromBase64(s)), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new AttestError("bad_signature", "token signature is invalid", 401);
  const payload = decodeSegment(p, "payload");

  if (payload.iss !== opts.issuer) throw new AttestError("bad_issuer", "token issuer is not GitHub Actions", 401);
  const { nowSecs: now, skewSecs: skew } = opts;
  if (typeof payload.exp !== "number") throw new AttestError("malformed_token", "token has no exp", 401);
  if (now >= payload.exp + skew) throw new AttestError("expired", "token expired", 401);
  if (payload.nbf !== undefined && (typeof payload.nbf !== "number" || now + skew < payload.nbf)) {
    throw new AttestError("not_yet_valid", "token not valid yet", 401);
  }
  if (payload.iat !== undefined && (typeof payload.iat !== "number" || payload.iat > now + skew)) {
    throw new AttestError("not_yet_valid", "token issued in the future", 401);
  }
  return { header, payload };
}
