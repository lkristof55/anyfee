// Claim: pick the account type, connect the wallet that will hold the box, prove control
// (GitHub Actions OIDC via the workflow, or a public X post), bind, then claim.
// A pasted attestation JSON works for every type (for when the attester runs elsewhere).
import { PublicKey } from "@solana/web3.js";
import { DEVNET_ATTESTER, PLATFORM_NAMES, bindInstructions, claimProof, parseTarget, verifyAttestation } from "@anyfee/sdk";
import { copyButton, h, replace } from "../lib/dom.js";
import { ApiError, attestX, attesterHealth, attesterUrl, resolve, setAttesterUrl } from "../lib/api.js";
import { parseAttestations } from "../lib/attestations.js";
import { connection, explainError, sendInstructions } from "../lib/chain.js";
import { fmtDateTime, groupDigits, relTime, short } from "../lib/format.js";
import { current, onWallet, signer } from "../lib/wallet.js";
import { platformLabel, vaultPath } from "../routes.js";
import { ensureWallet } from "../ui/walletui.js";
import { toast } from "../ui/toast.js";
import { ownerPanel, recordCard, statusOf } from "./parts.js";

const TYPES = [
  { key: "github-repo", title: "GitHub repository", how: "Run one workflow on the default branch. Whoever can do that controls the repository's box." },
  { key: "github-user", title: "GitHub account", how: "Run the same workflow yourself, in a repository your personal account owns." },
  { key: "x", title: "X account", how: "Publish one public post with a short code, then paste its link." },
];

let active = null;

export function leaveClaim() {
  active?.dispose();
  active = null;
}

export function renderClaim(main, loc) {
  leaveClaim();
  active = createClaim(loc);
  replace(main, active.el);
}

function workflowYaml(wallet, attester) {
  return `name: anyfee claim

on:
  workflow_dispatch:
    inputs:
      claimant:
        description: Solana wallet (base58) that will be able to claim this repository's vault
        required: true
        default: ${wallet}
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
          claimant: \${{ inputs.claimant }}
          attester-url: ${attester}
          claim: \${{ inputs.claim }}
`;
}

