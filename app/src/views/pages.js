// Static pages: /how (mechanism + threat model summary), /faq and the 404.
import { PROGRAM_ID } from "@anyfee/sdk";
import { h, replace } from "../lib/dom.js";
import { explorerAddress } from "../lib/format.js";
import { QA, REPO_URL, STEPS } from "../content.js";
import { diagram } from "../diagrams/index.js";
import { DERIVE_PARAMS } from "../lib/example.js";

const step = (id) => STEPS.find((s) => s.id === id);
/** A step's diagram beside a section's text. */
function fig(id) {
  const s = step(id);
  return h("figure.section-fig", diagram(id, id === "derive" ? DERIVE_PARAMS : {}, { label: s.figure, className: "dg-glyph" }).el, h("figcaption.mono.small.muted", s.code));
}

const docLink = (path, label) => h("code.mono", { title: `In the anyfee repository: ${path}` }, label ?? path);

export function renderHow(main) {
  replace(
    main,
    h(
      "article.wrap.page.page-how",
      h(
        "header.page-head",
        h("p.label", "How it works"),
        h("h1.page-title", "One program, one attester key, one website. Nobody in between can move your funds."),
        h(
          "p.lede",
          "Here is exactly what each part can do, and what goes wrong if one of them misbehaves.",
        ),
      ),
      h(
        "nav.toc",
        { "aria-label": "On this page" },
        h("a", { href: "#vault" }, "The vault"),
        h("a", { href: "#send" }, "Sending"),
        h("a", { href: "#refunds" }, "Refunds"),
        h("a", { href: "#claim" }, "Claiming"),
        h("a", { href: "#after" }, "After a claim"),
        h("a", { href: "#risks" }, "What can go wrong"),
        h("a", { href: "#numbers" }, "Numbers"),
      ),
      section(
        "vault",
        "The vault",
        { fig: "derive" },
        h("p", "Every vault is a program-derived address (PDA) of the anyfee program:"),
        h("pre.code", h("code", 'vault = find_program_address(["vault", platform (1 byte), id (u64, little-endian)], anyfee)')),
        h(
          "p",
          "The platform is 1 for a GitHub user, 2 for a GitHub repository and 3 for an X account. The id is the account's permanent numeric id from GitHub or X, never a name or handle. So the address is known before anyone signs up, a renamed repository keeps its vault, and so does an X account after a handle change.",
        ),
        h(
          "p",
          "The address can receive SOL and USDC before the vault exists on-chain. Opening it (",
          h("code.mono", "init_vault"),
          ") is permissionless; if money arrived first, that money pays the vault's rent.",
        ),
      ),
      section(
        "send",
        "Sending",
        { fig: "fund" },
        h(
          "table.facts",
          h("thead", h("tr", h("th", ""), h("th", "Direct tip"), h("th", "Routed fees or plain transfers"))),
          h(
            "tbody",
            h("tr", h("th", "How"), h("td", h("code.mono", "tip_sol"), " / ", h("code.mono", "tip_token"), " from this site or the SDK"), h("td", "Any transfer to the vault address, e.g. pump.fun or Bags creator fees")),
            h("tr", h("th", "Receipt"), h("td", "Yes: a Tip account records sender, amount and time"), h("td", "None")),
            h("tr", h("th", "If unclaimed"), h("td", "Refundable to the sender after 30 days, by anyone"), h("td", "Stays in the vault, possibly forever")),
            h("tr", h("th", "If declined"), h("td", "Refundable to the sender at once"), h("td", "Still claimable by the owner")),
            h("tr", h("th", "Once claimed"), h("td", "The owner's; the receipt deposit can be closed back to the sender"), h("td", "The owner's")),
          ),
        ),
        h("p", "A refund can only ever pay the original sender (or the sender's USDC account). That is why the refund button can be pressed by anyone."),
      ),
      section(
        "refunds",
        "Refunds",
        { fig: "refund" },
        h("p", "Each direct tip records its sender, amount and time in a receipt. While a vault is unclaimed, the refund window (30 days) runs per tip; once it has passed, anyone may crank ", h("code.mono", "refund_tip"), " and the tip, plus its receipt deposit, goes back to the sender. If the owner declines, every outstanding tip is refundable at once."),
        h("p", "Creator fees and plain transfers arrive without a receipt and without a single sender, so nothing can return them: they wait for the owner."),
      ),
      section(
        "claim",
        "Claiming",
        { fig: "claim" },
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
            " run on the default branch, not from a fork. Whoever can run workflows on the default branch controls the vault — the same model Drips uses with FUNDING.json.",
          ),
          h("li", h("strong", "GitHub account. "), "The same token, and the person who ran the workflow owns the repository it ran in, and that owner is a person, not an organization."),
          h("li", h("strong", "X account. "), "A public post containing exactly one ", h("code.mono", "anyfee:<your wallet>"), ", at most 24 hours old. The vault is the post author's numeric id as X reports it."),
        ),
        h("p", "The attester never sees a password, a GitHub token with any other use, or a private key."),
      ),
      section(
        "after",
        "After a claim",
        h(
          "ul",
          h("li", h("strong", "Claim "), "moves everything above the vault's rent to any destination the owner picks, SOL and USDC. It works even while a rebind is pending."),
          h("li", h("strong", "Decline "), "is permanent in this version: new tips are rejected, outstanding tips become refundable at once, routed fees stay claimable."),
          h(
            "li",
            h("strong", "A second proof "),
            "for a vault that already has an owner does not replace them. It creates a pending rebind that takes effect after 48 hours. The owner sees it on the vault page and should claim first, then cancel.",
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
            h("strong", "Unclaimed vaults are at risk: "),
            "the thief can sign a statement for their own wallet, bind any vault that has no owner yet, and claim what is in it, including routed fees and tips that were not refunded yet. This is the central trust assumption of v0.1. The real owner shrinks the window by claiming early.",
          ),
          h(
            "p",
            h("strong", "Claimed vaults are protected: "),
            "the thief can only request a rebind, which waits at least 24 hours (48 by default); the owner claims and cancels. Response: the admin pauses (blocks tips, binds and finalizing rebinds; never claims, refunds, cancels or declines), rotates the attester, and owners cancel pending rebinds.",
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
            "Tokens other than the program's USDC mint, USDC sent to a token account that is not the vault's canonical one, and fees routed to a GitHub organization's account vault can never be claimed or refunded. The site warns about each.",
          ),
        ),
        h(
          "div.risk",
          h("h3", "Replays"),
          h(
            "p",
            "A statement expires after 15 minutes, and a GitHub token is minted for one wallet. Replaying a bind for the current owner fails. The devnet attester key must never sign for mainnet: the statement names the program, not the cluster.",
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
        h("p.small.muted", "The full analysis is in the ", h("a", { href: REPO_URL, target: "_blank", rel: "noopener" }, "repository ↗"), ": ", docLink("docs/THREAT-MODEL.md"), ", the contract in ", docLink("docs/SPEC.md"), ", the claim flow in ", docLink("docs/CLAIMING.md"), "."),
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
          num("Vault rent", "≈ 0.00144 SOL", "stays in the vault forever"),
          num("Receipt deposit", "≈ 0.00131 SOL", "per tip, returned to the sender on refund or close"),
          num("Assets", "SOL and devnet USDC", h("code.mono", "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")),
          num("Cluster", "devnet", "no mainnet deployment, no real funds"),
        ),
      ),
    ),
  );
}

