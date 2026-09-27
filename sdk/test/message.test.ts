import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { BIND_MESSAGE_LENGTH, PROGRAM_ID, decodeBindMessage, encodeBindMessage, fromHex, toHex } from "../src/index.ts";

// SPEC.md "Attestation message" test vector (also keys/bind-vector.txt). Must match the Rust test.
const VECTOR_HEX =
  "616e796665653a62696e643a76319f549f827029a8031facc0e17c7851c771515d8331a40e119925aa443d66514002d2029649000000007e8c088760bfde1dddcf32c17f209b8242ee52aaf131facd88d0ea2c6d0b06f2a0dcb86a00000000";
const CLAIMANT = new PublicKey("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");

test("encodeBindMessage matches the SPEC.md test vector byte-for-byte", () => {
  const m = encodeBindMessage({
    programId: new PublicKey("BixfaA4JmPvntZvGZwnqhHdoUQvEzZY6ZBMXCLgF3C9M"),
    platform: 2,
    id: 1234567890n,
    claimant: CLAIMANT,
    expiresAt: 1790500000n,
  });
  assert.equal(m.length, BIND_MESSAGE_LENGTH);
  assert.equal(toHex(m), VECTOR_HEX);
});

test("encodeBindMessage defaults to the anyfee program id and accepts number/string ids", () => {
  const a = encodeBindMessage({ platform: 2, id: 1234567890, claimant: CLAIMANT, expiresAt: 1790500000 });
  const b = encodeBindMessage({ platform: 2, id: "1234567890", claimant: CLAIMANT, expiresAt: 1790500000 });
  assert.equal(toHex(a), VECTOR_HEX);
  assert.equal(toHex(b), VECTOR_HEX);
});

test("decodeBindMessage round-trips the vector", () => {
  const d = decodeBindMessage(fromHex(VECTOR_HEX));
  assert.ok(d.programId.equals(PROGRAM_ID));
  assert.equal(d.platform, 2);
  assert.equal(d.id, 1234567890n);
  assert.ok(d.claimant.equals(CLAIMANT));
  assert.equal(d.expiresAt, 1790500000n);
});

test("u64 max id and negative/large expires_at encode little-endian", () => {
  const m = encodeBindMessage({ platform: 3, id: (1n << 64n) - 1n, claimant: CLAIMANT, expiresAt: -1n });
  assert.equal(toHex(m.slice(47, 55)), "ffffffffffffffff");
  assert.equal(toHex(m.slice(87, 95)), "ffffffffffffffff");
  assert.equal(decodeBindMessage(m).expiresAt, -1n);
});

test("encode/decode reject bad input", () => {
  assert.throws(() => encodeBindMessage({ platform: 4 as never, id: 1n, claimant: CLAIMANT, expiresAt: 1n }), /unknown platform/);
  assert.throws(() => encodeBindMessage({ platform: 1, id: 1n << 64n, claimant: CLAIMANT, expiresAt: 1n }), /u64/);
  assert.throws(() => encodeBindMessage({ platform: 1, id: -1, claimant: CLAIMANT, expiresAt: 1n }), /u64/);
  assert.throws(() => decodeBindMessage(fromHex(VECTOR_HEX).slice(1)), /95 bytes/);
  const bad = fromHex(VECTOR_HEX);
  bad[0] = 0x41;
  assert.throws(() => decodeBindMessage(bad), /domain/);
  const badPlatform = fromHex(VECTOR_HEX);
  badPlatform[46] = 9;
  assert.throws(() => decodeBindMessage(badPlatform), /unknown platform/);
});
