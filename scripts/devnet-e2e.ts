// End-to-end check of the deployed program on devnet, using only the SDK (no mocks).
//
//   RPC_URL=https://api.devnet.solana.com node scripts/devnet-e2e.ts
//
// Needs keys/devnet-deployer.json (payer + tipper, a few hundredths of devnet SOL) and
// keys/attester-devnet.json (the devnet attester). Uses fresh synthetic GitHub-repo ids (900000000000+),
// so it never touches a real repo's vault. Devnet only: refuses to run against mainnet.
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  Platform, vaultPda, tipSolInstructions, createAttestation, bindInstructions,
  claimAllInstructions, declineIx, refundTipIx, fetchVaultState,
} from "../sdk/src/index.ts";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const conn = new Connection(RPC, "confirmed");
const load = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"))));
const payer = load("keys/devnet-deployer.json");
const attester = load("keys/attester-devnet.json");
const signer = { publicKey: attester.publicKey, sign: (m: Uint8Array) => nacl.sign.detached(m, attester.secretKey) };
const sol = (l: number | bigint) => (Number(l) / LAMPORTS_PER_SOL).toFixed(6);
const tx = (label: string, ixs: any[], extra: Keypair[] = []) =>
  sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [payer, ...extra], { commitment: "confirmed" })
    .then((sig) => { console.log(`  ${label}: https://explorer.solana.com/tx/${sig}?cluster=devnet`); return sig; });
const ok = (cond: unknown, what: string) => { if (!cond) throw new Error(`FAIL: ${what}`); console.log(`  ✓ ${what}`); };

if ((await conn.getGenesisHash()) !== DEVNET_GENESIS) throw new Error("not devnet — refusing to run");
console.log(`payer ${payer.publicKey.toBase58()}  balance ${sol(await conn.getBalance(payer.publicKey))} SOL`);

const base = 900_000_000_000n + BigInt(Date.now() % 1_000_000) * 10n;
const expiresAt = Math.floor(Date.now() / 1000) + 600;

// ---------- A: pre-funded vault (pump.fun-style raw inflow) + receipted tip -> bind -> claim ----------
{
  const id = base, platform = Platform.GithubRepo;
  const [vault] = vaultPda(platform, id);
  const claimant = Keypair.generate();
  console.log(`\nA  vault ${vault.toBase58()}  (platform 2, id ${id})`);
  await tx("raw inflow 0.003 SOL to the uninitialized vault address",
    [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: vault, lamports: 3_000_000 })]);
  await tx("init_vault + tip_sol 0.01", await tipSolInstructions(conn, { platform, id, sender: payer.publicKey, amount: 10_000_000n }));
  let s = await fetchVaultState(conn, platform, id);
  ok(s.initialized && s.account!.tipCount === 1n, "vault initialized on a pre-funded address, 1 tip recorded");
  const att = await createAttestation({ platform, id, claimant: claimant.publicKey, expiresAt }, signer);
  await tx("ed25519 + bind", await bindInstructions(conn, att, { payer: payer.publicKey }));
  s = await fetchVaultState(conn, platform, id);
  ok(s.account!.claimant.equals(claimant.publicKey), "vault bound to the attested claimant");
  await tx("claim_sol -> claimant", await claimAllInstructions(conn, { platform, id, claimant: claimant.publicKey }), [claimant]);
  const got = await conn.getBalance(claimant.publicKey);
  const rent = await conn.getMinimumBalanceForRentExemption((await conn.getAccountInfo(vault))!.data.length);
  // The raw inflow arrived before init, so it also paid the vault's rent (init_vault's payer topped up nothing);
  // the claim leaves exactly rent-exempt minimum in the vault.
  ok(got === 13_000_000 - rent, `claimant received raw inflow + tip minus vault rent = ${sol(got)} SOL (rent ${sol(rent)} stays)`);
  s = await fetchVaultState(conn, platform, id);
  ok(s.account!.claimEpoch === 1n && s.account!.outstandingTipLamports === 0n, "claim consumed the tip (epoch 1, outstanding 0)");
}

// ---------- B: tip -> bind -> decline -> permissionless refund to the sender ----------
{
  const id = base + 1n, platform = Platform.GithubRepo;
  const claimant = Keypair.generate();
  console.log(`\nB  vault ${vaultPda(platform, id)[0].toBase58()}  (platform 2, id ${id})`);
  await tx("init_vault + tip_sol 0.01", await tipSolInstructions(conn, { platform, id, sender: payer.publicKey, amount: 10_000_000n }));
  const att = await createAttestation({ platform, id, claimant: claimant.publicKey, expiresAt }, signer);
  await tx("ed25519 + bind", await bindInstructions(conn, att, { payer: payer.publicKey }));
  await tx("decline (claimant signs)", [declineIx({ platform, id, claimant: claimant.publicKey })], [claimant]);
  const before = await conn.getBalance(payer.publicKey);
  await tx("refund_tip (permissionless crank) -> original sender", [refundTipIx({ platform, id, tipIndex: 0n, sender: payer.publicKey })]);
  const after = await conn.getBalance(payer.publicKey);
  ok(after - before > 10_000_000, `sender got the 0.01 SOL tip + receipt rent back (+${sol(after - before)} SOL net of fee)`);
  const s = await fetchVaultState(conn, platform, id);
  ok(s.account!.declined && s.account!.outstandingTipLamports === 0n, "vault declined, nothing outstanding");
}

console.log(`\nall devnet checks passed · payer balance ${sol(await conn.getBalance(payer.publicKey))} SOL`);
