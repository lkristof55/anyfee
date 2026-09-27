import { Buffer } from "buffer";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { concatBytes } from "./bytes.ts";
import { ED25519_PROGRAM_ID } from "./constants.ts";

/** Instruction index meaning "this same instruction" in Ed25519SigVerify offsets. */
export const ED25519_SELF_INDEX = 0xffff;
const HEADER_LEN = 16; // num_signatures u8, padding u8, 7 x u16 offsets

export interface Ed25519VerifyParams {
  publicKey: PublicKey | Uint8Array;
  message: Uint8Array;
  signature: Uint8Array;
}

/**
 * Builds an Ed25519SigVerify instruction with exactly one signature whose offsets all point
 * inside this same instruction (instruction_index = u16::MAX), as `bind` requires.
 * Layout: header(16) | pubkey(32) | signature(64) | message.
 */
export function buildEd25519VerifyInstruction(p: Ed25519VerifyParams): TransactionInstruction {
  const pk = p.publicKey instanceof PublicKey ? p.publicKey.toBytes() : p.publicKey;
  if (pk.length !== 32) throw new RangeError("ed25519 public key must be 32 bytes");
  if (p.signature.length !== 64) throw new RangeError("ed25519 signature must be 64 bytes");
  if (p.message.length > 0xffff) throw new RangeError("message too long");
  const publicKeyOffset = HEADER_LEN;
  const signatureOffset = publicKeyOffset + 32;
  const messageDataOffset = signatureOffset + 64;
  const header = new Uint8Array(HEADER_LEN);
  const v = new DataView(header.buffer);
  v.setUint8(0, 1); // num_signatures
  v.setUint8(1, 0); // padding
  v.setUint16(2, signatureOffset, true);
  v.setUint16(4, ED25519_SELF_INDEX, true);
  v.setUint16(6, publicKeyOffset, true);
  v.setUint16(8, ED25519_SELF_INDEX, true);
  v.setUint16(10, messageDataOffset, true);
  v.setUint16(12, p.message.length, true);
  v.setUint16(14, ED25519_SELF_INDEX, true);
  return new TransactionInstruction({
    programId: ED25519_PROGRAM_ID,
    keys: [],
    data: Buffer.from(concatBytes(header, pk, p.signature, p.message)),
  });
}

export interface ParsedEd25519Instruction {
  publicKey: PublicKey;
  signature: Uint8Array;
  message: Uint8Array;
}

/**
 * Parses a single-signature, self-referencing Ed25519SigVerify instruction (the exact shape the
 * program accepts). Throws for anything else — mirrors the on-chain checks.
 */
export function parseEd25519VerifyInstruction(data: Uint8Array): ParsedEd25519Instruction {
  if (data.length < HEADER_LEN) throw new Error("ed25519 ix too short");
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (v.getUint8(0) !== 1) throw new Error("ed25519 ix must carry exactly one signature");
  const sigOff = v.getUint16(2, true);
  const sigIx = v.getUint16(4, true);
  const pkOff = v.getUint16(6, true);
  const pkIx = v.getUint16(8, true);
  const msgOff = v.getUint16(10, true);
  const msgLen = v.getUint16(12, true);
  const msgIx = v.getUint16(14, true);
  if (sigIx !== ED25519_SELF_INDEX || pkIx !== ED25519_SELF_INDEX || msgIx !== ED25519_SELF_INDEX) {
    throw new Error("ed25519 ix offsets must reference the same instruction");
  }
  if (pkOff + 32 > data.length || sigOff + 64 > data.length || msgOff + msgLen > data.length) {
    throw new Error("ed25519 ix offsets out of bounds");
  }
  return {
    publicKey: new PublicKey(new Uint8Array(data.subarray(pkOff, pkOff + 32))),
    signature: new Uint8Array(data.subarray(sigOff, sigOff + 64)),
    message: new Uint8Array(data.subarray(msgOff, msgOff + msgLen)),
  };
}

/** Verifies an ed25519 signature (pure JS, works in browsers and Node). */
export function verifyEd25519(publicKey: PublicKey | Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  const pk = publicKey instanceof PublicKey ? publicKey.toBytes() : publicKey;
  try {
    return ed25519.verify(signature, message, pk);
  } catch {
    return false;
  }
}
