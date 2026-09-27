# anyfee

One address for anyone. Send SOL or USDC tips, or route pump.fun and Bags creator fees, to a
**GitHub repo**, a **GitHub user** or an **X account**. Each vault is keyed to the account's
permanent numeric id. The owner claims later by proving control. Unclaimed direct tips go back
to the sender.

**Status: devnet MVP.** No mainnet use. No real funds. Read [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md)
before trusting it with anything.

| Document | Contents |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | The contract |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Decisions and deviations |
| [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) | Trust assumptions and attacks |

---

## Program

The Anchor program lives in `programs/anyfee`. Its id is `BixfaA4JmPvntZvGZwnqhHdoUQvEzZY6ZBMXCLgF3C9M`.

### Build and test

```sh
scripts/build-program.sh   # anchor build -> target/deploy/anyfee.so, IDL -> programs/anyfee/idl/
scripts/test-program.sh    # build + unit tests + LiteSVM suite (the one command for CI)
```

With Anchor's runner: `scripts/build-program.sh && anchor test --skip-build
--skip-local-validator --skip-deploy`. Anchor.toml's test script is
`cargo test -p anyfee-program-tests`. Plain `anchor test` would build with Anchor's default
platform-tools v1.57 instead of the pinned v1.54.

Lint: `cargo clippy -p anyfee --all-targets -- -D warnings`.

Toolchain:

| Tool | Version |
|---|---|
| Rust (host) | 1.89 or newer; developed on 1.98.1 |
| solana-cli | 4.2.2 |
| cargo-build-sbf | platform-tools v1.54 (rustc 1.89) |
| Anchor CLI | 1.2.0 (`cargo install anchor-cli --version 1.2.0 --locked`) |
| SBPF | v3 (active on devnet and mainnet) |

The build script pins the tools version and arch. Override them with
`ANYFEE_SBF_TOOLS_VERSION` and `ANYFEE_SBF_ARCH`.

Output: `target/deploy/anyfee.so`, about 397 KB. Its rent-exempt ProgramData costs about
2.77 SOL.

The IDL (Anchor 1.x format) and TS types are committed at `programs/anyfee/idl/anyfee.json` and
`programs/anyfee/idl/anyfee.ts`. Regenerate them with `scripts/build-program.sh` after changing
the program.

### Accounts (all PDAs of the program)

| Account | Seeds | Size (incl. 8-byte discriminator) | Discriminator |
|---|---|---|---|
| Config | `["config"]` | 122 | `9b0caae01efacc82` |
| Vault | `["vault", [platform], id.to_le_bytes()]` | 155 | `d308e82b02987577` |
| Tip | `["tip", vault, tip_index.to_le_bytes()]` | 130 | `57da267a0fc5bee6` |

- The field layouts are exactly those in SPEC (Borsh, little-endian).
- `platform` is 1 = GitHub user, 2 = GitHub repo, 3 = X account.
- Token balances live in the vault's associated token account for `config.usdc_mint`, under the
  classic SPL Token program.

### Instructions

Discriminators are Anchor's: `sha256("global:<name>")[..8]`. Args are Borsh-encoded. Account
flags: w = writable, s = signer.

| Instruction | Discriminator | Args | Accounts (in order) |
|---|---|---|---|
| `initialize` | `afaf6d1f0d989bed` | attester: Pubkey, usdc_mint: Pubkey, refund_window_secs: i64, rebind_delay_secs: i64 | admin (w,s; must be the upgrade authority), config (w), program, program_data, system_program |
| `set_config` | `6c9e9aafd4623442` | new_admin, attester: Option\<Pubkey\>; refund_window_secs, rebind_delay_secs: Option\<i64\>; paused: Option\<bool\> | admin (s), config (w) |
| `init_vault` | `4d4f559621d9346a` | platform: u8, id: u64 | payer (w,s), vault (w), system_program |
| `tip_sol` | `6f5191ffebe5674b` | platform, id, amount: u64 | sender (w,s), config, vault (w), tip (w; index = `vault.tip_count`), system_program |
| `tip_token` | `644b1734d680d929` | platform, id, amount: u64 | sender (w,s), config, vault (w), tip (w), usdc_mint, sender_token_account (w), vault_token_account (w; ATA, created if missing), token_program, associated_token_program, system_program |
| `bind` | `b239bbfe8a2b6386` | platform, id, claimant: Pubkey, expires_at: i64 | config, vault (w), instructions_sysvar. **The previous instruction must be Ed25519SigVerify of M by `config.attester`** |
| `finalize_rebind` | `7eff5c6b617db927` | platform, id | config, vault (w) |
| `cancel_rebind` | `abf10949547b1e0f` | platform, id | claimant (s), vault (w) |
| `claim_sol` | `8b71b3bdbe1e84c3` | platform, id | claimant (s), vault (w), destination (w; any account except the vault) |
| `claim_token` | `74ce1bbfa6130049` | platform, id | claimant (s), config, vault (w), usdc_mint, vault_token_account (w), destination (w; any token account of the mint), token_program |
| `refund_tip` | `42a205ff3f7000f3` | platform, id, tip_index: u64 | config, vault (w), tip (w, closed), sender (w; = tip.sender) |
| `refund_tip_token` | `5ee3aa83c92fca38` | platform, id, tip_index: u64 | config, vault (w), tip (w, closed), sender (w), usdc_mint, vault_token_account (w), sender_token_account (w; sender's ATA), token_program |
| `decline` | `18395aa25b5ef5b1` | platform, id | claimant (s), vault (w) |
| `close_tip` | `166ddc69100b70ee` | platform, id, tip_index: u64 | vault, tip (w, closed), sender (w; = tip.sender) |

Rules, beyond the spec text. See DECISIONS P2–P11 for the reasons.

**Tipping**
- `tip_*` needs an initialized vault. For a new vault, prepend `init_vault` in the same
  transaction.
- `tip_*` fails when paused, when the vault is declined, or when `amount == 0`.

**Binding**
- `bind` fails when paused.
- On an unbound vault, `bind` sets the claimant immediately.
- On a bound vault, `bind` sets `pending_claimant` and `pending_effective_at = now + rebind_delay_secs`.
- A new request overwrites a pending one.
- `finalize_rebind` can be sent by anyone once `now >= pending_effective_at`. It fails when paused.

**Claiming**
- A claim that is not made while declined, and that finds live tips, increments `claim_epoch`
  and zeroes **both** outstanding counters.
- While declined, a claim keeps the outstanding amount back for refunds.
- The claimant can claim while a rebind is pending.

**Refunding**
- `refund_tip` / `refund_tip_token` require `tip.epoch == claim_epoch`. They then succeed if
  the vault is declined, or if the vault is unbound and `now >= created_at + refund_window_secs`.
- `close_tip` is an addition to SPEC. It returns the receipt rent of a consumed tip
  (`tip.epoch < claim_epoch`) to its sender.

**Pause** blocks `tip_*`, `bind` and `finalize_rebind` only.

**Admin bounds**
- `refund_window_secs` must be in [86 400, 31 536 000].
- `rebind_delay_secs` must be in [86 400, 2 592 000].

Compute units (LiteSVM): every instruction stays under 40k CU. `ed25519 + bind` is about 7.7k,
and `tip_token` that creates the ATA is about 38k. Run
`cargo test -p anyfee-program-tests compute_units -- --nocapture` for the full list.

### Attestation message `M` (95 bytes)

```
"anyfee:bind:v1" (14) || program_id (32) || platform (1) || id u64 LE (8) || claimant (32) || expires_at i64 LE (8)
```

The spec's test vector is asserted in `programs/anyfee/src/attestation.rs` and in
`tests/program/tests/admin.rs`.

The Ed25519SigVerify instruction immediately before `bind` must meet all of these:
- exactly one signature
- all three `*_instruction_index` fields set to `0xFFFF`
- public key = `config.attester`
- message = `M`

The standard `Ed25519Program.createInstructionWithPublicKey` / `new_ed25519_instruction_with_signature`
layout satisfies this.

### Events

All events are emitted with `emit!`, as `Program data:` logs. Discriminators are Anchor's
`sha256("event:<Name>")[..8]`, listed in the IDL.

`ConfigInitialized`, `ConfigUpdated`, `VaultInitialized`, `Tipped`, `Bound`, `RebindRequested`,
`RebindFinalized`, `RebindCancelled`, `Claimed`, `Refunded`, `Declined`, `TipClosed`.

### Errors

Custom codes, from 6000:
- 6000 `VaultDeclined`
- 6001 `Paused`
- 6002 `NotClaimant`
- 6003 `BadAttestation`
- 6004 `AttestationExpired`
- 6005 `RebindNotReady`
- 6006 `NothingToClaim`
- 6007 `RefundNotYet`
- 6008 `TipAlreadySettled`
- 6009 `UnknownPlatform`
- 6010 `VaultUnbound`
- 6011 `NoPendingRebind`
- 6012 `AlreadyClaimant`
- 6013 `AlreadyDeclined`
- 6014 `InvalidClaimant`
- 6015 `ZeroAmount`
- 6016 `MathOverflow`
- 6017 `InvalidConfig`
- 6018 `NotAdmin`
- 6019 `NotUpgradeAuthority`
- 6020 `MissingEd25519Instruction`
- 6021 `MalformedEd25519Instruction`
- 6022 `WrongAttester`
- 6023 `NotRefundable`
- 6024 `WrongTipKind`
- 6025 `TipNotConsumed`
- 6026 `InvalidDestination`
- 6027 `InsufficientVaultBalance`

Anchor's own codes also appear. For example, 3012 `AccountNotInitialized` means the vault does
not exist yet.

### Tests

`tests/program` is a LiteSVM 0.16 suite (Agave 4.2 runtime, with real precompile
verification). It loads `target/deploy/anyfee.so`:
- `admin.rs`: the M test vector; `initialize` restricted to the upgrade authority and allowed
  once; `set_config` access and bounds; admin cannot withdraw; pause semantics
- `bind.rs`: the happy path; wrong attester; wrong message (claimant, id, platform, expiry,
  domain, program, length); expired; missing or misplaced ed25519 instruction; offsets pointing
  into another instruction (attack layouts that pass the precompile); two signatures; default
  claimant; rebind → pending, claim while pending, cancel, finalize only after the delay; delay
  snapshot; attester rotation
- `vault.rs`: `init_vault` on a pre-funded address (above and below rent); unknown platforms;
  tip → refund after the window; refund before the window and on a bound vault fails; claim by
  a non-claimant fails; `claim_sol` leaves rent and consumes tips (epoch++), and earlier tips
  cannot be refunded even after a decline; `close_tip`; declined vault (tips rejected,
  immediate refunds, claim keeps outstanding back); raw lamport inflow (pump.fun-style)
  claimable after bind
- `token.rs`: USDC-like mint tip, claim, refund; ATA creation; recreating a closed sender ATA
  for a refund; declined token reserve; compute-unit guard

### Localnet (for SDK, attester and site end-to-end tests)

```sh
scripts/localnet.sh            # foreground; Ctrl-C stops
scripts/localnet.sh --detach   # background; stop with: kill $(cat .anchor/localnet/validator.pid)
scripts/localnet.sh --smoke    # also runs tip -> ed25519+bind -> claim once (signs with keys/attester-devnet.json)
```

The script does the following:
- starts `solana-test-validator` on `http://127.0.0.1:8899` (`ANYFEE_RPC_PORT` overrides). The
  program is upgradeable, with a local admin key as upgrade authority.
