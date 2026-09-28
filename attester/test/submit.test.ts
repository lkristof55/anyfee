import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ComputeBudgetProgram, Keypair, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  ACCOUNTS,
  DEVNET_USDC_MINT,
  ED25519_PROGRAM_ID,
  MAINNET_GENESIS_HASH,
  PROGRAM_ID,
  createAttestation,
  encodeAccountData,
  instructionDiscriminator,
  parseEd25519VerifyInstruction,
  toHex,
  vaultPda,
} from "@anyfee/sdk";
import { memoryChain } from "@anyfee/sdk/testing";
import { createHandler } from "../src/handler.ts";
import { resetSubmitState, submitAttestation } from "../src/submit.ts";
import { signerFromKey, parseSecretKey } from "../src/keys.ts";
import { attesterKp, claimant, otherWallet, post, quietLog, testConfig } from "./helpers.ts";

const NOW = Math.floor(Date.now() / 1000);
const signer = signerFromKey(parseSecretKey(bs58.encode(attesterKp.secretKey)));

function fakeRpc(genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") {
  const chain = memoryChain();
  const sent: Buffer[] = [];
  const conn = {
    ...chain,
    set: chain.set,
    sent,
    getGenesisHash: async () => genesis,
    getLatestBlockhash: async () => ({ blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 100 }),
    sendRawTransaction: async (raw: Buffer | Uint8Array) => {
      sent.push(Buffer.from(raw));
      const tx = Transaction.from(raw);
      return bs58.encode(tx.signature!);
    },
    getSignatureStatuses: async (_sigs: string[]): Promise<{ context: { slot: number }; value: unknown[] }> => ({
      context: { slot: 1 },
      value: [{ slot: 1, confirmations: 0, err: null, confirmationStatus: "confirmed" }],
    }),
    getBlockHeight: async () => 50,
  };
  return conn;
}

beforeEach(() => resetSubmitState());

async function att(platform: 1 | 2 | 3 = 2, id = "1296269") {
  return createAttestation({ platform, id, claimant, expiresAt: NOW + 900 }, signer);
}

test("unbound, uninitialized vault: [compute budget, init_vault, ed25519, bind] signed by the fee payer", async () => {
  const rpc = fakeRpc();
  const feePayer = Keypair.fromSeed(new Uint8Array(32).fill(30));
  const a = await att();
  const r = await submitAttestation(rpc as never, feePayer, a, { programId: PROGRAM_ID, fallbackUsdcMint: DEVNET_USDC_MINT });
  assert.equal(r.status, "sent", r.error ?? "");
  assert.equal(rpc.sent.length, 1);
  const tx = Transaction.from(rpc.sent[0]!);
  assert.ok(tx.feePayer?.equals(feePayer.publicKey));
  assert.ok(tx.verifySignatures());
  assert.equal(r.signature, bs58.encode(tx.signature!));
  const [cb, init, ed, bind] = tx.instructions;
  assert.ok(cb!.programId.equals(ComputeBudgetProgram.programId));
  assert.equal(toHex(init!.data.subarray(0, 8)), toHex(instructionDiscriminator("init_vault")));
  assert.ok(ed!.programId.equals(ED25519_PROGRAM_ID));
  assert.equal(toHex(bind!.data.subarray(0, 8)), toHex(instructionDiscriminator("bind")));
  const parsed = parseEd25519VerifyInstruction(ed!.data);
  assert.ok(parsed.publicKey.equals(attesterKp.publicKey));
  assert.ok(nacl.sign.detached.verify(parsed.message, parsed.signature, attesterKp.publicKey.toBytes()));
  assert.ok(bind!.keys.some((k) => k.pubkey.equals(vaultPda(2, 1296269n)[0]) && k.isWritable));
});

