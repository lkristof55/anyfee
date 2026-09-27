// Runtime-agnostic request handler: (Request) => Promise<Response>.
import { Connection, type PublicKey } from "@solana/web3.js";
import {
  PLATFORM_NAMES,
  ResolveError,
  TargetParseError,
  USDC_DECIMALS,
  createAttestation,
  defaultXResolver,
  fetchVaultState,
  parseTarget,
  resolveIdentity,
  vaultPda,
  type AttestationJson,
  type FetchLike,
  type ResolvedIdentity,
  type Target,
  type XResolver,
} from "@anyfee/sdk";
import { describeConfig, type AttesterConfig } from "./config.ts";
import { GITHUB_JWKS_URL, verifyGithubClaim, type Grant } from "./github.ts";
import { AttestError, JwksCache } from "./jwt.ts";
import { keypairFromKey, signerFromKey } from "./keys.ts";
import { submitAttestation, type SubmitConnection, type SubmitResult } from "./submit.ts";
import { verifyXClaim } from "./x.ts";
import { TtlCache } from "./cache.ts";

export type ChainConnection = SubmitConnection & Pick<Connection, "getAccountInfo">;

export interface HandlerDeps {
  config: AttesterConfig;
  /** fetch used for GitHub, X and the JWKS (tests inject a fake). */
  fetch?: FetchLike;
  connection?: ChainConnection;
  jwks?: JwksCache;
  xResolver?: XResolver;
  nowSecs?: () => number;
  log?: (entry: Record<string, unknown>) => void;
}

