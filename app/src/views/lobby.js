// The lobby: home ("send") and every vault page share it. The wall stays mounted while the
// counter switches between the idle intro and a box's record, so looking up an identity slides
// its box out instead of reloading the page.
import { parseTarget } from "@anyfee/sdk";
import { h, replace } from "../lib/dom.js";
import { ApiError, resolve, xProfile } from "../lib/api.js";
import { idPath, platformLabel, vaultPath } from "../routes.js";
import { navigate } from "../router.js";
import { mountWall, wall } from "../wall/index.js";
import { feePanel, ownerPanel, recordCard, senderPanel, tipForm, trustNotes, wallBox } from "./parts.js";
import { copyButton } from "../lib/dom.js";

let lobby = null;

export function renderLobby(main, route) {
  if (!lobby || !main.contains(lobby.el)) {
    lobby?.dispose();
    lobby = createLobby();
    replace(main, lobby.el, lobby.below);
  }
  lobby.go(route);
}

export function leaveLobby() {
  lobby?.dispose();
  lobby = null;
}

const EXAMPLES = ["octocat/Hello-World", "github.com/octocat", "lkristof55/ox81"];

function describeParseError(input, message) {
  const word = input.trim().replace(/^@/, "");
  if (/ambiguous/.test(message) && /^[A-Za-z0-9_-]{1,39}$/.test(word)) {
    return { ambiguous: word };
  }
  return { message };
}

function createLobby() {
  const wallHost = h("div.lobby-wall", h("p.wall-sign", { "aria-hidden": "true" }, h("span.wall-sign-label", "Lobby"), h("span.wall-sign-text", "Boxes numbered by account id")));
  const input = h("input#to.addressee-input", {
    name: "q",
    type: "text",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    placeholder: window.matchMedia("(max-width: 640px)").matches ? "owner/repo · user · @handle" : "github.com/owner/repo · GitHub user · @handle · box address",
    "aria-describedby": "to-help",
  });
  const help = h("div#to-help.addressee-help", { "aria-live": "polite" });
  const findBtn = h("button.btn.btn-brass", { type: "submit" }, "Find the box");
  const form = h(
    "form.addressee",
    { role: "search", "aria-label": "Find a box" },
    h("label.addressee-label", { for: "to" }, "To"),
    h("div.addressee-row", input, findBtn),
    help,
  );
  const intro = h(
    "div.counter-intro",
    h("p.kicker", "P.O. boxes for the open internet"),
    h("h1.display", "Every repo, GitHub user and X account already has a box."),
    h(
      "p.lede",
      "Drop SOL or USDC in it, or point pump.fun and Bags creator fees at it. The owner claims by proving control. If nobody claims a tip within 30 days, it comes back to you.",
    ),
  );
  const record = h("div.record-slot", { "aria-live": "polite" });
  const counter = h("div.counter", intro, form, record);
  const el = h("section.lobby", { "data-state": "idle" }, wallHost, h("div.lobby-inner", counter));
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

  function setState(s) {
    el.dataset.state = s;
  }

  function showHelp(content) {
    replace(help, content ?? "");
  }

  function examples() {
    return h(
      "p.examples",
      "Try ",
      EXAMPLES.map((q, i) => [i ? " · " : "", h("button.link-button", { type: "button", onclick: () => ((input.value = q), lookup(q, "submit")) }, q)]),
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
    showHelp(h("p.hint.loading", "Looking up the box…"));
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
      if (!current?.res) replace(record, h("p.loading.record-loading", `Looking up ${route.label}…`));
    }
    let res;
    try {
      res = await resolve(route.query, { signal: ctl.signal, fresh });
    } catch (e) {
      if (e?.name === "AbortError" || my !== seq) return;
      current = null;
      setState("error");
      cleanup();
      wall.clearBox();
      replace(record, notFound(route, e));
      replace(below);
      return;
    }
    if (my !== seq) return;
    const sameBox = current?.res && current.res.platformName === res.platformName && current.res.id === res.id;
    if (!sameBox) profile = null;
    current = { route, res };
    setState("found");
    showHelp("");
    draw();
    if (sameBox && fresh) wall.updateBox(wallBox(res));
    else wall.showBox(wallBox(res));
    document.title = `${res.display} · anyfee box`;
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
    const claimHref = `/claim?type=${res.platformName}&q=${encodeURIComponent(`${res.platformName}:${res.id}`)}`;
    replace(record, recordCard(res, { profile }), tipForm(res, { refresh, track }));
    replace(
      below,
      h(
        "div.below-grid",
        h("div.below-main", senderPanel(res, { refresh, track }), feePanel(res)),
        h("div.below-side", ownerPanel(res, { refresh, claimHref, track }), shareBlock(res), trustNotes(res)),
      ),
    );
  }

  function go(route) {
    mountWall(wallHost);
    if (route.name === "home") {
      seq++;
      ctl?.abort();
      current = null;
      cleanup();
      setState("idle");
      wall.clearBox();
      replace(record);
      if (document.activeElement !== input) input.value = "";
      showHelp(examples());
      replace(below, homeBelow());
      return;
    }
    // what goes back into the field must parse again ("octocat" alone is ambiguous)
    if (document.activeElement !== input || !input.value.trim()) input.value = route.kind === "github-user" ? route.query : route.label;
    if (current?.route?.query === route.query && current.res) {
      return;
    }
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
    },
  };
}