test("initialized vault: no init_vault; already bound to the same claimant: skipped", async () => {
  const rpc = fakeRpc();
  const [vault] = vaultPda(2, 1296269n);
  rpc.set(vault, { lamports: 2_000_000, owner: PROGRAM_ID, data: encodeAccountData(ACCOUNTS.Vault, { platform: 2, id: 1296269n, claimant: otherWallet }) });
  const r = await submitAttestation(rpc as never, attesterKp, await att(), { programId: PROGRAM_ID, fallbackUsdcMint: DEVNET_USDC_MINT });
  assert.equal(r.status, "sent");
  const tx = Transaction.from(rpc.sent[0]!);
  assert.equal(tx.instructions.length, 3, "compute budget + ed25519 + bind (rebind request)");
  rpc.set(vault, { lamports: 2_000_000, owner: PROGRAM_ID, data: encodeAccountData(ACCOUNTS.Vault, { platform: 2, id: 1296269n, claimant }) });
  const again = await submitAttestation(rpc as never, attesterKp, await att(), { programId: PROGRAM_ID, fallbackUsdcMint: DEVNET_USDC_MINT });
  assert.equal(again.status, "already_bound");
  assert.equal(rpc.sent.length, 1);
});

test("refuses to submit on mainnet-beta", async () => {
  const rpc = fakeRpc(MAINNET_GENESIS_HASH);
  const r = await submitAttestation(rpc as never, attesterKp, await att(), { programId: PROGRAM_ID, fallbackUsdcMint: DEVNET_USDC_MINT });
  assert.equal(r.status, "failed");
  assert.match(r.error!, /mainnet/);
  assert.equal(rpc.sent.length, 0);
});

test("ATTESTER_SUBMIT=1 wires submission into the X endpoint", async () => {
  const rpc = fakeRpc();
  const text = `anyfee:${claimant.toBase58()}`;
  const tweet = { code: 200, message: "OK", tweet: { id: "20", text, author: { id: "12", screen_name: "jack", name: "jack" }, created_timestamp: NOW - 10 } };
  const fetchImpl = async (u: string | URL) => {
    assert.equal(String(u), "https://api.fxtwitter.com/status/20");
    return new Response(JSON.stringify(tweet), { status: 200 });
  };
  const handler = createHandler({ config: testConfig({ ATTESTER_SUBMIT: "1" }), fetch: fetchImpl, connection: rpc as never, log: quietLog });
  const res = await handler(post("/api/attest/x", { tweetUrl: "https://x.com/jack/status/20", claimant: claimant.toBase58() }));
  const body = (await res.json()) as any;
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.submitted.length, 1);
  assert.equal(body.submitted[0].status, "sent");
  assert.equal(rpc.sent.length, 1);
});

test("on-chain failure is reported with the program's error name", async () => {
  const rpc = fakeRpc();
  rpc.getSignatureStatuses = async () => ({
    context: { slot: 1 },
    value: [{ slot: 1, confirmations: 0, err: { InstructionError: [3, { Custom: 6022 }] }, confirmationStatus: "processed" }],
  });
  const r = await submitAttestation(rpc as never, attesterKp, await att(), { programId: PROGRAM_ID, fallbackUsdcMint: DEVNET_USDC_MINT });
  assert.equal(r.status, "failed");
  assert.match(r.error!, /^WrongAttester/);
  assert.ok(r.signature);
});

test("confirmation is polled (no WebSocket): unseen until the deadline -> sent, not confirmed yet", async () => {
  const rpc = fakeRpc();
  let polls = 0;
  rpc.getSignatureStatuses = async () => {
    polls++;
    return { context: { slot: 1 }, value: [null] };
  };
  const r = await submitAttestation(rpc as never, attesterKp, await att(), {
    programId: PROGRAM_ID,
    fallbackUsdcMint: DEVNET_USDC_MINT,
    confirmTimeoutMs: 30,
    pollMs: 5,
  });
  assert.equal(r.status, "sent");
  assert.match(r.error!, /not confirmed yet/);
  assert.ok(polls >= 2, `polled ${polls} times`);
});

test("a transaction whose blockhash expired unconfirmed is reported as failed", async () => {
  const rpc = fakeRpc();
  rpc.getSignatureStatuses = async () => ({ context: { slot: 1 }, value: [null] });
  rpc.getBlockHeight = async () => 101; // lastValidBlockHeight is 100
  const r = await submitAttestation(rpc as never, attesterKp, await att(), {
    programId: PROGRAM_ID,
    fallbackUsdcMint: DEVNET_USDC_MINT,
    confirmTimeoutMs: 5_000,
    pollMs: 1,
  });
  assert.equal(r.status, "failed");
  assert.match(r.error!, /expired/);
  assert.ok(r.signature);
});