const MAX_BODY = 16 * 1024;
const USER_AGENT = "anyfee-attester/0.1";

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const cfg = deps.config;
  const fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init));
  const nowSecs = deps.nowSecs ?? (() => Math.floor(Date.now() / 1000));
  const connection: ChainConnection = deps.connection ?? new Connection(cfg.rpcUrl, "confirmed");
  const jwks = deps.jwks ?? new JwksCache({ url: GITHUB_JWKS_URL, fetch: fetchImpl });
  const xResolver = deps.xResolver ?? defaultXResolver({ bearerToken: cfg.xBearerToken, fetch: fetchImpl });
  const github = { fetch: fetchImpl, userAgent: USER_AGENT, ...(cfg.githubToken ? { token: cfg.githubToken } : {}) };
  const signer = cfg.attesterKey ? signerFromKey(cfg.attesterKey) : null;
  const feePayer = cfg.submit && cfg.feePayerKey ? keypairFromKey(cfg.feePayerKey) : null;
  const identityCache = new TtlCache<ResolvedIdentity | ResolveError>(1000);
  const log = deps.log ?? ((e) => console.log(JSON.stringify(e)));

  const cors: Record<string, string> = {
    "access-control-allow-origin": cfg.corsOrigin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
  const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors, ...extra },
    });
  const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });

  async function readJson(req: Request): Promise<Record<string, unknown>> {
    const len = Number(req.headers.get("content-length") ?? "0");
    if (len > MAX_BODY) throw new AttestError("body_too_large", "request body too large", 413);
    const text = await req.text();
    if (text.length > MAX_BODY) throw new AttestError("body_too_large", "request body too large", 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new AttestError("bad_request", "body must be JSON", 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new AttestError("bad_request", "body must be a JSON object", 400);
    return body as Record<string, unknown>;
  }

  async function sign(grants: Grant[], claimant: PublicKey): Promise<AttestationJson[]> {
    if (!signer) throw new AttestError("not_configured", "this attester has no signing key configured", 503);
    for (const g of grants) {
      if (vaultPda(g.platform, g.id, cfg.programId)[0].equals(claimant)) throw new AttestError("bad_claimant", "the claimant cannot be the vault itself", 400);
    }
    const expiresAt = nowSecs() + cfg.attestationTtlSecs;
    return Promise.all(grants.map((g) => createAttestation({ platform: g.platform, id: g.id, claimant, expiresAt, programId: cfg.programId }, signer)));
  }

  async function maybeSubmit(atts: AttestationJson[]): Promise<SubmitResult[] | undefined> {
    if (!cfg.submit || !feePayer) return undefined;
    const out: SubmitResult[] = [];
    for (const a of atts) {
      out.push(await submitAttestation(connection, feePayer, a, { programId: cfg.programId, fallbackUsdcMint: cfg.fallbackUsdcMint }));
    }
    return out;
  }

  async function identity(target: Target): Promise<ResolvedIdentity> {
    const key = JSON.stringify(target, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const hit = identityCache.get(key);
    if (hit instanceof ResolveError) throw hit;
    if (hit) return hit;
    try {
      const r = await resolveIdentity(target, { github, x: xResolver, connection, programId: cfg.programId });
      identityCache.set(key, r, target.kind === "address" ? 30_000 : 5 * 60_000);
      return r;
    } catch (e) {
      if (e instanceof ResolveError && e.status === 404) identityCache.set(key, e, 60_000);
      throw e;
    }
  }

  async function handleResolve(url: URL): Promise<Response> {
    const q = url.searchParams.get("q");
    if (!q) return fail(400, "bad_request", "missing ?q= (a GitHub repo/user link, @handle, x.com link or Solana address)");
    let target: Target;
    try {
      target = parseTarget(q);
    } catch (e) {
      if (e instanceof TargetParseError) return fail(400, "bad_target", e.message);
      throw e;
    }
    let who: ResolvedIdentity;
    try {
      who = await identity(target);
    } catch (e) {
      if (e instanceof ResolveError) return fail(e.status === 400 ? 400 : e.status, e.status === 404 ? "not_found" : "upstream_error", e.message);
      throw e;
    }
    const base = {
      query: q,
      platform: who.platform,
      platformName: PLATFORM_NAMES[who.platform],
      id: who.id,
      display: who.display,
      url: who.url,
      ...(who.github?.repo ? { github: { owner: who.github.repo.owner, defaultBranch: who.github.repo.defaultBranch } } : {}),
      ...(who.github?.user ? { github: { type: who.github.user.type, avatarUrl: who.github.user.avatarUrl } } : {}),
    };
    try {
      const s = await fetchVaultState(connection, who.platform, who.id, { programId: cfg.programId, fallbackUsdcMint: cfg.fallbackUsdcMint });
      const a = s.account;
      const pending = a?.pendingClaimant ? { claimant: a.pendingClaimant.toBase58(), effectiveAt: Number(a.pendingEffectiveAt) } : null;
      const warnings = [...who.warnings];
      if (pending) warnings.push(`A change of claimant is pending and takes effect at ${new Date(pending.effectiveAt * 1000).toISOString()} unless the current claimant cancels it.`);
      if (a?.declined) warnings.push("The recipient declined tips: new direct tips are rejected and outstanding tips can be refunded.");
      if (s.config?.paused) warnings.push("The program is paused: new tips are rejected.");
      return json(200, {
        ...base,
        vault: s.vault.toBase58(),
        vaultTokenAccount: s.vaultTokenAccount.toBase58(),
        initialized: s.initialized,
        balances: {
          lamports: s.lamports,
          rentExemptLamports: s.rentExemptLamports,
          claimableLamports: s.claimableLamports,
          usdc: { mint: s.usdcMint.toBase58(), amount: s.tokenAmount, claimable: s.claimableTokens, decimals: USDC_DECIMALS },
        },
        claimant: a?.claimant?.toBase58() ?? null,
        boundAt: a && a.claimant ? Number(a.boundAt) : null,
        declined: a?.declined ?? false,
        pending,
        tips: a
          ? { count: a.tipCount, claimEpoch: a.claimEpoch, outstandingLamports: a.outstandingTipLamports, outstandingTokens: a.outstandingTipTokens }
          : { count: 0n, claimEpoch: 0n, outstandingLamports: 0n, outstandingTokens: 0n },
        config: s.config
          ? { attester: s.config.attester.toBase58(), paused: s.config.paused, refundWindowSecs: s.config.refundWindowSecs, rebindDelaySecs: s.config.rebindDelaySecs }
          : null,
        warnings,
      });
    } catch (e) {
      return json(200, { ...base, chainError: `could not read chain state: ${(e as Error).message}`, warnings: who.warnings });
    }
  }

  async function handleGithub(req: Request): Promise<Response> {
    const body = await readJson(req);
    if (typeof body.oidcToken !== "string") throw new AttestError("bad_request", 'body must be {"oidcToken": string}', 400);
    const claim = body.claim ?? "both";
    if (claim !== "both" && claim !== "repo" && claim !== "user") throw new AttestError("bad_request", 'claim must be "repo", "user" or "both"', 400);
    if (!signer) throw new AttestError("not_configured", "this attester has no signing key configured", 503);
    const r = await verifyGithubClaim(body.oidcToken, { jwks, github, nowSecs, skewSecs: cfg.oidcSkewSecs });
    if (claim === "user" && !r.userClaim.allowed) throw new AttestError("user_claim_not_allowed", r.userClaim.reason ?? "user claim not allowed", 403);
    const grants = r.grants.filter((g) => claim === "both" || (claim === "repo" ? g.platform === 2 : g.platform === 1));
    const attestations = await sign(grants, r.claimant);
    const submitted = await maybeSubmit(attestations);
    log({ route: "attest/github", ok: true, repository_id: r.repository.id, grants: grants.map((g) => g.platform), submitted: submitted?.map((s) => s.status) });
    return json(200, {
      claimant: r.claimant.toBase58(),
      repository: r.repository,
      run: r.run,
      userClaim: r.userClaim,
      attestations,
      ...(submitted ? { submitted } : {}),
    });
  }

  async function handleX(req: Request): Promise<Response> {
    const body = await readJson(req);
    if (!signer) throw new AttestError("not_configured", "this attester has no signing key configured", 503);
    const r = await verifyXClaim({ tweetUrl: body.tweetUrl, claimant: body.claimant }, {
      resolver: xResolver,
      nowSecs,
      maxPostAgeSecs: cfg.xMaxPostAgeSecs,
      skewSecs: cfg.oidcSkewSecs,
    });
    const attestations = await sign(r.grants, r.claimant);
    const submitted = await maybeSubmit(attestations);
    log({ route: "attest/x", ok: true, author_id: r.post.authorId, submitted: submitted?.map((s) => s.status) });
    return json(200, { claimant: r.claimant.toBase58(), post: r.post, attestations, ...(submitted ? { submitted } : {}) });
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (path === "/api/health" && req.method === "GET") {
        return json(200, { ok: true, service: "anyfee-attester", ...describeConfig(cfg), xResolver: xResolver.name });
      }
      if (path === "/api/resolve") {
        if (req.method !== "GET") return fail(405, "method_not_allowed", "use GET");
        return await handleResolve(url);
      }
      if (path === "/api/attest/github" || path === "/api/attest/x") {
        if (req.method !== "POST") return fail(405, "method_not_allowed", "use POST");
        return path === "/api/attest/github" ? await handleGithub(req) : await handleX(req);
      }
      return fail(404, "not_found", "unknown endpoint");
    } catch (e) {
      if (e instanceof AttestError) {
        log({ route: path, ok: false, code: e.code, status: e.status });
        return fail(e.status, e.code, e.message);
      }
      log({ route: path, ok: false, code: "internal", error: (e as Error).message });
      return fail(500, "internal", "internal error");
    }
  };
}
