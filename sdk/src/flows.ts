// High-level helpers that read chain state and return ready-to-sign instruction lists.
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { fetchVaultState, type ChainReader, type VaultState } from "./accounts.ts";
import { attestationToInstructions, type AttestationJson } from "./attestation.ts";
import { PROGRAM_ID, type Platform } from "./constants.ts";
import { claimSolIx, claimTokenIx, createAtaIdempotentIx, initVaultIx, tipSolIx, tipTokenIx } from "./instructions.ts";
import { associatedTokenAddress, type U64Like } from "./pda.ts";

interface Target {
  platform: Platform;
  id: U64Like;
  programId?: PublicKey;
  /** Used only when the program Config is missing (e.g. before `initialize`). */
  fallbackUsdcMint?: PublicKey;
}

async function state(conn: ChainReader, t: Target): Promise<VaultState> {
  return fetchVaultState(conn, t.platform, t.id, {
    ...(t.programId ? { programId: t.programId } : {}),
    ...(t.fallbackUsdcMint ? { fallbackUsdcMint: t.fallbackUsdcMint } : {}),
  });
}

const pidOpt = (t: Target) => (t.programId ? { programId: t.programId } : {});

/** `[init_vault?, tip_sol]` — initializes the vault first when needed; tip index = `tip_count`. */
export async function tipSolInstructions(conn: ChainReader, p: Target & { sender: PublicKey; amount: U64Like }): Promise<TransactionInstruction[]> {
  const s = await state(conn, p);
  const out: TransactionInstruction[] = [];
  if (!s.initialized) out.push(initVaultIx({ payer: p.sender, platform: p.platform, id: p.id, ...pidOpt(p) }));
  out.push(tipSolIx({ sender: p.sender, platform: p.platform, id: p.id, amount: p.amount, tipIndex: s.account?.tipCount ?? 0n, ...pidOpt(p) }));
  return out;
}

/** `[init_vault?, tip_token]` for `Config.usdc_mint` from the sender's ATA. */
export async function tipTokenInstructions(conn: ChainReader, p: Target & { sender: PublicKey; amount: U64Like }): Promise<TransactionInstruction[]> {
  const s = await state(conn, p);
  const out: TransactionInstruction[] = [];
  if (!s.initialized) out.push(initVaultIx({ payer: p.sender, platform: p.platform, id: p.id, ...pidOpt(p) }));
  out.push(
    tipTokenIx({ sender: p.sender, platform: p.platform, id: p.id, amount: p.amount, tipIndex: s.account?.tipCount ?? 0n, mint: s.usdcMint, ...pidOpt(p) }),
  );
  return out;
}

/** `[init_vault?, Ed25519SigVerify, bind]` for an attestation (verified first). */
export async function bindInstructions(
  conn: ChainReader,
  a: AttestationJson,
  p: { payer: PublicKey; programId?: PublicKey; expectedAttester?: PublicKey; fallbackUsdcMint?: PublicKey },
): Promise<TransactionInstruction[]> {
  const pair = attestationToInstructions(a, {
    ...(p.programId ? { programId: p.programId } : {}),
    ...(p.expectedAttester ? { expectedAttester: p.expectedAttester } : {}),
  });
  const s = await state(conn, { platform: a.platform, id: a.id, ...(p.programId ? { programId: p.programId } : {}), ...(p.fallbackUsdcMint ? { fallbackUsdcMint: p.fallbackUsdcMint } : {}) });
  const out: TransactionInstruction[] = [];
  if (!s.initialized) out.push(initVaultIx({ payer: p.payer, platform: a.platform, id: a.id, programId: p.programId ?? PROGRAM_ID }));
  out.push(...pair);
  return out;
}

/**
 * Everything the claimant can take now: `claim_sol` when lamports above rent are available and,
 * when the vault holds tokens, `[create ATA (idempotent), claim_token]` to the claimant's ATA.
 * Returns [] when there is nothing to claim.
 */
export async function claimAllInstructions(
  conn: ChainReader,
  p: Target & { claimant: PublicKey; destination?: PublicKey; tokenDestinationOwner?: PublicKey },
): Promise<TransactionInstruction[]> {
  const s = await state(conn, p);
  if (!s.initialized) return [];
  const out: TransactionInstruction[] = [];
  if (s.claimableLamports > 0n) {
    out.push(claimSolIx({ claimant: p.claimant, destination: p.destination ?? p.claimant, platform: p.platform, id: p.id, ...pidOpt(p) }));
  }
  if (s.claimableTokens > 0n) {
    const owner = p.tokenDestinationOwner ?? p.claimant;
    out.push(createAtaIdempotentIx({ payer: p.claimant, owner, mint: s.usdcMint }));
    out.push(
      claimTokenIx({
        claimant: p.claimant,
        platform: p.platform,
        id: p.id,
        mint: s.usdcMint,
        destination: associatedTokenAddress(owner, s.usdcMint),
        ...pidOpt(p),
      }),
    );
  }
  return out;
}
