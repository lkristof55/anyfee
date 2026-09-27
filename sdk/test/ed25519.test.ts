import { test } from "node:test";
import assert from "node:assert/strict";
import { Ed25519Program, Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  ED25519_PROGRAM_ID,
  buildEd25519VerifyInstruction,
  encodeBindMessage,
  parseEd25519VerifyInstruction,
  verifyEd25519,
} from "../src/index.ts";

const kp = Keypair.fromSeed(new Uint8Array(32).fill(7));
const message = encodeBindMessage({ platform: 2, id: 42n, claimant: Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey, expiresAt: 2_000_000_000 });
const signature = nacl.sign.detached(message, kp.secretKey);

test("Ed25519SigVerify ix: one signature, all offsets point at itself (u16::MAX)", () => {
  const ix = buildEd25519VerifyInstruction({ publicKey: kp.publicKey, message, signature });
  assert.ok(ix.programId.equals(ED25519_PROGRAM_ID));
  assert.equal(ix.keys.length, 0);
  const d = ix.data;
  assert.equal(d[0], 1); // num_signatures
  assert.equal(d.readUInt16LE(2), 48); // signature offset
  assert.equal(d.readUInt16LE(4), 0xffff);
  assert.equal(d.readUInt16LE(6), 16); // pubkey offset
  assert.equal(d.readUInt16LE(8), 0xffff);
  assert.equal(d.readUInt16LE(10), 112); // message offset
  assert.equal(d.readUInt16LE(12), 95);
  assert.equal(d.readUInt16LE(14), 0xffff);
  assert.equal(d.length, 16 + 32 + 64 + 95);
});

test("byte-identical to web3.js Ed25519Program.createInstructionWithPublicKey", () => {
  const ours = buildEd25519VerifyInstruction({ publicKey: kp.publicKey, message, signature });
  const theirs = Ed25519Program.createInstructionWithPublicKey({ publicKey: kp.publicKey.toBytes(), message, signature });
  assert.deepEqual(new Uint8Array(ours.data), new Uint8Array(theirs.data));
});

test("parse round-trip and rejection of foreign offsets", () => {
  const ix = buildEd25519VerifyInstruction({ publicKey: kp.publicKey, message, signature });
  const p = parseEd25519VerifyInstruction(ix.data);
  assert.ok(p.publicKey.equals(kp.publicKey));
  assert.deepEqual(p.message, message);
  assert.deepEqual(p.signature, signature);
  const other = Buffer.from(ix.data);
  other.writeUInt16LE(0, 14); // message taken from instruction 0
  assert.throws(() => parseEd25519VerifyInstruction(other), /same instruction/);
  const two = Buffer.from(ix.data);
  two[0] = 2;
  assert.throws(() => parseEd25519VerifyInstruction(two), /exactly one/);
});

test("verifyEd25519 agrees with tweetnacl", () => {
  assert.equal(verifyEd25519(kp.publicKey, message, signature), true);
  const tampered = message.slice();
  tampered[20] = (tampered[20] as number) ^ 1;
  assert.equal(verifyEd25519(kp.publicKey, tampered, signature), false);
  assert.equal(nacl.sign.detached.verify(tampered, signature, kp.publicKey.toBytes()), false);
});
