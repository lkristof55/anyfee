// Home ("/") and every vault page ("/v/…") share one view: the finder stays mounted while the
// page switches between the introduction and a vault's readout, so looking something up never
// reloads the page or loses the field's focus.
import { Platform, parseTarget, vaultPda } from "@anyfee/sdk";
import { copyButton, h, replace } from "../lib/dom.js";
import { ApiError, resolve, xProfile } from "../lib/api.js";
import { idPath, platformLabel, vaultPath } from "../routes.js";
import { navigate } from "../router.js";
import { diagram } from "../diagrams/index.js";
import { COIN_NOTES, COIN_STEPS, FLOW, HERO, REPO_URL, STEPS, TRUST } from "../content.js";
import { RECIPIENTS, STATUS, TICKER, TOKEN_COPY, pct, repoName } from "../token.js";
import { short, toBig } from "../lib/format.js";
import { DERIVE_PARAMS, EXAMPLE_ID, EXAMPLE_REPO, EXAMPLE_VAULT } from "../lib/example.js";
import { feePanel, ownerPanel, recordCard, senderPanel, statusOf, tipForm, trustNotes } from "./parts.js";

let view = null;

export function renderLookup(main, route) {
  if (!view || !main.contains(view.el)) {
    view?.dispose();
    view = createLookup();
    replace(main, view.el, view.below);
  }
  view.go(route);
}

export function leaveLookup() {
  view?.dispose();
  view = null;
}

const EXAMPLES = ["octocat/Hello-World", "github.com/octocat", "lkristof55/ox81"];

function describeParseError(input, message) {
  const word = input.trim().replace(/^@/, "");
  if (/ambiguous/.test(message) && /^[A-Za-z0-9_-]{1,39}$/.test(word)) return { ambiguous: word };
  return { message };
}

export function vaultParams(res) {
  const b = res.balances;
  const funded = toBig(b?.lamports) > toBig(b?.rentExemptLamports) || toBig(b?.usdc?.amount) > 0n;
  return {
    status: statusOf(res),
    hasClaimant: !!res.claimant,
    declined: !!res.declined,
    funded,
    glyph: res.platformName === "x" ? "x" : "github",
    idLabel: `${res.platformName}:${res.id}`,
    claimantLabel: res.claimant ? short(res.claimant) : "",
    pendingLabel: res.pending ? `→ ${short(res.pending.claimant)}` : "",
  };
}

