// End-to-end, offline: the GitHub Action's code (action/lib.mjs) -> the local Node attester
// server over HTTP -> OIDC verification (mock JWKS + recorded GitHub API) -> signed attestations.
import { test } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { fromBase64 } from "@anyfee/sdk";
import { memoryChain } from "@anyfee/sdk/testing";
import { run } from "../../action/lib.mjs";
import { createHandler } from "../src/handler.ts";
import { JwksCache } from "../src/jwt.ts";
import { serve } from "../src/node.ts";
import { GH, JWKS_URL, attesterKp, claimant, fakeFetch, githubClaims, makeRsaKey, quietLog, sdkFixture, signJwt, testConfig } from "./helpers.ts";

test("action -> attester server -> attestations that verify against the attester key", async () => {
  const now = Math.floor(Date.now() / 1000);
  const key = await makeRsaKey("e2e");
  const upstream = fakeFetch({
    [JWKS_URL]: { body: { keys: [key.jwk] } },
    [`${GH}/repositories/1296269`]: { body: sdkFixture("github/repositories-1296269.json") },
  });
  const handler = createHandler({
    config: testConfig(),
    fetch: upstream,
    jwks: new JwksCache({ url: JWKS_URL, fetch: upstream }),
    connection: memoryChain() as never,
    log: quietLog,
  });
  const server = await serve(handler, 0);
  const port = (server.address() as { port: number }).port;
  try {
    let requestedAudience = "";
    const runnerFetch = async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(url instanceof Request ? url.url : String(url));
      if (u.hostname === "runner.test") {
        requestedAudience = u.searchParams.get("audience") ?? "";
        const token = await signJwt(githubClaims(now, { aud: requestedAudience }), key);
        return new Response(JSON.stringify({ value: token }), { status: 200 });
      }
      return fetch(url, init); // real HTTP to the local attester
    };
    const out: Record<string, string> = {};
    const logs: string[] = [];
    const code = await run(
      {
        INPUT_CLAIMANT: claimant.toBase58(),
        "INPUT_ATTESTER-URL": `http://127.0.0.1:${port}`,
        ACTIONS_ID_TOKEN_REQUEST_URL: "https://runner.test/idtoken?api-version=2.0",
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runtime",
        GITHUB_OUTPUT: "out",
      },
      runnerFetch,
      { log: (s: string) => logs.push(s), error: (s: string) => logs.push(s), appendFile: (p: string, s: string) => (out[p] = (out[p] ?? "") + s) },
    );
    assert.equal(code, 0, logs.join("\n"));
    assert.equal(requestedAudience, `anyfee:${claimant.toBase58()}`);
    const line = out.out!.split("\n").find((l) => l.startsWith("attestations="))!;
    const atts = JSON.parse(line.slice("attestations=".length)) as { platform: number; message: string; signature: string }[];
    assert.deepEqual(atts.map((a) => a.platform), [2, 1]);
    for (const a of atts) assert.ok(nacl.sign.detached.verify(fromBase64(a.message), fromBase64(a.signature), attesterKp.publicKey.toBytes()));
  } finally {
    await new Promise((r) => server.close(r));
  }
});
