export { createHandler, type HandlerDeps, type ChainConnection } from "./handler.ts";
export { loadConfig, describeConfig, type AttesterConfig, type Env } from "./config.ts";
export { parseSecretKey, signerFromKey, keypairFromKey, type LoadedKey, type Ed25519Signer } from "./keys.ts";
export { AttestError, JwksCache, verifyJwtRs256, type Jwk } from "./jwt.ts";
export {
  verifyGithubClaim,
  claimantFromProof,
  parseClaimant,
  GITHUB_OIDC_ISSUER,
  GITHUB_JWKS_URL,
  ALLOWED_EVENTS,
  type GithubClaimResult,
  type Grant,
} from "./github.ts";
export { verifyXClaim, proofClaimants, type XClaimResult } from "./x.ts";
export { submitAttestation, type SubmitResult } from "./submit.ts";
export { netlifyHandler } from "./netlify.ts";
export { nodeListener, serve } from "./node.ts";
