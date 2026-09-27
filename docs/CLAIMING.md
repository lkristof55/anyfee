# Claiming an anyfee vault

Every GitHub repository, GitHub user and X account has one anyfee vault on Solana. The vault's
address is derived from the account's permanent numeric id, not from its name. People can send
tips to it, and pump.fun or Bags creator fees can be routed to it, before its owner has ever
heard of anyfee.

Claiming binds the vault to a Solana wallet (the *claimant*). From then on only that wallet can
withdraw. You prove control of the account to the **attester**. The attester is a service that
signs a short-lived statement: "vault X may be bound to wallet W". The program checks that
signature on-chain.

> v0.1 runs on **devnet only**, with no real funds. Unclaimed direct tips go back to their
> senders after the refund window (30 days by default). Fees routed from pump.fun or Bags have
> no single sender, so they stay in the vault until someone claims it.

| Account | How you prove control | Vault id |
|---|---|---|
| GitHub repository | Run a workflow on the default branch that sends a GitHub OIDC token with audience `anyfee:<wallet>` | `repository_id` |
| GitHub user | The same workflow, run by you, in a repository your personal account owns | your numeric user id |
| X account | A public post that contains `anyfee:<wallet>` | your numeric X user id |

Handles and repository names can change, and the vault does not move when they do. A renamed
repository keeps its vault. So does an X account after a handle change.

---

## 1. GitHub repository (and your GitHub account)

### Add the workflow

Commit this file to the repository's **default branch** as
`.github/workflows/anyfee-claim.yml`:

```yaml
name: anyfee claim

on:
  workflow_dispatch:
    inputs:
      claimant:
        description: Solana wallet (base58) that will be able to claim this repository's vault
        required: true
      claim:
        description: "What to bind: repo, user (your GitHub account, personal repos only) or both"
        required: false
        default: both

permissions:
  id-token: write   # lets the job request an OIDC token; nothing else is needed
  contents: read

jobs:
  claim:
    runs-on: ubuntu-latest
    steps:
      - uses: OWNER/anyfee/action@v0.1.0   # replace with the published action location
        with:
          claimant: ${{ inputs.claimant }}
          attester-url: https://app.anyfee.workers.dev   # the anyfee attester (devnet); or your own
          claim: ${{ inputs.claim }}
```

Then open the **Actions** tab, choose **anyfee claim**, select **Run workflow**, keep the default
branch, and paste your wallet address.

To run the claim on every push instead, use `on: push` with `branches: [main]` (your default
branch), and put the wallet in `with: claimant:` directly. Your wallet address is public anyway.

### What the action does

1. It requests an OIDC ID token from GitHub with the audience `anyfee:<your wallet>`. GitHub
   signs the token and puts facts about the run in it: repository id, owner id, branch, event
   and actor.
2. It sends the token to the attester (`POST /api/attest/github`). No other secret leaves the
   runner. The token is short-lived (minutes) and is useless for anything but this audience. The
   action masks it in the logs.
3. The attester verifies the token and answers with signed attestations. It also returns the
   bind transaction signatures when it submits the transaction itself.

### What the attester checks

| Check | Why |
|---|---|
| RS256 signature against GitHub's JWKS (`token.actions.githubusercontent.com`); issuer matches exactly; token not expired (60 s clock skew) | The token was really minted by GitHub Actions |
| `aud` is exactly `anyfee:<wallet>` | The token was minted for *this* claim and wallet, so it cannot be replayed for another wallet |
| `event_name` is `workflow_dispatch` or `push` | Pull requests (including `pull_request_target`) and other triggers cannot claim |
| `ref` is `refs/heads/<default branch>`, with the default branch read from the GitHub API | A feature branch or tag cannot claim; only whoever can run workflows on the default branch can |
| The repository's current owner id equals the token's `repository_owner_id` | No forks and no stale tokens across a transfer |
| **User vault only:** `actor_id == repository_owner_id`, and the owner is a *User* | The account owner personally ran the workflow in their own repository |

The trust model for repositories: **whoever can run workflows on the default branch controls
the repository's vault.** Drips uses the same model with `FUNDING.json`. In practice this means
anyone with write access to the repository. Section 4 covers how the rebind delay protects an
already-bound vault.

### Limits

- **Organization accounts** cannot claim a *GitHub-user* vault. Only personal accounts can.
  Organizations are paid through their repositories: the repository vault works fine for
  org-owned repositories. The site warns senders about this.
- **Private repositories** work only if the attester's own `GITHUB_TOKEN` can read them. The
  public attester cannot, so it answers `repo_not_visible`.
- **Archived repositories** cannot run workflows. Unarchive, claim, then archive again.
- **Forks** have their own vault. A workflow in your fork claims the fork, not the upstream
  project.
- **Collaborators** can claim the repository vault, but not the owner's user vault (the
  `actor_id` check).

---

## 2. X account

