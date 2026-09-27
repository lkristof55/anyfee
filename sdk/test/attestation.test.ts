import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  ED25519_PROGRAM_ID,
  PROGRAM_ID,
  attestationToInstructions,
  claimProof,
  createAttestation,
  fromBase64,
  toBase64,
  verifyAttestation,
  vaultPda,
} from "../src/index.ts";

const attesterKp = Keypair.fromSeed(new Uint8Array(32).fill(11));
const signer = { publicKey: attesterKp.publicKey, sign: (m: Uint8Array) => nacl.sign.detached(m, attesterKp.secretKey) };
const claimant = Keypair.fromSeed(new Uint8Array(32).fill(12)).publicKey;
const NOW = 1_800_000_000;

test("claimProof is anyfee:<base58>", () => {
  assert.equal(claimProof(claimant), `anyfee:${claimant.toBase58()}`);
  assert.throws(() => claimProof("not-a-key"));
});

test("createAttestation -> verifyAttestation", async () => {
  const a = await createAttestation({ platform: 2, id: "1296269", claimant, expiresAt: NOW + 900 }, signer);
  assert.equal(a.attester, attesterKp.publicKey.toBase58());
  assert.equal(a.vault, vaultPda(2, 1296269n)[0].toBase58());
  assert.equal(fromBase64(a.message).length, 95);
  const v = verifyAttestation(a, { expectedAttester: attesterKp.publicKey, nowSecs: NOW });
  assert.equal(v.id, 1296269n);
  assert.ok(v.programId.equals(PROGRAM_ID));
  assert.ok(nacl.sign.detached.verify(fromBase64(a.message), fromBase64(a.signature), attesterKp.publicKey.toBytes()));
});

test("verifyAttestation catches every kind of tampering", async () => {
  const a = await createAttestation({ platform: 1, id: "583231", claimant, expiresAt: NOW + 900 }, signer);
  assert.throws(() => verifyAttestation({ ...a, id: "583232" }, { nowSecs: NOW }), /id does not match/);
  assert.throws(() => verifyAttestation({ ...a, platform: 2 }, { nowSecs: NOW }), /platform/);
  assert.throws(() => verifyAttestation({ ...a, claimant: PublicKey.default.toBase58() }, { nowSecs: NOW }), /claimant/);
  assert.throws(() => verifyAttestation({ ...a, expiresAt: NOW + 901 }, { nowSecs: NOW }), /expiresAt/);
  const msg = fromBase64(a.message);
  msg[60] = (msg[60] as number) ^ 1; // flip a claimant byte inside the signed message
  const claimantFromMsg = new PublicKey(msg.slice(55, 87)).toBase58();
  assert.throws(() => verifyAttestation({ ...a, message: toBase64(msg), claimant: claimantFromMsg }, { nowSecs: NOW }), /signature is invalid/);
  assert.throws(() => verifyAttestation(a, { nowSecs: NOW + 900 }), /expired/);
  assert.throws(() => verifyAttestation(a, { nowSecs: NOW, expectedAttester: claimant }), /unexpected attester/);
  assert.throws(() => verifyAttestation(a, { nowSecs: NOW, programId: claimant }), /different program/);
});

test("attestationToInstructions returns the adjacent [ed25519, bind] pair", async () => {
  const a = await createAttestation({ platform: 3, id: "12", claimant, expiresAt: NOW + 60 }, signer);
  const [ed, bind] = attestationToInstructions(a, { nowSecs: NOW });
  assert.ok(ed.programId.equals(ED25519_PROGRAM_ID));
  assert.ok(bind.programId.equals(PROGRAM_ID));
  assert.ok(bind.keys.some((k) => k.pubkey.equals(vaultPda(3, 12n)[0]) && k.isWritable));
});
