import { ed25519 } from "@noble/curves/ed25519.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

export interface Ed25519Signer {
  publicKey: PublicKey;
  sign(message: Uint8Array): Uint8Array;
}

export interface LoadedKey {
  /** 32-byte ed25519 seed. Never log it. */
  seed: Uint8Array;
  publicKey: PublicKey;
}

/**
 * Parses a secret key given as a JSON byte array (solana-keygen file format, 64 or 32 bytes) or
 * base58 (64-byte keypair as exported by wallets, or a 32-byte seed). For 64-byte keys the
 * embedded public key must match the seed. Error messages never contain key material.
 */
export function parseSecretKey(value: string, what = "secret key"): LoadedKey {
  const v = value.trim();
  let bytes: Uint8Array;
  if (v.startsWith("[")) {
    let arr: unknown;
    try {
      arr = JSON.parse(v);
    } catch {
      throw new Error(`${what}: invalid JSON array`);
    }
    if (!Array.isArray(arr) || !arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      throw new Error(`${what}: JSON must be an array of bytes`);
    }
    bytes = Uint8Array.from(arr as number[]);
  } else {
    try {
      bytes = bs58.decode(v);
    } catch {
      throw new Error(`${what}: not valid base58 or a JSON byte array`);
    }
  }
  if (bytes.length !== 64 && bytes.length !== 32) throw new Error(`${what}: expected 64 or 32 bytes, got ${bytes.length}`);
  const seed = bytes.slice(0, 32);
  const derived = ed25519.getPublicKey(seed);
  if (bytes.length === 64) {
    const embedded = bytes.slice(32);
    if (!embedded.every((b, i) => b === derived[i])) throw new Error(`${what}: public half does not match the secret half`);
  }
  return { seed, publicKey: new PublicKey(derived) };
}

export function signerFromKey(k: LoadedKey): Ed25519Signer {
  return { publicKey: k.publicKey, sign: (m) => ed25519.sign(m, k.seed) };
}

export function keypairFromKey(k: LoadedKey): Keypair {
  return Keypair.fromSeed(k.seed);
}
