import { test, before } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, decodeBindMessage, fromBase64, vaultPda, type AttestationJson } from "@anyfee/sdk";
import { createHandler } from "../src/handler.ts";
import { JwksCache } from "../src/jwt.ts";
import { verifyGithubClaim } from "../src/github.ts";
import { memoryChain } from "@anyfee/sdk/testing";
import {
  GH,
  JWKS_URL,
  attesterKp,
  claimant,
  fakeFetch,
  githubClaims,
  makeRsaKey,
  post,
  quietLog,
  sdkFixture,
  signJwt,
  testConfig,
  type RsaKey,
} from "./helpers.ts";

const NOW = 1_790_000_000;
let keyA: RsaKey;
let keyB: RsaKey;
let rogue: RsaKey;

before(async () => {
  keyA = await makeRsaKey("kid-a");
  keyB = await makeRsaKey("kid-b");
  rogue = await makeRsaKey("kid-a"); // same kid as A, different key
});

const helloWorld = sdkFixture("github/repositories-1296269.json");
const gitignore = sdkFixture("github/repos-github-gitignore.json"); // org-owned

function routes(jwksKeys: () => RsaKey[] = () => [keyA]) {
  return {
    [JWKS_URL]: () => ({ body: { keys: jwksKeys().map((k) => k.jwk) } }),
    [`${GH}/repositories/1296269`]: { body: helloWorld },
    [`${GH}/repositories/1062897`]: { body: gitignore },
    [`${GH}/repositories/404`]: { status: 404, body: { message: "Not Found" } },
  };
}

function setup(jwksKeys?: () => RsaKey[], env: Record<string, string> = {}) {
  const f = fakeFetch(routes(jwksKeys));
  const jwks = new JwksCache({ url: JWKS_URL, fetch: f, nowMs: () => NOW * 1000, minRefetchIntervalMs: 30_000 });
  const handler = createHandler({ config: testConfig(env), fetch: f, jwks, connection: memoryChain() as never, nowSecs: () => NOW, log: quietLog });
  const call = async (token: string, extra: Record<string, unknown> = {}) => {
    const res = await handler(post("/api/attest/github", { oidcToken: token, ...extra }));
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  return { f, jwks, handler, call };
}

function checkAttestation(a: AttestationJson, platform: number, id: string) {
  assert.equal(a.platform, platform);
  assert.equal(a.id, id);
  assert.equal(a.claimant, claimant.toBase58());
  assert.equal(a.attester, attesterKp.publicKey.toBase58());
  assert.equal(a.expiresAt, NOW + 900);
  assert.equal(a.vault, vaultPda(platform as 1 | 2 | 3, BigInt(id))[0].toBase58());
  const m = fromBase64(a.message);
  const sig = fromBase64(a.signature);
  // independent check with tweetnacl against the attester public key
  assert.ok(nacl.sign.detached.verify(m, sig, attesterKp.publicKey.toBytes()), "signature verifies with tweetnacl");
  const d = decodeBindMessage(m);
  assert.ok(d.programId.equals(PROGRAM_ID));
  assert.equal(d.platform, platform);
  assert.equal(d.id.toString(), id);
  assert.ok(d.claimant.equals(claimant));
  assert.equal(d.expiresAt, BigInt(NOW + 900));
}

test("good token (workflow_dispatch by the owner) -> repo + user attestations", async () => {
  const { call } = setup();
  const r = await call(await signJwt(githubClaims(NOW), keyA));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.claimant, claimant.toBase58());
  assert.deepEqual(r.body.userClaim, { allowed: true });
  assert.equal(r.body.repository.fullName, "octocat/Hello-World");
  assert.equal(r.body.attestations.length, 2);
  checkAttestation(r.body.attestations[0], 2, "1296269");
  checkAttestation(r.body.attestations[1], 1, "583231");
  assert.equal(r.body.submitted, undefined);
});