function createLookup() {
  const mobile = window.matchMedia("(max-width: 640px)").matches;
  const input = h("input#to.finder-input", {
    name: "q",
    type: "text",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    enterkeyhint: "search",
    placeholder: mobile ? "owner/repo · user · @handle" : "github.com/owner/repo · GitHub user · @handle · vault address",
    "aria-describedby": "to-help",
  });
  const help = h("div#to-help.finder-help", { "aria-live": "polite" });
  const findBtn = h("button.btn.btn-primary.finder-btn", { type: "submit" }, "Find vault");
  const form = h(
    "form.finder",
    { role: "search", "aria-label": "Find a vault" },
    h("label.label.finder-label", { for: "to" }, "Find a vault — paste a GitHub or X link or handle"),
    h("div.finder-row", input, findBtn),
    help,
  );

  const flowItems = FLOW.map((f) => h("li.flow-item", h("span.flow-n", f.n), h("span.flow-t", f.title), h("span.flow-s", f.short), h("span.flow-b", f.body)));
  const flow = h("ol.flow", flowItems);
  const owned = [];
  const heroFig = diagram("hero", { vaultLabel: `github-repo · ${EXAMPLE_ID}` }, {
    keep: true,
    label: HERO.figure,
    onPhase: (i) => flowItems.forEach((li, k) => li.classList.toggle("is-on", i === k)),
  });

  owned.push(heroFig);
  const hero = h(
    "div.wrap.hero",
    h(
      "div.hero-copy",
      h("p.label.hero-kicker", h("span.dot", { "aria-hidden": "true" }), HERO.kicker),
      h("h1.hero-title", HERO.title),
      h("p.hero-sub", HERO.coins),
      form,
    ),
    h("figure.hero-fig", heroFig.el, h("figcaption", flow)),
  );
  const record = h("div.wrap.record-slot", { "aria-live": "polite" });
  const el = h("section.lookup", { "data-state": "idle" }, hero, record);
  const below = h("div.below");

  let cleanups = [];
  const track = (fn) => cleanups.push(fn);
  const cleanup = () => {
    for (const fn of cleanups) fn();
    cleanups = [];
  };

  let typingTimer = 0;
  let ctl = null;
  let current = null; // { route, res }
  let profile = null;
  let seq = 0;
  let vaultDg = null;
  let vaultKey = null;
  let homeEl = null;

  const setState = (s) => (el.dataset.state = s);
  const showHelp = (content) => replace(help, content ?? "");

  function examples() {
    return h(
      "p.examples",
      h("span.label", "Try"),
      EXAMPLES.map((q) => h("button.link-button.mono", { type: "button", onclick: () => ((input.value = q), lookup(q, "submit")) }, q)),
    );
  }

  function parseHelp(q) {
    try {
      parseTarget(q);
      return null;
    } catch (e) {
      const d = describeParseError(q, e.message);
      if (d.ambiguous) {
        return h(
          "p.hint",
          "Which one? ",
          h("button.link-button", { type: "button", onclick: () => ((input.value = `github.com/${d.ambiguous}`), lookup(input.value, "submit")) }, `github.com/${d.ambiguous}`),
          " or ",
          h("button.link-button", { type: "button", onclick: () => ((input.value = `@${d.ambiguous}`), lookup(input.value, "submit")) }, `@${d.ambiguous} on X`),
        );
      }
      return h("p.hint", d.message.replace(/^"(.+?)" /, "“$1” "));
    }
  }

  async function lookup(q, how) {
    q = q.trim();
    if (!q) return;
    const problem = parseHelp(q);
    if (problem) {
      showHelp(problem);
      return;
    }
    showHelp(h("p.hint.loading", "Looking up the vault…"));
    ctl?.abort();
    ctl = new AbortController();
    try {
      const res = await resolve(q, { signal: ctl.signal });
      navigate(vaultPath(res), { replace: how === "typing" && location.pathname.startsWith("/v/") });
    } catch (e) {
      if (e?.name === "AbortError") return;
      showHelp(h("p.hint.hint-error", lookupError(e, q)));
    }
  }

  input.addEventListener("input", () => {
    clearTimeout(typingTimer);
    const q = input.value.trim();
    if (!q) {
      showHelp(current?.res ? "" : examples());
      return;
    }
    typingTimer = setTimeout(() => {
      const problem = parseHelp(q);
      if (problem) showHelp(q.length > 3 ? problem : "");
      else lookup(q, "typing");
    }, 650);
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    clearTimeout(typingTimer);
    lookup(input.value, "submit");
  });

  async function load(route, { fresh = false } = {}) {
    const my = ++seq;
    ctl?.abort();
    ctl = new AbortController();
    if (!fresh) {
      setState("loading");
      if (!current?.res) replace(record, h("p.loading.record-loading.mono", `Resolving ${route.label}…`));
    }
    let res;
    try {
      res = await resolve(route.query, { signal: ctl.signal, fresh });
    } catch (e) {
      if (e?.name === "AbortError" || my !== seq) return;
      current = null;
      setState("error");
      cleanup();
      replace(record, notFound(route, e));
      replace(below);
      return;
    }
    if (my !== seq) return;
    const sameVault = current?.res && current.res.platformName === res.platformName && current.res.id === res.id;
    if (!sameVault) profile = null;
    current = { route, res };
    setState("found");
    showHelp("");
    draw();
    document.title = `${res.display} · anyfee vault`;
    if (!profile && res.platformName === "x" && /^@[A-Za-z0-9_]{1,15}$/.test(res.display ?? "")) {
      xProfile(res.display.slice(1)).then((p) => {
        if (p && current?.res === res) {
          profile = p;
          draw();
        }
      });
    }
  }

  const refresh = () => (current ? load(current.route, { fresh: true }) : Promise.resolve());

  function draw() {
    const { res } = current;
    cleanup();
    const key = `${res.platformName}:${res.id}`;
    if (!vaultDg || vaultKey !== key) {
      vaultDg?.destroy();
      vaultDg = diagram("vault", vaultParams(res), { keep: true, label: `Diagram of this vault: ${statusOf(res)}.`, className: "dg-readout" });
      vaultKey = key;
    } else {
      vaultDg.set(vaultParams(res));
    }
    const claimHref = `/claim?type=${res.platformName}&q=${encodeURIComponent(`${res.platformName}:${res.id}`)}`;
    replace(
      record,
      h(
        "div.readout-grid",
        h("div.readout-main", recordCard(res, { profile, figure: vaultDg.el, level: 1 })),
        h("aside.readout-side", tipForm(res, { refresh, track, onLanded: () => vaultDg?.pulse() })),
      ),
    );
    replace(
      below,
      h(
        "div.wrap.panels",
        h("div.panels-main", senderPanel(res, { refresh, track }), feePanel(res)),
        h("div.panels-side", ownerPanel(res, { refresh, claimHref, track }), shareBlock(res), trustNotes(res)),
      ),
    );
  }

  function go(route) {
    if (route.name === "home") {
      seq++;
      ctl?.abort();
      current = null;
      cleanup();
      setState("idle");
      replace(record);
      if (document.activeElement !== input) input.value = "";
      showHelp(examples());
      replace(below, (homeEl ??= homeBelow(owned)));
      return;
    }
    // what goes back into the field must parse again ("octocat" alone is ambiguous)
    if (document.activeElement !== input || !input.value.trim()) input.value = route.kind === "github-user" ? route.query : route.label;
    if (current?.route?.query === route.query && current.res) return;
    load(route);
  }

  return {
    el,
    below,
    go,
    dispose() {
      cleanup();
      ctl?.abort();
      clearTimeout(typingTimer);
      for (const d of owned) d.destroy();
      vaultDg?.destroy();
    },
  };
}