function createClaim(loc) {
  const params = new URLSearchParams(loc.search);
  let type = TYPES.some((t) => t.key === params.get("type")) ? params.get("type") : null;
  let identityQuery = params.get("q") ?? "";
  let box = null; // resolve result of the box being claimed
  let pollTimer = 0;
  let disposed = false;
  const offs = [];
  const track = (fn) => offs.push(fn);
  let stepOffs = [];
  const stepTrack = (fn) => stepOffs.push(fn);

  const typeStep = h("li.step", h("h2.step-title", "Which account?"));
  const walletStep = h("li.step", h("h2.step-title", "The wallet that will hold the box"));
  const proveStep = h("li.step", h("h2.step-title", "Prove control"));
  const boxStep = h("li.step", h("h2.step-title", "The box"));
  const el = h(
    "section.claim",
    h(
      "header.page-head",
      h("p.kicker", "Claim"),
      h("h1.display.display-page", "Prove it's yours once. The box follows your wallet."),
      h(
        "p.lede",
        "You never share a password or a token. The attester checks a GitHub Actions run or a public X post and signs a short statement: this box may be bound to this wallet. The program checks that signature on-chain.",
      ),
    ),
    h("ol.steps", typeStep, walletStep, proveStep, boxStep),
  );

  // ---- step 1: type
  const typeList = h(
    "div.type-options",
    { role: "radiogroup", "aria-label": "Account type" },
    TYPES.map((t) =>
      h(
        "label.type-option",
        h("input", {
          type: "radio",
          name: "claim-type",
          value: t.key,
          checked: t.key === type,
          onchange: () => {
            type = t.key;
            if (!identityQuery.startsWith(`${t.key}:`)) identityQuery = "";
            box = null;
            history.replaceState({}, "", `/claim?type=${t.key}`);
            drawProve();
            drawBox();
          },
        }),
        h("span.type-title", t.title),
        h("span.type-how", t.how),
      ),
    ),
  );
  typeStep.append(typeList);

  // ---- step 2: wallet
  const walletBody = h("div.step-body");
  walletStep.append(walletBody);
  const onWalletChange = (s) => {
      if (s.connected) {
        replace(
          walletBody,
          h("p", "Connected: ", h("code.mono", s.address), " ", copyButton(s.address, "Copy")),
          h("p.small.muted", "Only this wallet will be able to withdraw from the box. Use a wallet you control; switch it to devnet."),
        );
      } else {
        replace(
          walletBody,
          h("p.muted", "Connect the wallet you want the box bound to."),
          h("button.btn.btn-brass", { type: "button", onclick: () => ensureWallet().catch(() => {}) }, "Connect wallet"),
        );
      }
    drawProve();
    drawBox();
  };

  // ---- step 3: prove
  const proveBody = h("div.step-body");
  proveStep.append(proveBody);

  function attesterField() {
    const input = h("input.input.input-mono", { value: attesterUrl(), "aria-label": "Attester URL", spellcheck: "false" });
    const info = h("p.small.muted", { "aria-live": "polite" });
    const check = async () => {
      const base = setAttesterUrl(input.value);
      input.value = base;
      replace(info, "Checking the attester…");
      try {
        const hlt = await attesterHealth(base);
        const local = /^http:\/\/(localhost|127\.|\[::1\])/.test(base);
        replace(
          info,
          `Attester ${short(hlt.attester ?? "(no key)", 6)} · `,
          hlt.submit ? "submits the bind itself (you only wait)" : "signs only (you submit the bind from this page)",
          hlt.attester && hlt.attester !== DEVNET_ATTESTER.toBase58() ? h("strong", " · not the devnet program's attester: its signatures will be rejected on-chain") : "",
          local && type !== "x" ? h("span.block", "GitHub's runners cannot reach a local attester. Use a public attester URL, or paste the attestation below.") : "",
        );
        return hlt;
      } catch {
        replace(info, h("span.error", "Could not reach an attester at that URL."));
        return null;
      }
    };
    input.addEventListener("change", () => {
      check();
      drawProve();
    });
    queueMicrotask(check);
    return h("div.attester", h("label.field-label", "Attester URL"), input, info);
  }

  function pasteBlock() {
    const ta = h("textarea.input.input-mono.paste", { rows: 6, spellcheck: "false", placeholder: '{ "platform": 3, "id": "…", "claimant": "…", "expiresAt": …, "message": "…", "signature": "…", "attester": "…" }', "aria-label": "Attestation JSON" });
    const out = h("div.paste-out", { "aria-live": "polite" });
    const btn = h("button.btn.btn-ghost", { type: "button" }, "Check attestation");
    btn.addEventListener("click", () => {
      let list;
      try {
        list = parseAttestations(ta.value);
      } catch (e) {
        replace(out, h("p.error", e.message));
        return;
      }
      showAttestations(list, out);
    });
    return h(
      "details.paste-block",
      { open: type === "x" && params.has("paste") ? true : undefined },
      h("summary", "Paste an attestation instead"),
      h("p.small.muted", "If the attester runs elsewhere, or only signs, paste the JSON it returned (one attestation, a list, or its whole response). Anyone may submit a bind; it only ever binds the wallet named inside."),
      ta,
      h("div.row", btn),
      out,
    );
  }

  /** Verifies attestations locally (SDK), then offers to submit the bind with the wallet. */
  function showAttestations(list, out) {
    const rows = [];
    const valid = [];
    for (const a of list) {
      try {
        const v = verifyAttestation(a, { expectedAttester: box?.config?.attester ? new PublicKey(box.config.attester) : DEVNET_ATTESTER });
        valid.push(a);
        const mine = current().address === v.claimant.toBase58();
        rows.push(
          h(
            "li.att",
            h("strong", `${platformLabel(PLATFORM_NAMES[v.platform])} #${groupDigits(v.id.toString())}`),
            " → ",
            h("span.mono", short(v.claimant.toBase58(), 6)),
            h("span.small.muted", ` · expires ${relTime(Number(v.expiresAt))}`),
            mine ? null : h("span.block.notice.notice-red", "This binds the box to a different wallet than the one connected. You can still submit it, but only that wallet will be able to withdraw."),
          ),
        );
      } catch (e) {
        rows.push(h("li.att.error", `Rejected: ${e.message}`));
      }
    }
    const status = h("p.form-status", { role: "status" });
    const bindBtn = h("button.btn.btn-brass", { type: "button", disabled: !valid.length }, valid.length > 1 ? `Bind ${valid.length} boxes` : "Bind with my wallet");
    bindBtn.addEventListener("click", () => submitBinds(valid, bindBtn, status));
    replace(out, h("ul.att-list", rows), valid.length ? h("div.row", bindBtn) : null, status);
  }

  async function submitBinds(atts, button, status) {
    button.disabled = true;
    try {
      await ensureWallet();
      const w = signer();
      const payer = new PublicKey(w.address);
      let last = null;
      for (const a of atts) {
        status.textContent = "Checking the transaction…";
        const ixs = await bindInstructions(connection(), a, { payer, expectedAttester: box?.config?.attester ? new PublicKey(box.config.attester) : DEVNET_ATTESTER });
        const before = await resolve(`${PLATFORM_NAMES[a.platform]}:${a.id}`, { fresh: true }).catch(() => null);
        const rebind = !!before?.claimant && before.claimant !== a.claimant;
        const sig = await sendInstructions(ixs, w, {
          onStatus: (s) => (status.textContent = { prepare: "Checking the transaction…", sign: "Approve it in your wallet…", send: "Sending…", confirm: "Waiting for devnet to confirm…" }[s] ?? ""),
        });
        const what = `${platformLabel(PLATFORM_NAMES[a.platform])} #${a.id}`;
        toast({
          kind: "ok",
          title: rebind ? `Change of holder requested for ${what}` : `Bound ${what}`,
          body: rebind ? "The box already had a holder: the change waits for the rebind delay, and the holder can cancel it." : undefined,
          sig,
        });
        last = a;
      }
      status.textContent = "Bound. The box is below.";
      if (last) {
        identityQuery = `${PLATFORM_NAMES[last.platform]}:${last.id}`;
        await loadBox(true);
      }
    } catch (e) {
      status.textContent = explainError(e);
      toast({ kind: "error", title: "Bind not sent", body: explainError(e) });
    } finally {
      button.disabled = false;
    }
  }

  function drawProve() {
    stopPolling();
    const w = current();
    if (!type) {
      replace(proveBody, h("p.muted", "Pick the kind of account first."));
      return;
    }
    if (!w.connected) {
      replace(proveBody, h("p.muted", "Connect a wallet first: the proof names it."));
      return;
    }
    if (type === "x") return drawProveX(w.address);
    drawProveGithub(w.address);
  }

  function identityInput(label, placeholder, onFound) {
    const input = h("input.input", { value: identityQuery, placeholder, spellcheck: "false", autocomplete: "off", "aria-label": label });
    const msg = h("p.small", { "aria-live": "polite" });
    const go = async () => {
      const q = input.value.trim();
      if (!q) return;
      try {
        parseTarget(q);
      } catch (e) {
        replace(msg, h("span.error", e.message));
        return;
      }
      replace(msg, "Looking it up…");
      try {
        const res = await resolve(q);
        if (res.platformName !== type) {
          replace(msg, h("span.error", `That is a ${platformLabel(res.platformName)}, not a ${platformLabel(type)}.`));
          return;
        }
        identityQuery = `${res.platformName}:${res.id}`;
        input.value = res.platformName === "x" ? res.display : `github.com/${res.display}`;
        replace(msg, "");
        box = res;
        onFound(res);
        drawBox();
      } catch (e) {
        replace(msg, h("span.error", e instanceof ApiError && e.status === 404 ? "Not found. Check the spelling (it may be private)." : (e.message ?? "Lookup failed.")));
      }
    };
    input.addEventListener("change", go);
    input.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), go()));
    return { el: h("div.identity", h("label.field-label", label), h("div.row", input, h("button.btn.btn-ghost", { type: "button", onclick: go }, "Look up")), msg), go, input };
  }

  function drawProveGithub(wallet) {
    const isUser = type === "github-user";
    const workflow = h("div.workflow");
    const hostRepo = h("input.input", { placeholder: "your-login/any-repo", spellcheck: "false", "aria-label": "Repository to run the workflow in" });
    const drawWorkflow = (repoFull, branch) => {
      const yaml = workflowYaml(wallet, attesterUrl());
      const links = [];
      if (repoFull) {
        const newUrl = `https://github.com/${repoFull}/new/${encodeURIComponent(branch || "main")}?filename=${encodeURIComponent(".github/workflows/anyfee-claim.yml")}&value=${encodeURIComponent(yaml)}`;
        links.push(
          h("a.btn.btn-brass", { href: newUrl, target: "_blank", rel: "noopener" }, "Add it to the repository ↗"),
          h("a.btn.btn-ghost", { href: `https://github.com/${repoFull}/actions/workflows/anyfee-claim.yml`, target: "_blank", rel: "noopener" }, "Open the workflow's Run button ↗"),
        );
      }
      replace(
        workflow,
        h("p", "Commit this file to the ", h("strong", "default branch"), " as ", h("code.mono", ".github/workflows/anyfee-claim.yml"), ". Your wallet is pre-filled; the only permission it needs is ", h("code.mono", "id-token: write"), "."),
        h("div.code-wrap", h("pre.code", h("code", yaml)), copyButton(yaml, "Copy YAML", "code-copy")),
        h("p.small.muted", "The action is not published yet: replace ", h("code.mono", "OWNER/anyfee/action@v0.1.0"), " with its location (the ", h("code.mono", "action/"), " folder of the anyfee repository)."),
        h("p", "Then open ", h("strong", "Actions → anyfee claim → Run workflow"), " and keep the default branch. The run sends GitHub's signed token to the attester; nothing else leaves the runner."),
        links.length ? h("div.row.row-wrap", links) : null,
        h("p.small.muted", isUser ? "Run it yourself, in a repository your personal account owns: the attester checks that the person who ran it owns the repository. With claim: both, the same run also claims that repository's box." : "Anyone who can run workflows on the default branch can claim the repository's box. If it was claimed before, a new claim waits 48 hours and the current holder can cancel it."),
      );
    };
    const ident = identityInput(isUser ? "Your GitHub username" : "Repository", isUser ? "github.com/your-login" : "github.com/owner/repo", (res) => {
      if (isUser && res.github?.type === "Organization") {
        replace(workflow, h("p.notice.notice-red", "This is an organization. Only personal accounts can claim a GitHub-account box; organizations are paid through their repositories."));
        return;
      }
      if (isUser) {
        hostRepo.value ||= `${res.display}/`;
        drawWorkflow(/^[^/]+\/[^/]+$/.test(hostRepo.value) ? hostRepo.value : null, "main");
      } else {
        drawWorkflow(res.display, res.github?.defaultBranch);
      }
      startPolling();
    });
    hostRepo.addEventListener("change", async () => {
      const v = hostRepo.value.trim().replace(/^https?:\/\/github\.com\//, "");
      if (!/^[^/]+\/[^/]+$/.test(v)) return drawWorkflow(null);
      try {
        const r = await resolve(`github.com/${v}`);
        drawWorkflow(r.display, r.github?.defaultBranch);
      } catch {
        drawWorkflow(v, "main");
      }
    });
    replace(
      proveBody,
      attesterField(),
      ident.el,
      isUser ? h("div.identity", h("label.field-label", "Repository to run it in"), hostRepo) : null,
      workflow,
      pasteBlock(),
    );
    if (identityQuery) ident.go();
    else drawWorkflow(null);
  }

  function drawProveX(wallet) {
    const proof = claimProof(wallet);
    const text = `Claiming my anyfee box ${proof}`;
    const url = h("input.input", { placeholder: "https://x.com/you/status/1234567890", spellcheck: "false", "aria-label": "Post URL" });
    const out = h("div.x-out", { "aria-live": "polite" });
    const verify = h("button.btn.btn-brass", { type: "button" }, "Verify the post");
    verify.addEventListener("click", async () => {
      const v = url.value.trim();
      if (!v) return;
      verify.disabled = true;
      replace(out, h("p.loading", "Asking the attester to read the post…"));
      try {
        const r = await attestX(v, wallet);
        const sub = r.submitted?.[0];
        replace(out, h("p", "Verified: post by ", h("strong", `@${r.post.authorHandle}`), ` (X account #${groupDigits(r.post.authorId)}).`));
        identityQuery = `x:${r.post.authorId}`;
        if (sub && (sub.status === "sent" || sub.status === "already_bound" || sub.status === "rebind_already_pending")) {
          out.append(h("p", "The attester submitted the bind itself. Watching the box…"));
          await loadBox(true);
          startPolling();
        } else {
          if (sub?.status === "failed") out.append(h("p.notice.notice-red", `The attester could not submit the bind (${sub.error ?? "failed"}); submit it yourself:`));
          const holder = h("div");
          out.append(holder);
          await loadBox(true);
          showAttestations(r.attestations, holder);
        }
      } catch (e) {
        replace(out, h("p.error", e instanceof ApiError ? xError(e) : explainError(e)));
      } finally {
        verify.disabled = false;
      }
    });
    replace(
      proveBody,
      h("p", "Publish a ", h("strong", "public"), " post from the account that contains exactly this code:"),
      h("div.proof", h("code.mono.proof-code", proof), copyButton(proof, "Copy")),
      h("div.row.row-wrap", h("a.btn.btn-ghost", { href: `https://x.com/intent/post?text=${encodeURIComponent(text)}`, target: "_blank", rel: "noopener" }, "Open the X composer ↗")),
      h("p.small.muted", "The attester reads the post, takes the author's numeric id from X (the handle in the link is ignored) and signs. Posts older than 24 hours are refused. You can delete the post once the box is bound."),
      attesterField(),
      h("label.field-label", "Link to your post"),
      h("div.row", url, verify),
      out,
      pasteBlock(),
    );
  }

  // ---- step 4: the box
  const boxBody = h("div.step-body");
  boxStep.append(boxBody);

  async function loadBox(fresh = false) {
    if (!identityQuery) return;
    try {
      box = await resolve(identityQuery, { fresh });
      drawBox();
    } catch {
      /* keep the last state */
    }
  }

  function drawBox() {
    for (const fn of stepOffs) fn();
    stepOffs = [];
    if (!box) {
      replace(boxBody, h("p.muted", "The box appears here once you name the account or submit a proof."));
      return;
    }
    const me = current().address;
    const bound = box.claimant && box.claimant === me;
    const pendingMine = box.pending && box.pending.claimant === me;
    const state = bound
      ? h("p.notice.notice-green", "Bound to your wallet. Claim whenever you like; manage the box below.")
      : pendingMine
        ? h("p.notice", `Your claim is pending: this box already had a holder, so the change takes effect ${fmtDateTime(box.pending.effectiveAt)} (${relTime(box.pending.effectiveAt)}) unless they cancel it.`)
        : box.claimant
          ? h("p.notice", "This box is held by ", h("span.mono", short(box.claimant)), ". A new proof requests a change that waits 48 hours; the holder can cancel it.")
          : h("p.muted", pollTimer ? "Not bound yet. Watching the box (every 6 seconds)…" : "Not bound yet.");
    replace(
      boxBody,
      recordCard(box),
      state,
      ownerPanel(box, { refresh: () => loadBox(true), claimHref: "#", inClaim: true, track: stepTrack }),
      h("p", h("a", { href: vaultPath(box) }, `Open the box page for ${box.display} →`)),
    );
    if (bound || pendingMine) stopPolling();
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (disposed) return stopPolling();
      loadBox(true);
    }, 6000);
  }
  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = 0;
  }

  if (identityQuery && !type) {
    try {
      const t = parseTarget(identityQuery);
      if (t.kind === "id") type = PLATFORM_NAMES[t.platform];
    } catch {
      /* ignore */
    }
  }
  track(onWallet(onWalletChange)); // draws steps 2-4
  if (identityQuery) loadBox();

  return {
    el,
    dispose() {
      disposed = true;
      stopPolling();
      for (const fn of [...offs, ...stepOffs]) fn();
    },
  };
}

function xError(e) {
  const map = {
    proof_missing: "The post does not contain your anyfee code. Post it exactly as shown.",
    proof_mismatch: "The post names a different wallet than the one connected.",
    proof_ambiguous: "The post names more than one wallet. Post a new one with just yours.",
    post_too_old: "The post is older than 24 hours. Post a fresh one.",
    post_in_future: "The post's timestamp is in the future.",
    post_not_found: "Post not found. It must be public (protected accounts do not work).",
    bad_tweet_url: "That does not look like a link to a post (x.com/<handle>/status/<id>).",
    not_configured: "This attester has no signing key. Point the attester URL at one that does.",
  };
  return map[e.code] ?? e.message;
}

export { statusOf };