test("good token on push; claim: \"repo\" returns only the repo attestation", async () => {
  const { call } = setup();
  const r = await call(await signJwt(githubClaims(NOW, { event_name: "push" }), keyA), { claim: "repo" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.attestations.map((a: AttestationJson) => a.platform), [2]);
});

test("wrong audience", async () => {
  const { call } = setup();
  for (const aud of ["sts.amazonaws.com", `https://github.com/octocat`, `anyfee-${claimant.toBase58()}`]) {
    const r = await call(await signJwt(githubClaims(NOW, { aud }), keyA));
    assert.equal(r.status, 401, aud);
    assert.equal(r.body.error.code, "bad_audience");
  }
  const two = await call(await signJwt(githubClaims(NOW, { aud: [`anyfee:${claimant.toBase58()}`, "other"] }), keyA));
  assert.equal(two.body.error.code, "bad_audience");
  const badKey = await call(await signJwt(githubClaims(NOW, { aud: "anyfee:not-a-wallet" }), keyA));
  assert.equal(badKey.body.error.code, "bad_claimant");
  const zero = await call(await signJwt(githubClaims(NOW, { aud: `anyfee:${PublicKey.default.toBase58()}` }), keyA));
  assert.equal(zero.body.error.code, "bad_claimant");
  const single = await call(await signJwt(githubClaims(NOW, { aud: [`anyfee:${claimant.toBase58()}`] }), keyA));
  assert.equal(single.status, 200);
});

test("expired token (with 60 s skew) and not-yet-valid token", async () => {
  const { call } = setup();
  const expired = await call(await signJwt(githubClaims(NOW, { exp: NOW - 61, iat: NOW - 400, nbf: NOW - 400 }), keyA));
  assert.equal(expired.status, 401);
  assert.equal(expired.body.error.code, "expired");
  const inSkew = await call(await signJwt(githubClaims(NOW, { exp: NOW - 30 }), keyA));
  assert.equal(inSkew.status, 200);
  const future = await call(await signJwt(githubClaims(NOW, { nbf: NOW + 120, iat: NOW + 120 }), keyA));
  assert.equal(future.body.error.code, "not_yet_valid");
  const noExp = await call(await signJwt(githubClaims(NOW, { exp: undefined }), keyA));
  assert.equal(noExp.status, 401);
});

test("wrong issuer", async () => {
  const { call } = setup();
  for (const iss of ["https://token.actions.githubusercontent.com/my-enterprise", "https://evil.example", "https://token.actions.githubusercontent.com/"]) {
    const r = await call(await signJwt(githubClaims(NOW, { iss }), keyA));
    assert.equal(r.status, 401, iss);
    assert.equal(r.body.error.code, "bad_issuer");
  }
});

test("wrong kid: unknown key id is rejected after one bounded JWKS refetch", async () => {
  const { call, jwks } = setup();
  const r = await call(await signJwt(githubClaims(NOW), keyB)); // kid-b not published
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, "unknown_kid");
  assert.equal(jwks.fetchCount, 1, "initial fetch only; refetch suppressed within minRefetchInterval");
  const again = await call(await signJwt(githubClaims(NOW), keyB));
  assert.equal(again.body.error.code, "unknown_kid");
  assert.equal(jwks.fetchCount, 1);
});

test("kid rotation: a new kid triggers a JWKS refetch and then verifies", async () => {
  let published = [keyA];
  let nowMs = NOW * 1000;
  const f = fakeFetch(routes(() => published));
  const jwks = new JwksCache({ url: JWKS_URL, fetch: f, nowMs: () => nowMs, minRefetchIntervalMs: 30_000 });
  const ctx = { jwks, github: { fetch: f }, nowSecs: () => NOW, skewSecs: 60 };
  await verifyGithubClaim(await signJwt(githubClaims(NOW), keyA), ctx);
  assert.equal(jwks.fetchCount, 1);
  await verifyGithubClaim(await signJwt(githubClaims(NOW), keyA), ctx);
  assert.equal(jwks.fetchCount, 1, "cached");
  published = [keyA, keyB]; // GitHub rotates keys
  nowMs += 31_000;
  const r = await verifyGithubClaim(await signJwt(githubClaims(NOW), keyB), ctx);
  assert.equal(r.grants.length, 2);
  assert.equal(jwks.fetchCount, 2);
  // TTL expiry refetches too
  nowMs += 11 * 60_000;
  await verifyGithubClaim(await signJwt(githubClaims(NOW), keyA), ctx);
  assert.equal(jwks.fetchCount, 3);
});

test("stale-if-error: JWKS outage after expiry keeps using the last good keys", async () => {
  let up = true;
  let nowMs = NOW * 1000;
  const f = fakeFetch({ ...routes(), [JWKS_URL]: () => (up ? { body: { keys: [keyA.jwk] } } : { status: 503, body: "down" }) });
  const jwks = new JwksCache({ url: JWKS_URL, fetch: f, nowMs: () => nowMs });
  const ctx = { jwks, github: { fetch: f }, nowSecs: () => NOW, skewSecs: 60 };
  await verifyGithubClaim(await signJwt(githubClaims(NOW), keyA), ctx);
  up = false;
  nowMs += 11 * 60_000;
  const r = await verifyGithubClaim(await signJwt(githubClaims(NOW), keyA), ctx);
  assert.equal(r.grants[0]!.id, "1296269");
});

