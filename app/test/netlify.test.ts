import { test } from "node:test";
import assert from "node:assert/strict";

test("Netlify api function: attester routes via its adapter, /api/rpc via the proxy", async () => {
  delete process.env.ATTESTER_SECRET_KEY;
  const { default: api, config } = await import("../netlify/functions/api.ts");
  assert.equal(config.path, "/api/*");
  const health = await api(new Request("https://site.test/api/health"));
  assert.equal(health.status, 200);
  assert.equal((await health.json()).service, "anyfee-attester");
  const rpc = await api(new Request("https://site.test/api/rpc", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "requestAirdrop" }) }));
  assert.equal(rpc.status, 403);
  const attest = await api(new Request("https://site.test/api/attest/x", { method: "POST", body: "{}" }));
  assert.equal(attest.status, 503, "no signing key configured → attest endpoints answer 503");
});

test("Netlify vault-page function: per-path meta on the built shell", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('<html><head><!--meta:start--><title>x</title><!--meta:end--></head></html>', { status: 200 })) as typeof fetch;
  try {
    const { default: page, config } = await import("../netlify/functions/vault-page.ts");
    assert.equal(config.path, "/v/*");
    const r = await page(new Request("https://site.test/v/x/jack"));
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<title>@jack · anyfee vault<\/title>/);
    const missing = await page(new Request("https://site.test/v/github/nope"));
    assert.equal(missing.status, 404);
  } finally {
    globalThis.fetch = realFetch;
  }
});
