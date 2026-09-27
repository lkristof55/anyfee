import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, DEVNET_USDC_MINT, PROGRAM_ID, TOKEN_PROGRAM_ID, VAULT_ACCOUNT_SIZE, configPda, encodeAccountData, vaultAta, vaultPda } from "@anyfee/sdk";
import { memoryChain, rentExemptMinimum, tokenAccountData } from "@anyfee/sdk/testing";
import { createHandler } from "../src/handler.ts";
import { GH, attesterKp, claimant, fakeFetch, get, otherWallet, quietLog, sdkFixture, testConfig } from "./helpers.ts";

const NOW = 1_790_000_000;

function setup(chain = memoryChain()) {
  const f = fakeFetch({
    [`${GH}/repos/octocat/Hello-World`]: { body: sdkFixture("github/repos-octocat-Hello-World.json") },
    [`${GH}/users/github`]: { body: sdkFixture("github/users-github.json") },
    [`${GH}/users/octocat`]: { body: sdkFixture("github/users-octocat.json") },
    [`${GH}/repos/octocat/nope`]: { status: 404, body: sdkFixture("github/not-found.json") },
    [`${GH}/repositories/1296269`]: { body: sdkFixture("github/repositories-1296269.json") },
    "https://api.fxtwitter.com/solana": { body: sdkFixture("fxtwitter/user-solana.json") },
  });
  const handler = createHandler({ config: testConfig(), fetch: f, connection: chain as never, nowSecs: () => NOW, log: quietLog });
  return {
    f,
    call: async (q: string) => {
      const res = await handler(get(`/api/resolve?q=${encodeURIComponent(q)}`));
      return { status: res.status, body: (await res.json()) as Record<string, any>, headers: res.headers };
    },
  };
}

test("repo link, pre-funded uninitialized vault (fees routed before init)", async () => {
  const chain = memoryChain();
  const [vault] = vaultPda(2, 1296269n);
  chain.set(configPda()[0], {
    lamports: 1,
    owner: PROGRAM_ID,
    data: encodeAccountData(ACCOUNTS.Config, { admin: otherWallet, attester: attesterKp.publicKey, usdcMint: DEVNET_USDC_MINT, refundWindowSecs: 2_592_000n, rebindDelaySecs: 172_800n }),
  });
  chain.set(vault, { lamports: 3_000_000_000 });
  chain.set(vaultAta(vault, DEVNET_USDC_MINT), { lamports: 1, owner: TOKEN_PROGRAM_ID, data: tokenAccountData(DEVNET_USDC_MINT, vault, 1_500_000n) });
  const { call } = setup(chain);
  const r = await call("https://github.com/octocat/Hello-World");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  const b = r.body;
  assert.deepEqual([b.platform, b.platformName, b.id, b.display], [2, "github-repo", "1296269", "octocat/Hello-World"]);
  assert.equal(b.vault, vault.toBase58());
  assert.equal(b.initialized, false);
  assert.equal(b.balances.lamports, "3000000000");
  assert.equal(b.balances.claimableLamports, String(3_000_000_000 - rentExemptMinimum(VAULT_ACCOUNT_SIZE)));
  assert.deepEqual(b.balances.usdc, { mint: DEVNET_USDC_MINT.toBase58(), amount: "1500000", claimable: "1500000", decimals: 6 });
  assert.equal(b.claimant, null);
  assert.equal(b.declined, false);
  assert.equal(b.pending, null);
  assert.equal(b.config.attester, attesterKp.publicKey.toBase58());
  assert.equal(b.github.defaultBranch, "master");
});

test("bound vault with a pending rebind and declined flag", async () => {
  const chain = memoryChain();
  const [vault] = vaultPda(1, 583231n);
  const data = encodeAccountData(ACCOUNTS.Vault, {
    platform: 1,
    id: 583231n,
    claimant,
    pendingClaimant: otherWallet,
    pendingEffectiveAt: BigInt(NOW + 172_800),
    boundAt: BigInt(NOW - 1000),
    declined: true,
    tipCount: 4n,
    outstandingTipLamports: 1000n,
  });
  chain.set(vault, { lamports: rentExemptMinimum(data.length) + 5000, owner: PROGRAM_ID, data });
  const { call } = setup(chain);
  const r = await call("github.com/octocat");
  assert.equal(r.status, 200);
  const b = r.body;
  assert.equal(b.initialized, true);
  assert.equal(b.claimant, claimant.toBase58());
  assert.equal(b.boundAt, NOW - 1000);
  assert.deepEqual(b.pending, { claimant: otherWallet.toBase58(), effectiveAt: NOW + 172_800 });
  assert.equal(b.declined, true);
  assert.equal(b.balances.claimableLamports, "4000");
  assert.equal(b.tips.count, "4");
  assert.ok(b.warnings.some((w: string) => /pending/.test(w)));
  assert.ok(b.warnings.some((w: string) => /declined/.test(w)));
  assert.equal(b.config, null);
});

test("org account warning, X handle, and the id cache", async () => {
  const { call, f } = setup();
  const org = await call("github.com/github");
  assert.equal(org.body.id, "9919");
  assert.match(org.body.warnings[0], /organization/i);
  const x = await call("@solana");
  assert.deepEqual([x.body.platform, x.body.id, x.body.display], [3, "951329744804392960", "@solana"]);
  await call("@solana");
  assert.equal(f.calls.filter((u) => u.includes("fxtwitter")).length, 1, "identity lookups are cached");
});

test("vault address reverse lookup", async () => {
  const chain = memoryChain();
  const [vault] = vaultPda(2, 1296269n);
  chain.set(vault, { lamports: rentExemptMinimum(155), owner: PROGRAM_ID, data: encodeAccountData(ACCOUNTS.Vault, { platform: 2, id: 1296269n }) });
  const { call } = setup(chain);
  const r = await call(vault.toBase58());
  assert.equal(r.status, 200);
  assert.equal(r.body.display, "octocat/Hello-World");
  assert.equal(r.body.initialized, true);
});

test("errors: missing q, unparseable, unknown repo, unknown address", async () => {
  const { call } = setup();
  assert.equal((await call("")).status, 400);
  const bad = await call("octocat");
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, "bad_target");
  const nf = await call("github.com/octocat/nope");
  assert.equal(nf.status, 404);
  assert.equal(nf.body.error.code, "not_found");
  const addr = await call(otherWallet.toBase58());
  assert.equal(addr.status, 404);
});

test("chain unavailable: identity still returned with chainError", async () => {
  const broken = {
    ...memoryChain(),
    getMultipleAccountsInfo: async () => {
      throw new Error("429 Too Many Requests");
    },
  };
  const { call } = setup(broken as never);
  const r = await call("github.com/octocat/Hello-World");
  assert.equal(r.status, 200);
  assert.equal(r.body.id, "1296269");
  assert.match(r.body.chainError, /429/);
});