- creates a USDC-like mint at the devnet USDC address
  `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (6 decimals). Its mint authority is
  `.anchor/localnet/usdc-mint-authority.json`.
- funds the devnet attester `FJpnX2EKfLMyFitghtSjZuoisNxP6ZgkNCQi2LgfiiLY` with 100 SOL, so it
  can pay for `bind` transactions.
- runs the real `initialize` with that attester and the SPEC defaults (30 d refund window,
  48 h rebind delay).

A summary is written to `.anchor/localnet/env`. The windows have 1-day minimums, so on localnet
test refunds through the declined path. The time-based paths are covered by LiteSVM.

### Deploy and initialize (devnet, orchestrator)

```sh
scripts/build-program.sh
solana program deploy target/deploy/anyfee.so \
  --program-id keys/program-keypair.json \
  --keypair keys/devnet-deployer.json -u devnet     # needs about 2.8 SOL, plus a temporary buffer of the same size
cargo run -p anyfee-program-tests --features localnet --bin anyfee-localnet-init -- \
  --url https://api.devnet.solana.com \
  --admin keys/devnet-deployer.json \
  --attester FJpnX2EKfLMyFitghtSjZuoisNxP6ZgkNCQi2LgfiiLY \
  --usdc-mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
```

`initialize` must be signed by the program's upgrade authority, which here is the deployer. It
runs once. After that, rotate the admin with `set_config(new_admin = ...)` if needed.

---

## SDK (`@anyfee/sdk`)

TypeScript, ESM, and runs in Node 22.18+ and browsers. It depends on `@solana/web3.js` 1.x,
`@noble/*`, `bs58` and `buffer`. In this monorepo the package points straight at its `.ts`
sources: Node strips the types natively, and bundlers handle them. `npm run build -w @anyfee/sdk`
emits `sdk/dist/` (JS + `.d.ts`) for publishing.

Instruction, account and event layouts are **generated from the committed IDL**. Run
`npm run sync-idl -w @anyfee/sdk` after the program changes. `sdk/test/idl-conformance.test.ts`
fails when the SDK drifts from `programs/anyfee/idl/anyfee.json`. The IDL itself ships as
`@anyfee/sdk/idl`.

```ts
import { Connection, Transaction } from "@solana/web3.js";
import {
  parseTarget, resolveIdentity, fetchVaultState, vaultPda,
  tipSolInstructions, bindInstructions, claimAllInstructions,
} from "@anyfee/sdk";

const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const who = await resolveIdentity("github.com/octocat/Hello-World"); // { platform: 2, id: "1296269", display, warnings }
const [vault] = vaultPda(who.platform, who.id);                      // deterministic; can receive SOL/fees before init
const state = await fetchVaultState(conn, who.platform, who.id);      // balances, claimant, pending rebind, declined
const tipIxs = await tipSolInstructions(conn, { platform: who.platform, id: who.id, sender, amount: 10_000_000n }); // [init_vault?, tip_sol]
```

| Area | Exports |
|---|---|
| Constants | `PROGRAM_ID`, `DEVNET_ATTESTER`, `DEVNET_USDC_MINT`, `Platform` (`GithubUser` 1, `GithubRepo` 2, `X` 3), `PLATFORM_NAMES`, `BIND_DOMAIN`, `CLAIM_PREFIX`, token/ATA/Ed25519 program ids |
| PDAs | `configPda()`, `vaultPda(platform, id)`, `tipPda(vault, index)`, `vaultAta(vault, mint)`, `associatedTokenAddress(owner, mint)`, `programDataAddress()` |
| Attestation message | `encodeBindMessage({ platform, id, claimant, expiresAt, programId? })` (95 bytes; unit-tested on the SPEC vector), `decodeBindMessage` |
| Ed25519 | `buildEd25519VerifyInstruction` (one signature, offsets = u16::MAX), `parseEd25519VerifyInstruction`, `verifyEd25519` |
| Instruction builders | `initializeIx`, `setConfigIx`, `initVaultIx`, `tipSolIx`, `tipTokenIx`, `bindIx`, `finalizeRebindIx`, `cancelRebindIx`, `claimSolIx`, `claimTokenIx`, `refundTipIx`, `refundTipTokenIx`, `refundIxForTip`, `closeTipIx`, `declineIx`, `createAtaIdempotentIx`; generic `buildInstruction(name, accounts, args)` |
| Attestations | `createAttestation`, `verifyAttestation`, `attestationToInstructions` → `[Ed25519SigVerify, bind]`, `bindInstructionsFromAttestation`, `claimProof(wallet)` → `anyfee:<wallet>` |
| Flows (read chain, return instructions) | `tipSolInstructions`, `tipTokenInstructions`, `bindInstructions` (`[init_vault?, ed25519, bind]`), `claimAllInstructions` (`claim_sol` + ATA + `claim_token`) |
| Accounts | `decodeConfig`, `decodeVault`, `decodeTip`, `identifyAccount`, `fetchConfig`, `fetchVault`, `fetchTip`, `fetchVaultState` |
| Events and errors | `parseEventsFromLogs(logs)`, `decodeEvent`, `describeProgramError(err)` → `{ code, name, msg }`, `PROGRAM_ERRORS` |
| Targets | `parseTarget(input)`: `github.com/owner/repo`, `owner/repo`, `git@github.com:o/r.git`, `github.com/user`, `github.com/orgs/x`, `@handle`, `x.com/handle[/status/id]`, a Solana address, or `github-repo:<id>` / `github-user:<id>` / `x:<id>` |
| Resolvers | `resolveGithubRepo`, `resolveGithubRepoById`, `resolveGithubUser`, `resolveGithubUserById` (GitHub REST, optional token); `fxTwitterResolver()` (default), `xApiResolver({ bearerToken })`, `defaultXResolver()`, `parseTweetUrl`; `resolveIdentity(input)` (includes honest warnings for org accounts, archived repos, forks) |
| Testing | `@anyfee/sdk/testing`: `memoryChain()`, `tokenAccountData()`, `rentExemptMinimum()` |

## Attester (`attester/`)

The attester verifies ownership proofs and signs `M`. It can bind a vault, and it can never
withdraw. The handlers are runtime-agnostic, `(Request) => Promise<Response>`
(`createHandler({ config })`), and two adapters wrap them:
- a local Node server: `npm run dev -w @anyfee/attester` on `http://127.0.0.1:8787`;
- a Netlify Functions v2 adapter: `attester/netlify/functions/api.ts` on `/api/*`, with base
  directory `attester/`.

Environment variables. They are read only from the environment, and are never logged or
committed:

| Variable | Meaning |
|---|---|
| `ATTESTER_SECRET_KEY` | Signing key: base58 (64-byte keypair or 32-byte seed) or a JSON byte array. Without it the attester runs resolve-only, and the attest endpoints answer 503 |
| `ATTESTER_SECRET_KEY_FILE` | **Local Node server only.** An explicit path to a keypair file, e.g. `ATTESTER_SECRET_KEY_FILE=../keys/attester-devnet.json npm run dev` |
| `ATTESTER_PUBKEY` | Optional sanity check. Startup fails if the key does not match |
| `RPC_URL` | Solana RPC (default: devnet public RPC). Only the host is ever printed |
| `GITHUB_TOKEN` | Optional. Raises GitHub rate limits, and is needed for private repositories |
| `X_BEARER_TOKEN` | Optional. Uses the official X API v2 instead of `api.fxtwitter.com` |
| `ATTESTER_SUBMIT=1` | Also send `[init_vault?, ed25519, bind]` as fee payer. Refuses mainnet (by genesis hash) |
| `FEE_PAYER_SECRET_KEY` | Optional separate fee payer for submit mode (default: the attester key) |
| `ATTESTATION_TTL_SECS` (900), `X_MAX_POST_AGE_SECS` (86400), `OIDC_CLOCK_SKEW_SECS` (60), `CORS_ORIGIN` (`*`), `PROGRAM_ID`, `USDC_MINT`, `PORT`, `HOST` | Tuning |

### Endpoints

`GET /api/health` returns `{ ok, attester, submit, programId, rpcHost, xResolver, … }`.

`GET /api/resolve?q=github.com/octocat/Hello-World` returns:

```json
{
  "query": "github.com/octocat/Hello-World",
  "platform": 2, "platformName": "github-repo", "id": "1296269",
  "display": "octocat/Hello-World", "url": "https://github.com/octocat/Hello-World",
  "github": { "owner": { "id": "583231", "login": "octocat", "type": "User" }, "defaultBranch": "master" },
  "vault": "4X1UzRBiXYeEDwkSMh6DUCzE7b88dR8aXtWxzxrgahmY",
  "vaultTokenAccount": "GYrqMrMi9BSGuEyvjpvvU7V4BEqgcGuLKaeXr43zv7L7",
  "initialized": false,
  "balances": { "lamports": "0", "rentExemptLamports": "1437640", "claimableLamports": "0",
                "usdc": { "mint": "4zMMC9…ncDU", "amount": "0", "claimable": "0", "decimals": 6 } },
  "claimant": null, "boundAt": null, "declined": false,
  "pending": null,
  "tips": { "count": "0", "claimEpoch": "0", "outstandingLamports": "0", "outstandingTokens": "0" },
  "config": null,
  "warnings": []
}
```

- `q` accepts everything `parseTarget` does.
- `pending` is `{ claimant, effectiveAt }` while a rebind is waiting.
- Amounts are decimal strings.
- If the RPC fails, the identity is still returned, with `chainError`.
- Errors look like `{ "error": { "code", "message" } }`: `400 bad_target`, `404 not_found`,
  `429`/`502` upstream.

`POST /api/attest/github` with `{ "oidcToken": "<GitHub Actions ID token, aud = anyfee:<wallet>>", "claim": "both" }`
(`claim`: `repo` | `user` | `both`) returns:

```json
{
  "claimant": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  "repository": { "id": "1296269", "fullName": "octocat/Hello-World", "defaultBranch": "master",
                  "owner": { "id": "583231", "login": "octocat", "type": "User" } },
  "run": { "event": "workflow_dispatch", "ref": "refs/heads/master", "actor": "octocat", "actorId": "583231", "sha": "…", "workflowRef": "…", "runId": "…" },
  "userClaim": { "allowed": true },
  "attestations": [
    { "platform": 2, "id": "1296269", "claimant": "9WzD…AWWM", "expiresAt": 1790500900,
      "message": "<base64, 95 bytes>", "signature": "<base64, 64 bytes>",
      "attester": "FJpnX2EKfLMyFitghtSjZuoisNxP6ZgkNCQi2LgfiiLY", "vault": "4X1U…ahmY" },
    { "platform": 1, "id": "583231", "…": "…" }
  ],
  "submitted": [ { "platform": 2, "id": "1296269", "status": "sent", "signature": "5x…" } ]
}
```

- `submitted` appears only with `ATTESTER_SUBMIT=1`. Its `status` is one of `sent`,
  `already_bound`, `rebind_already_pending` or `failed`, plus an `error` field.
- Rejections are `401` (`bad_signature`, `unknown_kid`, `expired`, `not_yet_valid`,
  `bad_issuer`, `bad_audience`, `unsupported_alg`) or `403` (`bad_event`, `not_default_branch`,
  `owner_mismatch`, `repo_not_visible`, `user_claim_not_allowed`).

`POST /api/attest/x` with `{ "tweetUrl": "https://x.com/jack/status/20", "claimant": "<wallet>" }`
returns `{ claimant, post: { id, url, authorId, authorHandle, createdAt }, attestations: [ { "platform": 3, "id": "<author id>", … } ], submitted? }`.
Rejections are `403` (`proof_missing`, `proof_mismatch`, `proof_ambiguous`, `post_too_old`,
`post_in_future`) and `404 post_not_found`.

See [`docs/CLAIMING.md`](docs/CLAIMING.md) for the user-facing flow and the trust model.

## GitHub Action (`action/`)

`action/action.yml` is a JavaScript action on `node24`, with no dependencies and no build step.
- Inputs: `claimant` (required), `attester-url` (required), `claim` (`both` by default).
- The job needs `permissions: id-token: write`.
- It mints an OIDC token with audience `anyfee:<claimant>`, masks it, and posts it to
  `<attester-url>/api/attest/github`.
- It prints the attestations and any bind transaction links, and writes a job-summary table.
- Outputs: `claimant`, `attestations` (JSON), `signatures`.

The example workflow is in [`docs/CLAIMING.md`](docs/CLAIMING.md).

`.github/workflows/oidc-selftest.yml` runs when this repository is on GitHub, on
`workflow_dispatch` and on pushes to `main`. It:
- mints **real** OIDC tokens and verifies them with the attester's verifier, against GitHub's
  live JWKS and REST API;
- checks negative controls: tampered signature, wrong audience, and a payload edited after
  signing;
- runs the action end to end against a local attester that signs with a throwaway key.

No secret is needed, and nothing touches Solana.

## JavaScript workspace

```sh
npm install
npm test            # sdk + attester + action, offline (recorded fixtures, mock JWKS, in-memory chain)
npm run typecheck   # tsc 7 over sdk, attester (sources, tests, scripts)
npm run dev         # attester on http://127.0.0.1:8787 (resolve-only unless a key is configured)
npm run localnet-e2e -w @anyfee/attester   # opt-in: SDK + attester against the real .so on a throwaway solana-test-validator (ports 18899/19900)
```

- Node 22.18 or newer is required, because it runs `.ts` files natively.
- `npm run sync-idl -w @anyfee/sdk` re-syncs the SDK after the program's IDL changes.
- Test fixtures under `sdk/test/fixtures` are recorded responses from `api.github.com` and
  `api.fxtwitter.com`.
