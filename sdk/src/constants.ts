import { PublicKey } from "@solana/web3.js";

/** anyfee program id (devnet; keys/program-keypair.json). */
export const PROGRAM_ID = new PublicKey("BixfaA4JmPvntZvGZwnqhHdoUQvEzZY6ZBMXCLgF3C9M");

/** Devnet attester public key (keys/attester-devnet.json). The on-chain source of truth is `Config.attester`. */
export const DEVNET_ATTESTER = new PublicKey("FJpnX2EKfLMyFitghtSjZuoisNxP6ZgkNCQi2LgfiiLY");

/** Circle's devnet USDC mint. The on-chain source of truth is `Config.usdc_mint`. */
export const DEVNET_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
export const USDC_DECIMALS = 6;

export const DEVNET_RPC_URL = "https://api.devnet.solana.com";
/** Genesis hash of mainnet-beta; the attester refuses to submit transactions there. */
export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const ED25519_PROGRAM_ID = new PublicKey("Ed25519SigVerify111111111111111111111111111");

/** Identity platforms (SPEC "Identities"). Values are the on-chain u8. */
export const Platform = {
  GithubUser: 1,
  GithubRepo: 2,
  X: 3,
} as const;
export type Platform = (typeof Platform)[keyof typeof Platform];

export const PLATFORM_NAMES: Record<Platform, "github-user" | "github-repo" | "x"> = {
  1: "github-user",
  2: "github-repo",
  3: "x",
};

export function isPlatform(v: unknown): v is Platform {
  return v === 1 || v === 2 || v === 3;
}

export function platformFromName(name: string): Platform | undefined {
  for (const [k, v] of Object.entries(PLATFORM_NAMES)) if (v === name) return Number(k) as Platform;
  return undefined;
}

/** Domain separator at the start of the attestation message `M`. */
export const BIND_DOMAIN = "anyfee:bind:v1";
export const BIND_MESSAGE_LENGTH = 95;

/** Prefix of the GitHub OIDC audience and of the X proof post: `anyfee:<claimant_base58>`. */
export const CLAIM_PREFIX = "anyfee:";

export const DEFAULT_REFUND_WINDOW_SECS = 2_592_000n; // 30 days
export const DEFAULT_REBIND_DELAY_SECS = 172_800n; // 48 hours
export const DEFAULT_ATTESTATION_TTL_SECS = 900; // 15 minutes

export const SEED_CONFIG = "config";
export const SEED_VAULT = "vault";
export const SEED_TIP = "tip";
