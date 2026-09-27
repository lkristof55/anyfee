import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FetchLike } from "../src/resolvers/http.ts";

export const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

export function fixture(path: string): unknown {
  return JSON.parse(readFileSync(FIXTURES + path, "utf8"));
}

export interface Route {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Offline fetch: answers only the listed URLs, records every call, throws for anything else. */
export function fakeFetch(routes: Record<string, Route | ((init?: RequestInit) => Route)>): FetchLike & { calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ...(init ? { init } : {}) });
    const r = routes[url];
    if (!r) throw new Error(`unexpected network call in test: ${url}`);
    const route = typeof r === "function" ? r(init) : r;
    const body = route.body === undefined ? "" : typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    return new Response(body, { status: route.status ?? 200, headers: { "content-type": "application/json", ...(route.headers ?? {}) } });
  }) as FetchLike & { calls: { url: string; init?: RequestInit }[] };
  fn.calls = calls;
  return fn;
}