function section(id, title, ...body) {
  const opts = body[0] && !(body[0] instanceof Node) && !Array.isArray(body[0]) && typeof body[0] === "object" ? body.shift() : {};
  const text = h("div.page-section-body", ...body);
  return h(
    `section.page-section${opts.fig ? ".has-fig" : ""}`,
    { id, "aria-labelledby": `${id}-title` },
    h(`h2#${id}-title.section-title`, title),
    opts.fig ? h("div.page-section-grid", text, fig(opts.fig)) : text,
  );
}

function num(label, value, note) {
  return h("div.number", h("dt", label), h("dd", h("strong", value), h("span.small.muted.block", note)));
}

export function renderFaq(main) {
  replace(
    main,
    h(
      "article.wrap.page.page-faq",
      h(
        "header.page-head",
        h("p.label", "FAQ"),
        h("h1.page-title", "Straight answers."),
        h("p.lede", "If yours is missing, the repository's docs go deeper."),
      ),
      h("nav.toc.toc-faq", { "aria-label": "Questions" }, QA.map(([id, q]) => h("a", { href: `#${id}` }, q))),
      h(
        "dl.qa",
        QA.map(([id, q, a]) => h("div.qa-item", h(`dt#${id}`, q), h("dd", a))),
      ),
    ),
  );
}

export function renderNotFound(main) {
  replace(
    main,
    h(
      "article.wrap.page.page-404",
      h("p.label", h("span.tag.tag-accent", "404"), " Not found"),
      h("h1.page-title", "No vault at this address."),
      h("p.lede", "Vault pages live at /v/github/owner/repo, /v/gh/user and /v/x/handle. Or look one up:"),
      h("p.row", h("a.btn.btn-primary", { href: "/" }, "Find a vault"), h("a.btn.btn-ghost", { href: "/how" }, "How it works")),
    ),
  );
}
