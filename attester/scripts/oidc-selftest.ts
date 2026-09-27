// Live check of real GitHub Actions OIDC tokens against the attester's verifier.
// Runs only inside GitHub Actions (.github/workflows/oidc-selftest.yml): tokens are minted by the
// Actions runtime, verified against GitHub's live JWKS and REST API. Verification only — no
// signing key, nothing touches Solana. Exit code != 0 on any unexpected outcome.
import { GITHUB_JWKS_URL, JwksCache, AttestError, verifyGithubClaim } from "../src/index.ts";
import { mintIdToken } from "../../action/lib.mjs";

const CLAIMANT = process.env.SELFTEST_CLAIMANT ?? "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const env = process.env as Record<string, string | undefined>;

if (!env.ACTIONS_ID_TOKEN_REQUEST_URL) {
  console.error("Not running inside GitHub Actions with `permissions: id-token: write`; nothing to test.");
  process.exit(env.CI ? 1 : 0);
}

const jwks = new JwksCache({ url: GITHUB_JWKS_URL });
const deps = {
  jwks,
  github: { userAgent: "anyfee-oidc-selftest", ...(env.GITHUB_TOKEN ? { token: env.GITHUB_TOKEN } : {}) },
  nowSecs: () => Math.floor(Date.now() / 1000),
  skewSecs: 60,
};
let failures = 0;
const ok = (msg: string) => console.log(`ok   ${msg}`);
const bad = (msg: string) => {
  failures++;
  console.log(`FAIL ${msg}`);
};

async function expectReject(name: string, token: string, code: string) {
  try {
    await verifyGithubClaim(token, deps);
    bad(`${name}: accepted, expected ${code}`);
  } catch (e) {
    if (e instanceof AttestError && e.code === code) ok(`${name}: rejected with ${code}`);
    else bad(`${name}: expected ${code}, got ${(e as Error).message}`);
  }
}

const audience = `anyfee:${CLAIMANT}`;
const token = await mintIdToken(env, audience);
console.log(`::add-mask::${token}`);
const [h, p] = token.split(".");
const header = JSON.parse(Buffer.from(h!, "base64url").toString("utf8"));
const claims = JSON.parse(Buffer.from(p!, "base64url").toString("utf8"));
const shown = ["iss", "aud", "event_name", "ref", "ref_type", "repository", "repository_id", "repository_owner", "repository_owner_id", "actor", "actor_id", "runner_environment"];
console.log("token header:", JSON.stringify({ alg: header.alg, kid: header.kid, typ: header.typ }));
console.log("token claims:", JSON.stringify(Object.fromEntries(shown.map((k) => [k, claims[k]]))));
console.log(`token lifetime: ${claims.exp - claims.iat}s (exp - iat)`);

// 1. The real token must verify (signature, issuer, expiry, audience, default branch, owner).
const expectPass = ["workflow_dispatch", "push"].includes(claims.event_name);
try {
  const r = await verifyGithubClaim(token, deps);
  if (!expectPass) bad(`real token accepted for event ${claims.event_name}`);
  else ok(`real token verified: repo ${r.repository.fullName} #${r.repository.id} (default branch ${r.repository.defaultBranch})`);
  console.log("grants:", JSON.stringify(r.grants), "userClaim:", JSON.stringify(r.userClaim));
  if (r.claimant.toBase58() !== CLAIMANT) bad("claimant from audience differs");
  if (jwks.fetchCount !== 1) bad(`expected 1 JWKS fetch, saw ${jwks.fetchCount}`);
} catch (e) {
  if (expectPass) bad(`real token rejected: ${(e as Error).message}`);
  else ok(`real token rejected for event ${claims.event_name}: ${(e as Error).message}`);
}

// 2. A second verification is served from the JWKS cache.
if (expectPass) {
  await verifyGithubClaim(token, deps).catch(() => {});
  if (jwks.fetchCount === 1) ok("JWKS cached across verifications");
  else bad(`JWKS refetched (${jwks.fetchCount})`);
}

// 3. Negative controls with real tokens.
const tampered = token.slice(0, -4) + (token.endsWith("AAAA") ? "BBBB" : "AAAA");
await expectReject("tampered signature", tampered, "bad_signature");
const wrongAud = await mintIdToken(env, "anyfee-selftest-wrong-audience");
console.log(`::add-mask::${wrongAud}`);
await expectReject("wrong audience", wrongAud, "bad_audience");
const [wh, wp] = token.split(".");
const swappedPayload = Buffer.from(JSON.stringify({ ...claims, ref: "refs/heads/not-the-default" })).toString("base64url");
await expectReject("payload edited after signing", `${wh}.${swappedPayload}.${token.split(".")[2]}`, "bad_signature");
void wp;

console.log(failures ? `\n${failures} check(s) failed` : "\nall OIDC self-test checks passed");
process.exit(failures ? 1 : 0);
