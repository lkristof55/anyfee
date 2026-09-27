import { PublicKey } from "@solana/web3.js";
import { DEFAULT_ATTESTATION_TTL_SECS, DEVNET_RPC_URL, DEVNET_USDC_MINT, PROGRAM_ID } from "@anyfee/sdk";
import { parseSecretKey, type LoadedKey } from "./keys.ts";

export type Env = Record<string, string | undefined>;

export interface AttesterConfig {
  /** Attestation signing key; `null` = resolve-only mode (attest endpoints answer 503). */
  attesterKey: LoadedKey | null;
  /** Fee payer for ATTESTER_SUBMIT (FEE_PAYER_SECRET_KEY, defaults to the attester key). */
  feePayerKey: LoadedKey | null;
  submit: boolean;
  rpcUrl: string;
  githubToken: string | undefined;
  xBearerToken: string | undefined;
  programId: PublicKey;
  fallbackUsdcMint: PublicKey;
  attestationTtlSecs: number;
  xMaxPostAgeSecs: number;
  oidcSkewSecs: number;
  corsOrigin: string;
}

function int(env: Env, name: string, def: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer in [${min}, ${max}]`);
  return n;
}

const truthy = (v: string | undefined) => v === "1" || v === "true" || v === "yes";

/**
 * Reads configuration from environment variables only. `readFile` enables
 * ATTESTER_SECRET_KEY_FILE for local development (the Node server passes it; serverless
 * adapters do not), so a key file is only ever read when a path is given explicitly.
 */
export function loadConfig(env: Env, readFile?: (path: string) => string): AttesterConfig {
  let attesterKey: LoadedKey | null = null;
  if (env.ATTESTER_SECRET_KEY) {
    attesterKey = parseSecretKey(env.ATTESTER_SECRET_KEY, "ATTESTER_SECRET_KEY");
  } else if (env.ATTESTER_SECRET_KEY_FILE) {
    if (!readFile) throw new Error("ATTESTER_SECRET_KEY_FILE is only supported by the local Node server");
    attesterKey = parseSecretKey(readFile(env.ATTESTER_SECRET_KEY_FILE), "ATTESTER_SECRET_KEY_FILE");
  }
  if (attesterKey && env.ATTESTER_PUBKEY && attesterKey.publicKey.toBase58() !== env.ATTESTER_PUBKEY) {
    throw new Error(`attester key does not match ATTESTER_PUBKEY (${env.ATTESTER_PUBKEY})`);
  }
  const submit = truthy(env.ATTESTER_SUBMIT);
  const feePayerKey = env.FEE_PAYER_SECRET_KEY ? parseSecretKey(env.FEE_PAYER_SECRET_KEY, "FEE_PAYER_SECRET_KEY") : attesterKey;
  if (submit && !feePayerKey) throw new Error("ATTESTER_SUBMIT=1 needs ATTESTER_SECRET_KEY (or FEE_PAYER_SECRET_KEY)");
  return {
    attesterKey,
    feePayerKey,
    submit,
    rpcUrl: env.RPC_URL || DEVNET_RPC_URL,
    githubToken: env.GITHUB_TOKEN || undefined,
    xBearerToken: env.X_BEARER_TOKEN || undefined,
    programId: env.PROGRAM_ID ? new PublicKey(env.PROGRAM_ID) : PROGRAM_ID,
    fallbackUsdcMint: env.USDC_MINT ? new PublicKey(env.USDC_MINT) : DEVNET_USDC_MINT,
    attestationTtlSecs: int(env, "ATTESTATION_TTL_SECS", DEFAULT_ATTESTATION_TTL_SECS, 60, 3600),
    xMaxPostAgeSecs: int(env, "X_MAX_POST_AGE_SECS", 86_400, 300, 7 * 86_400),
    oidcSkewSecs: int(env, "OIDC_CLOCK_SKEW_SECS", 60, 0, 300),
    corsOrigin: env.CORS_ORIGIN || "*",
  };
}

/** Safe-to-print summary (no secrets). */
export function describeConfig(c: AttesterConfig): Record<string, unknown> {
  let rpcHost = "(invalid)";
  try {
    rpcHost = new URL(c.rpcUrl).host;
  } catch {
    /* keep placeholder */
  }
  return {
    attester: c.attesterKey?.publicKey.toBase58() ?? null,
    submit: c.submit,
    feePayer: c.submit ? (c.feePayerKey?.publicKey.toBase58() ?? null) : null,
    rpcHost,
    programId: c.programId.toBase58(),
    githubToken: c.githubToken ? "set" : "unset",
    xResolver: c.xBearerToken ? "x-api-v2" : "fxtwitter",
    attestationTtlSecs: c.attestationTtlSecs,
  };
}
