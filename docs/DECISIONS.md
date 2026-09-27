# Decisions

Decisions made while building against `docs/SPEC.md` v0.1. Each entry says what was decided
and why. Other components may append their own sections below.

## Program (`programs/anyfee`, `tests/program`)

**P1. Framework and toolchain: Anchor 1.2.0.**
- Crates: `anchor-lang` and `anchor-spl` 1.2.0 (stable, released 2026-09-04). The CLI was
  installed with `cargo install anchor-cli --version 1.2.0 --locked`.
- Anchor 1.2's MSRV is rustc 1.89, which is exactly the rustc shipped in platform-tools v1.54.
  The pairing works as-is, so no native fallback was needed.
- The Anchor 1.2 CLI defaults to platform-tools v1.57 and SBPF v3.
  `scripts/build-program.sh` pins `--tools-version v1.54 --arch v3`, to use the toolchain
  installed here.
- SBPF v3 is active on devnet (feature `5cC3foj77CWun58pC51ebHFUWavHWKarWyR5UUik7dnC`, epoch
  1069) and on mainnet (epoch 993), checked with `solana feature status`. Set
  `ANYFEE_SBF_ARCH=v0` only if a target cluster lacks v3.
- The anchor-spl `idl-build` feature does not compile without anchor-spl's `token_2022`
  feature (an upstream bug), so `token_2022` is enabled. The program does not use it.

**P2. `tip_sol` / `tip_token` require an initialized vault.**
- Neither instruction uses `init_if_needed` on the vault. A missing vault fails with Anchor's
  `AccountNotInitialized` (3012).
- Clients prepend `init_vault` in the same transaction when the vault does not exist yet. This
  is tested.
- Reason: the core account is only ever created by one audited path, and each `tip_*` stays
  small.

**P3. Refunds are split into `refund_tip` (SOL) and `refund_tip_token` (token).**
- SPEC lists a single `refund_tip`. Anchor's optional accounts could express that, but a
  separate instruction keeps each account list exact and self-documenting for non-Anchor
  clients.
- Same args `(platform, id, tip_index)`, same rules, same `Refunded` event.
- Calling the wrong one fails: `WrongTipKind`, or an account constraint when the token accounts
  are absent.
- The token refund pays the sender's associated token account. If the sender closed it, a
  cranker prepends ATA `create_idempotent`.

**P4. Added `close_tip(platform, id, tip_index)`.** This is not in SPEC.
- It is a permissionless crank. It closes a tip receipt that a claim has already consumed
  (`tip.epoch < vault.claim_epoch`) and returns the receipt's rent (about 0.0018 SOL) to
  `tip.sender`.
- It moves no vault funds. Without it, every consumed receipt would lock the sender's rent
  forever.

**P5. A consuming claim resets both outstanding counters.**
- SPEC says `claim_sol` does `claim_epoch += 1, outstanding_tip_lamports = 0`. The epoch is
  shared by SOL and token tips. If `claim_sol` bumped the epoch but kept
  `outstanding_tip_tokens`, a later `decline` would make `claim_token` reserve token tips whose
  receipts can never be refunded (epoch mismatch). Those tokens would be stuck forever.
- So any claim made while not declined that finds live tips does all of the following:
  - bumps the epoch
  - zeroes both `outstanding_tip_lamports` and `outstanding_tip_tokens`
- That applies to `claim_sol` and `claim_token` alike. The consumed tips' funds stay in the
  vault, claimable by the claimant. Tested in `token_claim_and_consumption`.

**P6. The epoch only increments when a claim consumes tips.**
- A claim bumps the epoch only if at least one outstanding counter is non-zero. SPEC words it
  as "+1 on every claim that consumes tips".
- A claim of raw inflows only leaves the epoch unchanged.
- Declined claims never touch the epoch.

**P7. Bounds on admin-set windows.**
- `refund_window_secs` must be in [1 day, 365 days]. `rebind_delay_secs` must be in
  [1 day, 30 days]. Both are checked in `initialize` and `set_config`, and the SPEC defaults
  (30 d and 48 h) fit inside.
