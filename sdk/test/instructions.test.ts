import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  DEVNET_USDC_MINT,
  ED25519_PROGRAM_ID,
  INSTRUCTIONS,
  PROGRAM_ID,
  associatedTokenAddress,
  bindInstructionsFromAttestation,
  bindIx,
  cancelRebindIx,
  claimSolIx,
  claimTokenIx,
  configPda,
  concatBytes,
  declineIx,
  encodeBindMessage,
  finalizeRebindIx,
  i64le,
  initVaultIx,
  initializeIx,
  instructionDiscriminator,
  refundIxForTip,
  refundTipIx,
  refundTipTokenIx,
  closeTipIx,
  createAtaIdempotentIx,
  programDataAddress,
  setConfigIx,
  tipPda,
  tipSolIx,
  tipTokenIx,
  toHex,
  u64le,
  vaultAta,
  vaultPda,
  type InstructionName,
} from "../src/index.ts";

const pk = (n: number) => Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey;
const admin = pk(1);
const sender = pk(2);
const claimant = pk(3);
const attester = pk(4);
const dest = pk(5);
const vault = vaultPda(2, 99n)[0];
const [config] = configPda();

function checkAgainstLayout(name: InstructionName, ix: TransactionInstruction) {
  const layout = INSTRUCTIONS[name];
  assert.ok(ix.programId.equals(PROGRAM_ID), `${name}: program id`);
  assert.equal(toHex(ix.data.subarray(0, 8)), toHex(instructionDiscriminator(name)), `${name}: discriminator`);
  assert.equal(ix.keys.length, layout.accounts.length, `${name}: account count`);
  layout.accounts.forEach((a, i) => {
    const k = ix.keys[i]!;
    const optionalNone = "optional" in a && a.optional && k.pubkey.equals(PROGRAM_ID);
    if (!optionalNone) {
      assert.equal(k.isSigner, "signer" in a && !!a.signer, `${name}.${a.name}: signer`);
      assert.equal(k.isWritable, "writable" in a && !!a.writable, `${name}.${a.name}: writable`);
    }
    if ("address" in a && a.address && !optionalNone) assert.equal(k.pubkey.toBase58(), a.address, `${name}.${a.name}: fixed address`);
  });
}

const key = (ix: TransactionInstruction, name: InstructionName, account: string) => {
  const i = INSTRUCTIONS[name].accounts.findIndex((a) => a.name === account);
  assert.ok(i >= 0, `${name} has no account ${account}`);
  return ix.keys[i]!.pubkey;
};

const plat = (p: number, id: bigint) => concatBytes(Uint8Array.of(p), u64le(id));

