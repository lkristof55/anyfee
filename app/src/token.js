// $ANYFEE, the planned coin: the ONE place its fee split is defined. Pure data (no DOM, no SDK) so
// the site, the diagram and the tests all read the same list. Recipients are keyed by GitHub's
// permanent numeric repository id (platform 2 = github-repo), so the list stays valid through
// renames; `slug` is only the current display name. Vault addresses are derived from the id in
// the browser (vaultPda), never stored here.
//
// pump.fun rules for a fee-sharing config: 1 to 10 shareholders, every share > 0, shares summing
// to exactly 10,000 basis points (test/token.test.ts checks this).

export const TICKER = "$ANYFEE";
export const STATUS = "Planned · not launched";
export const PLATFORM = 2; // github-repo

/** @type {Array<{ slug: string, id: string, bps: number, reason: string }>} */
export const RECIPIENTS = [
  { slug: "lkristof55/anyfee", id: "1390597639", bps: 5000, reason: "development and audit of anyfee" },
  { slug: "otter-sec/anchor", id: "325891672", bps: 1000, reason: "the program framework (anchor-lang)" },
  { slug: "solana-foundation/solana-web3.js", id: "145759605", bps: 1000, reason: "the client library (@solana/web3.js)" },
  { slug: "paulmillr/noble-curves", id: "573750299", bps: 1000, reason: "ed25519 in the SDK and attester" },
  { slug: "LiteSVM/litesvm", id: "720395663", bps: 1000, reason: "the program test runtime" },
  { slug: "mrdoob/three.js", id: "576201", bps: 1000, reason: "the site's 3D diagrams" },
];

export const pct = (bps) => `${Number((bps / 100).toFixed(2))}%`;
export const repoName = (slug) => slug.split("/")[1];

export const TOKEN_COPY = {
  title: "A coin whose creator fees fund the code anyfee runs on.",
  function: `${TICKER} is a planned pump.fun coin with one function: its creator fees are split, by a fixed share list, among the anyfee vaults of the open-source repositories below. Every trade would fund open source.`,
  figure: `Diagram: creator fees from the ${TICKER} coin reach a fixed splitter and branch out to ${RECIPIENTS.length} repository vaults, each filling in proportion to its share: ${RECIPIENTS.map((r) => `${repoName(r.slug)} ${pct(r.bps)}`).join(", ")}.`,
  status: [
    ["Status", `${STATUS}. Launch waits for the mainnet program and an audit; anyfee is devnet only today.`],
    ["Not affiliated", "Apart from anyfee's own repository, the projects below are not affiliated with anyfee, do not endorse it or this coin, and did not ask for this. Each may decline: nobody has to claim, and a vault's owner can decline tips."],
    ["Unclaimed fees", "Creator fees have no single sender, so they are never refunded. A project that never claims leaves its share waiting in its vault, possibly forever."],
    ["Not an investment", "No returns are promised and holders receive nothing from the fees. The coin has no other utility: no staking, no governance, no burn."],
    ["Fixed split", "The share list is published here before launch and set once in pump.fun's creator-fee sharing config; pump.fun then allows no further change."],
  ],
};
