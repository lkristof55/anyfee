import { Buffer } from "buffer";
import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import { BorshWriter } from "./bytes.ts";
import { ASSOCIATED_TOKEN_PROGRAM_ID, PROGRAM_ID, TOKEN_PROGRAM_ID, type Platform } from "./constants.ts";
import { instructionDiscriminator } from "./discriminator.ts";
import { buildEd25519VerifyInstruction } from "./ed25519.ts";
import { INSTRUCTIONS, type ArgType, type InstructionLayout, type InstructionName } from "./layout.ts";
import { associatedTokenAddress, configPda, tipPda, vaultAta, vaultPda, type U64Like } from "./pda.ts";
import { decodeBindMessage } from "./message.ts";

export type ArgValue = bigint | number | string | boolean | PublicKey | null | undefined;

function writeArg(w: BorshWriter, type: ArgType, value: ArgValue, name: string): void {
  if (typeof type === "object") {
    if (value === null || value === undefined) {
      w.u8(0);
      return;
    }
    w.u8(1);
    writeArg(w, type.option, value, name);
    return;
  }
  if (value === null || value === undefined) throw new TypeError(`missing argument ${name}`);
  switch (type) {
    case "u8":
      w.u8(Number(value));
      return;
    case "u16":
    case "u32": {
      const n = Number(value);
      const max = type === "u16" ? 0xffff : 0xffffffff;
      if (!Number.isInteger(n) || n < 0 || n > max) throw new RangeError(`${name} out of ${type} range`);
      const b = new Uint8Array(type === "u16" ? 2 : 4);
      const v = new DataView(b.buffer);
      if (type === "u16") v.setUint16(0, n, true);
      else v.setUint32(0, n, true);
      w.raw(b);
      return;
    }
    case "u64":
      w.u64(value as bigint | number | string);
      return;
    case "i64":
      w.i64(typeof value === "string" ? BigInt(value) : (value as bigint | number));
      return;
    case "bool":
      if (typeof value !== "boolean") throw new TypeError(`${name} must be boolean`);
      w.bool(value);
      return;
    case "pubkey":
      if (!(value instanceof PublicKey)) throw new TypeError(`${name} must be a PublicKey`);
      w.pubkey(value.toBytes());
      return;
  }
}

/** Serializes `discriminator | borsh(args)` for any instruction in the layout registry. */
export function encodeInstructionData(name: InstructionName, args: Record<string, ArgValue>): Uint8Array {
  const layout: InstructionLayout = INSTRUCTIONS[name];
  const w = new BorshWriter().raw(instructionDiscriminator(layout.name));
  for (const a of layout.args) writeArg(w, a.type, args[a.name], a.name);
  return w.toBytes();
}

/**
 * Generic, registry-driven builder. `accounts` maps account names (snake_case, as in the IDL)
 * to addresses; fixed-address accounts (programs, sysvars) are filled in automatically and
 * missing optional accounts are passed as the program id (Anchor's "None").
 */
export function buildInstruction(
  name: InstructionName,
  accounts: Record<string, PublicKey | undefined>,
  args: Record<string, ArgValue>,
  programId: PublicKey = PROGRAM_ID,
): TransactionInstruction {
  const layout: InstructionLayout = INSTRUCTIONS[name];
  const keys: AccountMeta[] = layout.accounts.map((a) => {
    let pubkey = accounts[a.name];
    if (!pubkey && a.optional) {
      return { pubkey: programId, isSigner: false, isWritable: false };
    }
    if (!pubkey && a.address) pubkey = new PublicKey(a.address);
    if (!pubkey) throw new TypeError(`${name}: missing account ${a.name}`);
    return { pubkey, isSigner: !!a.signer, isWritable: !!a.writable };
  });
  return new TransactionInstruction({ programId, keys, data: Buffer.from(encodeInstructionData(name, args)) });
}

// ---- Helpers ------------------------------------------------------------------------------------

export const BPF_UPGRADEABLE_LOADER_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

/** The program's ProgramData account (upgradeable loader), required by `initialize`. */
export function programDataAddress(programId: PublicKey = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([programId.toBytes()], BPF_UPGRADEABLE_LOADER_ID)[0];
}

