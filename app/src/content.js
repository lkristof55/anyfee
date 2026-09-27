// Static copy for the home, /how and /faq pages. Pure data (no DOM) so tests can hold it to the
// product's honesty rules: unverified until claimed, not an endorsement, the recipient may
// decline, direct tips refund after 30 days, routed fees have no single sender, devnet only, no
// "claim your funds" lures, and no token of anyfee's own.

export const REPO_URL = "https://github.com/lkristof55/anyfee";

export const HERO = {
  kicker: "Solana vaults for GitHub and X accounts",
  title: "Send SOL and USDC to any GitHub repo, GitHub user or X account, before they sign up.",
  coins: "Launching a coin about someone's project? Route its creator fees to the project's vault and the maintainers claim them.",
  figure:
    "Diagram: creator fees from a coin and tips from anyone flow into a GitHub repository's vault. The owner's proof, a GitHub OIDC token, reaches the vault; the vault binds to the owner's wallet and the funds move there.",
};

/** The three beats of the hero diagram, highlighted in turn while it loops. */
export const FLOW = [
  { n: "01", title: "Fund", short: "fees and tips in", body: "Fees and tips flow into the account's vault." },
  { n: "02", title: "Prove", short: "owner proves control", body: "The owner proves control: a GitHub Actions run or an X post." },
  { n: "03", title: "Claim", short: "owner withdraws", body: "The vault binds to the owner's wallet. Only it can withdraw." },
];

export const STEPS = [
  {
    id: "derive",
    n: "01",
    label: "Derive",
    title: "The account's id is the address.",
    body: "GitHub and X give every repository and account a permanent number. The vault is a program-derived address of that number, so it exists before anyone signs up and stays put through renames and handle changes.",
    code: 'vault = PDA("vault", platform, id)',
    figure: "Diagram: a numeric account id goes through a hash (the program-derived address) and comes out as the vault's address.",
  },
  {
    id: "fund",
    n: "02",
    label: "Fund",
    title: "Tips and creator fees go in.",
    body: "Anyone can tip SOL or USDC from this site; every direct tip leaves an on-chain receipt. Or paste the vault address as a pump.fun or Bags creator-fee recipient. Both work before the vault is opened on-chain.",
    code: "tip_sol · tip_token · any transfer",
    figure: "Diagram: creator fees from a coin and tips from a wallet flow into one vault, which fills up.",
  },
  {
    id: "claim",
    n: "03",
    label: "Claim",
    title: "The owner proves control, then withdraws.",
    body: "A GitHub Actions run (its OIDC token) proves a repository or user; a public post proves an X account. The attester signs a short statement, the program checks the signature on-chain and binds the vault to the owner's wallet. Only that wallet can withdraw.",
    code: "proof → attester signature → ed25519 check → bind → withdraw",
    figure: "Diagram: a proof goes to the attester, which signs a statement; the program verifies it on-chain, binds the vault to the owner's wallet and the funds move there.",
  },
  {
    id: "refund",
    n: "04",
    label: "Refund",
    title: "Unclaimed tips go back.",
    body: "If nobody claims the vault within 30 days, anyone can refund a direct tip, and it can only go back to its sender. Creator fees have no single sender, so they stay in the vault and wait for the owner.",
    code: "refund_tip → always the original sender",
    figure: "Diagram: a 30-day timer runs around an unclaimed vault; when it completes, the tip travels back to its sender while routed fees stay.",
  },
];

export const COIN_STEPS = [
  "Look up the project above: paste its GitHub repository link, a GitHub user or an X handle.",
  "Copy the vault address from its page.",
  "pump.fun: add the address as a shareholder in the coin's creator-fee sharing. Bags: add it as a fee earner by wallet address.",
  "The maintainers claim whenever they are ready. Nobody has to sign up first.",
];

export const COIN_NOTES = [
  "Fees have no single sender, so they are never refunded. They wait in the vault for the owner, possibly forever.",
  "Routing fees to a vault is not an endorsement: the project has not agreed to your coin.",
  "anyfee has no token of its own.",
  "Devnet only for now: do not route real mainnet fees to a vault yet.",
];