1. Post a **public** post whose text contains exactly `anyfee:<your wallet>`, for example
   `Claiming my anyfee vault anyfee:9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM`.
2. Paste the post's URL into the claim page, or call the attester yourself:
   ```sh
   curl -s https://app.anyfee.workers.dev/api/attest/x \
     -H 'content-type: application/json' \
     -d '{"tweetUrl":"https://x.com/you/status/1234567890","claimant":"<your wallet>"}'
   ```
3. The attester fetches the post through its X resolver (the public `api.fxtwitter.com`, or the
   official X API when the attester has a bearer token). It then checks that:
   - the text has exactly one `anyfee:<wallet>` token, and it names the wallet you asked for;
   - the post is at most 24 hours old.

   It binds to the **author's numeric id**, as reported by X. The handle in the URL you paste is
   ignored.

Protected accounts do not work, because the post must be publicly readable. You can delete the
post after the bind is confirmed.

---

## 3. Submitting the bind

An attestation is valid for **15 minutes**. It turns into one transaction:

```
[ init_vault (only if the vault account does not exist yet),
  Ed25519SigVerify(attester, M, signature),
  bind(platform, id, claimant, expires_at) ]
```

`bind` checks that the instruction immediately before it verifies the attester's signature over
the exact 95-byte message `M`. **Anyone** may submit this transaction and pay its fee. It does
not have to be the claimant.

- If the attester runs with `ATTESTER_SUBMIT=1`, it submits the transaction itself as fee payer.
  The action then prints explorer links, and you are done.
- Otherwise, submit it from the anyfee site, or with the SDK:

```ts
import { Connection, Transaction } from "@solana/web3.js";
import { bindInstructions, DEVNET_ATTESTER } from "@anyfee/sdk";

const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const ixs = await bindInstructions(conn, attestation, { payer: wallet.publicKey, expectedAttester: DEVNET_ATTESTER });
const tx = new Transaction().add(...ixs); // sign with any fee payer and send
```

---

## 4. What the maintainer sees

In the action log (and as a table in the job summary):

```
Requested an OIDC token for audience anyfee:9WzD…AWWM; sending it to https://app.anyfee.workers.dev
anyfee: attester verified octocat/Hello-World for wallet 9WzD…AWWM
  - GitHub repository #1296269 -> vault 4X1U…ahmY (attestation expires 2026-09-27T10:15:00.000Z)
  - GitHub user #583231 -> vault 8ZR2…n3My (attestation expires 2026-09-27T10:15:00.000Z)
  - bind GitHub repository #1296269: sent https://explorer.solana.com/tx/5x…?cluster=devnet
  If this vault was already bound, the change takes effect after the rebind delay and the current claimant can cancel it.
```

A failed check fails the job with a readable reason, for example
`attester rejected the claim [not_default_branch]: the claim must run on the default branch (main), not refs/heads/dev`.

On the vault page (`GET /api/resolve?q=github.com/owner/repo`):
- `claimant` is set once the bind lands.
- `pending` shows a requested rebind and when it takes effect.
- `declined` is shown if you declined.
- `balances` shows what you can claim.

## 5. After binding

- **Claim** SOL and USDC at any time, to any destination (`claim_sol`, `claim_token`; the SDK's
  `claimAllInstructions` builds both). Claiming is allowed even while a rebind is pending.
- **Decline**: you do not want tips. New direct tips are then rejected, and outstanding tips
  can be refunded to their senders at once. Routed fees stay claimable.
- **Cancel a rebind** (`cancel_rebind`). Do this if you see a pending change of claimant you did
  not ask for.

---

## Trust model

- **The attester can bind, never withdraw.** Its only power is to sign `M`, which lets `bind` set
  or propose a claimant. Moving funds always needs the claimant's own signature, and the program
  has no admin or attester withdrawal path.
- **Bound vaults are protected by the rebind delay.** A second bind does not replace the
  claimant. It creates a *pending* rebind that takes effect after `rebind_delay_secs` (48 h by
  default, and never below 1 day). During that time the current claimant sees the
  `RebindRequested` event and the pending entry on the vault page. The claimant should do both
  of these:
  - **claim first**, to take everything out;
  - **then cancel** with `cancel_rebind`.
- **Unbound vaults trust the attester.** Before the first bind, whoever controls the attester
  key could bind a vault to any wallet. The real account owner reduces that window by claiming
  early. See `docs/THREAT-MODEL.md` §3 for the full analysis and mitigations: pause, attester
  rotation, short expiries.
- **Replays are harmless.** Every attestation expires, and a GitHub token is bound to one
  wallet by its audience. Re-binding the current claimant fails on-chain with `AlreadyClaimant`.
- **No secrets are shared.** The workflow needs only `id-token: write`. The attester never sees
  a GitHub token or password, and it logs repository ids, not tokens.
- The admin can pause the program and rotate the attester. The admin can never move vault funds.
