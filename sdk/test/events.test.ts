import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { EVENTS, PROGRAM_ID, describeProgramError, encodeAccountData, eventDiscriminator, parseEventsFromLogs, toBase64, vaultPda } from "../src/index.ts";

const pk = (n: number) => Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey;

/** Event payloads have the same shape as account data, with the event discriminator. */
function eventData(name: keyof typeof EVENTS, values: Record<string, unknown>): Uint8Array {
  const body = encodeAccountData(EVENTS[name], values).slice(8);
  const out = new Uint8Array(8 + body.length);
  out.set(eventDiscriminator(name));
  out.set(body, 8);
  return out;
}

test("parseEventsFromLogs decodes anyfee events and ignores other programs", () => {
  const vault = vaultPda(2, 1296269n)[0];
  const bound = eventData("Bound", { vault, platform: 2, id: 1296269n, claimant: pk(1) });
  const rebind = eventData("RebindRequested", { vault, platform: 2, id: 1296269n, currentClaimant: pk(1), pendingClaimant: pk(2), effectiveAt: 1_800_000_000n });
  const logs = [
    `Program Ed25519SigVerify111111111111111111111111111 invoke [1]`,
    `Program Ed25519SigVerify111111111111111111111111111 success`,
    `Program ${PROGRAM_ID.toBase58()} invoke [1]`,
    "Program log: Instruction: Bind",
    `Program data: ${toBase64(bound)}`,
    `Program data: ${toBase64(rebind)}`,
    `Program ${PROGRAM_ID.toBase58()} consumed 12345 of 200000 compute units`,
    `Program ${PROGRAM_ID.toBase58()} success`,
    `Program 11111111111111111111111111111111 invoke [1]`,
    `Program data: ${toBase64(bound)}`,
    `Program 11111111111111111111111111111111 success`,
  ];
  const evs = parseEventsFromLogs(logs);
  assert.deepEqual(evs.map((e) => e.name), ["Bound", "RebindRequested"]);
  assert.equal(evs[0]!.data.id, 1296269n);
  assert.ok((evs[1]!.data.pendingClaimant as typeof vault).equals(pk(2)));
  assert.equal(evs[1]!.data.effectiveAt, 1_800_000_000n);
});

test("describeProgramError maps custom codes from errors, messages and logs", () => {
  assert.equal(describeProgramError({ InstructionError: [2, { Custom: 6004 }] })?.name, "AttestationExpired");
  assert.equal(describeProgramError(new Error("Transaction simulation failed: custom program error: 0x1770"))?.name, "VaultDeclined");
  assert.equal(describeProgramError(["Program log: AnchorError occurred. Error Code: WrongAttester. Error Number: 6022. Error Message: x."])?.name, "WrongAttester");
  assert.equal(describeProgramError({ InstructionError: [0, { Custom: 1 }] }), null);
  assert.equal(describeProgramError("nothing"), null);
});