export const TRUST = [
  { title: "Non-custodial", body: "No admin and no attester can move funds. Money leaves a vault only to its bound owner, or back to the original sender as a refund." },
  { title: "Rebind delay", body: "The attester can bind a vault, never withdraw. Re-pointing a claimed vault waits 48 hours, and the owner can claim and cancel." },
  { title: "Unverified until claimed", body: "Every account has a vault whether or not its owner knows anyfee. A vault is not an endorsement." },
  { title: "The recipient may decline", body: "Then new tips are rejected and outstanding tips can be refunded to their senders at once." },
  { title: "No lists", body: "There is no ranking of unclaimed balances and no outreach telling anyone to claim funds. You find a vault only by asking for it." },
  { title: "Devnet only", body: "Test network, test money, unaudited program. No mainnet deployment." },
];

export const QA = [
  ["endorse", "Is a vault an endorsement?", "No. Every GitHub repository, GitHub account and X account has a vault whether or not its owner has heard of anyfee. A vault is unverified until claimed, and even a claimed vault only says that someone proved control of the account to the attester. The owner may decline."],
  ["unclaimed", "What happens to my tip if nobody claims the vault?", "After 30 days anyone can press Refund on it (the site shows the button to you under “Your tips to this vault”) and it goes back to your wallet, together with the receipt deposit. The money can only ever go back to the sender."],
  ["cost", "What does a tip cost?", "The tip, plus a receipt deposit of about 0.0013 SOL that comes back to you when the tip is refunded or its receipt is closed, plus about 0.0014 SOL once to open a vault that is not on-chain yet (that stays in the vault as rent), plus the network fee."],
  ["claimed", "What if the owner claims?", "Then your tip is theirs. It is no longer refundable. The receipt deposit is still yours: “Close receipt” returns it."],
  ["fees", "Can I route pump.fun or Bags creator fees to a vault?", "Yes: paste the vault address as a pump.fun creator-fee shareholder or a Bags fee earner. Fees have no single sender, so they are never refunded; they wait for the owner. anyfee is devnet only for now, so do not route real mainnet fees yet."],
  ["token", "Does anyfee have a token?", "No. anyfee has no token of its own. It routes other coins' creator fees to the accounts they are about; it never issues one."],
  ["rename", "What if a repository is renamed or transferred, or a handle changes?", "The vault follows the numeric id, so it stays put. A repository transferred to a new owner keeps its vault; if it was already claimed, the new owner's claim waits 48 hours and the previous owner can cancel it. Bound vaults favour the incumbent."],
  ["orgs", "Can a GitHub organization claim?", "Not its account vault: only personal accounts can claim a GitHub-account vault. Organizations get paid through their repositories, which work fine. The site blocks tips and warns against routing fees to organization account vaults."],
  ["collab", "Who can claim a repository?", "Whoever can run a workflow on the repository's default branch, usually anyone with write access. Collaborators can claim the repository's vault but not the owner's personal vault."],
  ["take", "Can anyfee, the admin or the attester take the money?", "Nobody can withdraw from a vault except its bound owner, and refunds only go to senders. The attester can bind; it cannot withdraw. But before a vault is first claimed you are trusting the attester to bind the right person: a stolen attester key could bind an unclaimed vault to a thief. Claimed vaults are protected by the 48-hour delay and the owner's cancel. The program's upgrade authority can replace the code; on devnet that is the deployer."],
  ["decline", "I own an account and don't want tips. What now?", "Claim the vault once, then decline. New tips are rejected and every outstanding tip becomes refundable to its sender at once. Declining is permanent in this version."],
  ["list", "Is there a list of vaults with money waiting?", "No, by design. There is no ranking of unclaimed balances and no outreach telling people to claim funds. You find a vault only by asking for a specific account. If someone messages you urging you to “claim your anyfee funds”, treat it as phishing."],
  ["keys", "Does the site see my keys?", "No. The site builds transactions with the open-source SDK and your wallet signs them. The site reads the chain through its own RPC proxy, which refuses mainnet."],
  ["tokens", "Which tokens can I send?", "SOL and the program's USDC mint on devnet. Anything else sent to a vault is stuck forever."],
  ["devnet", "Why devnet only?", "Because it is new and unaudited, and paying people who have not opted in raises legal questions that need a review first. Devnet money is free test money."],
];
