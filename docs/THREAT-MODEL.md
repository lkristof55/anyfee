# anyfee threat model (program v0.1, devnet)

Scope: the on-chain program `programs/anyfee` (id `BixfaA4JmPvntZvGZwnqhHdoUQvEzZY6ZBMXCLgF3C9M`).
The attester service, SDK and GitHub Action have their own concerns. They appear here only
where they touch the program's trust boundary. The contract is `docs/SPEC.md`, and the program's
deviations and clarifications are in `docs/DECISIONS.md`.

## 1. Assets, actors, invariants

**Assets**
- lamports held by a vault PDA above its rent-exempt minimum
- `config.usdc_mint` tokens in the vault's associated token account (ATA)
- tip receipts: who may get a direct tip back, and their rent

**Actors**
- sender: signs `tip_*`
- claimant: the wallet bound to a vault
- attester: an ed25519 key. Its signature over `M` authorises `bind`
- admin: `config.admin`
- upgrade authority: can replace the program. On devnet this is the deployer
- cranker: anyone who submits the permissionless instructions (`init_vault`, `bind`,
  `finalize_rebind`, `refund_tip*`, `close_tip`)
- the rest of the world: can send lamports or tokens to any address

**Invariants the program maintains**, all enforced with checked arithmetic:
1. `vault.lamports >= rent_min(vault) + outstanding_tip_lamports`
2. `vault_ata.amount >= outstanding_tip_tokens`
3. Only these instructions move value out of a vault:
   - `claim_sol` and `claim_token`: signed by `vault.claimant`, to a destination the claimant
     chooses
   - `refund_tip` and `refund_tip_token`: always to `tip.sender`, under the refund rules
4. A tip can settle only one way. It is refunded (receipt closed) or consumed by a claim
   (`tip.epoch < vault.claim_epoch`). Never both, never twice.
5. `claim_*` never takes the vault's rent. The vault account is never closed.

## 2. Who can do what

| Role | Can | Cannot |
|---|---|---|
| Sender | tip, get refunds under the rules | redirect a refund, claim, block claims |
| Claimant | claim everything claimable, to any destination; cancel a pending rebind; decline | take reserved outstanding tips of a declined vault; take the vault's rent |
| Attester | **bind an unbound vault immediately** to any wallet; request a rebind of a bound vault (effective after `rebind_delay_secs`) | move funds directly; skip the rebind delay; cancel a claimant's cancel |
| Admin | rotate the attester; set the refund window (1 day to 365 days) and rebind delay (1 day to 30 days); pause; hand over admin | move vault funds; change `usdc_mint`; re-initialize; block claims, refunds, `cancel_rebind` or `decline`; speed up an already pending rebind |
| Upgrade authority | replace the program code (**unlimited power**); initialize once | none on-chain. Governance is off-chain |
| Cranker | init vaults, submit binds (needs a valid attestation), finalize due rebinds, crank refunds and receipt closes | choose where the money goes |

**Admin ⇒ attester.** The admin can set the attester to a key it controls, so a malicious or
compromised admin has every power of a compromised attester (section 3). The spec says
"no admin or attester can ever move funds to itself". **That holds only for bound vaults.**
For unbound vaults, anyone who controls the attester key can bind the vault to themselves and
claim. That includes routed fees and tips that have not been refunded yet. This is the central
trust assumption of v0.1. It must be stated plainly to users and operators.

## 3. Attester compromise

**Unbound vaults are at risk.** An attacker who holds the attester key signs `M` for their own
wallet, binds immediately, and claims. It works on any vault, even one never initialized:
`init_vault` is permissionless and works on pre-funded addresses. Once a vault is bound, its
direct tips are no longer refundable (the vault is bound and not declined).

**Bound vaults are protected by the rebind delay.** The attacker can only create
`pending_claimant = attacker` with `pending_effective_at = now + rebind_delay_secs`. The program
enforces a minimum delay of 24 h. The default is 48 h. The admin cannot shorten a delay that is
already pending, because the delay is snapshotted into `pending_effective_at`. During the delay:
- The real claimant sees `RebindRequested` (event, and `vault.pending_claimant`). They can
  `claim_sol` / `claim_token` (allowed while a rebind is pending) and `cancel_rebind`.
- The attacker can re-request with a fresh signature. The pending entry is overwritten and the
  timer restarts, so they must wait the full delay again. The claimant cancels again.
- Anything that reaches the vault after the claimant's last claim is at risk until the attester
  is rotated.

**Response playbook**
1. Admin `set_config(paused = true)`. This blocks `bind` and `finalize_rebind` (and tips), so
   no pending rebind can complete. Claims, cancels, declines and refunds keep working.
2. Admin rotates `attester`.
3. Claimants `cancel_rebind`. There is no admin cancel: a pending entry created by the old key
   stays until its claimant cancels it, or it is finalized after unpause.
4. Unpause.