- Reason: the rebind delay is the only protection bound vaults have against a compromised
  attester, or an admin who rotated the attester. The refund window bounds protect recipients
  (tips bounced too early) and senders (tips locked indefinitely).
- A pending rebind keeps the delay that was in force when it was requested.
- Side effect: localnet e2e cannot test "refund after window" or "finalize after delay" in real
  time. Use the declined path, or LiteSVM, which covers both.

**P8. `initialize` requires the program's upgrade authority.**
- SPEC says "signer becomes admin; once". Anyone could otherwise front-run initialization right
  after deploy.
- Extra accounts: `program` (this program) and `program_data`, whose
  `upgrade_authority_address` must equal the signer.
- On devnet, the deployer (upgrade authority) must run `initialize`.

**P9. `set_config` takes `Option`s.**
- Signature: `set_config(new_admin: Option<Pubkey>, attester: Option<Pubkey>,
  refund_window_secs: Option<i64>, rebind_delay_secs: Option<i64>, paused: Option<bool>)`.
  `None` keeps the current value.
- `new_admin` and `attester` cannot be `Pubkey::default()`.
- `usdc_mint` is immutable, because outstanding token tips are accounted in it.

**P10. What pause blocks.**
- It blocks `tip_sol`, `tip_token`, `bind` and `finalize_rebind`.
- It never blocks claims, refunds, `cancel_rebind`, `decline`, `init_vault`, `close_tip` or
  `set_config`.
- Reason: pause is a brake for attester incidents, and must never let the admin freeze funds.
  SPEC only mentions tips.

**P11. `bind` details.**
- `claimant` cannot be `Pubkey::default()` or the vault itself (`InvalidClaimant`).
- Binding the current claimant again fails with `AlreadyClaimant`. This makes a replayed
  attestation a no-op.
- A new rebind request overwrites a pending one and restarts its timer.
- Expiry is strict: `now < expires_at`.
- `bind` works on a declined vault. Declined is permanent in v0.1 and survives rebinds, since
  SPEC defines no un-decline.
- `finalize_rebind` sets `bound_at = now`.

**P12. Extra explicit errors beyond SPEC's list.**
- Ed25519 and attestation: `MissingEd25519Instruction`, `MalformedEd25519Instruction` (wrong
  signature count, or offsets outside the instruction), `WrongAttester`. `BadAttestation`
  keeps its SPEC meaning: the message differs from `M`.
- Other additions: `VaultUnbound`, `NoPendingRebind`, `AlreadyClaimant`, `AlreadyDeclined`,
  `InvalidClaimant`, `ZeroAmount`, `MathOverflow`, `InvalidConfig`, `NotAdmin`,
  `NotUpgradeAuthority`, `NotRefundable` (bound and not declined), `WrongTipKind`,
  `TipNotConsumed`, `InvalidDestination`, `InsufficientVaultBalance`.
- Codes run from 6000 in declaration order. The IDL is authoritative.

**P13. Token handling.**
- Only the classic SPL Token program is supported (`Program<Token>`, `transfer_checked`), and
  the mint must equal `config.usdc_mint`. USDC on Solana is classic SPL Token. Token-2022
  extensions would break the tip accounting.
- `tip_token` creates the vault ATA (`init_if_needed`, paid by the sender).
- `claim_token` pays any token account of the mint that the claimant chooses.

**P14. `claim_sol` destination.** It can be any writable account except the vault itself.
Crediting lamports needs no ownership.

**P15. Events use `emit!` (log based), not `emit_cpi!`.**
- Events: `ConfigInitialized`, `ConfigUpdated`, `VaultInitialized` (with `prefunded_lamports`),
  `Tipped`, `Bound`, `RebindRequested`, `RebindFinalized`, `RebindCancelled`, `Claimed`
  (`mint` = default for SOL, `consumed_tips`, new `claim_epoch`), `Refunded`, `Declined`,
  `TipClosed`.
- `emit!` is cheaper and simpler, and indexers can always fall back to account state.

