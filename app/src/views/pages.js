// Static pages: /how (mechanism + threat model summary), /faq and the 404.
import { PROGRAM_ID } from "@anyfee/sdk";
import { h, replace } from "../lib/dom.js";
import { explorerAddress } from "../lib/format.js";

const docLink = (path, label) => h("code.mono", { title: `In the anyfee repository: ${path}` }, label ?? path);

export function renderHow(main) {
  replace(
    main,
    h(
      "article.page.page-how",
      h(
        "header.page-head",
        h("p.kicker", "How it works"),
        h("h1.display.display-page", "A post office with no clerk who can open your box."),
        h(
          "p.lede",
          "anyfee is one Solana program, one attester key and this website. Here is exactly what each can do, and what goes wrong if one of them misbehaves.",
        ),
      ),
      h(
        "nav.toc",
        { "aria-label": "On this page" },
        h("a", { href: "#box" }, "The box"),
        h("a", { href: "#send" }, "Sending"),
        h("a", { href: "#claim" }, "Claiming"),
        h("a", { href: "#after" }, "After a claim"),
        h("a", { href: "#risks" }, "What can go wrong"),
        h("a", { href: "#numbers" }, "Numbers"),
      ),
      section(
        "box",
        "The box",
        h("p", "Every box is a program-derived address (PDA) of the anyfee program:"),
        h("pre.code", h("code", 'vault = find_program_address(["vault", platform (1 byte), id (u64, little-endian)], anyfee)')),
        h(
          "p",
          "The platform is 1 for a GitHub user, 2 for a GitHub repository and 3 for an X account. The id is the account's permanent numeric id from GitHub or X, never a name or handle. So the address is known before anyone signs up, a renamed repository keeps its box, and so does an X account after a handle change.",
        ),
        h(
          "p",
          "The address can receive SOL and USDC before the box exists on-chain. Opening it (",
          h("code.mono", "init_vault"),
          ") is permissionless; if money arrived first, that money pays the box's rent.",
        ),
      ),
      section(
        "send",
        "Sending",
        h(
          "table.facts",
          h("thead", h("tr", h("th", ""), h("th", "Direct tip"), h("th", "Routed fees or plain transfers"))),
          h(
            "tbody",
            h("tr", h("th", "How"), h("td", h("code.mono", "tip_sol"), " / ", h("code.mono", "tip_token"), " from this site or the SDK"), h("td", "Any transfer to the box address, e.g. pump.fun or Bags creator fees")),
            h("tr", h("th", "Receipt"), h("td", "Yes: a Tip account records sender, amount and time"), h("td", "None")),
            h("tr", h("th", "If unclaimed"), h("td", "Refundable to the sender after 30 days, by anyone"), h("td", "Stays in the box, possibly forever")),
            h("tr", h("th", "If declined"), h("td", "Refundable to the sender at once"), h("td", "Still claimable by the owner")),
            h("tr", h("th", "Once claimed"), h("td", "The holder's; the receipt deposit can be closed back to the sender"), h("td", "The holder's")),
          ),
        ),
        h("p", "A refund can only ever pay the original sender (or the sender's USDC account). That is why the refund button can be pressed by anyone."),
      ),
      section(
        "claim",
        "Claiming",
        h(
          "p",
          "The attester is a service with an ed25519 key. When you prove control, it signs a 95-byte statement ",
          h("em", "M"),
          ": the domain ",
          h("code.mono", "anyfee:bind:v1"),
          ", the program id, the platform, the id, your wallet and an expiry 15 minutes out. The bind transaction carries that signature in Solana's Ed25519 precompile instruction, and the program checks the instruction right before ",
          h("code.mono", "bind"),
          " byte for byte: one signature, all offsets inside itself, the attester's public key, exactly ",
          h("em", "M"),
          ". Anyone may submit it; it binds only the wallet named inside.",
        ),
        h(
          "ul.checks",
          h(
            "li",
            h("strong", "GitHub repository. "),
            "A GitHub Actions OIDC token signed by GitHub, with audience ",
            h("code.mono", "anyfee:<your wallet>"),
            ", from a ",
            h("code.mono", "workflow_dispatch"),
            " or ",
            h("code.mono", "push"),
            " run on the default branch, not from a fork. Whoever can run workflows on the default branch controls the box — the same model Drips uses with FUNDING.json.",
          ),
          h("li", h("strong", "GitHub account. "), "The same token, and the person who ran the workflow owns the repository it ran in, and that owner is a person, not an organization."),
          h("li", h("strong", "X account. "), "A public post containing exactly one ", h("code.mono", "anyfee:<your wallet>"), ", at most 24 hours old. The box is the post author's numeric id as X reports it."),
        ),
        h("p", "The attester never sees a password, a GitHub token with any other use, or a private key."),
      ),
      section(
        "after",
        "After a claim",
        h(
          "ul",
          h("li", h("strong", "Claim "), "moves everything above the box's rent to any destination the holder picks, SOL and USDC. It works even while a change of holder is pending."),
          h("li", h("strong", "Decline "), "is permanent in this version: new tips are rejected, outstanding tips become refundable at once, routed fees stay claimable."),
          h(
            "li",
            h("strong", "A second proof "),
            "for a box that already has a holder does not replace them. It creates a pending change that takes effect after 48 hours. The holder sees it on the box page and should claim first, then cancel.",
          ),
        ),
      ),
      section(
        "risks",
        "What can go wrong",
        h(
          "div.risk",
          h("h3", "The attester key is stolen"),
          h(
            "p",
            h("strong", "Unclaimed boxes are at risk: "),
            "the thief can sign a statement for their own wallet, bind any box that has no holder yet, and claim what is in it, including routed fees and tips that were not refunded yet. This is the central trust assumption of v0.1. The real owner shrinks the window by claiming early.",
          ),
          h(
            "p",
            h("strong", "Claimed boxes are protected: "),
            "the thief can only request a change of holder, which waits at least 24 hours (48 by default); the holder claims and cancels. Response: the admin pauses (blocks tips, binds and finalizing changes; never claims, refunds, cancels or declines), rotates the attester, and holders cancel pending changes.",
          ),
        ),
        h(
          "div.risk",
          h("h3", "The admin misbehaves"),
          h(
            "p",
            "The admin can pause, rotate the attester and move the refund window (1 to 365 days) and the rebind delay (1 to 30 days). It cannot move money or re-initialize. Because it can install its own attester, a malicious admin has every power of a stolen attester key, and no more.",
          ),
        ),
        h(
          "div.risk",
          h("h3", "The program is replaced"),
          h(
            "p",
            "Whoever holds the upgrade authority can replace the program and therefore take everything. On devnet that is the deployer key. Before any mainnet use: a multisig upgrade authority with a timelock, or a frozen verifiable build, and a legal review.",
          ),
        ),
        h(
          "div.risk",
          h("h3", "Money that can never move"),
          h(
            "p",
            "Tokens other than the program's USDC mint, USDC sent to a token account that is not the box's canonical one, and fees routed to a GitHub organization's account box can never be claimed or refunded. The site warns about each.",
          ),
        ),
        h(
          "div.risk",
          h("h3", "Replays"),
          h(
            "p",
            "A statement expires after 15 minutes, and a GitHub token is minted for one wallet. Replaying a bind for the current holder fails. The devnet attester key must never sign for mainnet: the statement names the program, not the cluster.",
          ),
        ),
        h(
          "div.risk",
          h("h3", "This website"),
          h(
            "p",
            "The site builds transactions with the open-source SDK and asks your wallet to sign them; it never holds a key. It reads the chain through its own RPC proxy, which refuses mainnet. Check the program id in your wallet before you sign: ",
            h("a.mono", { href: explorerAddress(PROGRAM_ID.toBase58()), target: "_blank", rel: "noopener" }, PROGRAM_ID.toBase58()),
            ".",
          ),
        ),
        h("p.small.muted", "The full analysis is in the repository: ", docLink("docs/THREAT-MODEL.md"), ", the contract in ", docLink("docs/SPEC.md"), ", the claim flow in ", docLink("docs/CLAIMING.md"), "."),
      ),
      section(
        "numbers",
        "Numbers",
        h(
          "dl.numbers",
          num("Refund window", "30 days", "admin-settable within 1 to 365 days; not snapshotted per tip"),
          num("Rebind delay", "48 hours", "1 to 30 days; snapshotted when a change is requested"),
          num("Statement lifetime", "15 minutes", "attester setting, 1 minute to 1 hour"),
          num("X post age", "24 hours", "older posts are refused"),
          num("Box rent", "≈ 0.00144 SOL", "stays in the box forever"),
          num("Receipt deposit", "≈ 0.00131 SOL", "per tip, returned to the sender on refund or close"),
          num("Assets", "SOL and devnet USDC", h("code.mono", "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")),
          num("Cluster", "devnet", "no mainnet deployment, no real funds"),
        ),
      ),
    ),
  );
}