function lookupError(e, q) {
  if (e instanceof ApiError) {
    if (e.status === 404 && /not an initialized anyfee vault/.test(e.message)) {
      return "That Solana address is not a vault. A vault address only resolves once the vault is opened on-chain, and a plain wallet has no vault (send to it directly). Look up the GitHub or X account instead.";
    }
    if (e.status === 404) return `${q} was not found. Check the spelling; it may be private or deleted.`;
    if (e.status === 400) return e.message;
    if (e.status === 429) return "GitHub or X is rate-limiting lookups right now. Try again in a minute.";
    return `The lookup failed: ${e.message}`;
  }
  return "The lookup failed. Try again.";
}

function notFound(route, e) {
  return h(
    "div.readout.readout-missing",
    h("p.label", h("span.tag.tag-accent", "Not found")),
    h("h2.record-name", route.label),
    h("p", lookupError(e, route.label)),
    h("p.small.muted", "Vaults exist for GitHub repositories, GitHub accounts and X accounts, keyed to their numeric id. A plain Solana wallet has no vault: send to it directly."),
  );
}

function shareBlock(res) {
  const pretty = new URL(vaultPath(res), location.origin).toString();
  const stable = new URL(idPath(res.platformName, res.id), location.origin).toString();
  return h(
    "section.panel.panel-share",
    { "aria-labelledby": "share-title" },
    h("h2#share-title.panel-title", "Share this vault"),
    h("div.share-row", h("code.mono", pretty), copyButton(pretty, "Copy link")),
    pretty === stable ? null : h("div.share-row", h("code.mono", stable), copyButton(stable, "Copy")),
    h("p.small.muted", pretty === stable ? `This link uses the permanent ${platformLabel(res.platformName)} id.` : `The second link uses the permanent ${platformLabel(res.platformName)} id, so it keeps working after a rename or handle change.`),
  );
}

// ---- Home, below the first screen ----------------------------------------------------------------

function sectionHead(id, label, title, lede) {
  return h("header.section-head", h("p.label", label), h(`h2#${id}.section-title`, title), lede ? h("p.section-lede", lede) : null);
}