**P16. Seeds.**
- Vault seeds are written as `platform.to_le_bytes()` (1 byte) and `id.to_le_bytes()` (8
  bytes). These are exactly the SPEC bytes; this spelling lets Anchor put the vault PDA in the
  IDL.
- Tip seeds are `["tip", vault, tip_index.to_le_bytes()]`. At tip time the index is
  `vault.tip_count`.

**P17. Tests run on LiteSVM 0.16 (Agave 4.2 runtime, `precompiles` feature), in Rust.**
- The tests load the real `target/deploy/anyfee.so` and patch ProgramData to set an upgrade
  authority.
- Precompile verification is real, so the malicious ed25519 layouts are exercised end to end.
- The same happy path also runs once on a real `solana-test-validator`: `scripts/localnet.sh
  --smoke`.
- One command: `scripts/test-program.sh`.

**P18. The IDL is committed at `programs/anyfee/idl/anyfee.json`, with TS types in
`anyfee.ts`.** `scripts/build-program.sh` regenerates both. `target/` is gitignored.

**P19. Localnet uses a USDC-like mint at the devnet USDC address.**
- The address is `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`: classic SPL Token, 6
  decimals, confirmed on devnet.
- It is preloaded with a local mint authority, so clients use one mint address on localnet and
  devnet, and e2e tests can mint.
- Initialization uses the devnet attester pubkey from SPEC.
- `anyfee-localnet-init` (in `tests/program`, feature `localnet`) sends the real `initialize`
  over RPC. It also works against devnet (see README).

**P20. Account sizes.**
- Config is 122 bytes, Vault 155, Tip 130, each including the 8-byte discriminator. Field order
  is exactly SPEC's.
- SPEC defines no reserved padding. A v0.2 layout change will need a migration or new seeds.

## sdk/attester (`sdk/`, `attester/`, `action/`, `.github/workflows/oidc-selftest.yml`)

**S1. Runtime and tooling: Node ≥ 22.18, ESM, TypeScript with no build step.**
- Sources are `.ts` files with `.ts` import specifiers. Node strips the types natively, and so do
  `node --test` and Netlify's esbuild bundler.
- `tsconfig` sets `erasableSyntaxOnly` (no enums or parameter properties) and
  `rewriteRelativeImportExtensions`. So `npm run build -w @anyfee/sdk` can still emit
  `dist/*.js` + `.d.ts` for a later npm publish.
- Type checking uses TypeScript 7.0 (`tsc`).
- In the workspace, `@anyfee/sdk` exports `src/index.ts` directly. The workspace symlink
  resolves outside `node_modules`, so Node's type stripping applies.

**S2. Small dependency set.**
- Runtime dependencies: `@solana/web3.js` 1.99, `@noble/curves` and `@noble/hashes` 2.x, `bs58`
  6, `buffer` 6. The explicit `buffer` import keeps the SDK working in browsers.
- Dev dependencies: `typescript`, `@types/node`, and `tweetnacl`. Tests verify signatures with
  tweetnacl, independently of the noble signer.
- No JWT library. RS256 verification is about 150 lines of WebCrypto (`attester/src/jwt.ts`), so
  the same code runs on Node, Netlify, Deno and Workers.
- `npm audit` reports 4 moderate issues. All sit in `@solana/web3.js` 1.x's RPC client internals
  (`jayson` → `stream-json`/`uuid`), and there is no fix inside 1.x. They only parse responses
  from the RPC we configure.

**S3. Layouts come from the IDL.**
- `npm run sync-idl` copies `programs/anyfee/idl/anyfee.json` to `sdk/src/idl/anyfee.json`. It
  also generates `sdk/src/idl-layout.ts`: instruction account order and flags, Borsh args,
  account/event fields, and error codes.
- Typed builders pass a superset of *named* accounts, and the generic `buildInstruction` picks
  and orders them from the layout. An IDL change therefore rarely needs builder edits.
- `test/idl-conformance.test.ts` compares the generated layouts with the committed IDL:
  discriminators, accounts, args, account and event fields, errors.
