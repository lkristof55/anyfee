import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { ACCOUNTS, PROGRAM_ID, ResolveError, encodeAccountData, fxTwitterResolver, resolveIdentity, tipPda, vaultPda } from "../src/index.ts";
import { memoryChain } from "../src/testing.ts";
import { fakeFetch, fixture } from "./helpers.ts";

const GH = "https://api.github.com";
const routes = {
  [`${GH}/repos/octocat/Hello-World`]: { body: fixture("github/repos-octocat-Hello-World.json") },
  [`${GH}/repositories/1296269`]: { body: fixture("github/repositories-1296269.json") },
  [`${GH}/users/github`]: { body: fixture("github/users-github.json") },
  [`${GH}/users/octocat`]: { body: fixture("github/users-octocat.json") },
  "https://api.fxtwitter.com/solana": { body: fixture("fxtwitter/user-solana.json") },
};

test("resolveIdentity: repo, user, org warning, X", async () => {
  const f = fakeFetch(routes);
  const opts = { github: { fetch: f }, x: fxTwitterResolver({ fetch: f }) };
  const repo = await resolveIdentity("https://github.com/octocat/Hello-World", opts);
  assert.deepEqual([repo.platform, repo.id, repo.display, repo.url], [2, "1296269", "octocat/Hello-World", "https://github.com/octocat/Hello-World"]);
  assert.deepEqual(repo.warnings, []);
  const user = await resolveIdentity("github.com/octocat", opts);
  assert.deepEqual([user.platform, user.id, user.display], [1, "583231", "octocat"]);
  const org = await resolveIdentity("github.com/github", opts);
  assert.equal(org.id, "9919");
  assert.match(org.warnings[0]!, /organization/i);
  const x = await resolveIdentity("@solana", opts);
  assert.deepEqual([x.platform, x.id, x.display], [3, "951329744804392960", "@solana"]);
});

test("resolveIdentity: canonical id form uses id lookups", async () => {
  const f = fakeFetch(routes);
  const r = await resolveIdentity("github-repo:1296269", { github: { fetch: f } });
  assert.equal(r.display, "octocat/Hello-World");
  const x = await resolveIdentity("x:12", { x: fxTwitterResolver({ fetch: f }) });
  assert.equal(x.display, "x:12"); // fxtwitter has no id lookup; still resolves
});

test("resolveIdentity: vault address and tip address reverse lookup", async () => {
  const f = fakeFetch(routes);
  const [vault] = vaultPda(2, 1296269n);
  const [tip] = tipPda(vault, 0n);
  const chain = memoryChain();
  chain.set(vault, { lamports: 1, owner: PROGRAM_ID, data: encodeAccountData(ACCOUNTS.Vault, { platform: 2, id: 1296269n }) });
  chain.set(tip, { lamports: 1, owner: PROGRAM_ID, data: encodeAccountData(ACCOUNTS.Tip, { vault }) });
  const opts = { github: { fetch: f }, connection: chain };
  assert.equal((await resolveIdentity(vault.toBase58(), opts)).display, "octocat/Hello-World");
  assert.equal((await resolveIdentity(tip.toBase58(), opts)).id, "1296269");
  const random = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey.toBase58();
  await assert.rejects(resolveIdentity(random, opts), (e: unknown) => e instanceof ResolveError && e.status === 404);
  await assert.rejects(resolveIdentity(random, {}), (e: unknown) => e instanceof ResolveError && e.status === 400);
});
