import { PublicKey } from "@solana/web3.js";
import { u64le, utf8 } from "./bytes.ts";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  PROGRAM_ID,
  SEED_CONFIG,
  SEED_TIP,
  SEED_VAULT,
  TOKEN_PROGRAM_ID,
  isPlatform,
  type Platform,
} from "./constants.ts";

export type U64Like = bigint | number | string;

/** `["config"]` */
export function configPda(programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([utf8(SEED_CONFIG)], programId);
}

/** `["vault", [platform], id.to_le_bytes()]` — deterministic; can receive SOL/tokens before `init_vault`. */
export function vaultPda(platform: Platform, id: U64Like, programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  if (!isPlatform(platform)) throw new RangeError(`unknown platform ${String(platform)}`);
  return PublicKey.findProgramAddressSync([utf8(SEED_VAULT), Uint8Array.of(platform), u64le(id)], programId);
}

/** `["tip", vault, tip_index.to_le_bytes()]` */
export function tipPda(vault: PublicKey, tipIndex: U64Like, programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([utf8(SEED_TIP), vault.toBytes(), u64le(tipIndex)], programId);
}

/** Associated token account of `owner` (off-curve owners such as PDAs allowed). */
export function associatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgramId: PublicKey = TOKEN_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBytes(), tokenProgramId.toBytes(), mint.toBytes()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}

/** The vault's token account for `mint` (normally `Config.usdc_mint`). */
export function vaultAta(vault: PublicKey, mint: PublicKey, tokenProgramId: PublicKey = TOKEN_PROGRAM_ID): PublicKey {
  return associatedTokenAddress(vault, mint, tokenProgramId);
}
