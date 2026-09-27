import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { memoryChain } from "@anyfee/sdk/testing";
import { describeConfig, loadConfig } from "../src/config.ts";
import { createHandler } from "../src/handler.ts";
import { parseSecretKey } from "../src/keys.ts";
import { netlifyHandler } from "../src/netlify.ts";
import { serve } from "../src/node.ts";
import { quietLog } from "./helpers.ts";

const kp = Keypair.fromSeed(new Uint8Array(32).fill(40));
const b58 = bs58.encode(kp.secretKey);
const json = JSON.stringify(Array.from(kp.secretKey));

test("parseSecretKey: base58 keypair, JSON array, 32-byte seed; rejects mismatches without leaking", () => {
  for (const v of [b58, json, bs58.encode(kp.secretKey.slice(0, 32)), JSON.stringify(Array.from(kp.secretKey.slice(0, 32)))]) {
    assert.equal(parseSecretKey(v).publicKey.toBase58(), kp.publicKey.toBase58());
  }
  const broken = kp.secretKey.slice();
  broken[40] = (broken[40] as number) ^ 1;
  assert.throws(() => parseSecretKey(bs58.encode(broken)), (e: Error) => /public half/.test(e.message) && !e.message.includes(bs58.encode(broken)));
  assert.throws(() => parseSecretKey("[1,2,3]"), /64 or 32 bytes/);
  assert.throws(() => parseSecretKey("0OIl"), /base58/);
  assert.throws(() => parseSecretKey("[1,2,"), /JSON/);
});

test("loadConfig: env only; key file only with an explicit path and a reader", () => {
  const c = loadConfig({ ATTESTER_SECRET_KEY: b58, RPC_URL: "https://devnet.helius-rpc.com/?api-key=SECRET" });
  assert.equal(c.attesterKey?.publicKey.toBase58(), kp.publicKey.toBase58());
  assert.equal(c.submit, false);
  const d = JSON.stringify(describeConfig(c));
  assert.ok(!d.includes("SECRET") && !d.includes(b58), "describeConfig never prints secrets");
  assert.equal(loadConfig({}).attesterKey, null);
  assert.throws(() => loadConfig({ ATTESTER_SECRET_KEY_FILE: "/tmp/x.json" }), /only supported by the local Node server/);
  const fromFile = loadConfig({ ATTESTER_SECRET_KEY_FILE: "keys/attester-devnet.json" }, (p) => {
    assert.equal(p, "keys/attester-devnet.json");
    return json;
  });
  assert.equal(fromFile.attesterKey?.publicKey.toBase58(), kp.publicKey.toBase58());
  assert.throws(() => loadConfig({ ATTESTER_SECRET_KEY: b58, ATTESTER_PUBKEY: "FJpnX2EKfLMyFitghtSjZuoisNxP6ZgkNCQi2LgfiiLY" }), /does not match/);
  assert.throws(() => loadConfig({ ATTESTER_SUBMIT: "1" }), /needs ATTESTER_SECRET_KEY/);
  assert.throws(() => loadConfig({ ATTESTATION_TTL_SECS: "99999" }), /ATTESTATION_TTL_SECS/);
});

test("health, CORS preflight and 404", async () => {
  const handler = createHandler({ config: loadConfig({ ATTESTER_SECRET_KEY: b58 }), connection: memoryChain() as never, log: quietLog });
  const h = await handler(new Request("http://x/api/health"));
  const body = (await h.json()) as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(body.attester, kp.publicKey.toBase58());
  assert.equal(body.xResolver, "fxtwitter");
  const pre = await handler(new Request("http://x/api/attest/github", { method: "OPTIONS" }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
  assert.equal((await handler(new Request("http://x/nope"))).status, 404);
});

test("local Node server serves the handler", async () => {
  const handler = createHandler({ config: loadConfig({}), connection: memoryChain() as never, log: quietLog });
  const server = await serve(handler, 0);
  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/health`);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as Record<string, unknown>).attester, null);
    const p = await fetch(`http://127.0.0.1:${addr.port}/api/attest/x`, { method: "POST", body: JSON.stringify({ tweetUrl: "x", claimant: "y" }) });
    assert.equal(p.status, 503, "resolve-only mode");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("Netlify adapter builds the handler from env", async () => {
  const handler = netlifyHandler({ ATTESTER_SECRET_KEY: b58 });
  const res = await handler(new Request("https://attester.netlify.app/api/health"));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as Record<string, unknown>).attester, kp.publicKey.toBase58());
});
