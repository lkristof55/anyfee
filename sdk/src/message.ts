import { PublicKey } from "@solana/web3.js";
import { BorshReader, bytesEqual, concatBytes, i64le, u64le, utf8 } from "./bytes.ts";
import { BIND_DOMAIN, BIND_MESSAGE_LENGTH, PROGRAM_ID, isPlatform, type Platform } from "./constants.ts";
import type { U64Like } from "./pda.ts";

export interface BindMessageFields {
  programId?: PublicKey;
  platform: Platform;
  id: U64Like;
  claimant: PublicKey;
  /** Unix seconds (i64). */
  expiresAt: bigint | number;
}

export interface DecodedBindMessage {
  programId: PublicKey;
  platform: Platform;
  id: bigint;
  claimant: PublicKey;
  expiresAt: bigint;
}

const DOMAIN_BYTES = utf8(BIND_DOMAIN);

/**
 * Encodes the 95-byte attestation message `M` (SPEC "Attestation message"):
 * `b"anyfee:bind:v1" | program_id | platform u8 | id u64 LE | claimant | expires_at i64 LE`.
 */
export function encodeBindMessage(f: BindMessageFields): Uint8Array {
  if (!isPlatform(f.platform)) throw new RangeError(`unknown platform ${String(f.platform)}`);
  const out = concatBytes(
    DOMAIN_BYTES,
    (f.programId ?? PROGRAM_ID).toBytes(),
    Uint8Array.of(f.platform),
    u64le(f.id),
    f.claimant.toBytes(),
    i64le(f.expiresAt),
  );
  if (out.length !== BIND_MESSAGE_LENGTH) throw new Error(`bind message length ${out.length} != ${BIND_MESSAGE_LENGTH}`);
  return out;
}

export function decodeBindMessage(m: Uint8Array): DecodedBindMessage {
  if (m.length !== BIND_MESSAGE_LENGTH) throw new RangeError(`bind message must be ${BIND_MESSAGE_LENGTH} bytes, got ${m.length}`);
  const r = new BorshReader(m);
  if (!bytesEqual(r.bytes(DOMAIN_BYTES.length), DOMAIN_BYTES)) throw new Error("bad bind message domain");
  const programId = new PublicKey(r.bytes(32));
  const platform = r.u8();
  if (!isPlatform(platform)) throw new RangeError(`unknown platform ${platform}`);
  const id = r.u64();
  const claimant = new PublicKey(r.bytes(32));
  const expiresAt = r.i64();
  return { programId, platform, id, claimant, expiresAt };
}