- `target/idl` is not checked. It is gitignored local build output and can be ahead of the
  committed IDL.
- The offline, self-contained PDA and discriminator tests stay hand-written: the SPEC vector,
  pinned addresses, and the well-known `initialize` discriminator.

**S4. `parseTarget` accepts more forms than SPEC lists.**
- Extra forms: `owner/repo`, `git@github.com:owner/repo.git`, `github.com/orgs|users|sponsors/<name>`,
  and tweet URLs (the author's handle is returned together with `tweetId`).
- Canonical id forms `github-repo:<id>`, `github-user:<id>` and `x:<id>` exist so the site can
  link by the stable id.
- It rejects:
  - bare words (ambiguous between GitHub and X);
  - reserved GitHub and X paths;
  - `x.com/i/web/status/<id>` (no handle);
  - `anyfee:<wallet>` strings (a proof, not a payee).
- A Solana address resolves only if it is an initialized vault, or a Tip that points to one. An
  uninitialized vault PDA cannot be reversed.

**S5. Honest warnings in resolve.**
- GitHub organizations get a warning: they can never claim a *user* vault, so tips to that vault
  just refund. Archived repositories (cannot run workflows) and forks also get warnings.
- Pending rebinds, declined vaults and a paused program appear in `warnings` too.
- There is no ranking or listing endpoint.

**S6. GitHub OIDC policy (beyond SPEC).**
- `iss` must match exactly. Enterprise custom issuers are rejected.
- The header `alg` must be `RS256`. `none` and `HS*` are refused before any key lookup.
- `exp` and `nbf` allow 60 s of skew. `iat` must not be in the future.
- `aud` must be one string, or a one-element array, equal to `anyfee:` plus a **canonical**
  base58 32-byte key. That key must not be all zeros and must not be the vault itself (both are
  rejected on-chain as well).
- `ref_type` must be `branch`.
- The repository is fetched **by `repository_id`** (`/repositories/{id}`), which is stable across
  renames. Its `id` and `owner.id` must equal the token's `repository_id` and
  `repository_owner_id`.
- Private repositories get `repo_not_visible` unless the attester's `GITHUB_TOKEN` can read
  them.
- The request may narrow what is bound with `claim: "repo" | "user" | "both"` (default `both`).
  - An explicit `user` request that is not allowed returns 403.
  - With `both`, a disallowed user claim is reported in `userClaim.reason`.

**S7. JWKS caching and rotation.**
- Keys are cached by `kid` for 10 minutes, or for the response's `Cache-Control: max-age`
  clamped to between 1 minute and 1 hour.
- An unknown `kid` triggers a refetch at most once every 30 s, to cover key rotation without
  letting refetches be abused.
- Stale-if-error: the last good keys stay in use if GitHub's JWKS is down.
- Only RSA `sig` keys of at least 2048 bits are imported.

**S8. X policy.**
- The post must contain exactly one distinct `anyfee:<wallet>`, matched as a whole token and in
  lowercase, and it must name the requested wallet.
- The post must be at most 24 h old (`X_MAX_POST_AGE_SECS`) and not dated in the future. This
  bounds how long an old post can be replayed after the owner moves to a new wallet.
- The vault id is the author id returned by the resolver. The handle in the pasted URL is
  ignored.
- The default resolver is fxtwitter, which returns a 302 or a 404 JSON when something is not
  found; both are treated as not found. The official X API v2 is used when `X_BEARER_TOKEN` is
  set. A `200 {errors}` from it is treated as not found, and `note_tweet` text is preferred.

**S9. Attestation format and TTL.**
- Format: `{ platform, id (decimal string), claimant, expiresAt (unix s), message (base64),
  signature (base64), attester, vault }`.
- TTL is 15 minutes by default, configurable from 60 s to 1 h.
- The SDK's `verifyAttestation` re-derives every field from the signed message. So a JSON field
  can never disagree with what `bind` checks.

**S10. Submit mode (`ATTESTER_SUBMIT=1`).**
- One transaction per attestation: `[ComputeBudget 200k, init_vault if missing, Ed25519SigVerify, bind]`.
- It is skipped as `already_bound` when the claimant is already bound (the program would fail
  with `AlreadyClaimant`). It is skipped as `rebind_already_pending` when the same claimant is
  already pending, so a retry does not restart the rebind timer.
- It fails early when the program is paused.
- It refuses to send when the RPC's genesis hash is mainnet-beta's.
- The fee payer is `FEE_PAYER_SECRET_KEY`, or the attester key.
- The program's custom errors are reported by name through the IDL error table.
- After 20 s without confirmation it answers `sent` with a note, not a failure.

**S11. Keys and secrets.**
- Keys come from env only. `ATTESTER_SECRET_KEY_FILE` is honoured **only** by the local Node
  server (`src/server.ts`), and only with an explicit path. No default path to `keys/` exists
  anywhere.
- The Netlify adapter rejects the file option.
- `describeConfig` prints the attester pubkey and the RPC *host* only. RPC URLs often carry API
  keys.
- The action masks the OIDC token. The attester never logs tokens.

**S12. Serving.**
- Without a key the attester runs resolve-only, and the attest endpoints answer 503.
- CORS `*` (no cookies). Request bodies are limited to 16 KB.
- Identity lookups are cached in memory for 5 minutes (404s for 60 s). Chain state is never
  cached.
- No rate limiting in v0.1. Put the attester behind the platform's limits before any public
  launch.

**S13. The action is a JavaScript action (`runs.using: node24`) with no dependencies.**
- It reads its inputs from `INPUT_*` and requests the token from
  `ACTIONS_ID_TOKEN_REQUEST_URL&audience=…`. That is what `@actions/core.getIDToken` does,
  without the dependency.
- The attester URL must be https (localhost is allowed for testing).
- It fails the job with the attester's error code and message.

**S14. Live OIDC proof in CI.**
- The self-test workflow verifies real tokens and runs negative controls.
- It also runs the action end to end against a local attester with a throwaway key. So the first
  push to GitHub proves both the verifier and the action with real tokens.

**S15. A real-program end-to-end script, opt-in.**
- `npm run localnet-e2e -w @anyfee/attester` spawns its own `solana-test-validator` with the
  compiled `.so` (upgradeable, admin = upgrade authority) on ports 18899/19900, so it does not
  clash with `scripts/localnet.sh` on 8899.
- It drives the SDK and the attester, in submit mode, through 28 checks. These include
  pre-funded `init_vault`, tips, OIDC → bind, claims, `close_tip`, rebind + cancel, X → bind,
  decline, refund, and five on-chain rejections.
- It is not part of `npm test`, because it needs the Solana CLI and a built program.

## Devnet deployment (orchestrator, 2026-09-27)

- Program deployed to devnet at BixfaA4JmPvntZvGZwnqhHdoUQvEzZY6ZBMXCLgF3C9M (upgrade authority = devnet deployer), config AB2iPJfuLv2Bf3JecZ3LcSqsMaAeE8VPfgWSmQ6i9TbA initialized with the devnet attester, devnet USDC 4zMMC9…, 30 d refund window, 48 h rebind delay.
- `scripts/devnet-e2e.ts` passes against devnet with the SDK only: raw inflow to an uninitialized vault address → init + tip → ed25519+bind → claim; tip → bind → decline → permissionless refund.
- Note: when fees reach a vault address before `init_vault`, the vault's rent (0.00144 SOL) is taken from those funds, and every claim leaves exactly that rent in the vault.

## site (`app/`)

**W1. Stack: vanilla ES modules bundled by esbuild; three.js only for the wall, loaded lazily.**
- No framework: the UI is a handful of forms and panels built with a 40-line `h()` helper that
  only ever inserts text nodes (names and descriptions from GitHub and X cannot inject markup).
- The SDK is used as-is (`@anyfee/sdk` sources through the workspace); no PDA, layout or
  instruction code is duplicated in the app. `@solana/web3.js` 1.x is the SDK's own dependency.
- Wallets: `@wallet-standard/app` only (Phantom, Solflare, Backpack and any standard wallet).
- Budget: app ≈142 KB gzip + three.js wall ≈138 KB gzip (dynamic import) ≈ 280 KB, under the
  400 KB target; CSS ≈8 KB gzip; fonts vendored (≈108 KB woff2, OFL, see `app/CREDITS.md`).

**W2. One origin: site + attester handlers + an RPC proxy.**
- Local: `app/server/dev.ts` serves `app/dist` and composes the attester's
  `createHandler({ config: loadConfig(env) })` with the app's `/api/rpc` proxy on one port.
  `ATTESTER_SECRET_KEY_FILE` stays explicit (S11); a relative path is resolved against `INIT_CWD`
  so `npm run dev:site` works from the repository root.
- Netlify (not deployed): `/api/*` is the attester's own `netlifyHandler()` plus the proxy;
  `/v/*` is a function that injects per-page meta into the built shell.

**W3. The browser talks to Solana only through `/api/rpc`.**
- Why: `RPC_URL` carries an API key (Helius). The proxy keeps it server-side and never echoes
  upstream error text.
- It forwards an allowlist of read/send methods, limits `getProgramAccounts` to scans of the anyfee
  program that are filtered by vault (memcmp at offset 8), refuses batches, refuses mainnet-beta
  by genesis hash (and anything but devnet/testnet unless `ALLOW_LOCAL_RPC=1`), and retries
  upstream 429s with backoff (free RPC tiers throttle a page load plus a transaction).
- No websockets: confirmations are polled with `getSignatureStatuses` (and the raw transaction is
  re-sent every few seconds until confirmed or the blockhash expires).
- No rate limiting of its own in v0.1 (same as the attester, S12).

**W4. Transactions: simulate, then `solana:signTransaction`, then send ourselves.**
- Legacy transactions, fee payer = the connected wallet. Every transaction is simulated before
  the wallet opens, so program errors show as sentences (`describeProgramError` + a few Anchor
  codes by log text) instead of a wallet warning.
- The site asks for `signTransaction`, not `signAndSendTransaction`, so the site decides the
  cluster (devnet) regardless of the wallet's network setting.
- A tip whose index was taken by a concurrent tip (seeds mismatch) is rebuilt and retried once.

**W5. "Your mail to this box" lists a sender's receipts with one filtered scan.**
- `getProgramAccounts` with `dataSize 130`, `memcmp(8) = vault`, `memcmp(40) = sender`; the tip
  index (needed by `refund_tip`/`close_tip`) is recovered by deriving tip PDAs from `tip_count`
  downwards. If the RPC refuses the scan, the last 300 receipts are read directly.
- Only the connected wallet's own receipts are shown; nobody else's tips are listed.

**W6. UI limits that the program does not enforce.**
- Minimum tip 0.001 SOL / 0.10 USDC: the receipt deposit (≈0.00131 SOL) would otherwise dwarf the
  tip (THREAT-MODEL §7).
- Tips to a GitHub *organization's* account box are disabled, and the fee panel says not to route
  fees there: organizations can never claim it, so tips could only ever bounce and fees would be
  stuck forever.
- Declined or paused boxes show why tips are closed instead of a form.

**W7. Routes.** `/v/github/:owner/:repo`, `/v/gh/:login`, `/v/x/:handle` as asked, plus
`/v/id/:platform/:id` by numeric id. The id route is the stable share link (survives renames and
handle changes) and the only route for identities without a resolvable handle (fxtwitter has no
id → handle lookup). A numeric `/v/x/<id>` was not used because X handles can be all digits.
Unknown paths get the in-character 404 with HTTP 404; `404.html` also boots the app, so plain
static hosts still serve vault pages.

**W8. Link previews come from the path only.** `<title>`, description and Open Graph tags are
derived from the URL, with no network call and no balances or amounts, so a shared box never
reads like a "claim your funds" lure. `og.png` and the icons are rendered from the site's own
3D wall (`npm run og -w @anyfee/app`).

**W9. Claim page details.**
- GitHub: the workflow YAML from CLAIMING.md with the wallet pre-filled as the
  `workflow_dispatch` input default and the attester URL filled in; an "Add it to the repository"
  link opens GitHub's new-file page with the content pre-filled. The `uses:` line keeps the
  CLAIMING.md placeholder (`OWNER/anyfee/action@v0.1.0`) because the action is not published;
  the page says so. A local attester URL gets a warning (GitHub's runners cannot reach it).
- After the proof, the page polls `/api/resolve` every 6 s until the box is bound (or a change
  is pending) to the connected wallet, then shows the holder's window.
- Paste mode (every type): the JSON is verified in the browser with the SDK's
  `verifyAttestation` against `config.attester` before anything is signed; a claimant different
  from the connected wallet is allowed (anyone may submit a bind) but flagged.
- The attester URL is configurable (stored per browser); default is the same origin.

**W10. Honesty copy.** Every box says: unverified until claimed, not an endorsement, the owner
may decline, direct tips return after the refund window, routed fees stay, devnet only. Where the
brief says "the attester can bind but never withdraw", the site adds the THREAT-MODEL caveat:
until a box is first claimed you are trusting the attester to bind the right person. The fee
panel warns that the box address is a devnet box and must not be put into a mainnet coin yet
(the same program id could later exist on mainnet, but nothing can claim there today).

**W11. Design.** A post-office lobby: enamel-green wall, numbered brass boxes with glass windows,
combination dials and a letter slot, form-paper panels and rubber stamps for status
(Unclaimed / Claimed / Return to sender / Change pending). Type: Big Shoulders Display (civic
signage, engraved numerals), Public Sans (US government forms), IBM Plex Mono (addresses). The
wall renders on demand only (no idle loop), pauses when hidden, caps DPR at 2 (1.5 on small
screens), falls back to a CSS wall without WebGL, and does not animate under
`prefers-reduced-motion`. `/faq` is a plain question list, not an accordion.

**W12. Tests.** `npm test -w @anyfee/app` is offline (routes, meta shell, RPC proxy guards,
formatting, attestation parsing, both Netlify functions). `npm run e2e:devnet -w @anyfee/app` is
opt-in: Playwright (not a dependency; `PLAYWRIGHT_MODULE`) drives the real site on devnet with an
injected Wallet Standard wallet whose key stays in Node, funded from the deployer with a 0.05 SOL
cap recorded in `keys/site-test-wallet.funding.json`.

**W13. Not done.** No deploy. USDC tips are implemented but not exercised on devnet (the test
wallet holds no devnet USDC; Circle's faucet is a web form). The GitHub claim was exercised up to
the YAML and polling; a real OIDC run needs the action published and a public attester. No
analytics, no i18n.

**SDK / attester notes for their owners** (not changed here):
- `XUser` has no avatar; `/api/resolve` could return X avatars (fxtwitter provides
  `avatar_url`). The site fetches it from fxtwitter in the browser, display only.
- A `fetchTipsBySender(conn, vault, sender)` helper (scan + index recovery, W5) would belong in
  the SDK so other clients can offer refunds.
- `fetchVaultState` makes three sequential RPC calls (config + vault, then the ATA, then rent);
  folding the ATA into the first `getMultipleAccounts` (it is derivable from the fallback mint)
  would halve round trips on rate-limited RPCs.
- `describeProgramError` knows only the program's own codes; Anchor framework codes (3012
  `AccountNotInitialized`, 2006 `ConstraintSeeds`) would help clients too.
- `/api/resolve?q=x:<id>` returns no handle because fxtwitter has no id lookup (`userById`).
- 2026-09-27 dogfood on real GitHub + devnet: `.github/workflows/anyfee-claim.yml` (this repo, id 1390597639) ran `./action`, the attester (reached through a temporary tunnel, submit mode) verified GitHub's OIDC token and sent the bind; `scripts/devnet-claim.ts` then claimed the 0.01 SOL tip to the maintainer wallet. The OIDC self-test workflow also verifies real GitHub tokens in CI.
