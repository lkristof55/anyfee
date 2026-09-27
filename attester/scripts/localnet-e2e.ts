// End-to-end check of the SDK + attester against the REAL compiled program on a throwaway local
// validator (no devnet, no real funds). Opt-in, not part of `npm test`:
//
//   scripts/build-program.sh            # produces target/deploy/anyfee.so
//   npm run localnet-e2e -w @anyfee/attester
//
// Spawns solana-test-validator (ports 18899/19900) with the program deployed as upgradeable (admin
// = upgrade authority), then exercises: initialize, pre-funded init_vault, tip_sol, tip_token,
// GitHub OIDC attestation -> attester submit (ed25519 + bind), /api/resolve, claim_sol +
// claim_token, close_tip, rebind + cancel_rebind, X attestation, decline, refund_tip, and the
// program's rejections (RefundNotYet, VaultDeclined, WrongAttester, AttestationExpired, NoPendingRebind).
import { spawn } from "node:child_process";
import type { webcrypto } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Signer,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  bindInstructions,
  bindInstructionsFromAttestation,
  cancelRebindIx,
  claimAllInstructions,
  closeTipIx,
  createAtaIdempotentIx,
  createAttestation,
  declineIx,
  describeProgramError,
  encodeBindMessage,
  fetchVault,
  finalizeRebindIx,
  initializeIx,
  parseEventsFromLogs,
  refundTipIx,
  tipSolInstructions,
  tipTokenInstructions,
  tokenAccountAmount,
  vaultPda,
} from "@anyfee/sdk";
import { createHandler } from "../src/handler.ts";
import { JwksCache } from "../src/jwt.ts";
import { loadConfig } from "../src/config.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const SO = join(root, "target/deploy/anyfee.so");
const RPC_PORT = 18899;
const RPC = `http://127.0.0.1:${RPC_PORT}`;

if (!existsSync(SO)) {
  console.error(`missing ${SO}; build the program first (scripts/build-program.sh)`);
  process.exit(1);
}

let failures = 0;
const ok = (m: string) => console.log(`ok   ${m}`);
const fail = (m: string) => {
  failures++;
  console.log(`FAIL ${m}`);
};
const check = (cond: boolean, m: string) => (cond ? ok(m) : fail(m));

// ---- validator ----------------------------------------------------------------------------------
const admin = Keypair.generate();
const ledger = mkdtempSync(join(tmpdir(), "anyfee-e2e-ledger-"));
const validator = spawn(
  "solana-test-validator",
  [
    "--ledger", ledger, "--reset", "--quiet",
    "--bind-address", "127.0.0.1",
    "--rpc-port", String(RPC_PORT),
    "--faucet-port", "19900",
    "--gossip-port", "18001",
    "--dynamic-port-range", "18002-18040",
    "--upgradeable-program", PROGRAM_ID.toBase58(), SO, admin.publicKey.toBase58(),
  ],
  { stdio: "ignore" },
);
const cleanup = () => {
  validator.kill("SIGTERM");
  rmSync(ledger, { recursive: true, force: true });
};
process.on("exit", cleanup);

const conn = new Connection(RPC, "confirmed");
for (let i = 0; ; i++) {
  try {
    await conn.getLatestBlockhash();
    break;
  } catch {
    if (i > 60) throw new Error("validator did not start");
    await new Promise((r) => setTimeout(r, 500));
  }
}
ok("local validator up with the anyfee program (upgradeable, admin = upgrade authority)");

async function airdrop(to: PublicKey, sol: number) {
  const sig = await conn.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
}

async function send(ixs: TransactionInstruction[], signers: Signer[]): Promise<{ sig: string; logs: string[] }> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signers[0]!.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  const t = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (t?.meta?.err) throw Object.assign(new Error(`tx failed: ${JSON.stringify(t.meta.err)}`), { logs: t.meta.logMessages ?? [] });
  return { sig, logs: t?.meta?.logMessages ?? [] };
}

async function expectProgramError(ixs: TransactionInstruction[], signers: Signer[], name: string, what: string) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signers[0]!.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(...signers);
  const sim = await conn.simulateTransaction(tx);
  const e = describeProgramError(sim.value.err) ?? describeProgramError(sim.value.logs ?? []);
  check(e?.name === name, `${what}: rejected with ${name}${e && e.name !== name ? ` (got ${e.name})` : !e ? ` (got ${JSON.stringify(sim.value.err)})` : ""}`);
}

