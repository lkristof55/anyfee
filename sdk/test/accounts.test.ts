import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  ACCOUNTS,
  DEVNET_USDC_MINT,
  PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  VAULT_ACCOUNT_SIZE,
  configPda,
  decodeConfig,
  decodeTip,
  decodeVault,
  encodeAccountData,
  fetchVaultState,
  identifyAccount,
  vaultAta,
  vaultPda,
} from "../src/index.ts";
import { memoryChain, rentExemptMinimum, tokenAccountData } from "../src/testing.ts";

const pk = (n: number) => Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey;

test("account sizes follow the SPEC field lists", () => {
  assert.equal(VAULT_ACCOUNT_SIZE, 155);
});

test("Config round-trip", () => {
  const data = encodeAccountData(ACCOUNTS.Config, {
    admin: pk(1),
    attester: pk(2),
    usdcMint: DEVNET_USDC_MINT,
    refundWindowSecs: 2_592_000n,
    rebindDelaySecs: 172_800n,
    paused: true,
    bump: 254,
  });
  const c = decodeConfig(data);
  assert.ok(c.admin.equals(pk(1)));
  assert.ok(c.attester.equals(pk(2)));
  assert.ok(c.usdcMint.equals(DEVNET_USDC_MINT));
  assert.equal(c.refundWindowSecs, 2_592_000n);
  assert.equal(c.rebindDelaySecs, 172_800n);
  assert.equal(c.paused, true);
  assert.equal(c.bump, 254);
  assert.equal(identifyAccount(data), "Config");
});

test("Vault decode maps Pubkey::default to null", () => {
  const unbound = decodeVault(encodeAccountData(ACCOUNTS.Vault, { platform: 2, id: 99n, tipCount: 3n, bump: 253 }));
  assert.equal(unbound.claimant, null);
  assert.equal(unbound.pendingClaimant, null);
  assert.equal(unbound.tipCount, 3n);
  const bound = decodeVault(
    encodeAccountData(ACCOUNTS.Vault, {
      platform: 3,
      id: 12n,
      claimant: pk(5),
      pendingClaimant: pk(6),
      pendingEffectiveAt: 1_800_000_000n,
      boundAt: 1_700_000_000n,
      createdAt: 1_690_000_000n,
      declined: true,
      claimEpoch: 2n,
      outstandingTipLamports: 10n,
      outstandingTipTokens: 20n,
      totalClaimedLamports: 30n,
      totalClaimedTokens: 40n,
      bump: 1,
    }),
  );
  assert.ok(bound.claimant?.equals(pk(5)));
  assert.ok(bound.pendingClaimant?.equals(pk(6)));
  assert.equal(bound.pendingEffectiveAt, 1_800_000_000n);
  assert.equal(bound.declined, true);
  assert.equal(bound.claimEpoch, 2n);
  assert.equal(bound.totalClaimedTokens, 40n);
});

test("Tip decode; SOL tips have mint null", () => {
  const t = decodeTip(encodeAccountData(ACCOUNTS.Tip, { vault: pk(1), sender: pk(2), amount: 5n, createdAt: 7n, epoch: 0n, bump: 9 }));
  assert.equal(t.mint, null);
  assert.equal(t.amount, 5n);
  assert.equal(t.refunded, false);
});

test("decoders reject a wrong discriminator and short data", () => {
  const tip = encodeAccountData(ACCOUNTS.Tip, { vault: pk(1), sender: pk(2) });
  assert.throws(() => decodeVault(tip), /discriminator/);
  const vault = encodeAccountData(ACCOUNTS.Vault, { platform: 1 });
  assert.throws(() => decodeVault(vault.slice(0, 50)), /too short/);
  const badPlatform = encodeAccountData(ACCOUNTS.Vault, { platform: 7 });
  assert.throws(() => decodeVault(badPlatform), /unknown platform/);
});

test("fetchVaultState: pre-funded, uninitialized vault (fee routing before init)", async () => {
  const [vault] = vaultPda(2, 1296269n);
  const chain = memoryChain();
  chain.set(configPda()[0], {
    lamports: 1,
    owner: PROGRAM_ID,
    data: encodeAccountData(ACCOUNTS.Config, { admin: pk(1), attester: pk(2), usdcMint: DEVNET_USDC_MINT }),
  });
  chain.set(vault, { lamports: 5_000_000_000 }); // system-owned, no data: pump.fun/Bags sent fees here
  chain.set(vaultAta(vault, DEVNET_USDC_MINT), { lamports: 2_039_280, owner: TOKEN_PROGRAM_ID, data: tokenAccountData(DEVNET_USDC_MINT, vault, 7_000_000n) });
  const s = await fetchVaultState(chain, 2, 1296269n);
  assert.equal(s.initialized, false);
  assert.equal(s.account, null);
  assert.equal(s.lamports, 5_000_000_000n);
  assert.equal(s.rentExemptLamports, BigInt(rentExemptMinimum(VAULT_ACCOUNT_SIZE)));
  assert.equal(s.claimableLamports, 5_000_000_000n - BigInt(rentExemptMinimum(VAULT_ACCOUNT_SIZE)));
  assert.equal(s.tokenAmount, 7_000_000n);
  assert.ok(s.usdcMint.equals(DEVNET_USDC_MINT));
});

test("fetchVaultState: declined vault holds back outstanding tips", async () => {
  const [vault] = vaultPda(1, 5n);
  const data = encodeAccountData(ACCOUNTS.Vault, { platform: 1, id: 5n, claimant: pk(3), declined: true, outstandingTipLamports: 1_000n, outstandingTipTokens: 50n });
  const rent = rentExemptMinimum(data.length);
  const chain = memoryChain();
  chain.set(vault, { lamports: rent + 10_000, owner: PROGRAM_ID, data });
  chain.set(vaultAta(vault, DEVNET_USDC_MINT), { lamports: 1, owner: TOKEN_PROGRAM_ID, data: tokenAccountData(DEVNET_USDC_MINT, vault, 80n) });
  const s = await fetchVaultState(chain, 1, 5n, { fallbackUsdcMint: DEVNET_USDC_MINT });
  assert.equal(s.initialized, true);
  assert.ok(s.account?.claimant?.equals(pk(3)));
  assert.equal(s.claimableLamports, 9_000n);
  assert.equal(s.claimableTokens, 30n);
  assert.equal(s.config, null);
});

test("fetchVaultState without config or fallback mint fails loudly", async () => {
  await assert.rejects(fetchVaultState(memoryChain(), 1, 5n), /fallback USDC mint/);
  assert.ok(PublicKey.default);
});
