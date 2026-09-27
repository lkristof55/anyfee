import { readFileSync } from "node:fs";
import type { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { toBase64, type FetchLike } from "@anyfee/sdk";
import { loadConfig, type AttesterConfig } from "../src/config.ts";

const SDK_FIXTURES = fileURLToPath(new URL("../../sdk/test/fixtures/", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

export function sdkFixture(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(SDK_FIXTURES + path, "utf8"));
}
export function fixture(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURES + path, "utf8"));
}

// ---- deterministic test keys (never real keys) -------------------------------------------------
export const attesterKp = Keypair.fromSeed(new Uint8Array(32).fill(21));
export const claimant = Keypair.fromSeed(new Uint8Array(32).fill(22)).publicKey;
export const otherWallet = Keypair.fromSeed(new Uint8Array(32).fill(23)).publicKey;

export function testConfig(extra: Record<string, string> = {}): AttesterConfig {
  return loadConfig({ ATTESTER_SECRET_KEY: bs58.encode(attesterKp.secretKey), ...extra });
}

// ---- RSA / JWT -----------------------------------------------------------------------------------
const b64url = (b: Uint8Array) => toBase64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

export interface RsaKey {
  kid: string;
  privateKey: CryptoKey;
  jwk: webcrypto.JsonWebKey & { kid: string; alg: string; use: string };
}

export async function makeRsaKey(kid: string): Promise<RsaKey> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as webcrypto.CryptoKeyPair;
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { kty: "RSA", n: pub.n!, e: pub.e!, kid, alg: "RS256", use: "sig" } };
}

export async function signJwt(payload: Record<string, unknown>, key: RsaKey, header: Record<string, unknown> = {}): Promise<string> {
  const h = enc({ alg: "RS256", typ: "JWT", kid: key.kid, ...header });
  const p = enc(payload);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url(sig)}`;
}

/** GitHub Actions OIDC claims for octocat/Hello-World (ids from the recorded GitHub fixture). */
export function githubClaims(now: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jti: "3d6a5c1e-7f0b-4a1e-9d4e-2f1c8b7a6e5d",
    sub: "repo:octocat/Hello-World:ref:refs/heads/master",
    aud: `anyfee:${claimant.toBase58()}`,
    ref: "refs/heads/master",
    sha: "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d",
    repository: "octocat/Hello-World",
    repository_owner: "octocat",
    repository_owner_id: "583231",
    run_id: "9876543210",
    run_number: "1",
    run_attempt: "1",
    repository_visibility: "public",
    repository_id: "1296269",
    actor_id: "583231",
    actor: "octocat",
    workflow: "anyfee claim",
    head_ref: "",
    base_ref: "",
    event_name: "workflow_dispatch",
    ref_protected: "false",
    ref_type: "branch",
    workflow_ref: "octocat/Hello-World/.github/workflows/anyfee-claim.yml@refs/heads/master",
    workflow_sha: "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d",
    job_workflow_ref: "octocat/Hello-World/.github/workflows/anyfee-claim.yml@refs/heads/master",
    job_workflow_sha: "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d",
    runner_environment: "github-hosted",
    iss: "https://token.actions.githubusercontent.com",
    nbf: now - 5,
    exp: now + 300,
    iat: now - 5,
    ...overrides,
  };
}

// ---- fake network ----------------------------------------------------------------------------------
export interface Route {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export function fakeFetch(routes: Record<string, Route | (() => Route)>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const r = routes[url];
    if (!r) throw new Error(`unexpected network call in test: ${url}`);
    const route = typeof r === "function" ? r() : r;
    const body = route.body === undefined ? "" : typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    return new Response(body, { status: route.status ?? 200, headers: { "content-type": "application/json", ...(route.headers ?? {}) } });
  }) as FetchLike & { calls: string[] };
  fn.calls = calls;
  return fn;
}

export const JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";
export const GH = "https://api.github.com";

export function post(path: string, body: unknown): Request {
  return new Request(`http://attester.test${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export function get(path: string): Request {
  return new Request(`http://attester.test${path}`);
}

export const quietLog = () => {};

export function pk(s: string): PublicKey {
  return new PublicKey(s);
}
