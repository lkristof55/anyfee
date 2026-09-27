# anyfee — spec v0.1 (MVP, devnet)

Working name `anyfee` (rename later is a search-and-replace). One address for anyone: send SOL/USDC tips — or route pump.fun / Bags creator fees — to a **GitHub repo**, a **GitHub user** or an **X account**, keyed to the account's permanent numeric id. The person claims later by proving control; unclaimed direct tips go back to the sender. Non-custodial: no admin or attester can ever move funds to itself.

Research behind this: pump.fun pays GitHub *users* only (orgs lose fees, one pump.fun key co-signs every claim, 90% of 11,492 recipients never claimed, 17.5k SOL waiting); UsePaid pays X handles via X Money from its own float (no X Money API exists; X Money bans crypto use); Drips pays repos but only on EVM. Nobody on Solana pays repos, and nobody uses GitHub Actions OIDC as the ownership proof.

## Layout (monorepo at /Users/kristof2507/Desktop/files/anyfee, git repo, identity already set to lkristof55 noreply — never change git config)

```
Anchor.toml  Cargo.toml (workspace)  package.json (npm workspaces)
programs/anyfee/      Anchor program (Rust)                  — owner: program agent
tests/program/        program tests (LiteSVM or Mollusk in Rust, and/or TS against solana-test-validator)
sdk/                  @anyfee/sdk (TypeScript, ESM)          — owner: sdk/attester agent
attester/             attester service (TypeScript, runtime-agnostic handlers + a local HTTP server)
action/               GitHub Action: mint an OIDC token for the claimant, post it to the attester
app/                  website (send / claim / vault pages)   — owner: site agent (later)
docs/                 SPEC.md (this file), THREAT-MODEL.md, CLAIMING.md
keys/                 gitignored: program-keypair.json, attester-devnet.json, devnet-deployer.json, bind-vector.txt
```

Program id (keys/program-keypair.json): **BixfaA4JmPvntZvGZwnqhHdoUQvEzZY6ZBMXCLgF3C9M**
Devnet attester pubkey (keys/attester-devnet.json): **FJpnX2EKfLMyFitghtSjZuoisNxP6ZgkNCQi2LgfiiLY**
Devnet deployer (keys/devnet-deployer.json): B1ACyn4AnSqigkJTEz6qw1sZQjHMsjg5aPbX7BFhXFnP (currently 0 SOL; devnet faucet is rate-limited — develop and test on a local validator / LiteSVM; the orchestrator handles devnet deploy).

## Identities

| platform (u8) | meaning | id (u64) |
|---|---|---|
| 1 | GitHub user | numeric GitHub user id (`GET /users/{login}` → `id`) |
| 2 | GitHub repo | numeric `repository_id` (`GET /repos/{o}/{r}` → `id`) |
| 3 | X account | numeric X user id |

Reserved: 4 Farcaster fid, 5 email (future hashed platforms use a different seed prefix `vault_h` + 32-byte hash — not in v0.1). Never key anything on a login/handle string.

## Accounts (Anchor, all PDAs of the program)

**Config** — seeds `["config"]`
`admin: Pubkey, attester: Pubkey, usdc_mint: Pubkey, refund_window_secs: i64 (default 2_592_000 = 30 d), rebind_delay_secs: i64 (default 172_800 = 48 h), paused: bool, bump: u8`

**Vault** — seeds `["vault", [platform], id.to_le_bytes()]`
```
platform: u8, id: u64,
claimant: Pubkey            // Pubkey::default() = unbound
pending_claimant: Pubkey    // default = none
pending_effective_at: i64
bound_at: i64, created_at: i64,
declined: bool,
claim_epoch: u64,           // +1 on every claim that consumes tips
tip_count: u64,
outstanding_tip_lamports: u64, outstanding_tip_tokens: u64,   // receipted, not yet refunded or consumed in this epoch
total_claimed_lamports: u64, total_claimed_tokens: u64,
bump: u8
```
The vault address is deterministic and can receive lamports (and, via its ATA, tokens) **before it is initialized** — e.g. as a pump.fun `SharingConfig` shareholder or a Bags fee earner. `init_vault` must succeed on a pre-funded address (test this explicitly). Token balance lives in the vault's associated token account for `config.usdc_mint` (owner = vault PDA, off-curve).

**Tip** — seeds `["tip", vault, tip_index.to_le_bytes()]`
`vault: Pubkey, sender: Pubkey, mint: Pubkey (default = SOL), amount: u64, created_at: i64, epoch: u64, refunded: bool, bump: u8`

## Instructions

