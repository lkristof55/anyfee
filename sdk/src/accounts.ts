import { PublicKey, type AccountInfo, type Commitment, type Connection } from "@solana/web3.js";
import { BorshReader, BorshWriter, bytesEqual } from "./bytes.ts";
import { PROGRAM_ID, TOKEN_PROGRAM_ID, isPlatform, type Platform } from "./constants.ts";
import { accountDiscriminator } from "./discriminator.ts";
import { ACCOUNTS, accountSize, type AccountDataLayout, type FieldType } from "./layout.ts";
import { configPda, tipPda, vaultAta, vaultPda, type U64Like } from "./pda.ts";

export interface ConfigAccount {
  admin: PublicKey;
  attester: PublicKey;
  usdcMint: PublicKey;
  refundWindowSecs: bigint;
  rebindDelaySecs: bigint;
  paused: boolean;
  bump: number;
}

export interface VaultAccount {
  platform: Platform;
  id: bigint;
  /** `null` when unbound (Pubkey::default on chain). */
  claimant: PublicKey | null;
  /** `null` when no rebind is pending. */
  pendingClaimant: PublicKey | null;
  pendingEffectiveAt: bigint;
  boundAt: bigint;
  createdAt: bigint;
  declined: boolean;
  claimEpoch: bigint;
  tipCount: bigint;
  outstandingTipLamports: bigint;
  outstandingTipTokens: bigint;
  totalClaimedLamports: bigint;
  totalClaimedTokens: bigint;
  bump: number;
}

export interface TipAccount {
  vault: PublicKey;
  sender: PublicKey;
  /** `null` = SOL tip (Pubkey::default on chain). */
  mint: PublicKey | null;
  amount: bigint;
  createdAt: bigint;
  epoch: bigint;
  refunded: boolean;
  bump: number;
}

type Raw = Record<string, bigint | number | boolean | PublicKey>;

function readField(r: BorshReader, t: FieldType): bigint | number | boolean | PublicKey {
  switch (t) {
    case "u8":
      return r.u8();
    case "bool":
      return r.bool();
    case "u64":
      return r.u64();
    case "i64":
      return r.i64();
    case "pubkey":
      return new PublicKey(r.bytes(32));
  }
}

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Decodes `discriminator | borsh(fields)`; throws on a wrong discriminator or short data. */
export function decodeAccountData(layout: AccountDataLayout, data: Uint8Array): Raw {
  if (data.length < 8 || !bytesEqual(data.subarray(0, 8), accountDiscriminator(layout.name))) {
    throw new Error(`not a ${layout.name} account (discriminator mismatch)`);
  }
  const r = new BorshReader(data, 8);
  const out: Raw = {};
  for (const f of layout.fields) out[camel(f.name)] = readField(r, f.type);
  return out;
}

/**
 * Inverse of `decodeAccountData` (keys in camelCase). Mainly for tests and local mocks; `null`
 * pubkeys encode as Pubkey::default.
 */
export function encodeAccountData(layout: AccountDataLayout, values: Record<string, unknown>): Uint8Array {
  const w = new BorshWriter().raw(accountDiscriminator(layout.name));
  for (const f of layout.fields) {
    const v = values[camel(f.name)];
    switch (f.type) {
      case "u8":
        w.u8(Number(v ?? 0));
        break;
      case "bool":
        w.bool(v === true);
        break;
      case "u64":
        w.u64((v ?? 0n) as bigint);
        break;
      case "i64":
        w.i64((v ?? 0n) as bigint);
        break;
      case "pubkey":
        w.pubkey(((v ?? PublicKey.default) as PublicKey).toBytes());
        break;
    }
  }
  return w.toBytes();
}

const orNull = (k: PublicKey) => (k.equals(PublicKey.default) ? null : k);

export function decodeConfig(data: Uint8Array): ConfigAccount {
  return decodeAccountData(ACCOUNTS.Config, data) as unknown as ConfigAccount;
}

export function decodeVault(data: Uint8Array): VaultAccount {
  const raw = decodeAccountData(ACCOUNTS.Vault, data);
  if (!isPlatform(raw.platform)) throw new Error(`vault has unknown platform ${String(raw.platform)}`);
  return {
    ...(raw as unknown as VaultAccount),
    claimant: orNull(raw.claimant as PublicKey),
    pendingClaimant: orNull(raw.pendingClaimant as PublicKey),
  };
}

export function decodeTip(data: Uint8Array): TipAccount {
  const raw = decodeAccountData(ACCOUNTS.Tip, data);
  return { ...(raw as unknown as TipAccount), mint: orNull(raw.mint as PublicKey) };
}

export const CONFIG_ACCOUNT_SIZE = accountSize(ACCOUNTS.Config);
export const VAULT_ACCOUNT_SIZE = accountSize(ACCOUNTS.Vault);
export const TIP_ACCOUNT_SIZE = accountSize(ACCOUNTS.Tip);