**Hardening for v0.2** (not in the v0.1 program):
- threshold attestation: k of n attester keys, each as its own Ed25519 instruction
- a first-bind delay with a guardian veto
- a timelock on attester rotation
- recording which attester requested a pending rebind, so rotation invalidates it
- the attester key in an HSM or KMS
- short expiries (the attester's default is 15 min)
- public monitoring of `Bound` and `RebindRequested`

**Cross-cluster replay.** `M` binds the program id, which is the same keypair on devnet and
mainnet. The cluster is not part of `M`. If one attester key signed for both clusters, an
attestation could be replayed on the other cluster until it expires. **Rule: never reuse an
attester key across clusters.** The devnet key is devnet-only.

**Replay inside a cluster.** There is no nonce. The replay window is bounded by `expires_at`
(`now < expires_at`, strict).
- Replaying a bind for the current claimant fails with `AlreadyClaimant`.
- Replaying a rebind request for the same pending claimant only restarts the timer, and only
  until the attestation expires.

## 4. Rebind race

- `finalize_rebind` is permissionless once `now >= pending_effective_at`, and blocked while paused.
- The claimant should do both: **claim first, then cancel**. Claiming alone does not stop the
  rebind. Cancelling alone leaves funds exposed to the next request.
- A newer valid attestation overwrites a pending rebind. A legitimate new owner, for example
  after a GitHub repo transfer (`repository_id` is stable across transfers), therefore needs
  the old claimant not to cancel. If the old claimant keeps cancelling, the new owner needs
  off-chain resolution. This is intended: bound vaults favour the incumbent.
- The attester side decides what "control" means. For a repo, that is being able to run a
  workflow on the default branch. Its bugs (fork detection, `actor_id` checks, default-branch
  lookup) are attester bugs with the same impact as key compromise on unbound vaults. See the
  attester docs.

## 5. Ed25519 instruction introspection

`bind` does not verify signatures. It proves that the runtime already verified *our*
statement. `programs/anyfee/src/attestation.rs` checks all of the following:

| Pitfall | Check |
|---|---|
| No signature verification in the tx, or it sits elsewhere in the tx | The instruction at `current_index - 1` must exist and have `program_id == Ed25519SigVerify111…`. `bind` at index 0 fails. A verify ix placed two instructions earlier, or after `bind`, fails with `MissingEd25519Instruction`. |
| Offsets pointing into **another** instruction: the precompile verifies bytes elsewhere, while naive code reads attester-looking bytes from its own data | `signature_instruction_index`, `public_key_instruction_index` and `message_instruction_index` must all be `u16::MAX` ("this instruction"). Tests cover each index pointing elsewhere, including a real attack layout that passes the precompile. |
| Several signatures in one instruction, where the program might read the wrong one | `num_signatures == 1` |
| Out-of-bounds or overlapping offsets | Every region is bounds-checked with `get(..)` before comparing. |
| Wrong signer | The pubkey bytes at `public_key_offset` must equal `config.attester` (`WrongAttester`). |
| Wrong statement | The message must be exactly 95 bytes and byte-equal to `M(program_id, platform, id, claimant, expires_at)`, rebuilt on-chain from the instruction args and `crate::ID` (`BadAttestation`). The domain `anyfee:bind:v1` and the program id separate it from other uses of the key. |
| Spoofed instructions sysvar | The account is constrained to `Sysvar1nstructions1111…`. |
| Invocation through CPI | The instructions sysvar only lists top-level instructions, so a CPI'd `bind` checks the instruction before the outer instruction. That instruction still has to be a genuine attester signature over this exact `M`, so the result is equally sound. |
| Signature malleability | Irrelevant: pubkey and message are compared, and the signature bytes are not used as an identifier. |

The precompile runs as part of the transaction. If any signature is invalid, the whole
transaction fails before `bind` can succeed.

## 6. Pre-funded PDA griefing

- Anyone can send lamports to the vault, tip or config PDAs. Nobody can allocate or assign them,
  because that needs the program's PDA signature. Anchor's `init` handles a non-zero balance:
  it tops up to rent exemption, then allocates and assigns. Initialization therefore cannot be
  blocked. This is tested for a vault above rent, a vault below rent, and a pre-funded tip
  address.
- Lamports sent to a vault before or after init are routed fees by design. The claimant can
  claim them, and nobody can refund them.
- Lamports sent to a *future* tip PDA end up with that tip's sender when the receipt is closed:
  a gift to the sender, harmless.
- Tokens can reach the vault's ATA before `init_vault`. They are claimable later.
- **Funds that are stuck forever** (the SDK and UI must prevent these):
  - lamports sent to vault PDAs of unknown platforms. `init_vault` rejects platforms outside
    {1, 2, 3}.
  - tokens of any mint other than `config.usdc_mint`
  - `usdc_mint` tokens in a vault-owned token account that is not the canonical ATA
- `init_vault` is permissionless. A griefer who initializes someone's vault only pays that
  vault's rent for them.

## 7. Rent

- Rent-exempt minimums: Vault is 155 bytes (0.00196968 SOL), paid by whoever calls
  `init_vault`. Tip is 130 bytes (0.00179568 SOL), paid by the sender. Config is 122 bytes,
  paid by the admin.
- The vault's rent stays in the vault forever. `claim_sol` sends `lamports - rent_min(len)`,
  computed from the Rent sysvar.
- Tip rent goes back to the sender: `refund_tip*` closes the receipt, and `close_tip` closes
  receipts consumed by a claim. Both are permissionless and always pay `tip.sender`.
- For tiny tips, the receipt rent can exceed the tip. The SDK should enforce a sensible minimum.
- A claim or refund to an empty system account must leave it rent-exempt (at least 890,880
  lamports). Otherwise the runtime rejects the transaction.

## 8. Token accounts and closing

- The vault ATA's owner is the vault PDA. The program never closes it, approves a delegate or
  changes its authority, so it cannot be closed or drained.
- `claim_token` and `refund_tip_token` use `transfer_checked`. Only the classic SPL Token
  program is accepted (`Program<Token>`), and the mint must equal `config.usdc_mint`, which is
  immutable. Token-2022 mints (transfer fees, hooks, permanent delegates) are out of scope.
  They would break the `outstanding_tip_tokens` accounting.
- **The sender closes their ATA before a refund.** `refund_tip_token` pays the sender's
  *associated* token account, so a cranker prepends ATA `create_idempotent` in the same
  transaction (tested). A refund cannot be redirected to another owner's account.
- **Freezes.** If the USDC freeze authority freezes the vault ATA or the sender's ATA, token
  claims or refunds fail. Reserved amounts stay reserved. This is outside the program's
  control.
- Tip receipts close only through `refund_tip`, `refund_tip_token` or `close_tip`, and their
  rent always goes to `tip.sender`.

## 9. Refund griefing and tip accounting

- Refunds are permissionless: whoever cranks pays only the fee. The destination is fixed to
  `tip.sender` (`has_one = sender`), with the sender's ATA for tokens.
- A refund is allowed only when all of these hold:
  - `!refunded`
  - `tip.epoch == vault.claim_epoch`
  - the vault is declined, or the vault is unbound and `now >= created_at + refund_window_secs`

  No one can refund early, refund twice (the receipt is closed), or refund a tip a claim has
  already consumed.
- Race between refund and bind: a tip that becomes refundable can be refunded right up to the
  moment the vault is bound. Once the vault is bound (and not declined), it can no longer be
  refunded. This is by design and matches the spec.
- The refund window is global and *not* snapshotted per tip. The admin can move it within
  [1 day, 365 days], which accelerates or delays refunds of outstanding unbound tips. The admin
  cannot redirect them.
- **Epochs.** A claim that is not made while declined, and that finds live tips
  (`outstanding_* > 0`), bumps `claim_epoch` and zeroes *both* outstanding counters. SOL and
  token tips share the epoch. The consumed tips' funds stay in the vault for the claimant.
  Without resetting both counters, a later `decline` would reserve token tips that could never
  be refunded. See D5 in DECISIONS.
- **Tip spam.** Each tip costs the spammer a receipt's rent plus fees, all refundable to them
  under the rules. Claims never iterate over tips, so spam cannot block or slow a claim.
- **Tip index collisions.** Two senders who build a tip for the same `tip_count` in the same
  slot collide: the second fails the PDA seed check. The client retries with a fresh
  `tip_count`.
- **Declined vaults.** Declining is permanent in v0.1. New tips are rejected. Outstanding tips
  stay reserved (claims keep them back) until someone cranks their refunds. Raw inflows stay
  claimable.

## 10. Pause

| Instruction | Paused? |
|---|---|
| `tip_sol`, `tip_token`, `bind`, `finalize_rebind` | **blocked** |
| `claim_sol`, `claim_token`, `refund_tip`, `refund_tip_token`, `cancel_rebind`, `decline`, `init_vault`, `close_tip`, `set_config` | never blocked |

The admin cannot freeze anyone's money. Pause is a brake for attester incidents.

## 11. Upgrade authority and initialization

- `initialize` requires the signer to be the program's upgrade authority. It reads
  ProgramData's `upgrade_authority_address`. This blocks front-running between deploy and
  initialize. `initialize` runs once, because the config PDA `init` fails on a second call.
- The upgrade authority can replace the program and therefore take everything. For devnet it
  is the deployer key. **Before any mainnet use**: a multisig upgrade authority with a timelock,
  or a frozen, verifiable build (`anchor build --verifiable`), plus a legal review (see SPEC).

## 12. Known limitations (v0.1)

- A single attester. Unbound vaults trust it fully (section 3).
- There is no un-decline. A declined vault that is rebound stays declined.
- Only SOL and `config.usdc_mint` via the canonical ATA. Other assets sent to a vault are stuck.
- Events are `emit!` log events, which the runtime can truncate on very long logs. Indexers
  should fall back to reading account state.
- No on-chain nonce: replay is bounded by attestation expiry only.