function homeBelow(owned) {
  const glyphParams = { derive: DERIVE_PARAMS };
  return h(
    "div.home",
    h(
      "section.wrap.band.how-band",
      { "aria-labelledby": "how-title" },
      sectionHead("how-title", "How it works", "Four steps, each one checked on-chain.", "No sign-up comes first: the vault exists as soon as the account does."),
      h(
        "ol.steps4",
        STEPS.map((s) =>
          h(
            "li.step4",
            h("p.label.step4-n", h("span", s.n), s.label),
            owned[owned.push(diagram(s.id, glyphParams[s.id] ?? {}, { keep: true, label: s.figure, className: "dg-glyph" })) - 1].el,
            h("h3.step4-title", s.title),
            h("p.step4-body", s.body),
            h("code.mono.step4-code", s.code),
            s.id === "derive"
              ? h("p.step4-example.mono", h("span.muted", `${EXAMPLE_REPO} · id ${EXAMPLE_ID} →`), " ", h("span.break", EXAMPLE_VAULT))
              : null,
          ),
        ),
      ),
    ),
    tokenSection(owned),
    h(
      "section.wrap.band.coins-band",
      { "aria-labelledby": "coins-title" },
      sectionHead("coins-title", "For coin launchers", "Launching a coin about someone's project? Pay the project."),
      h(
        "div.coins-grid",
        h("ol.numbered", COIN_STEPS.map((t) => h("li", t))),
        h(
          "div.coins-side",
          h(
            "dl.spec",
            h("div", h("dt", "pump.fun"), h("dd", "Creator-fee sharing → add a shareholder → paste the vault address")),
            h("div", h("dt", "Bags"), h("dd", "Fee sharing → add a fee earner by wallet address → paste the vault address")),
            h("div", h("dt", "Owner"), h("dd", "Claims with a GitHub Actions run or an X post, whenever they are ready")),
          ),
          h("ul.fine", COIN_NOTES.map((t) => h("li", t))),
        ),
      ),
    ),
    h(
      "section.wrap.band.trust-band",
      { "aria-labelledby": "trust-title-home" },
      sectionHead("trust-title-home", "Safety", "What nobody behind anyfee can do."),
      h("ul.trust-grid", TRUST.map((t) => h("li", h("h3", t.title), h("p", t.body)))),
    ),
    h(
      "nav.wrap.band.next-band",
      { "aria-label": "More" },
      h("a.next-link", { href: "/claim" }, h("span.label", "Owners"), h("span.next-t", "Claim a vault"), h("span.next-a", { "aria-hidden": "true" }, "→")),
      h("a.next-link", { href: "/how" }, h("span.label", "Mechanism"), h("span.next-t", "How it works"), h("span.next-a", { "aria-hidden": "true" }, "→")),
      h("a.next-link", { href: "/faq" }, h("span.label", "Answers"), h("span.next-t", "FAQ"), h("span.next-a", { "aria-hidden": "true" }, "→")),
      h("a.next-link", { href: REPO_URL, target: "_blank", rel: "noopener" }, h("span.label", "Source"), h("span.next-t", "GitHub"), h("span.next-a", { "aria-hidden": "true" }, "↗")),
    ),
  );
}

// ---- $ANYFEE: the planned coin and its fixed fee split (data in src/token.js) --------------------

function tokenSection(owned) {
  const rows = RECIPIENTS.map((r) => {
    const vault = vaultPda(Platform.GithubRepo, BigInt(r.id))[0].toBase58();
    const [owner, repo] = r.slug.split("/");
    return h(
      "tr",
      h("th", { scope: "row" }, h("a", { href: `/v/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` }, r.slug), h("small.muted.block.mono", `repository id ${r.id}`)),
      h("td.token-share", pct(r.bps)),
      h("td.token-vault", h("code.mono", { title: vault }, short(vault, 6)), copyButton(vault, "Copy")),
      h("td.token-why", r.reason),
    );
  });
  const shares = RECIPIENTS.map((r) => ({ label: pct(r.bps), name: repoName(r.slug), bps: r.bps }));
  const fig = diagram("split", { shares, ticker: TICKER }, { keep: true, label: TOKEN_COPY.figure, className: "dg-token" });
  owned.push(fig);
  return h(
    "section#anyfee-coin.wrap.band.token-band",
    { "aria-labelledby": "token-title" },
    h(
      "header.section-head",
      h("p.label.token-label", h("span.token-ticker", TICKER), h("span.tag.tag-accent", STATUS)),
      h("h2#token-title.section-title", TOKEN_COPY.title),
      h("p.section-lede", TOKEN_COPY.function),
    ),
    h(
      "div.token-grid",
      h("figure.token-fig", fig.el, h("figcaption.mono", "creator fees → fixed split → repository vaults")),
      h("dl.token-status", TOKEN_COPY.status.map(([k, v]) => h("div", h("dt", k), h("dd", v)))),
    ),
    h(
      "table.token-table",
      h("caption.visually-hidden", `${TICKER} creator-fee split`),
      h("thead", h("tr", h("th", { scope: "col" }, "Repository"), h("th", { scope: "col" }, "Share"), h("th", { scope: "col" }, "Vault"), h("th", { scope: "col" }, "Why"))),
      h("tbody", rows),
    ),
    h("p.small.muted.token-note", "Each share is keyed by the repository's permanent numeric id, so the list stays valid through renames and transfers. Each vault address is derived in your browser from that id."),
  );
}