test("bad signature, forged key with a published kid, alg confusion", async () => {
  const { call } = setup();
  const good = await signJwt(githubClaims(NOW), keyA);
  const [h, , s] = good.split(".");
  const evilPayload = Buffer.from(JSON.stringify(githubClaims(NOW, { repository_id: "1062897" }))).toString("base64url");
  const tampered = await call(`${h}.${evilPayload}.${s}`);
  assert.equal(tampered.body.error.code, "bad_signature");
  const forged = await call(await signJwt(githubClaims(NOW), rogue));
  assert.equal(forged.body.error.code, "bad_signature");
  const none = await call(`${Buffer.from(JSON.stringify({ alg: "none", kid: "kid-a" })).toString("base64url")}.${evilPayload}.`);
  assert.equal(none.body.error.code, "unsupported_alg");
  const hs = await call(await signJwt(githubClaims(NOW), keyA, { alg: "HS256" }));
  assert.equal(hs.body.error.code, "unsupported_alg");
  const garbage = await call("not-a-jwt");
  assert.equal(garbage.status, 400);
  assert.equal(garbage.body.error.code, "malformed_token");
});

test("non-default branch and tag refs are rejected", async () => {
  const { call } = setup();
  const branch = await call(await signJwt(githubClaims(NOW, { ref: "refs/heads/feature" }), keyA));
  assert.equal(branch.status, 403);
  assert.equal(branch.body.error.code, "not_default_branch");
  assert.match(branch.body.error.message, /master/);
  const tag = await call(await signJwt(githubClaims(NOW, { ref: "refs/tags/v1", ref_type: "tag" }), keyA));
  assert.equal(tag.body.error.code, "not_default_branch");
});

test("fork / pull_request events are rejected", async () => {
  const { call } = setup();
  for (const event_name of ["pull_request", "pull_request_target", "workflow_run", "schedule", "issue_comment"]) {
    const r = await call(await signJwt(githubClaims(NOW, { event_name, ref: "refs/pull/7/merge" }), keyA));
    assert.equal(r.status, 403, event_name);
    assert.equal(r.body.error.code, "bad_event");
  }
});

test("owner mismatch (fork/transfer): token repository_owner_id != repository's owner", async () => {
  const { call } = setup();
  const r = await call(await signJwt(githubClaims(NOW, { repository_owner_id: "999", actor_id: "999" }), keyA));
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "owner_mismatch");
});

test("org-owned repository: repo claim ok, user claim rejected", async () => {
  const { call } = setup();
  const claims = githubClaims(NOW, {
    repository: "github/gitignore",
    repository_id: "1062897",
    repository_owner: "github",
    repository_owner_id: "9919",
    ref: "refs/heads/main",
    actor_id: "9919",
  });
  const r = await call(await signJwt(claims, keyA));
  assert.equal(r.status, 200);
  assert.equal(r.body.userClaim.allowed, false);
  assert.match(r.body.userClaim.reason, /Organization/);
  assert.deepEqual(r.body.attestations.map((a: AttestationJson) => [a.platform, a.id]), [[2, "1062897"]]);
  const userOnly = await call(await signJwt(claims, keyA), { claim: "user" });
  assert.equal(userOnly.status, 403);
  assert.equal(userOnly.body.error.code, "user_claim_not_allowed");
});

test("actor != owner: repo claim ok, user claim rejected", async () => {
  const { call } = setup();
  const r = await call(await signJwt(githubClaims(NOW, { actor: "a-collaborator", actor_id: "1234" }), keyA));
  assert.equal(r.status, 200);
  assert.equal(r.body.userClaim.allowed, false);
  assert.match(r.body.userClaim.reason, /a-collaborator/);
  assert.equal(r.body.attestations.length, 1);
});

test("repository not visible to the attester (private) and malformed claims", async () => {
  const { call } = setup();
  const r = await call(await signJwt(githubClaims(NOW, { repository_id: "404" }), keyA));
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "repo_not_visible");
  const bad = await call(await signJwt(githubClaims(NOW, { repository_id: 1296269 }), keyA));
  assert.equal(bad.body.error.code, "malformed_token");
});

test("resolve-only mode (no key) answers 503 and request validation", async () => {
  const f = fakeFetch(routes());
  const handler = createHandler({ config: { ...testConfig(), attesterKey: null }, fetch: f, connection: memoryChain() as never, log: quietLog });
  const res = await handler(post("/api/attest/github", { oidcToken: "x.y.z" }));
  assert.equal(res.status, 503);
  const { handler: h2 } = setup();
  assert.equal((await h2(post("/api/attest/github", { token: "x" }))).status, 400);
  assert.equal((await h2(post("/api/attest/github", { oidcToken: "x", claim: "everything" }))).status, 400);
  assert.equal((await h2(new Request("http://attester.test/api/attest/github", { method: "POST", body: "{nope" }))).status, 400);
  assert.equal((await h2(new Request("http://attester.test/api/attest/github"))).status, 405);
  assert.equal((await h2(post("/api/attest/github", { oidcToken: "a".repeat(20_000) }))).status, 413);
});
