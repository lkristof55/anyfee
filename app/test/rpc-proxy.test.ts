import { test } from "node:test";
import assert from "node:assert/strict";
import { DEVNET_GENESIS, MAINNET_GENESIS, createRpcProxy } from "../server/rpc-proxy.ts";

const PROGRAM = "BixfaA4JmPvntZvGZwnqhHdoUQvEzZY6ZBMXCLgF3C9M";

function fakeUpstream(genesis: string, opts: { rateLimitFirst?: number } = {}) {
  const calls: Array<{ method: string; url: string }> = [];
  let limited = opts.rateLimitFirst ?? 0;
  const fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ method: body.method, url });
    if (body.method !== "getGenesisHash" && limited > 0) {
      limited--;
      return new Response("busy", { status: 429 });
    }
    const result = body.method === "getGenesisHash" ? genesis : { ok: body.method };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const call = (proxy: (r: Request) => Promise<Response>, method: string, params?: unknown) =>
  proxy(new Request("http://site.test/api/rpc", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }) }));

test("forwards allowed methods to the configured RPC", async () => {
  const up = fakeUpstream(DEVNET_GENESIS);
  const proxy = createRpcProxy({ rpcUrl: "https://rpc.test/?api-key=SECRET", programId: PROGRAM, fetch: up.fetch });
  const r = await call(proxy, "getLatestBlockhash", [{ commitment: "confirmed" }]);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).result, { ok: "getLatestBlockhash" });
  assert.deepEqual(up.calls.map((c) => c.method), ["getGenesisHash", "getLatestBlockhash"]);
});

test("refuses methods outside the allowlist and unfiltered scans, without calling upstream", async () => {
  const up = fakeUpstream(DEVNET_GENESIS);
  const proxy = createRpcProxy({ rpcUrl: "https://rpc.test", programId: PROGRAM, fetch: up.fetch });
  assert.equal((await call(proxy, "requestAirdrop", ["x", 1])).status, 403);
  assert.equal((await call(proxy, "getProgramAccounts", ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"])).status, 403);
  assert.equal((await call(proxy, "getProgramAccounts", [PROGRAM, { filters: [{ dataSize: 130 }] }])).status, 403);
  assert.equal(up.calls.length, 0);
  const ok = await call(proxy, "getProgramAccounts", [PROGRAM, { filters: [{ dataSize: 130 }, { memcmp: { offset: 8, bytes: PROGRAM } }] }]);
  assert.equal(ok.status, 200);
});

test("refuses batches and non-POST", async () => {
  const proxy = createRpcProxy({ rpcUrl: "https://rpc.test", programId: PROGRAM, fetch: fakeUpstream(DEVNET_GENESIS).fetch });
  const batch = await proxy(new Request("http://site.test/api/rpc", { method: "POST", body: "[]" }));
  assert.equal(batch.status, 400);
  assert.equal((await proxy(new Request("http://site.test/api/rpc"))).status, 405);
});

test("never talks to mainnet-beta", async () => {
  const up = fakeUpstream(MAINNET_GENESIS);
  const proxy = createRpcProxy({ rpcUrl: "https://rpc.test", programId: PROGRAM, fetch: up.fetch });
  const r = await call(proxy, "getBalance", ["x"]);
  assert.equal(r.status, 503);
  assert.match((await r.json()).error.message, /mainnet/);
  assert.deepEqual(up.calls.map((c) => c.method), ["getGenesisHash"]);
});

test("absorbs short upstream rate limits", async () => {
  const up = fakeUpstream(DEVNET_GENESIS, { rateLimitFirst: 2 });
  const proxy = createRpcProxy({ rpcUrl: "https://rpc.test", programId: PROGRAM, fetch: up.fetch });
  const r = await call(proxy, "getSlot");
  assert.equal(r.status, 200);
  assert.equal(up.calls.filter((c) => c.method === "getSlot").length, 3);
});

test("upstream errors never leak the RPC URL", async () => {
  const fetch = (async () => {
    throw new Error("connect ECONNREFUSED https://rpc.test/?api-key=SECRET");
  }) as unknown as typeof globalThis.fetch;
  const proxy = createRpcProxy({ rpcUrl: "https://rpc.test/?api-key=SECRET", programId: PROGRAM, fetch });
  const text = await (await call(proxy, "getSlot")).text();
  assert.ok(!text.includes("SECRET"));
});