const lamports = async (k: PublicKey) => BigInt(await conn.getBalance(k, "confirmed"));
const tokens = async (k: PublicKey) => tokenAccountAmount(await conn.getAccountInfo(k, "confirmed"));

const sender = Keypair.generate();
const claimant = Keypair.generate();
const newWallet = Keypair.generate();
const attesterKp = Keypair.generate();
const cranker = Keypair.generate();
await Promise.all([admin, sender, claimant, attesterKp, cranker].map((k) => airdrop(k.publicKey, 20)));

// ---- USDC-like mint (6 decimals) ------------------------------------------------------------------
const mint = Keypair.generate();
await send(
  [
    SystemProgram.createAccount({
      fromPubkey: admin.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: await conn.getMinimumBalanceForRentExemption(82),
      space: 82,
      programId: TOKEN_PROGRAM_ID,
    }),
    new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [{ pubkey: mint.publicKey, isSigner: false, isWritable: true }],
      data: Buffer.from([20, 6, ...admin.publicKey.toBytes(), 0]), // InitializeMint2
    }),
    createAtaIdempotentIx({ payer: admin.publicKey, owner: sender.publicKey, mint: mint.publicKey }),
    new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: mint.publicKey, isSigner: false, isWritable: true },
        { pubkey: associatedTokenAddress(sender.publicKey, mint.publicKey), isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([7, ...new Uint8Array(new BigUint64Array([100_000_000n]).buffer)]), // MintTo 100.000000
    }),
  ],
  [admin, mint],
);

// ---- initialize ----------------------------------------------------------------------------------
await send(
  [initializeIx({ admin: admin.publicKey, attester: attesterKp.publicKey, usdcMint: mint.publicKey, refundWindowSecs: 86_400, rebindDelaySecs: 86_400 })],
  [admin],
);
ok("initialize (config: attester, mint, 1 d refund window, 1 d rebind delay)");

