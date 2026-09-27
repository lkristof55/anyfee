import { test } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { decodeBindMessage, fromBase64, fxTwitterResolver } from "@anyfee/sdk";
import { memoryChain } from "@anyfee/sdk/testing";
import { createHandler } from "../src/handler.ts";
import { proofClaimants, verifyXClaim } from "../src/x.ts";
import { attesterKp, claimant, fakeFetch, otherWallet, post, quietLog, sdkFixture, testConfig } from "./helpers.ts";

const NOW = 1_790_000_000;
const FX = "https://api.fxtwitter.com";

/** Recorded fxtwitter response for x.com/jack/status/20 with only text + timestamp swapped. */
function claimPost(text: string, createdTimestamp = NOW - 600): Record<string, unknown> {
  const rec = structuredClone(sdkFixture("fxtwitter/status-20.json")) as { tweet: Record<string, any> };
  rec.tweet.text = text;
  rec.tweet.raw_text = { text, display_text_range: [0, text.length], facets: [] };
  rec.tweet.created_timestamp = createdTimestamp;
  rec.tweet.created_at = new Date(createdTimestamp * 1000).toUTCString();
  return rec;
}

function setup(body: Record<string, unknown> | { status: number; body: unknown }, env: Record<string, string> = {}) {
  const route = "status" in body && typeof body.status === "number" ? (body as { status: number; body: unknown }) : { body };
  const f = fakeFetch({ [`${FX}/status/20`]: route });
  const handler = createHandler({ config: testConfig(env), fetch: f, connection: memoryChain() as never, nowSecs: () => NOW, log: quietLog });
  return async (reqBody: Record<string, unknown>) => {
    const res = await handler(post("/api/attest/x", reqBody));
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
}

const url = "https://x.com/jack/status/20";

test("good post -> platform 3 attestation for the author's numeric id", async () => {
  const call = setup(claimPost(`claiming my anyfee vault: anyfee:${claimant.toBase58()} #anyfee`));
  const r = await call({ tweetUrl: url, claimant: claimant.toBase58() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.post.authorId, "12");
  assert.equal(r.body.post.authorHandle, "jack");
  const [a] = r.body.attestations;
  assert.equal(a.platform, 3);
  assert.equal(a.id, "12");
  assert.equal(a.expiresAt, NOW + 900);
  assert.ok(nacl.sign.detached.verify(fromBase64(a.message), fromBase64(a.signature), attesterKp.publicKey.toBytes()));
  const m = decodeBindMessage(fromBase64(a.message));
  assert.equal(m.platform, 3);
  assert.equal(m.id, 12n);
  assert.ok(m.claimant.equals(claimant));
});

test("the handle in the URL is ignored; the resolver's author id wins", async () => {
  const call = setup(claimPost(`anyfee:${claimant.toBase58()}`));
  const r = await call({ tweetUrl: "https://twitter.com/someone_else/status/20?s=20", claimant: claimant.toBase58() });
  assert.equal(r.status, 200);
  assert.equal(r.body.attestations[0].id, "12");
});

test("post without the proof, with another wallet, or with two wallets", async () => {
  const missing = await setup(claimPost("just setting up my twttr"))({ tweetUrl: url, claimant: claimant.toBase58() });
  assert.equal(missing.status, 403);
  assert.equal(missing.body.error.code, "proof_missing");
  const other = await setup(claimPost(`anyfee:${otherWallet.toBase58()}`))({ tweetUrl: url, claimant: claimant.toBase58() });
  assert.equal(other.body.error.code, "proof_mismatch");
  const two = await setup(claimPost(`anyfee:${claimant.toBase58()} anyfee:${otherWallet.toBase58()}`))({ tweetUrl: url, claimant: claimant.toBase58() });
  assert.equal(two.body.error.code, "proof_ambiguous");
  const glued = await setup(claimPost(`notanyfee:${claimant.toBase58()}`))({ tweetUrl: url, claimant: claimant.toBase58() });
  assert.equal(glued.body.error.code, "proof_missing");
  const extended = await setup(claimPost(`anyfee:${claimant.toBase58()}abc`))({ tweetUrl: url, claimant: claimant.toBase58() });
  assert.equal(extended.body.error.code, "proof_missing");
  const upper = await setup(claimPost(`ANYFEE:${claimant.toBase58()}`))({ tweetUrl: url, claimant: claimant.toBase58() });
  assert.equal(upper.body.error.code, "proof_missing");
});

test("old and future-dated posts are rejected", async () => {
  const old = await setup(claimPost(`anyfee:${claimant.toBase58()}`, NOW - 2 * 86_400))({ tweetUrl: url, claimant: claimant.toBase58() });
  assert.equal(old.status, 403);
  assert.equal(old.body.error.code, "post_too_old");
  const future = await setup(claimPost(`anyfee:${claimant.toBase58()}`, NOW + 3600))({ tweetUrl: url, claimant: claimant.toBase58() });
  assert.equal(future.body.error.code, "post_in_future");
  const longer = await setup(claimPost(`anyfee:${claimant.toBase58()}`, NOW - 2 * 86_400), { X_MAX_POST_AGE_SECS: "259200" })({
    tweetUrl: url,
    claimant: claimant.toBase58(),
  });
  assert.equal(longer.status, 200);
});

test("deleted/unknown post (recorded 404) and bad input", async () => {
  const gone = setup({ status: 404, body: sdkFixture("fxtwitter/status-not-found.json") });
  const r = await gone({ tweetUrl: url, claimant: claimant.toBase58() });
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, "post_not_found");
  const call = setup(claimPost(`anyfee:${claimant.toBase58()}`));
  assert.equal((await call({ tweetUrl: "https://evil.example/jack/status/20", claimant: claimant.toBase58() })).body.error.code, "bad_tweet_url");
  assert.equal((await call({ tweetUrl: "https://x.com/jack", claimant: claimant.toBase58() })).body.error.code, "bad_tweet_url");
  assert.equal((await call({ tweetUrl: url, claimant: "nope" })).body.error.code, "bad_claimant");
  assert.equal((await call({ tweetUrl: url })).status, 400);
});

test("official X API is used when X_BEARER_TOKEN is set", async () => {
  const text = `anyfee:${claimant.toBase58()}`;
  const f = fakeFetch({
    "https://api.x.com/2/tweets/20?expansions=author_id&tweet.fields=created_at,author_id,note_tweet&user.fields=username,name": {
      body: {
        data: { id: "20", text, author_id: "12", created_at: new Date((NOW - 60) * 1000).toISOString() },
        includes: { users: [{ id: "12", name: "jack", username: "jack" }] },
      },
    },
  });
  const handler = createHandler({ config: testConfig({ X_BEARER_TOKEN: "AAAA-test" }), fetch: f, connection: memoryChain() as never, nowSecs: () => NOW, log: quietLog });
  const res = await handler(post("/api/attest/x", { tweetUrl: url, claimant: claimant.toBase58() }));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as any).attestations[0].id, "12");
  assert.equal(f.calls.length, 1);
});

test("proofClaimants / verifyXClaim unit", async () => {
  assert.deepEqual(proofClaimants(`a anyfee:${claimant.toBase58()}. b (anyfee:${claimant.toBase58()})`), [claimant.toBase58()]);
  const f = fakeFetch({ [`${FX}/status/20`]: { body: claimPost(`anyfee:${claimant.toBase58()}`) } });
  const r = await verifyXClaim({ tweetUrl: url, claimant: claimant.toBase58() }, {
    resolver: fxTwitterResolver({ fetch: f }),
    nowSecs: () => NOW,
    maxPostAgeSecs: 86_400,
    skewSecs: 60,
  });
  assert.deepEqual(r.grants, [{ platform: 3, id: "12" }]);
});