test("initialize (admin must be the upgrade authority: program + program_data accounts)", () => {
  const ix = initializeIx({ admin, attester, usdcMint: DEVNET_USDC_MINT, refundWindowSecs: 2_592_000, rebindDelaySecs: 172_800 });
  checkAgainstLayout("initialize", ix);
  assert.ok(key(ix, "initialize", "config").equals(config));
  assert.ok(key(ix, "initialize", "program").equals(PROGRAM_ID));
  const [programData] = PublicKey.findProgramAddressSync([PROGRAM_ID.toBytes()], new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"));
  assert.ok(key(ix, "initialize", "program_data").equals(programData));
  assert.ok(programDataAddress().equals(programData));
  assert.equal(
    toHex(ix.data.subarray(8)),
    toHex(concatBytes(attester.toBytes(), DEVNET_USDC_MINT.toBytes(), i64le(2_592_000), i64le(172_800))),
  );
});

test("set_config encodes Option<T> (0 = None, 1 + value = Some)", () => {
  const ix = setConfigIx({ admin, paused: true, rebindDelaySecs: 60 });
  checkAgainstLayout("set_config", ix);
  // new_admin None, attester None, refund None, rebind Some(60), paused Some(true)
  assert.equal(toHex(ix.data.subarray(8)), toHex(concatBytes(Uint8Array.of(0, 0, 0, 1), i64le(60), Uint8Array.of(1, 1))));
  const all = setConfigIx({ admin, newAdmin: sender, attester, refundWindowSecs: 86_400, rebindDelaySecs: 3600, paused: false });
  assert.equal(
    toHex(all.data.subarray(8)),
    toHex(concatBytes(Uint8Array.of(1), sender.toBytes(), Uint8Array.of(1), attester.toBytes(), Uint8Array.of(1), i64le(86_400), Uint8Array.of(1), i64le(3600), Uint8Array.of(1, 0))),
  );
});

test("init_vault", () => {
  const ix = initVaultIx({ payer: sender, platform: 2, id: 99n });
  checkAgainstLayout("init_vault", ix);
  assert.ok(key(ix, "init_vault", "vault").equals(vault));
  assert.equal(toHex(ix.data.subarray(8)), toHex(plat(2, 99n)));
});

test("tip_sol uses tip index = tip_count", () => {
  const ix = tipSolIx({ sender, platform: 2, id: 99n, amount: 1_000_000n, tipIndex: 4n });
  checkAgainstLayout("tip_sol", ix);
  assert.ok(key(ix, "tip_sol", "tip").equals(tipPda(vault, 4n)[0]));
  assert.ok(key(ix, "tip_sol", "sender").equals(sender));
  assert.equal(toHex(ix.data.subarray(8)), toHex(concatBytes(plat(2, 99n), u64le(1_000_000n))));
});

test("tip_token derives sender ATA and vault ATA", () => {
  const ix = tipTokenIx({ sender, platform: 2, id: 99n, amount: 5_000_000n, tipIndex: 0n, mint: DEVNET_USDC_MINT });
  checkAgainstLayout("tip_token", ix);
  assert.ok(key(ix, "tip_token", "vault_token_account").equals(vaultAta(vault, DEVNET_USDC_MINT)));
  assert.ok(key(ix, "tip_token", "sender_token_account").equals(associatedTokenAddress(sender, DEVNET_USDC_MINT)));
});

test("bind args = platform, id, claimant, expires_at", () => {
  const ix = bindIx({ platform: 2, id: 99n, claimant, expiresAt: 1_800_000_000 });
  checkAgainstLayout("bind", ix);
  assert.equal(toHex(ix.data.subarray(8)), toHex(concatBytes(plat(2, 99n), claimant.toBytes(), i64le(1_800_000_000))));
});

test("rebind / claim / decline builders", () => {
  checkAgainstLayout("finalize_rebind", finalizeRebindIx({ platform: 1, id: 7n }));
  const cancel = cancelRebindIx({ platform: 1, id: 7n, claimant });
  checkAgainstLayout("cancel_rebind", cancel);
  assert.ok(key(cancel, "cancel_rebind", "claimant").equals(claimant));
  const cs = claimSolIx({ platform: 2, id: 99n, claimant, destination: dest });
  checkAgainstLayout("claim_sol", cs);
  assert.ok(key(cs, "claim_sol", "destination").equals(dest));
  const ct = claimTokenIx({ platform: 2, id: 99n, claimant, mint: DEVNET_USDC_MINT });
  checkAgainstLayout("claim_token", ct);
  assert.ok(key(ct, "claim_token", "destination").equals(associatedTokenAddress(claimant, DEVNET_USDC_MINT)));
  checkAgainstLayout("decline", declineIx({ platform: 3, id: 12n, claimant }));
});

test("refund_tip (SOL), refund_tip_token, refundIxForTip, close_tip", () => {
  const sol = refundTipIx({ platform: 2, id: 99n, tipIndex: 3n, sender });
  checkAgainstLayout("refund_tip", sol);
  assert.equal(toHex(sol.data.subarray(8)), toHex(concatBytes(plat(2, 99n), u64le(3n))));
  assert.ok(key(sol, "refund_tip", "tip").equals(tipPda(vault, 3n)[0]));
  assert.ok(key(sol, "refund_tip", "sender").equals(sender));
  const tok = refundTipTokenIx({ platform: 2, id: 99n, tipIndex: 3n, sender, mint: DEVNET_USDC_MINT });
  checkAgainstLayout("refund_tip_token", tok);
  assert.ok(key(tok, "refund_tip_token", "sender_token_account").equals(associatedTokenAddress(sender, DEVNET_USDC_MINT)));
  assert.ok(key(tok, "refund_tip_token", "vault_token_account").equals(vaultAta(vault, DEVNET_USDC_MINT)));
  const auto1 = refundIxForTip({ platform: 2, id: 99n, tipIndex: 3n, tip: { sender, mint: null } });
  assert.deepEqual(new Uint8Array(auto1.data), new Uint8Array(sol.data));
  const auto2 = refundIxForTip({ platform: 2, id: 99n, tipIndex: 3n, tip: { sender, mint: DEVNET_USDC_MINT } });
  assert.deepEqual(new Uint8Array(auto2.data), new Uint8Array(tok.data));
  const close = closeTipIx({ platform: 2, id: 99n, tipIndex: 3n, sender });
  checkAgainstLayout("close_tip", close);
});

test("createAtaIdempotentIx matches the ATA program's CreateIdempotent layout", () => {
  const ix = createAtaIdempotentIx({ payer: claimant, owner: claimant, mint: DEVNET_USDC_MINT });
  assert.equal(ix.programId.toBase58(), "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  assert.deepEqual(Array.from(ix.data), [1]);
  assert.ok(ix.keys[1]!.pubkey.equals(associatedTokenAddress(claimant, DEVNET_USDC_MINT)));
  assert.equal(ix.keys.length, 6);
});

test("every IDL instruction has a typed builder that satisfies its layout", () => {
  const built: Record<string, TransactionInstruction> = {
    initialize: initializeIx({ admin, attester, usdcMint: DEVNET_USDC_MINT, refundWindowSecs: 1, rebindDelaySecs: 1 }),
    set_config: setConfigIx({ admin }),
    init_vault: initVaultIx({ payer: sender, platform: 1, id: 1n }),
    tip_sol: tipSolIx({ sender, platform: 1, id: 1n, amount: 1n, tipIndex: 0n }),
    tip_token: tipTokenIx({ sender, platform: 1, id: 1n, amount: 1n, tipIndex: 0n, mint: DEVNET_USDC_MINT }),
    bind: bindIx({ platform: 1, id: 1n, claimant, expiresAt: 1 }),
    finalize_rebind: finalizeRebindIx({ platform: 1, id: 1n }),
    cancel_rebind: cancelRebindIx({ platform: 1, id: 1n, claimant }),
    claim_sol: claimSolIx({ platform: 1, id: 1n, claimant, destination: dest }),
    claim_token: claimTokenIx({ platform: 1, id: 1n, claimant, mint: DEVNET_USDC_MINT }),
    refund_tip: refundTipIx({ platform: 1, id: 1n, tipIndex: 0n, sender }),
    refund_tip_token: refundTipTokenIx({ platform: 1, id: 1n, tipIndex: 0n, sender, mint: DEVNET_USDC_MINT }),
    close_tip: closeTipIx({ platform: 1, id: 1n, tipIndex: 0n, sender }),
    decline: declineIx({ platform: 1, id: 1n, claimant }),
  };
  assert.deepEqual(Object.keys(built).sort(), Object.keys(INSTRUCTIONS).sort());
  for (const [name, ix] of Object.entries(built)) checkAgainstLayout(name as InstructionName, ix);
});

test("attestation -> [Ed25519SigVerify, bind], adjacent, fields from the signed message", () => {
  const signerKp = Keypair.fromSeed(new Uint8Array(32).fill(4));
  const message = encodeBindMessage({ platform: 2, id: 99n, claimant, expiresAt: 1_800_000_000 });
  const signature = nacl.sign.detached(message, signerKp.secretKey);
  const [ed, bind] = bindInstructionsFromAttestation({ message, signature, attester: signerKp.publicKey });
  assert.ok(ed.programId.equals(ED25519_PROGRAM_ID));
  assert.deepEqual(new Uint8Array(ed.data.subarray(112)), message);
  assert.deepEqual(new Uint8Array(bind.data), new Uint8Array(bindIx({ platform: 2, id: 99n, claimant, expiresAt: 1_800_000_000 }).data));
  // A realistic bind tx (init_vault + ed25519 + bind) fits in one packet.
  const tx = new Transaction({ feePayer: sender, recentBlockhash: PublicKey.default.toBase58() }).add(
    initVaultIx({ payer: sender, platform: 2, id: 99n }),
    ed,
    bind,
  );
  const size = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
  assert.ok(size <= 1232, `tx size ${size}`);
});