1. `initialize(attester, usdc_mint, refund_window_secs, rebind_delay_secs)` — signer becomes admin; once.
2. `set_config(...)` — admin only: attester, refund window, rebind delay, paused, new admin. **Admin can never move vault funds.**
3. `init_vault(platform, id)` — permissionless, payer funds rent; works on pre-funded addresses. Rejects unknown platforms.
4. `tip_sol(platform, id, amount)` — sender signs; vault must exist (or init-if-needed, your call — document it); rejects if `paused` or `declined`; creates Tip (index = tip_count, epoch = claim_epoch), transfers lamports sender → vault, `outstanding_tip_lamports += amount`. Emits `Tipped`.
5. `tip_token(platform, id, amount)` — same for `config.usdc_mint`: sender token account → vault ATA (create ATA if missing), `outstanding_tip_tokens += amount`.
6. `bind(platform, id, claimant, expires_at)` — anyone may submit; requires the **immediately preceding instruction** to be an Ed25519SigVerify instruction with exactly one signature, all offsets pointing inside that same instruction (instruction_index = u16::MAX), pubkey == `config.attester`, message == `M` below byte-for-byte; `clock.unix_timestamp < expires_at`. If the vault is unbound: `claimant` set now, `bound_at = now`. If bound: `pending_claimant = claimant`, `pending_effective_at = now + rebind_delay_secs`. Emits `Bound` / `RebindRequested`.
7. `finalize_rebind(platform, id)` — permissionless once `now >= pending_effective_at`.
8. `cancel_rebind(platform, id)` — current claimant signs; clears pending. (A compromised attester can never take funds: the real claimant sees the pending rebind, claims and/or cancels.)
9. `claim_sol(platform, id)` — current claimant signs, destination = any account the claimant passes. Sends `lamports - rent_exempt_min(vault)`; if `declined`, keeps `outstanding_tip_lamports` back. When it consumes tips (not declined): `claim_epoch += 1`, `outstanding_tip_lamports = 0`. Allowed while a rebind is pending. Emits `Claimed`.
10. `claim_token(platform, id)` — same for the vault ATA.
11. `refund_tip(platform, id, tip_index)` — **permissionless crank**, destination is always `tip.sender` (lamports or sender's token account for token tips). Allowed iff `!tip.refunded && tip.epoch == vault.claim_epoch` and (`vault is unbound && now >= tip.created_at + refund_window_secs` **or** `vault.declined`). Decrements outstanding, marks refunded, closes the Tip account with rent to `tip.sender`. Emits `Refunded`.
12. `decline(platform, id)` — current claimant signs; `declined = true`: new tips are rejected, outstanding tips become refundable immediately, raw inflows (fees) stay claimable.

Errors are explicit (`VaultDeclined`, `Paused`, `NotClaimant`, `BadAttestation`, `AttestationExpired`, `RebindNotReady`, `NothingToClaim`, `RefundNotYet`, `TipAlreadySettled`, `UnknownPlatform`, …). Checked arithmetic everywhere.

## Attestation message `M` (95 bytes, all little-endian)

```
b"anyfee:bind:v1"   14 bytes ASCII
program_id          32
platform            1
id                  8  (u64 LE)
claimant            32
expires_at          8  (i64 LE)
```
Test vector (also in keys/bind-vector.txt): program BixfaA4JmPvntZvGZwnqhHdoUQvEzZY6ZBMXCLgF3C9M, platform 2, id 1234567890, claimant 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM, expires_at 1790500000 →
`616e796665653a62696e643a76319f549f827029a8031facc0e17c7851c771515d8331a40e119925aa443d66514002d2029649000000007e8c088760bfde1dddcf32c17f209b8242ee52aaf131facd88d0ea2c6d0b06f2a0dcb86a00000000`
Both the Rust program and the TS SDK must have a unit test asserting this exact hex.

## How claims are proven (attester)

The attester is an ed25519 key that signs `M`. It can only bind a vault to a wallet; it can never withdraw. Its checks:

- **GitHub repo (platform 2)** — a GitHub Actions OIDC token (issuer `https://token.actions.githubusercontent.com`, RS256, GitHub JWKS, not expired) with `aud == "anyfee:" + claimant_base58`, `ref == "refs/heads/" + default_branch` (default branch via GitHub API), `event_name` ∈ {`workflow_dispatch`, `push`}, not from a fork (`repository_owner_id` of the repo = token's `repository_owner_id`). id = `repository_id`. Model = "whoever can run workflows on the default branch controls the repo's funds" (same trust model as Drips' FUNDING.json), protected after first binding by the rebind delay + `cancel_rebind`.
- **GitHub user (platform 1)** — same OIDC token, plus `actor_id == repository_owner_id` and the owner is a User (not an Organization): the account owner ran a workflow in a repo they own. id = `repository_owner_id`.
- **X (platform 3)** — the user posts a public tweet containing exactly `anyfee:<claimant_base58>`; the attester fetches the tweet through a pluggable resolver (default: public `api.fxtwitter.com`; official X API when `X_BEARER_TOKEN` is set), checks the text and takes the author's numeric id. Handle → id resolution for senders uses the same resolver.
- Attestations expire (default 15 min). Optional: the attester submits the `bind` transaction itself as fee payer (devnet), so a maintainer only has to run the workflow.

## Honesty / product rules

- Every vault page says clearly: unverified until claimed, not an endorsement, the recipient may decline; direct tips refund after 30 days if unclaimed; fee-routed funds (pump.fun/Bags) have no single sender and stay claimable.
- No ranked lists of unclaimed balances; no outreach that looks like "claim your funds" phishing.
- Devnet only until a legal review; no mainnet transactions, no real funds.
- Secrets only from env (`ATTESTER_SECRET_KEY`, `RPC_URL`, optional `GITHUB_TOKEN`, `X_BEARER_TOKEN`); keys/ is gitignored. Never print a secret.