/** Associated Token Account program `CreateIdempotent` (creates `owner`'s ATA for `mint` if missing). */
export function createAtaIdempotentIx(p: { payer: PublicKey; owner: PublicKey; mint: PublicKey; tokenProgramId?: PublicKey }): TransactionInstruction {
  const tokenProgram = p.tokenProgramId ?? TOKEN_PROGRAM_ID;
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: p.payer, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAddress(p.owner, p.mint, tokenProgram), isSigner: false, isWritable: true },
      { pubkey: p.owner, isSigner: false, isWritable: false },
      { pubkey: p.mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

// ---- Typed builders ---------------------------------------------------------------------------

interface Common {
  programId?: PublicKey;
}
interface VaultRef extends Common {
  platform: Platform;
  id: U64Like;
}

function vaultOf(p: VaultRef): PublicKey {
  return vaultPda(p.platform, p.id, p.programId)[0];
}

function pid(p: Common): PublicKey {
  return p.programId ?? PROGRAM_ID;
}

export function initializeIx(p: Common & {
  admin: PublicKey;
  attester: PublicKey;
  usdcMint: PublicKey;
  refundWindowSecs: bigint | number;
  rebindDelaySecs: bigint | number;
}): TransactionInstruction {
  return buildInstruction(
    "initialize",
    { config: configPda(pid(p))[0], admin: p.admin, program: pid(p), program_data: programDataAddress(pid(p)) },
    { attester: p.attester, usdc_mint: p.usdcMint, refund_window_secs: p.refundWindowSecs, rebind_delay_secs: p.rebindDelaySecs },
    pid(p),
  );
}

export function setConfigIx(p: Common & {
  admin: PublicKey;
  attester?: PublicKey;
  refundWindowSecs?: bigint | number;
  rebindDelaySecs?: bigint | number;
  paused?: boolean;
  newAdmin?: PublicKey;
}): TransactionInstruction {
  return buildInstruction(
    "set_config",
    { config: configPda(pid(p))[0], admin: p.admin },
    {
      attester: p.attester,
      refund_window_secs: p.refundWindowSecs,
      rebind_delay_secs: p.rebindDelaySecs,
      paused: p.paused,
      new_admin: p.newAdmin,
    },
    pid(p),
  );
}

export function initVaultIx(p: VaultRef & { payer: PublicKey }): TransactionInstruction {
  return buildInstruction(
    "init_vault",
    { payer: p.payer, vault: vaultOf(p), config: configPda(pid(p))[0] },
    { platform: p.platform, id: p.id },
    pid(p),
  );
}

/** `tipIndex` must equal the vault's current `tip_count` (see `fetchVault`). */
export function tipSolIx(p: VaultRef & { sender: PublicKey; amount: U64Like; tipIndex: U64Like }): TransactionInstruction {
  const vault = vaultOf(p);
  return buildInstruction(
    "tip_sol",
    { config: configPda(pid(p))[0], vault, tip: tipPda(vault, p.tipIndex, pid(p))[0], sender: p.sender },
    { platform: p.platform, id: p.id, amount: p.amount },
    pid(p),
  );
}

export function tipTokenIx(p: VaultRef & {
  sender: PublicKey;
  amount: U64Like;
  tipIndex: U64Like;
  mint: PublicKey;
  senderTokenAccount?: PublicKey;
  tokenProgramId?: PublicKey;
}): TransactionInstruction {
  const vault = vaultOf(p);
  const tokenProgram = p.tokenProgramId ?? TOKEN_PROGRAM_ID;
  return buildInstruction(
    "tip_token",
    {
      config: configPda(pid(p))[0],
      vault,
      tip: tipPda(vault, p.tipIndex, pid(p))[0],
      sender: p.sender,
      usdc_mint: p.mint,
      sender_token_account: p.senderTokenAccount ?? associatedTokenAddress(p.sender, p.mint, tokenProgram),
      vault_token_account: vaultAta(vault, p.mint, tokenProgram),
      token_program: tokenProgram,
    },
    { platform: p.platform, id: p.id, amount: p.amount },
    pid(p),
  );
}

export function bindIx(p: VaultRef & { claimant: PublicKey; expiresAt: bigint | number }): TransactionInstruction {
  return buildInstruction(
    "bind",
    { config: configPda(pid(p))[0], vault: vaultOf(p) },
    { platform: p.platform, id: p.id, claimant: p.claimant, expires_at: p.expiresAt },
    pid(p),
  );
}

export function finalizeRebindIx(p: VaultRef): TransactionInstruction {
  return buildInstruction("finalize_rebind", { vault: vaultOf(p), config: configPda(pid(p))[0] }, { platform: p.platform, id: p.id }, pid(p));
}

export function cancelRebindIx(p: VaultRef & { claimant: PublicKey }): TransactionInstruction {
  return buildInstruction("cancel_rebind", { vault: vaultOf(p), claimant: p.claimant }, { platform: p.platform, id: p.id }, pid(p));
}

export function claimSolIx(p: VaultRef & { claimant: PublicKey; destination: PublicKey }): TransactionInstruction {
  return buildInstruction(
    "claim_sol",
    { config: configPda(pid(p))[0], vault: vaultOf(p), claimant: p.claimant, destination: p.destination },
    { platform: p.platform, id: p.id },
    pid(p),
  );
}

export function claimTokenIx(p: VaultRef & {
  claimant: PublicKey;
  mint: PublicKey;
  /** Destination token account (defaults to the claimant's ATA). */
  destination?: PublicKey;
  tokenProgramId?: PublicKey;
}): TransactionInstruction {
  const vault = vaultOf(p);
  const tokenProgram = p.tokenProgramId ?? TOKEN_PROGRAM_ID;
  return buildInstruction(
    "claim_token",
    {
      config: configPda(pid(p))[0],
      vault,
      claimant: p.claimant,
      usdc_mint: p.mint,
      vault_token_account: vaultAta(vault, p.mint, tokenProgram),
      destination: p.destination ?? associatedTokenAddress(p.claimant, p.mint, tokenProgram),
      token_program: tokenProgram,
    },
    { platform: p.platform, id: p.id },
    pid(p),
  );
}

/** Permissionless refund crank for a SOL tip; lamports and the Tip rent go to `sender` (= `tip.sender`). */
export function refundTipIx(p: VaultRef & { tipIndex: U64Like; sender: PublicKey }): TransactionInstruction {
  const vault = vaultOf(p);
  return buildInstruction(
    "refund_tip",
    { config: configPda(pid(p))[0], vault, tip: tipPda(vault, p.tipIndex, pid(p))[0], sender: p.sender },
    { platform: p.platform, id: p.id, tip_index: p.tipIndex },
    pid(p),
  );
}

/**
 * Permissionless refund crank for a token tip: tokens go to the sender's ATA for `mint`
 * (`Config.usdc_mint`). If the sender closed that ATA, prepend `createAtaIdempotentIx`.
 */
export function refundTipTokenIx(p: VaultRef & { tipIndex: U64Like; sender: PublicKey; mint: PublicKey; tokenProgramId?: PublicKey }): TransactionInstruction {
  const vault = vaultOf(p);
  const tokenProgram = p.tokenProgramId ?? TOKEN_PROGRAM_ID;
  return buildInstruction(
    "refund_tip_token",
    {
      config: configPda(pid(p))[0],
      vault,
      tip: tipPda(vault, p.tipIndex, pid(p))[0],
      sender: p.sender,
      usdc_mint: p.mint,
      vault_token_account: vaultAta(vault, p.mint, tokenProgram),
      sender_token_account: associatedTokenAddress(p.sender, p.mint, tokenProgram),
      token_program: tokenProgram,
    },
    { platform: p.platform, id: p.id, tip_index: p.tipIndex },
    pid(p),
  );
}

/** Picks `refund_tip` or `refund_tip_token` from a decoded Tip (mint `null` = SOL). */
export function refundIxForTip(p: VaultRef & { tipIndex: U64Like; tip: { sender: PublicKey; mint: PublicKey | null } }): TransactionInstruction {
  const base = { platform: p.platform, id: p.id, tipIndex: p.tipIndex, sender: p.tip.sender, ...(p.programId ? { programId: p.programId } : {}) };
  return p.tip.mint ? refundTipTokenIx({ ...base, mint: p.tip.mint }) : refundTipIx(base);
}

/** Permissionless: closes a Tip receipt already consumed by a claim; rent goes back to `sender`. */
export function closeTipIx(p: VaultRef & { tipIndex: U64Like; sender: PublicKey }): TransactionInstruction {
  const vault = vaultOf(p);
  return buildInstruction(
    "close_tip",
    { vault, tip: tipPda(vault, p.tipIndex, pid(p))[0], sender: p.sender },
    { platform: p.platform, id: p.id, tip_index: p.tipIndex },
    pid(p),
  );
}

export function declineIx(p: VaultRef & { claimant: PublicKey }): TransactionInstruction {
  return buildInstruction("decline", { vault: vaultOf(p), claimant: p.claimant }, { platform: p.platform, id: p.id }, pid(p));
}

// ---- Attestation -> [Ed25519SigVerify, bind] -------------------------------------------------

export interface SignedBind {
  /** The 95-byte message `M`. */
  message: Uint8Array;
  /** 64-byte ed25519 signature over `message` by the attester. */
  signature: Uint8Array;
  attester: PublicKey;
}

/**
 * Returns `[ed25519Verify, bind]` for a signed attestation. The two must stay adjacent and in
 * this order in the transaction: `bind` checks the immediately preceding instruction.
 * Fields are taken from the message itself so the pair can never disagree.
 */
export function bindInstructionsFromAttestation(a: SignedBind): [TransactionInstruction, TransactionInstruction] {
  const m = decodeBindMessage(a.message);
  const ed = buildEd25519VerifyInstruction({ publicKey: a.attester, message: a.message, signature: a.signature });
  const bind = bindIx({
    programId: m.programId,
    platform: m.platform,
    id: m.id,
    claimant: m.claimant,
    expiresAt: m.expiresAt,
  });
  return [ed, bind];
}
