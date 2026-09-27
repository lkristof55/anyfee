import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  ACCOUNTS,
  DEVNET_USDC_MINT,
  PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  bindInstructions,
  claimAllInstructions,
  configPda,
  createAttestation,
  encodeAccountData,
  instructionDiscriminator,
  tipPda,
  tipSolInstructions,
  tipTokenInstructions,
  toHex,
  vaultAta,
  vaultPda,
} from "../src/index.ts";
import { memoryChain, rentExemptMinimum, tokenAccountData } from "../src/testing.ts";

const pk = (n: number) => Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey;
const sender = pk(1);
const claimant = pk(2);
const disc = (ix: { data: Buffer }) => toHex(ix.data.subarray(0, 8));
const is = (name: string) => toHex(instructionDiscriminator(name));

function chainWithConfig() {
  const chain = memoryChain();
  chain.set(configPda()[0], { lamports: 1, owner: PROGRAM_ID, data: encodeAccountData(ACCOUNTS.Config, { admin: pk(9), attester: pk(8), usdcMint: DEVNET_USDC_MINT }) });
  return chain;
}

test("tip flows prepend init_vault only when needed and use tip_count as the index", async () => {
  const chain = chainWithConfig();
  const fresh = await tipSolInstructions(chain, { sender, platform: 2, id: 5n, amount: 10n });
  assert.deepEqual(fresh.map(disc), [is("init_vault"), is("tip_sol")]);
  const [vault] = vaultPda(2, 5n);
  chain.set(vault, { lamports: 1, owner: PROGRAM_ID, data: encodeAccountData(ACCOUNTS.Vault, { platform: 2, id: 5n, tipCount: 7n }) });
  const existing = await tipTokenInstructions(chain, { sender, platform: 2, id: 5n, amount: 10n });
  assert.deepEqual(existing.map(disc), [is("tip_token")]);
  assert.ok(existing[0]!.keys.some((k) => k.pubkey.equals(tipPda(vault, 7n)[0])));
});

test("bindInstructions: [init_vault?, ed25519, bind]", async () => {
  const attester = Keypair.fromSeed(new Uint8Array(32).fill(3));
  const a = await createAttestation(
    { platform: 3, id: "12", claimant, expiresAt: Math.floor(Date.now() / 1000) + 600 },
    { publicKey: attester.publicKey, sign: (m) => nacl.sign.detached(m, attester.secretKey) },
  );
  const ixs = await bindInstructions(chainWithConfig(), a, { payer: sender, expectedAttester: attester.publicKey });
  assert.equal(ixs.length, 3);
  assert.equal(disc(ixs[0]!), is("init_vault"));
  assert.equal(ixs[1]!.programId.toBase58(), "Ed25519SigVerify111111111111111111111111111");
  assert.equal(disc(ixs[2]!), is("bind"));
  await assert.rejects(bindInstructions(chainWithConfig(), a, { payer: sender, expectedAttester: sender }), /unexpected attester/);
});

test("claimAllInstructions: SOL above rent and tokens (with idempotent ATA creation)", async () => {
  const chain = chainWithConfig();
  const [vault] = vaultPda(1, 77n);
  assert.deepEqual(await claimAllInstructions(chain, { claimant, platform: 1, id: 77n }), [], "uninitialized: nothing");
  const data = encodeAccountData(ACCOUNTS.Vault, { platform: 1, id: 77n, claimant });
  chain.set(vault, { lamports: rentExemptMinimum(data.length), owner: PROGRAM_ID, data });
  assert.deepEqual(await claimAllInstructions(chain, { claimant, platform: 1, id: 77n }), [], "only rent: nothing");
  chain.set(vault, { lamports: rentExemptMinimum(data.length) + 5, owner: PROGRAM_ID, data });
  chain.set(vaultAta(vault, DEVNET_USDC_MINT), { lamports: 1, owner: TOKEN_PROGRAM_ID, data: tokenAccountData(DEVNET_USDC_MINT, vault, 9n) });
  const ixs = await claimAllInstructions(chain, { claimant, platform: 1, id: 77n });
  assert.equal(ixs.length, 3);
  assert.equal(disc(ixs[0]!), is("claim_sol"));
  assert.equal(ixs[1]!.programId.toBase58(), "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  assert.equal(disc(ixs[2]!), is("claim_token"));
});
