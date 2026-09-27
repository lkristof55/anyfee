import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { fromBase64, toBase64 } from "./bytes.ts";
import { CLAIM_PREFIX, PROGRAM_ID, isPlatform, type Platform } from "./constants.ts";
import { verifyEd25519 } from "./ed25519.ts";
import { bindInstructionsFromAttestation } from "./instructions.ts";
import { decodeBindMessage, encodeBindMessage, type DecodedBindMessage } from "./message.ts";
import { vaultPda } from "./pda.ts";

/** What the attester returns (JSON-safe). */
export interface AttestationJson {
  platform: Platform;
  /** u64 as a decimal string. */
  id: string;
  /** base58 */
  claimant: string;
  /** Unix seconds. */
  expiresAt: number;
  /** base64 of the 95-byte message `M`. */
  message: string;
  /** base64 of the 64-byte ed25519 signature. */
  signature: string;
  /** base58 attester public key. */
  attester: string;
  /** base58 vault PDA (convenience; derived from platform + id). */
  vault?: string;
}

export interface VerifiedAttestation extends DecodedBindMessage {
  message: Uint8Array;
  signature: Uint8Array;
  attester: PublicKey;
}

/** The exact string a claimant proves control with: OIDC `aud` and X post text. */
export function claimProof(claimant: PublicKey | string): string {
  return `${CLAIM_PREFIX}${typeof claimant === "string" ? new PublicKey(claimant).toBase58() : claimant.toBase58()}`;
}

/** Signs `M` with any ed25519 signer (attester side). */
export async function createAttestation(
  fields: { platform: Platform; id: string | bigint; claimant: PublicKey; expiresAt: number; programId?: PublicKey },
  signer: { publicKey: PublicKey; sign(message: Uint8Array): Uint8Array | Promise<Uint8Array> },
): Promise<AttestationJson> {
  const programId = fields.programId ?? PROGRAM_ID;
  const message = encodeBindMessage({ programId, platform: fields.platform, id: fields.id, claimant: fields.claimant, expiresAt: fields.expiresAt });
  const signature = await signer.sign(message);
  if (signature.length !== 64) throw new Error("signer returned a non-64-byte signature");
  return {
    platform: fields.platform,
    id: String(fields.id),
    claimant: fields.claimant.toBase58(),
    expiresAt: fields.expiresAt,
    message: toBase64(message),
    signature: toBase64(signature),
    attester: signer.publicKey.toBase58(),
    vault: vaultPda(fields.platform, BigInt(fields.id), programId)[0].toBase58(),
  };
}

/**
 * Checks an attestation before using it: message well-formed, JSON fields equal the signed
 * message, signature valid, optionally the expected attester / program, and not expired.
 */
export function verifyAttestation(
  a: AttestationJson,
  opts: { expectedAttester?: PublicKey; programId?: PublicKey; nowSecs?: number } = {},
): VerifiedAttestation {
  const message = fromBase64(a.message);
  const signature = fromBase64(a.signature);
  const attester = new PublicKey(a.attester);
  const m = decodeBindMessage(message);
  if (!isPlatform(a.platform) || m.platform !== a.platform) throw new Error("attestation platform does not match message");
  if (m.id.toString() !== a.id) throw new Error("attestation id does not match message");
  if (m.claimant.toBase58() !== a.claimant) throw new Error("attestation claimant does not match message");
  if (m.expiresAt !== BigInt(a.expiresAt)) throw new Error("attestation expiresAt does not match message");
  if (!m.programId.equals(opts.programId ?? PROGRAM_ID)) throw new Error("attestation is for a different program");
  if (opts.expectedAttester && !attester.equals(opts.expectedAttester)) throw new Error("attestation signed by an unexpected attester");
  if (!verifyEd25519(attester, message, signature)) throw new Error("attestation signature is invalid");
  const now = opts.nowSecs ?? Math.floor(Date.now() / 1000);
  if (BigInt(now) >= m.expiresAt) throw new Error("attestation expired");
  return { ...m, message, signature, attester };
}

/** `[Ed25519SigVerify, bind]` for an attestation JSON (verifies it first). */
export function attestationToInstructions(
  a: AttestationJson,
  opts: { expectedAttester?: PublicKey; programId?: PublicKey; nowSecs?: number } = {},
): [TransactionInstruction, TransactionInstruction] {
  return bindInstructionsFromAttestation(verifyAttestation(a, opts));
}
