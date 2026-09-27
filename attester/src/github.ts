// GitHub Actions OIDC claim policy (SPEC "How claims are proven": platforms 2 and 1).
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { CLAIM_PREFIX, Platform, ResolveError, resolveGithubRepoById, type GithubOptions } from "@anyfee/sdk";
import { AttestError, JwksCache, verifyJwtRs256 } from "./jwt.ts";

export const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const GITHUB_JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";
export const ALLOWED_EVENTS = ["workflow_dispatch", "push"] as const;

export interface GithubClaimDeps {
  jwks: JwksCache;
  github: GithubOptions;
  nowSecs: () => number;
  skewSecs: number;
}

export interface Grant {
  platform: Platform;
  /** u64 decimal string */
  id: string;
}

export interface GithubClaimResult {
  claimant: PublicKey;
  repository: { id: string; fullName: string; defaultBranch: string; owner: { id: string; login: string; type: string } };
  run: { event: string; ref: string; actor: string; actorId: string; sha: string | null; workflowRef: string | null; runId: string | null };
  /** Platform 2 always; platform 1 when `userClaim.allowed`. */
  grants: Grant[];
  userClaim: { allowed: boolean; reason?: string };
}

const NUMERIC = /^(0|[1-9][0-9]{0,19})$/;

function numericClaim(payload: Record<string, unknown>, name: string): string {
  const v = payload[name];
  if (typeof v !== "string" || !NUMERIC.test(v) || BigInt(v) >= 1n << 64n) {
    throw new AttestError("malformed_token", `token claim ${name} missing or not numeric`, 401);
  }
  return v;
}

function stringClaim(payload: Record<string, unknown>, name: string): string {
  const v = payload[name];
  if (typeof v !== "string" || !v) throw new AttestError("malformed_token", `token claim ${name} missing`, 401);
  return v;
}

/** Parses `anyfee:<base58>` into a canonical, non-default public key. */
export function claimantFromProof(value: string, what: string): PublicKey {
  if (!value.startsWith(CLAIM_PREFIX)) throw new AttestError("bad_audience", `${what} must be "${CLAIM_PREFIX}<your Solana wallet>"`, 401);
  return parseClaimant(value.slice(CLAIM_PREFIX.length), what);
}

export function parseClaimant(s: string, what = "claimant"): PublicKey {
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(s);
  } catch {
    throw new AttestError("bad_claimant", `${what}: not a base58 Solana address`, 400);
  }
  if (bytes.length !== 32) throw new AttestError("bad_claimant", `${what}: not a 32-byte Solana address`, 400);
  const pk = new PublicKey(bytes);
  if (pk.toBase58() !== s) throw new AttestError("bad_claimant", `${what}: non-canonical base58`, 400);
  if (pk.equals(PublicKey.default)) throw new AttestError("bad_claimant", `${what}: the all-zero address means "unbound"`, 400);
  return pk;
}

/**
 * Verifies a GitHub Actions OIDC token and applies the claim policy:
 * signature (GitHub JWKS, RS256) · iss · exp/nbf · aud = `anyfee:<claimant>` ·
 * event_name ∈ {workflow_dispatch, push} · ref = default branch (GitHub API) ·
 * repository owner id matches (no forks/transfers) · user claim iff actor_id == repository_owner_id
 * and the owner is a User.
 */
export async function verifyGithubClaim(token: string, deps: GithubClaimDeps): Promise<GithubClaimResult> {
  const { payload } = await verifyJwtRs256(token, {
    jwks: deps.jwks,
    issuer: GITHUB_OIDC_ISSUER,
    nowSecs: deps.nowSecs(),
    skewSecs: deps.skewSecs,
  });

  let aud = payload.aud;
  if (Array.isArray(aud) && aud.length === 1) aud = aud[0];
  if (typeof aud !== "string") throw new AttestError("bad_audience", "token must have exactly one audience", 401);
  const claimant = claimantFromProof(aud, "token audience");

  const event = stringClaim(payload, "event_name");
  if (!(ALLOWED_EVENTS as readonly string[]).includes(event)) {
    throw new AttestError("bad_event", `workflow event "${event}" is not allowed; run the claim workflow via workflow_dispatch or push`, 403);
  }
  const ref = stringClaim(payload, "ref");
  if ((payload.ref_type !== undefined && payload.ref_type !== "branch") || !ref.startsWith("refs/heads/")) {
    throw new AttestError("not_default_branch", `the claim must run on the default branch, not ${ref}`, 403);
  }
  const repositoryId = numericClaim(payload, "repository_id");
  const ownerId = numericClaim(payload, "repository_owner_id");
  const actorId = numericClaim(payload, "actor_id");

  let repo;
  try {
    repo = await resolveGithubRepoById(repositoryId, deps.github);
  } catch (e) {
    if (e instanceof ResolveError && e.status === 404) {
      throw new AttestError("repo_not_visible", "the attester cannot see this repository (private repositories need an attester GITHUB_TOKEN with access)", 403);
    }
    throw new AttestError("github_unavailable", `GitHub API: ${(e as Error).message}`, e instanceof ResolveError && e.status === 429 ? 503 : 502);
  }
  if (repo.id !== repositoryId) throw new AttestError("repo_mismatch", "GitHub API returned a different repository", 502);
  if (repo.owner.id !== ownerId) {
    throw new AttestError("owner_mismatch", "token repository_owner_id does not match the repository's current owner (fork or transfer)", 403);
  }
  if (ref !== `refs/heads/${repo.defaultBranch}`) {
    throw new AttestError("not_default_branch", `the claim must run on the default branch (${repo.defaultBranch}), not ${ref}`, 403);
  }

  const grants: Grant[] = [{ platform: Platform.GithubRepo, id: repositoryId }];
  let userClaim: GithubClaimResult["userClaim"];
  if (repo.owner.type !== "User") {
    userClaim = { allowed: false, reason: `repository owner ${repo.owner.login} is an ${repo.owner.type}, not a personal account` };
  } else if (actorId !== ownerId) {
    userClaim = { allowed: false, reason: `workflow was run by ${String(payload.actor ?? actorId)}, not by the repository owner ${repo.owner.login}` };
  } else {
    userClaim = { allowed: true };
    grants.push({ platform: Platform.GithubUser, id: ownerId });
  }

  const opt = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : null);
  return {
    claimant,
    repository: { id: repo.id, fullName: repo.fullName, defaultBranch: repo.defaultBranch, owner: repo.owner },
    run: { event, ref, actor: opt("actor") ?? "", actorId, sha: opt("sha"), workflowRef: opt("workflow_ref"), runId: opt("run_id") },
    grants,
    userClaim,
  };
}
