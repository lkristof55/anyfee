// Same-origin JSON-RPC proxy for the browser: /api/rpc -> RPC_URL.
//
// Why: the RPC URL usually carries an API key (Helius), which must never reach the browser.
// The proxy forwards only the read/send methods the site uses, restricts getProgramAccounts to
// filtered scans of the anyfee program, never echoes upstream error details (they can contain
// the URL), and refuses to talk to mainnet-beta (checked by genesis hash) — devnet only.

export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const TESTNET_GENESIS = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

const ALLOWED = new Set([
  "getAccountInfo",
  "getMultipleAccounts",
  "getBalance",
  "getTokenAccountBalance",
  "getMinimumBalanceForRentExemption",
  "getLatestBlockhash",
  "isBlockhashValid",
  "getBlockHeight",
  "getSlot",
  "getGenesisHash",
  "getHealth",
  "getVersion",
  "getFeeForMessage",
  "simulateTransaction",
  "sendTransaction",
  "getSignatureStatuses",
  "getProgramAccounts",
]);

const MAX_BODY = 32 * 1024;

export interface RpcProxyOptions {
  rpcUrl: string;
  /** anyfee program id (base58): the only program getProgramAccounts may scan. */
  programId: string;
  fetch?: typeof fetch;
  /** Allow a non-devnet, non-mainnet cluster (e.g. a local validator). Mainnet is always refused. */
  allowLocal?: boolean;
}

type Json = Record<string, unknown>;

function rpcError(status: number, id: unknown, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function gpaAllowed(params: unknown, programId: string): boolean {
  if (!Array.isArray(params) || params[0] !== programId) return false;
  const cfg = params[1] as Json | undefined;
  const filters = cfg && Array.isArray(cfg.filters) ? (cfg.filters as Json[]) : [];
  // Must be narrowed to one vault (Tip.vault lives at offset 8).
  return filters.some((f) => f && typeof f === "object" && (f.memcmp as Json | undefined)?.offset === 8);
}

export function createRpcProxy(opts: RpcProxyOptions): (req: Request) => Promise<Response> {
  const fetchImpl = opts.fetch ?? ((i: RequestInfo | URL, init?: RequestInit) => fetch(i, init));
  let cluster: Promise<string> | null = null;

  async function once(body: string): Promise<Response> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20_000);
    try {
      return await fetchImpl(opts.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body, signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // Free RPC tiers rate-limit bursts (a page load plus a transaction is a burst). Absorb short
  // 429s here with a few backoffs instead of surfacing them to the browser.
  async function upstream(body: string): Promise<Response> {
    let r = await once(body);
    for (let i = 0; r.status === 429 && i < 4; i++) {
      await new Promise((res) => setTimeout(res, 250 * 2 ** i + Math.random() * 150));
      r = await once(body);
    }
    return r;
  }

  async function checkCluster(): Promise<string> {
    const r = await upstream(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getGenesisHash" }));
    const j = (await r.json()) as Json;
    if (typeof j.result !== "string") throw new Error("no genesis hash");
    return j.result;
  }

  return async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    if (req.method !== "POST") return rpcError(405, null, -32600, "use POST");
    const len = Number(req.headers.get("content-length") ?? "0");
    if (len > MAX_BODY) return rpcError(413, null, -32600, "request too large");
    const text = await req.text();
    if (text.length > MAX_BODY) return rpcError(413, null, -32600, "request too large");
    let msg: Json;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return rpcError(400, null, -32600, "batch requests are not supported");
      msg = parsed as Json;
    } catch {
      return rpcError(400, null, -32700, "parse error");
    }
    const method = msg.method;
    if (typeof method !== "string" || !ALLOWED.has(method)) {
      return rpcError(403, msg.id, -32601, `method ${String(method)} is not available through the anyfee RPC proxy`);
    }
    if (method === "getProgramAccounts" && !gpaAllowed(msg.params, opts.programId)) {
      return rpcError(403, msg.id, -32602, "getProgramAccounts is limited to filtered scans of the anyfee program");
    }
    try {
      if (!cluster) {
        cluster = checkCluster();
        cluster.catch(() => (cluster = null));
      }
      const genesis = await cluster;
      if (genesis === MAINNET_GENESIS) return rpcError(503, msg.id, -32000, "refusing to proxy mainnet-beta: anyfee is devnet only");
      if (genesis !== DEVNET_GENESIS && genesis !== TESTNET_GENESIS && !opts.allowLocal) {
        return rpcError(503, msg.id, -32000, "the configured RPC is not devnet");
      }
      const r = await upstream(JSON.stringify({ jsonrpc: "2.0", id: msg.id ?? 1, method, ...(msg.params !== undefined ? { params: msg.params } : {}) }));
      const body = await r.text();
      if (!r.ok) return rpcError(r.status === 429 ? 429 : 502, msg.id, -32000, r.status === 429 ? "RPC rate limited, try again" : `RPC answered ${r.status}`);
      return new Response(body, { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    } catch {
      return rpcError(502, msg.id, -32000, "RPC unavailable");
    }
  };
}
