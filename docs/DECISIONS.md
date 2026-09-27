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