/** Which anyfee account type (if any) the data is, by discriminator. */
export function identifyAccount(data: Uint8Array): "Config" | "Vault" | "Tip" | null {
  if (data.length < 8) return null;
  for (const name of ["Config", "Vault", "Tip"] as const) {
    if (bytesEqual(data.subarray(0, 8), accountDiscriminator(name))) return name;
  }
  return null;
}

// ---- Fetch helpers (web3.js Connection) --------------------------------------------------------

/** The subset of `Connection` the SDK reads with; easy to fake in tests. */
export type ChainReader = Pick<Connection, "getMultipleAccountsInfo" | "getMinimumBalanceForRentExemption">;

export async function fetchConfig(conn: Pick<Connection, "getAccountInfo">, programId: PublicKey = PROGRAM_ID, commitment?: Commitment): Promise<ConfigAccount | null> {
  const info = await conn.getAccountInfo(configPda(programId)[0], commitment);
  if (!info || !info.owner.equals(programId)) return null;
  return decodeConfig(info.data);
}

export async function fetchVault(
  conn: Pick<Connection, "getAccountInfo">,
  platform: Platform,
  id: U64Like,
  programId: PublicKey = PROGRAM_ID,
  commitment?: Commitment,
): Promise<VaultAccount | null> {
  const info = await conn.getAccountInfo(vaultPda(platform, id, programId)[0], commitment);
  if (!info || !info.owner.equals(programId)) return null;
  return decodeVault(info.data);
}

export async function fetchTip(
  conn: Pick<Connection, "getAccountInfo">,
  vault: PublicKey,
  tipIndex: U64Like,
  programId: PublicKey = PROGRAM_ID,
): Promise<TipAccount | null> {
  const info = await conn.getAccountInfo(tipPda(vault, tipIndex, programId)[0]);
  if (!info || !info.owner.equals(programId)) return null;
  return decodeTip(info.data);
}

/** Reads the SPL token amount (u64 at offset 64) of a token account. */
export function tokenAccountAmount(info: AccountInfo<Uint8Array> | null): bigint {
  if (!info || info.data.length < 72) return 0n;
  return new DataView(info.data.buffer, info.data.byteOffset + 64, 8).getBigUint64(0, true);
}

export interface VaultState {
  platform: Platform;
  id: bigint;
  vault: PublicKey;
  vaultTokenAccount: PublicKey;
  usdcMint: PublicKey;
  /** `true` once `init_vault` ran (a pre-funded uninitialized vault is still valid). */
  initialized: boolean;
  lamports: bigint;
  rentExemptLamports: bigint;
  /** Lamports a claim could move now (lamports minus rent-exempt minimum, minus refundable tips when declined). */
  claimableLamports: bigint;
  tokenAmount: bigint;
  claimableTokens: bigint;
  account: VaultAccount | null;
  config: ConfigAccount | null;
}

/**
 * One round trip (config + vault) plus one for the vault ATA. Works for uninitialized vaults:
 * lamports sent to the PDA before `init_vault` are reported.
 */
export async function fetchVaultState(
  conn: ChainReader,
  platform: Platform,
  id: U64Like,
  opts: { programId?: PublicKey; fallbackUsdcMint?: PublicKey; commitment?: Commitment } = {},
): Promise<VaultState> {
  const programId = opts.programId ?? PROGRAM_ID;
  const [vault] = vaultPda(platform, id, programId);
  const [configAddr] = configPda(programId);
  const [configInfo, vaultInfo] = await conn.getMultipleAccountsInfo([configAddr, vault], opts.commitment);
  const config = configInfo && configInfo.owner.equals(programId) ? decodeConfig(configInfo.data) : null;
  const usdcMint = config?.usdcMint ?? opts.fallbackUsdcMint;
  if (!usdcMint) throw new Error("program config not found and no fallback USDC mint given");
  const vaultTokenAccount = vaultAta(vault, usdcMint, TOKEN_PROGRAM_ID);
  const initialized = !!vaultInfo && vaultInfo.owner.equals(programId) && identifyAccount(vaultInfo.data) === "Vault";
  const account = initialized && vaultInfo ? decodeVault(vaultInfo.data) : null;
  const [ataInfo] = await conn.getMultipleAccountsInfo([vaultTokenAccount], opts.commitment);
  const lamports = BigInt(vaultInfo?.lamports ?? 0);
  const size = initialized && vaultInfo ? vaultInfo.data.length : VAULT_ACCOUNT_SIZE;
  const rentExemptLamports = BigInt(await conn.getMinimumBalanceForRentExemption(size));
  const tokenAmount = tokenAccountAmount(ataInfo ?? null);
  const heldLamports = account?.declined ? account.outstandingTipLamports : 0n;
  const heldTokens = account?.declined ? account.outstandingTipTokens : 0n;
  const clamp = (v: bigint) => (v > 0n ? v : 0n);
  return {
    platform,
    id: BigInt(id),
    vault,
    vaultTokenAccount,
    usdcMint,
    initialized,
    lamports,
    rentExemptLamports,
    claimableLamports: clamp(lamports - rentExemptLamports - heldLamports),
    tokenAmount,
    claimableTokens: clamp(tokenAmount - heldTokens),
    account,
    config,
  };
}
