// X claim policy (SPEC "How claims are proven": platform 3).
import type { PublicKey } from "@solana/web3.js";
import { CLAIM_PREFIX, Platform, ResolveError, parseTweetUrl, type XResolver } from "@anyfee/sdk";
import { parseClaimant, type Grant } from "./github.ts";
import { AttestError } from "./jwt.ts";

export interface XClaimDeps {
  resolver: XResolver;
  nowSecs: () => number;
  maxPostAgeSecs: number;
  skewSecs: number;
}

export interface XClaimResult {
  claimant: PublicKey;
  post: { id: string; url: string; authorId: string; authorHandle: string; createdAt: number };
  grants: Grant[];
}

// `anyfee:<base58>` as a whole token: not glued to a preceding word, not followed by more base58.
const PROOF_RE = /(?<![A-Za-z0-9_])anyfee:([1-9A-HJ-NP-Za-km-z]{32,44})(?![1-9A-HJ-NP-Za-km-z])/g;

/** All distinct claimants named by `anyfee:<wallet>` tokens in a post. */
export function proofClaimants(text: string): string[] {
  return [...new Set([...text.matchAll(PROOF_RE)].map((m) => m[1]!))];
}

/**
 * Verifies an X post: it must contain exactly one `anyfee:<claimant>` token naming the requested
 * claimant, be recent, and the vault id is the author's numeric id reported by the resolver
 * (never the handle in the URL).
 */
export async function verifyXClaim(input: { tweetUrl: unknown; claimant: unknown }, deps: XClaimDeps): Promise<XClaimResult> {
  if (typeof input.tweetUrl !== "string" || typeof input.claimant !== "string") {
    throw new AttestError("bad_request", "body must be {\"tweetUrl\": string, \"claimant\": string}", 400);
  }
  const claimant = parseClaimant(input.claimant.trim());
  let tweetId: string;
  try {
    tweetId = parseTweetUrl(input.tweetUrl).tweetId;
  } catch (e) {
    throw new AttestError("bad_tweet_url", (e as Error).message, 400);
  }
  let tweet;
  try {
    tweet = await deps.resolver.tweet(tweetId);
  } catch (e) {
    if (e instanceof ResolveError && e.status === 404) throw new AttestError("post_not_found", "post not found, deleted or not public", 404);
    throw new AttestError("x_unavailable", `X lookup failed: ${(e as Error).message}`, e instanceof ResolveError && e.status === 429 ? 503 : 502);
  }
  const named = proofClaimants(tweet.text);
  const want = `${CLAIM_PREFIX}${claimant.toBase58()}`;
  if (named.length === 0) throw new AttestError("proof_missing", `the post must contain "${want}"`, 403);
  if (named.length > 1) throw new AttestError("proof_ambiguous", "the post names more than one wallet", 403);
  if (named[0] !== claimant.toBase58()) throw new AttestError("proof_mismatch", `the post names a different wallet than ${claimant.toBase58()}`, 403);

  if (tweet.createdAt === null) throw new AttestError("x_unavailable", "could not determine when the post was made", 502);
  const now = deps.nowSecs();
  if (tweet.createdAt > now + deps.skewSecs) throw new AttestError("post_in_future", "post timestamp is in the future", 403);
  if (now - tweet.createdAt > deps.maxPostAgeSecs) {
    throw new AttestError("post_too_old", `the post is older than ${Math.round(deps.maxPostAgeSecs / 3600)} h; post a new one`, 403);
  }
  if (!/^[0-9]{1,20}$/.test(tweet.author.id)) throw new AttestError("x_unavailable", "resolver returned no numeric author id", 502);
  return {
    claimant,
    post: {
      id: tweet.id,
      url: tweet.author.handle ? `https://x.com/${tweet.author.handle}/status/${tweet.id}` : `https://x.com/i/web/status/${tweet.id}`,
      authorId: tweet.author.id,
      authorHandle: tweet.author.handle,
      createdAt: tweet.createdAt,
    },
    grants: [{ platform: Platform.X, id: tweet.author.id }],
  };
}
