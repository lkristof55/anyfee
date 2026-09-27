export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class ResolveError extends Error {
  override name = "ResolveError";
  /** HTTP-ish status the caller may surface: 404 not found, 429 rate limited, 502 upstream failure. */
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function fetchJson(fetchImpl: FetchLike, url: string, init: RequestInit, what: string, timeoutMs = 10_000): Promise<{ status: number; body: unknown; headers: Headers }> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new ResolveError(`${what}: request failed (${(e as Error).message})`, 502);
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: res.status, body, headers: res.headers };
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Numeric id as a decimal string (GitHub returns numbers, X returns strings). */
export function idString(v: unknown): string | null {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return String(v);
  if (typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) < 1n << 64n) return v;
  return null;
}