function lookupError(e, q) {
  if (e instanceof ApiError) {
    if (e.status === 404 && /not an initialized anyfee vault/.test(e.message)) {
      return "That Solana address is not a box. A box address only resolves once the box is open on-chain; a plain wallet has no box (send to it directly). Look up the GitHub or X account instead.";
    }
    if (e.status === 404) return `Return to sender: ${q} was not found. Check the spelling, or it may be private or deleted.`;
    if (e.status === 400) return e.message;
    if (e.status === 429) return "GitHub or X is rate-limiting lookups right now. Try again in a minute.";
    return `The lookup failed: ${e.message}`;
  }
  return "The lookup failed. Try again.";
}

function notFound(route, e) {
  return h(
    "div.record.record-missing",
    h("span.stamp.stamp-red", "Return to sender"),
    h("h2.record-name", route.label),
    h("p", lookupError(e, route.label)),
    h("p.small.muted", "Boxes exist for GitHub repositories, GitHub accounts and X accounts, keyed to their numeric id. A plain Solana wallet has no box: send to it directly."),
  );
}

function shareBlock(res) {
  const pretty = new URL(vaultPath(res), location.origin).toString();
  const stable = new URL(idPath(res.platformName, res.id), location.origin).toString();
  return h(
    "section.panel.panel-share",
    { "aria-labelledby": "share-title" },
    h("h2#share-title.panel-title", "Share this box"),
    h("div.share-row", h("code.mono", pretty), copyButton(pretty, "Copy link")),
    pretty === stable ? null : h("div.share-row", h("code.mono", stable), copyButton(stable, "Copy")),
    h("p.small.muted", pretty === stable ? `This link uses the permanent ${platformLabel(res.platformName)} id.` : `The second link uses the permanent ${platformLabel(res.platformName)} id, so it keeps working after a rename or handle change.`),
  );
}

// ---- Home, below the lobby -----------------------------------------------------------------------

function homeBelow() {
  return h(
    "div.home",
    h(
      "section.beat.beat-key",
      { "aria-labelledby": "beat-key" },
      h("div.beat-copy", h("h2#beat-key.beat-title", "The box number is the account's id, not its name."), h(
        "p",
        "GitHub gives every repository and user a permanent number; X gives every account one. anyfee derives each box's address from that number, so it exists before anyone signs up, and it does not move when a repository is renamed or a handle changes.",
      )),
      h(
        "figure.formula",
        h("code.mono", "box = PDA( \"vault\", platform, id )"),
        h(
          "ul.formula-rows",
          h("li", h("span", "github.com/octocat/Hello-World"), h("span.arrow", "→"), h("span.mono", "repository 1 296 269")),
          h("li", h("span", "github.com/octocat"), h("span.arrow", "→"), h("span.mono", "user 583 231")),
          h("li", h("span", "@X, formerly @twitter"), h("span.arrow", "→"), h("span.mono", "X account 783 214")),
        ),
        h("figcaption.small.muted", "Platforms: 1 = GitHub user, 2 = GitHub repository, 3 = X account."),
      ),
    ),
    h(
      "section.beat.beat-routes",
      { "aria-labelledby": "beat-routes" },
      h("h2#beat-routes.beat-title", "Every letter ends one of three ways."),
      h(
        "ol.routes",
        h("li.route", h("span.route-stamp.stamp.stamp-green", "Delivered"), h("h3", "The owner claims"), h("p", "They prove control once, with a GitHub Actions run or a public X post, and the box is bound to their wallet. Only that wallet can withdraw.")),
        h("li.route", h("span.route-stamp.stamp.stamp-red", "Returned"), h("h3", "Nobody claims, or they decline"), h("p", "A direct tip carries a receipt. After 30 days unclaimed, or at once if the owner declines, anyone can press Refund and it goes back to the sender. Only to the sender.")),
        h("li.route", h("span.route-stamp.stamp.stamp-indigo", "Held"), h("h3", "Routed fees wait"), h("p", "Creator fees from pump.fun or Bags arrive without a receipt or a single sender, so they stay in the box until the owner claims it.")),
      ),
    ),
    h(
      "section.beat.beat-fees",
      { "aria-labelledby": "beat-fees" },
      h("div.beat-copy", h("h2#beat-fees.beat-title", "Launching a coin about someone's project? Pay the project."), h(
        "p",
        "Look up the repository or account above, copy its box address, and paste it as a shareholder in pump.fun's creator-fee sharing or as a fee earner on Bags. The maintainers claim whenever they are ready; nobody has to sign up first.",
      )),
      h("p.notice", h("strong", "Devnet only for now. "), "anyfee is not on mainnet. Do not route real fees to a box yet."),
    ),
    h(
      "section.beat.beat-trust",
      { "aria-labelledby": "beat-trust" },
      h("h2#beat-trust.beat-title", "What nobody behind the counter can do."),
      h(
        "ul.trust-grid",
        h("li", h("h3", "Take your money"), h("p", "There is no admin withdrawal. Money leaves a box only to its bound holder, or back to the original sender as a refund.")),
        h("li", h("h3", "Quietly swap a holder"), h("p", "The attester can bind a box, never withdraw. Re-pointing a claimed box waits 48 hours, and the holder can claim and cancel.")),
        h("li", h("h3", "Rank what's unclaimed"), h("p", "There is no leaderboard of unclaimed balances and no “claim your funds” outreach. You find a box only by asking for it.")),
        h("li", h("h3", "Vouch for anyone"), h("p", "A box is unverified until claimed. It is not an endorsement, and the owner may decline.")),
      ),
      h("p", h("a.btn.btn-ghost", { href: "/how" }, "How it works, and what can go wrong"), " ", h("a.btn.btn-ghost", { href: "/claim" }, "Is one of these boxes yours?")),
    ),
  );
}