// ---- attester wired to the local chain, with mocked GitHub/JWKS/fxtwitter -----------------------
const rsa = (await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
)) as webcrypto.CryptoKeyPair;
const pubJwk = await crypto.subtle.exportKey("jwk", rsa.publicKey);
const b64url = (b: Uint8Array | string) => Buffer.from(b).toString("base64url");
async function oidcToken(claims: Record<string, unknown>) {
  const h = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "local" }));
  const p = b64url(JSON.stringify(claims));
  const s = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", rsa.privateKey, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url(s)}`;
}
let tweetText = "";
const fakeFetch = async (input: string | URL | Request) => {
  const url = input instanceof Request ? input.url : String(input);
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
  if (url.endsWith("/.well-known/jwks")) return json({ keys: [{ ...pubJwk, kid: "local", alg: "RS256", use: "sig" }] });
  if (url === "https://api.github.com/repositories/1296269") {
    return json({ id: 1296269, full_name: "octocat/Hello-World", default_branch: "master", owner: { id: 583231, login: "octocat", type: "User" } });
  }
  if (url === "https://api.fxtwitter.com/status/20") {
    return json({ code: 200, tweet: { id: "20", text: tweetText, created_timestamp: Math.floor(Date.now() / 1000) - 30, author: { id: "12", screen_name: "jack", name: "jack" } } });
  }
  throw new Error(`unexpected fetch ${url}`);
};
const config = loadConfig({ ATTESTER_SECRET_KEY: bs58.encode(attesterKp.secretKey), ATTESTER_SUBMIT: "1", RPC_URL: RPC });
const handler = createHandler({
  config,
  fetch: fakeFetch,
  connection: conn,
  jwks: new JwksCache({ url: "https://token.actions.githubusercontent.com/.well-known/jwks", fetch: fakeFetch }),
  log: () => {},
});
const api = async (path: string, body?: unknown) => {
  const res = await handler(
    new Request(`http://local${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};

// ---- scenario A: GitHub repo vault ----------------------------------------------------------------
const REPO = { platform: 2 as const, id: 1296269n };
const [repoVault] = vaultPda(REPO.platform, REPO.id);
await send([SystemProgram.transfer({ fromPubkey: sender.publicKey, toPubkey: repoVault, lamports: LAMPORTS_PER_SOL / 2 })], [sender]);
ok("routed 0.5 SOL of 'fees' to the uninitialized vault PDA");

const tipA = await send(await tipSolInstructions(conn, { ...REPO, sender: sender.publicKey, amount: LAMPORTS_PER_SOL / 10 }), [sender]);
let v = await fetchVault(conn, REPO.platform, REPO.id);
check(!!v && v.tipCount === 1n && v.outstandingTipLamports === BigInt(LAMPORTS_PER_SOL / 10), "init_vault on a pre-funded address + tip_sol (tip #0, outstanding 0.1 SOL)");
check(parseEventsFromLogs(tipA.logs).some((e) => e.name === "Tipped"), "Tipped event parsed from logs");
await send(await tipTokenInstructions(conn, { ...REPO, sender: sender.publicKey, amount: 5_000_000n }), [sender]);
check((await fetchVault(conn, REPO.platform, REPO.id))?.outstandingTipTokens === 5_000_000n, "tip_token 5 USDC (vault ATA created)");

await expectProgramError([refundTipIx({ ...REPO, tipIndex: 0n, sender: sender.publicKey })], [cranker], "RefundNotYet", "refund before the window on an unbound vault");

const now = Math.floor(Date.now() / 1000);
const token = await oidcToken({
  iss: "https://token.actions.githubusercontent.com",
  aud: `anyfee:${claimant.publicKey.toBase58()}`,
  ref: "refs/heads/master",
  ref_type: "branch",
  event_name: "workflow_dispatch",
  repository: "octocat/Hello-World",
  repository_id: "1296269",
  repository_owner_id: "583231",
  actor: "octocat",
  actor_id: "583231",
  iat: now - 5,
  nbf: now - 5,
  exp: now + 300,
});
const gh = await api("/api/attest/github", { oidcToken: token, claim: "repo" });
check(gh.status === 200 && gh.body.submitted?.[0]?.status === "sent", `attester verified OIDC and submitted ed25519+bind (${gh.body.submitted?.[0]?.status ?? gh.body.error?.message})`);
v = await fetchVault(conn, REPO.platform, REPO.id);
check(v?.claimant?.equals(claimant.publicKey) === true, "vault bound to the claimant on chain");
const bindTx = gh.body.submitted?.[0]?.signature;
if (bindTx) {
  const t = await conn.getTransaction(bindTx, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  check(parseEventsFromLogs(t?.meta?.logMessages ?? []).some((e) => e.name === "Bound"), "Bound event in the bind transaction");
}
const again = await api("/api/attest/github", { oidcToken: token, claim: "repo" });
check(again.body.submitted?.[0]?.status === "already_bound", "second submit is skipped (already bound)");

const resolved = await api("/api/resolve?q=github-repo:1296269");
check(resolved.body.claimant === claimant.publicKey.toBase58() && resolved.body.initialized === true && resolved.body.balances.usdc.amount === "5000000", "/api/resolve reads the live vault");

await airdrop(claimant.publicKey, 1);
const before = await lamports(claimant.publicKey);
const claimIxs = await claimAllInstructions(conn, { ...REPO, claimant: claimant.publicKey });
const claimed = await send(claimIxs, [claimant]);
const gained = (await lamports(claimant.publicKey)) - before;
check(gained > BigInt(0.59 * LAMPORTS_PER_SOL), `claim_sol moved pre-funded fees + tip (${Number(gained) / LAMPORTS_PER_SOL} SOL net of fees/ATA rent)`);
check((await tokens(associatedTokenAddress(claimant.publicKey, mint.publicKey))) === 5_000_000n, "claim_token moved 5 USDC to the claimant's ATA");
check(parseEventsFromLogs(claimed.logs).filter((e) => e.name === "Claimed").length === 2, "two Claimed events");
v = await fetchVault(conn, REPO.platform, REPO.id);
check(v?.claimEpoch === 1n && v.outstandingTipLamports === 0n && v.outstandingTipTokens === 0n, "claim consumed the tips (epoch 1, outstanding 0)");

const senderBefore = await lamports(sender.publicKey);
await send([closeTipIx({ ...REPO, tipIndex: 0n, sender: sender.publicKey }), closeTipIx({ ...REPO, tipIndex: 1n, sender: sender.publicKey })], [cranker]);
check((await lamports(sender.publicKey)) > senderBefore, "close_tip returned the receipts' rent to the sender");

// rebind + cancel
const reAtt = await createAttestation(
  { platform: 2, id: "1296269", claimant: newWallet.publicKey, expiresAt: now + 600 },
  { publicKey: attesterKp.publicKey, sign: (m) => nacl.sign.detached(m, attesterKp.secretKey) },
);
await send(await bindInstructions(conn, reAtt, { payer: cranker.publicKey }), [cranker]);
v = await fetchVault(conn, REPO.platform, REPO.id);
check(v?.pendingClaimant?.equals(newWallet.publicKey) === true && v.claimant?.equals(claimant.publicKey) === true, "second bind = pending rebind (current claimant unchanged)");
await expectProgramError([finalizeRebindIx(REPO)], [cranker], "RebindNotReady", "finalize before the rebind delay");
await send([cancelRebindIx({ ...REPO, claimant: claimant.publicKey })], [claimant]);
check((await fetchVault(conn, REPO.platform, REPO.id))?.pendingClaimant === null, "cancel_rebind by the current claimant");
await expectProgramError([finalizeRebindIx(REPO)], [cranker], "NoPendingRebind", "finalize with nothing pending");

// forged / expired attestations
const forger = Keypair.generate();
const forgedMsg = encodeBindMessage({ platform: 2, id: 1296269n, claimant: forger.publicKey, expiresAt: now + 600 });
await expectProgramError(
  bindInstructionsFromAttestation({ message: forgedMsg, signature: nacl.sign.detached(forgedMsg, forger.secretKey), attester: forger.publicKey }),
  [cranker],
  "WrongAttester",
  "bind signed by a non-attester key",
);
const oldMsg = encodeBindMessage({ platform: 2, id: 1296269n, claimant: forger.publicKey, expiresAt: now - 10 });
await expectProgramError(
  bindInstructionsFromAttestation({ message: oldMsg, signature: nacl.sign.detached(oldMsg, attesterKp.secretKey), attester: attesterKp.publicKey }),
  [cranker],
  "AttestationExpired",
  "expired attestation",
);

// ---- scenario B: X vault, decline, refund ----------------------------------------------------------
const X = { platform: 3 as const, id: 12n };
await send(await tipSolInstructions(conn, { ...X, sender: sender.publicKey, amount: LAMPORTS_PER_SOL / 5 }), [sender]);
tweetText = `claiming anyfee:${claimant.publicKey.toBase58()}`;
const xr = await api("/api/attest/x", { tweetUrl: "https://x.com/jack/status/20", claimant: claimant.publicKey.toBase58() });
check(xr.status === 200 && xr.body.submitted?.[0]?.status === "sent", `X post verified and bound (${xr.body.submitted?.[0]?.status ?? xr.body.error?.message})`);
await send([declineIx({ ...X, claimant: claimant.publicKey })], [claimant]);
check((await fetchVault(conn, X.platform, X.id))?.declined === true, "decline by the claimant");
await expectProgramError(await tipSolInstructions(conn, { ...X, sender: sender.publicKey, amount: 1000 }), [sender], "VaultDeclined", "tip to a declined vault");
const sBefore = await lamports(sender.publicKey);
await send([refundTipIx({ ...X, tipIndex: 0n, sender: sender.publicKey })], [cranker]);
const refunded = (await lamports(sender.publicKey)) - sBefore;
check(refunded >= BigInt(LAMPORTS_PER_SOL / 5), `refund_tip crank returned the 0.2 SOL tip (+ receipt rent) to the sender (${Number(refunded) / LAMPORTS_PER_SOL} SOL)`);
check((await fetchVault(conn, X.platform, X.id))?.outstandingTipLamports === 0n, "outstanding tips back to 0");

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall localnet end-to-end checks passed");
cleanup();
process.exit(failures ? 1 : 0);