function section(id, title, ...body) {
  return h("section.page-section", { id, "aria-labelledby": `${id}-title` }, h(`h2#${id}-title.section-title`, title), ...body);
}

function num(label, value, note) {
  return h("div.number", h("dt", label), h("dd", h("strong", value), h("span.small.muted.block", note)));
}

const QA = [
  ["endorse", "Is a box an endorsement?", "No. Every GitHub repository, GitHub account and X account has a box whether or not its owner has heard of anyfee. A box is unverified until claimed, and even a claimed box only says that someone proved control of the account to the attester. The owner may decline."],
  ["unclaimed", "What happens to my tip if nobody claims the box?", "After 30 days anyone can press Refund on it (the site shows the button to you under “Your mail to this box”) and it goes back to your wallet, together with the receipt deposit. The money can only ever go back to the sender."],
  ["cost", "What does a tip cost?", "The tip, plus a receipt deposit of about 0.0013 SOL that comes back to you when the tip is refunded or its receipt is closed, plus about 0.0014 SOL once to open a box that is not on-chain yet (that stays in the box as rent), plus the network fee."],
  ["claimed", "What if the owner claims?", "Then your tip is theirs. It is no longer refundable. The receipt deposit is still yours: “Close receipt” returns it."],
  ["fees", "Can I route pump.fun or Bags creator fees to a box?", "Yes: paste the box address as a pump.fun creator-fee shareholder or a Bags fee earner. Fees have no single sender, so they are never refunded; they wait for the owner. anyfee is devnet only for now, so do not route real mainnet fees yet."],
  ["rename", "What if a repository is renamed or transferred, or a handle changes?", "The box follows the numeric id, so it stays put. A repository transferred to a new owner keeps its box; if it was already claimed, the new owner's claim waits 48 hours and the previous holder can cancel it. Bound boxes favour the incumbent."],
  ["orgs", "Can a GitHub organization claim?", "Not its account box: only personal accounts can claim a GitHub-account box. Organizations get paid through their repositories, which work fine. The site blocks tips and warns against routing fees to organization account boxes."],
  ["collab", "Who can claim a repository?", "Whoever can run a workflow on the repository's default branch, usually anyone with write access. Collaborators can claim the repository box but not the owner's personal box."],
  ["take", "Can anyfee, the admin or the attester take the money?", "Nobody can withdraw from a box except its bound holder, and refunds only go to senders. The attester can bind; it cannot withdraw. But before a box is first claimed you are trusting the attester to bind the right person: a stolen attester key could bind an unclaimed box to a thief. Claimed boxes are protected by the 48-hour delay and the holder's cancel. The program's upgrade authority can replace the code; on devnet that is the deployer."],
  ["decline", "I own an account and don't want tips. What now?", "Claim the box once, then decline. New tips are rejected and every outstanding tip becomes refundable to its sender at once. Declining is permanent in this version."],
  ["list", "Is there a list of boxes with money waiting?", "No, by design. There is no ranking of unclaimed balances and no outreach telling people to claim funds. You find a box only by asking for a specific account. If someone messages you urging you to “claim your anyfee funds”, treat it as phishing."],
  ["keys", "Does the site see my keys?", "No. The site builds transactions with the open-source SDK and your wallet signs them. The site reads the chain through its own RPC proxy, which refuses mainnet."],
  ["tokens", "Which tokens can I send?", "SOL and the program's USDC mint on devnet. Anything else sent to a box is stuck forever."],
  ["devnet", "Why devnet only?", "Because it is new and unaudited, and paying people who have not opted in raises legal questions that need a review first. Devnet money is free test money."],
];

export function renderFaq(main) {
  replace(
    main,
    h(
      "article.page.page-faq",
      h(
        "header.page-head",
        h("p.kicker", "Questions"),
        h("h1.display.display-page", "Asked at the counter."),
        h("p.lede", "Straight answers. If yours is missing, the repository's docs go deeper."),
      ),
      h("nav.toc.toc-faq", { "aria-label": "Questions" }, QA.map(([id, q]) => h("a", { href: `#${id}` }, q))),
      h(
        "dl.qa",
        QA.map(([id, q, a]) => [h(`dt#${id}`, q), h("dd", a)]),
      ),
    ),
  );
}

export function renderNotFound(main) {
  replace(
    main,
    h(
      "article.page.page-404",
      h("span.stamp.stamp-red.stamp-big", "Return to sender"),
      h("h1.display.display-page", "No box at this address."),
      h("p.lede", "Boxes live at /v/github/owner/repo, /v/gh/user and /v/x/handle. Or ask the counter:"),
      h("p", h("a.btn.btn-brass", { href: "/" }, "Find a box"), " ", h("a.btn.btn-ghost", { href: "/how" }, "How it works")),
    ),
  );
}
