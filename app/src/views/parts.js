// Building blocks of a vault page: the readout, the tip form, the creator-fee notes, the sender's
// receipts and the owner's panel. Every chain action goes through the SDK builders.
import { PublicKey } from "@solana/web3.js";
import {
  cancelRebindIx,
  claimAllInstructions,
  closeTipIx,
  createAtaIdempotentIx,
  declineIx,
  finalizeRebindIx,
  refundIxForTip,
  tipSolInstructions,
  tipTokenInstructions,
} from "@anyfee/sdk";
import { copyButton, h, replace } from "../lib/dom.js";
import { explorerAddress, fmtDate, fmtDateTime, groupDigits, parseUnits, relTime, short, sol, toBig, usdc, duration } from "../lib/format.js";
import { connection, explainError, rentExempt, sendInstructions, tipsOf, tokenBalance, balance } from "../lib/chain.js";
import { current, onWallet, signer } from "../lib/wallet.js";
import { platformLabel } from "../routes.js";
import { ensureWallet } from "../ui/walletui.js";
import { toast } from "../ui/toast.js";

export const TIP_SIZE = 130;
export const MIN_TIP_LAMPORTS = 1_000_000n; // 0.001 SOL: below this the receipt deposit dwarfs the tip
export const MIN_TIP_USDC = 100_000n; // 0.10 USDC

export function statusOf(res) {
  if (res.declined) return "declined";
  if (res.pending) return "pending";
  if (res.claimant) return "claimed";
  return "unclaimed";
}

export function isOrgUserVault(res) {
  return res.platformName === "github-user" && res.github?.type === "Organization";
}

export function avatarUrl(res, profile) {
  if (res.platformName === "github-repo" && res.github?.owner?.id) return `https://avatars.githubusercontent.com/u/${res.github.owner.id}?s=120&v=4`;
  if (res.platformName === "github-user" && res.github?.avatarUrl?.startsWith("https://avatars.githubusercontent.com/")) {
    return `${res.github.avatarUrl}${res.github.avatarUrl.includes("?") ? "&" : "?"}s=120`;
  }
  return profile?.avatarUrl ?? null;
}

const TAG = {
  unclaimed: ["Unclaimed", "tag"],
  claimed: ["Claimed", "tag tag-solid"],
  declined: ["Declined", "tag tag-accent"],
  pending: ["Rebind pending", "tag tag-accent"],
};

async function runTx(label, buildIxs, { onDone, button, status, failLabel = "Transaction not sent" } = {}) {
  const setStatus = (t) => status && (status.textContent = t);
  if (button) button.disabled = true;
  try {
    await ensureWallet();
    const w = signer();
    setStatus("Preparing…");
    const ixs = await buildIxs(new PublicKey(w.address));
    if (!ixs.length) {
      setStatus("Nothing to do right now.");
      return null;
    }
    const sig = await sendInstructions(ixs, w, {
      onStatus: (s) =>
        setStatus({ prepare: "Checking the transaction…", sign: "Approve it in your wallet…", send: "Sending…", confirm: "Waiting for devnet to confirm…" }[s] ?? ""),
    });
    setStatus("");
    toast({ kind: "ok", title: label, sig });
    await onDone?.(sig);
    return sig;
  } catch (e) {
    const msg = explainError(e);
    setStatus(msg);
    if (!/No wallet connected/.test(String(e?.message))) toast({ kind: "error", title: failLabel, body: msg });
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

// ---- Readout -----------------------------------------------------------------------------------

function row(key, label, ...value) {
  return h(`div.field.field-${key}`, h("dt", label), h("dd", ...value));
}

export function recordCard(res, { profile, figure, level = 2 } = {}) {
  const st = statusOf(res);
  const [tagText, tagClass] = TAG[st];
  const avatar = avatarUrl(res, profile);
  const b = res.balances;
  const rent = toBig(b?.rentExemptLamports);
  const lamports = toBig(b?.lamports);
  const inVault = lamports > rent ? lamports - rent : 0n;
  const outstanding = toBig(res.tips?.outstandingLamports);
  const outstandingTok = toBig(res.tips?.outstandingTokens);
  const name = res.display ?? `${res.platformName}:${res.id}`;
  const nameEl = res.url ? h("a", { href: res.url, target: "_blank", rel: "noopener" }, name, h("span.ext", { "aria-hidden": "true" }, " ↗")) : name;

  let statusText;
  if (st === "unclaimed") {
    statusText = `Unverified until claimed. Nobody has proven control of this ${platformLabel(res.platformName)} yet; the vault exists whether or not its owner knows about anyfee. Not an endorsement.`;
  } else if (st === "claimed") {
    statusText = "Claimed. The owner's wallet proved control through the attester; only it can withdraw.";
  } else if (st === "declined") {
    statusText = "The owner declined tips. New tips are rejected and outstanding tips can be refunded to their senders now. Routed fees stay claimable by the owner.";
  } else {
    statusText = h(
      "span",
      "A rebind to ",
      h("span.mono", short(res.pending.claimant)),
      ` takes effect ${fmtDateTime(res.pending.effectiveAt)} (${relTime(res.pending.effectiveAt)}) unless the current owner cancels it.`,
    );
  }

  const owner = res.claimant
    ? [h("a.mono", { href: explorerAddress(res.claimant), target: "_blank", rel: "noopener" }, short(res.claimant, 6)), res.boundAt ? h("small.muted.block", `bound ${fmtDate(res.boundAt)}`) : null]
    : [h("span.muted", "none — unclaimed")];
  const pending = res.pending
    ? [h("span.mono", `→ ${short(res.pending.claimant, 6)}`), h("small.muted.block", `effective ${fmtDateTime(res.pending.effectiveAt)} (${relTime(res.pending.effectiveAt)})`)]
    : [h("span.muted", "none")];

  const warnings = (res.warnings ?? []).filter((w) => !/change of claimant is pending|declined tips/i.test(w));
  return h(
    "article.readout.record",
    { "aria-labelledby": "record-name" },
    h(
      "header.readout-head",
      avatar ? h("img.avatar", { src: avatar, alt: "", width: 48, height: 48, loading: "lazy", referrerpolicy: "no-referrer" }) : h("span.avatar.avatar-mono", { "aria-hidden": "true" }, res.platformName === "x" ? "X" : "#"),
      h("div.readout-title", h("p.label", `${platformLabel(res.platformName)} · `, h("span.nowrap", `id ${groupDigits(res.id)}`)), h(`h${level}#record-name.record-name`, nameEl)),
      h(`span.${tagClass.split(" ").join(".")}.readout-tag`, tagText),
    ),
    h(
      "div.readout-body",
      h(
        "dl.readout-fields",
        row("id", "Identity", h("span.mono", `${res.platformName}:${res.id}`), h("small.muted.block", `platform ${res.platform} · permanent numeric id`)),
        row(
          "vault",
          "Vault",
          h("code.mono.address", res.vault ?? "—"),
          res.vault ? h("span.address-actions", copyButton(res.vault, "Copy"), h("a.btn.btn-small.btn-ghost", { href: explorerAddress(res.vault), target: "_blank", rel: "noopener" }, "Explorer ↗")) : null,
        ),
        row("status", "Status", statusText),
        row(
          "balance",
          "Balance",
          h("span.amount", sol(inVault, 4), h("small", " SOL")),
          h("span.amount", usdc(b?.usdc?.amount ?? 0n), h("small", " USDC")),
          rent > 0n ? h("small.muted.block", `+ ${sol(rent, 5)} SOL rent that stays in the vault`) : null,
        ),
        row("owner", "Owner", ...owner),
        row("pending", "Rebind", ...pending),
        row(
          "tips",
          "Tips",
          h("span.amount", String(res.tips?.count ?? 0), h("small", " received")),
          outstanding > 0n || outstandingTok > 0n
            ? h("small.muted.block", `${outstanding > 0n ? sol(outstanding, 4) + " SOL" : ""}${outstanding > 0n && outstandingTok > 0n ? " + " : ""}${outstandingTok > 0n ? usdc(outstandingTok) + " USDC" : ""} still returnable to senders`)
            : h("small.muted.block", res.initialized ? "none waiting to be returned" : "vault not opened on-chain yet"),
        ),
      ),
      figure ? h("div.readout-fig", figure) : null,
    ),
    res.chainError ? h("p.notice.notice-red", "Could not read the chain right now; balances may be missing. ", res.chainError) : null,
    warnings.length ? h("ul.notices", warnings.map((w) => h("li.notice", w))) : null,
  );
}

// ---- Tip form ----------------------------------------------------------------------------------

let tipRent = null;

export function tipForm(res, { refresh, track = () => {}, onLanded = () => {} }) {
  const status = h("p.form-status", { role: "status", "aria-live": "polite" });
  const disabledReason = res.declined
    ? "The owner declined tips, so direct tips are rejected. Fees routed here still reach the owner."
    : res.config?.paused
      ? "anyfee is paused (the brake for attester incidents), so new tips are rejected for now."
      : isOrgUserVault(res)
        ? "This is a GitHub organization's account vault. Organizations can never claim it; tip one of their repositories instead."
        : null;

  let currency = "SOL";
  const amount = h("input#tip-amount.input.input-amount", { inputmode: "decimal", autocomplete: "off", value: "0.01", "aria-describedby": "tip-costs" });
  const unit = h("span.input-unit", "SOL");
  const presets = h("div.presets");
  const costs = h("dl#tip-costs.costs");
  const submit = h("button.btn.btn-primary.btn-block", { type: "submit" });
  const own = h("p.small.muted");

  const PRESETS = { SOL: ["0.001", "0.01", "0.05", "0.1"], USDC: ["1", "5", "10"] };
  const drawPresets = () =>
    replace(
      presets,
      PRESETS[currency].map((v) =>
        h("button.chip", { type: "button", onclick: () => ((amount.value = v), update()) }, `${v} ${currency}`),
      ),
    );

  const seg = h(
    "div.segmented",
    { role: "radiogroup", "aria-label": "Currency" },
    ["SOL", "USDC"].map((c) =>
      h(
        "label.seg",
        h("input", { type: "radio", name: "tip-currency", value: c, checked: c === "SOL", onchange: () => ((currency = c), (unit.textContent = c), (amount.value = c === "SOL" ? "0.01" : "5"), drawPresets(), update()) }),
        h("span", c),
      ),
    ),
  );

  const parsed = () => parseUnits(amount.value, currency === "SOL" ? 9 : 6);

  function update() {
    const v = parsed();
    const vaultRent = res.initialized ? 0n : (() => {
      const r = toBig(res.balances?.rentExemptLamports);
      const l = toBig(res.balances?.lamports);
      return r > l ? r - l : 0n;
    })();
    const receipt = tipRent ?? 1_310_640n;
    const fee = 5_000n;
    const rows = [
      ["Into the vault", v === null ? "?" : currency === "SOL" ? `${sol(v, 9)} SOL` : `${usdc(v, 6)} USDC`],
      [h("span", "Receipt deposit ", h("small", "(comes back to you on refund or close)")), `${sol(receipt, 6)} SOL`],
    ];
    if (vaultRent > 0n) rows.push([h("span", "Opening the vault ", h("small", "(first tip only; stays as its rent)")), `${sol(vaultRent, 6)} SOL`]);
    rows.push(["Network fee", `≈ ${sol(fee, 6)} SOL`]);
    const solTotal = (currency === "SOL" && v !== null ? v : 0n) + receipt + vaultRent + fee;
    rows.push(["You pay", currency === "SOL" ? `${sol(solTotal, 6)} SOL` : `${v === null ? "?" : usdc(v, 6)} USDC + ${sol(solTotal, 6)} SOL`]);
    replace(costs, rows.map(([k, val], i) => [h(i === rows.length - 1 ? "dt.costs-total" : "dt", k), h(i === rows.length - 1 ? "dd.costs-total" : "dd", val)]));
    const min = currency === "SOL" ? MIN_TIP_LAMPORTS : MIN_TIP_USDC;
    const bad = v === null || v < min;
    submit.disabled = !!disabledReason || bad;
    const c = current();
    submit.textContent = disabledReason
      ? "Tips are closed for this vault"
      : !c.connected
        ? "Connect a wallet to send"
        : bad
          ? `Minimum ${currency === "SOL" ? "0.001 SOL" : "0.10 USDC"}`
          : `Send ${currency === "SOL" ? sol(v, 9) : usdc(v, 6)} ${currency}`;
    if (!c.connected && !disabledReason) submit.disabled = false;
  }

  if (tipRent === null) rentExempt(TIP_SIZE).then((r) => ((tipRent = r), update())).catch(() => {});
  amount.addEventListener("input", update);
  const off = onWallet(async (s) => {
    update();
    if (!s.connected) return replace(own, "");
    try {
      const [bal, tok] = await Promise.all([balance(s.address), tokenBalance(s.address, res.balances?.usdc?.mint ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")]);
      replace(
        own,
        `Your wallet: ${sol(bal, 4)} SOL · ${usdc(tok.amount)} USDC (devnet). `,
        bal < 5_000_000n ? h("a", { href: "https://faucet.solana.com", target: "_blank", rel: "noopener" }, "Get devnet SOL ↗") : null,
        currency === "USDC" && tok.amount === 0n ? [" ", h("a", { href: "https://faucet.circle.com", target: "_blank", rel: "noopener" }, "Get devnet USDC ↗")] : null,
      );
    } catch {
      replace(own, "");
    }
  });

  const form = h(
    "form.tipform",
    {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!current().connected) {
          ensureWallet().then(update, () => {});
          return;
        }
        const v = parsed();
        if (v === null) return;
        const platform = res.platform;
        const id = BigInt(res.id);
        const label = `Tip of ${currency === "SOL" ? sol(v, 9) : usdc(v, 6)} ${currency} confirmed`;
        const build = (sender) =>
          currency === "SOL"
            ? tipSolInstructions(connection(), { platform, id, sender, amount: v })
            : tipTokenInstructions(connection(), { platform, id, sender, amount: v });
        const sig = await runTx(label, build, { button: submit, status, failLabel: "Tip not sent", onDone: async () => {
          onLanded();
          replace(status, h("span.ok", "Confirmed. Your receipt is listed under “Your tips to this vault”."));
          await refresh();
        } });
        if (!sig && /same moment/.test(status.textContent)) {
          await runTx(label, build, { button: submit, status, failLabel: "Tip not sent", onDone: async () => (onLanded(), await refresh()) });
        }
        update();
      },
    },
    h("h3.form-title", "Send a tip"),
    disabledReason
      ? h("p.notice.notice-red", disabledReason)
      : [seg, h("label.visually-hidden", { for: "tip-amount" }, "Amount"), h("div.input-wrap", amount, unit), presets, costs, submit, status, own],
    disabledReason ? null : h(
      "p.small.muted",
      res.claimant && !res.declined
        ? "This vault has an owner, so your tip goes to them. It cannot be refunded once it lands."
        : "If nobody claims the vault within 30 days, anyone can press Refund and your tip comes back to you (the button appears under “Your tips to this vault”).",
    ),
  );
  drawPresets();
  update();
  track(off);
  return form;
}

// ---- Fee recipient -------------------------------------------------------------------------------

export function feePanel(res) {
  const org = isOrgUserVault(res);
  const rent = toBig(res.balances?.rentExemptLamports);
  return h(
    "section.panel.panel-fees",
    { "aria-labelledby": "fees-title" },
    h("h2#fees-title.panel-title", "For coin launchers: route creator fees here"),
    org
      ? h("p.notice.notice-red", h("strong", "Do not route fees here. "), "A GitHub organization can never claim its account vault, and fees have no sender to return to: they would be stuck for good. Use one of the organization's repositories instead.")
      : null,
    h(
      "div.fee-address",
      h("span.fee-label", "Paste this address"),
      h("code.mono.fee-code", res.vault),
      copyButton(res.vault, "Copy address"),
    ),
    h(
      "div.fee-cols",
      h(
        "div",
        h("h3", "pump.fun"),
        h("p", "In the coin's creator-fee sharing settings (its SharingConfig), add this address as a shareholder with the share you want to give."),
      ),
      h(
        "div",
        h("h3", "Bags"),
        h("p", "When you set up fee sharing, add this address as a fee earner by wallet address."),
      ),
    ),
    h(
      "ul.fine",
      h("li", "Fees have no single sender, so they are ", h("strong", "never refunded"), ". They wait in the vault until the owner claims it, which may be never."),
      h("li", "Routing fees here is not an endorsement: the account's owner has not agreed to your coin."),
      h("li", `If fees arrive before anyone opens the vault on-chain, the first ${sol(rent || 1_437_640n, 5)} SOL become the vault's rent. Every later claim leaves exactly that rent behind.`),
      h("li", "Only SOL and the program's USDC mint (", h("code.mono", short(res.balances?.usdc?.mint ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", 6)), ") can be claimed. Any other token sent here is stuck forever."),
      h("li", h("strong", "Devnet only. "), "anyfee is not deployed on mainnet. Do not put this address into a mainnet coin: funds there would sit unclaimable until a mainnet program exists."),
    ),
  );
}

// ---- Sender's receipts -------------------------------------------------------------------------------

export function senderPanel(res, { refresh, track = () => {} }) {
  const body = h("div.panel-body");
  const panel = h(
    "section.panel.panel-tips",
    { "aria-labelledby": "tips-title" },
    h("h2#tips-title.panel-title", "Your tips to this vault"),
    body,
  );
  const now = () => Math.floor(Date.now() / 1000);
  const windowSecs = Number(res.config?.refundWindowSecs ?? 2_592_000);

  async function load(address) {
    if (!address) {
      replace(body, h("p.muted", "Connect the wallet you tipped from to see your receipts, their refund dates and the refund button."), h("button.btn.btn-ghost", { type: "button", onclick: () => ensureWallet().catch(() => {}) }, "Connect wallet"));
      return;
    }
    if (!res.initialized || toBig(res.tips?.count) === 0n) {
      replace(body, h("p.muted", "No tips in this vault yet."));
      return;
    }
    replace(body, h("p.muted.loading", "Looking for your receipts…"));
    let tips;
    try {
      tips = await tipsOf(res.vault, address, res.tips.count);
    } catch (e) {
      replace(body, h("p.notice.notice-red", "Could not read your receipts: ", explainError(e)));
      return;
    }
    if (!tips.length) {
      replace(body, h("p.muted", `No open receipts from ${short(address)} in this vault. Refunded and closed receipts disappear from the chain.`));
      return;
    }
    const epoch = toBig(res.tips.claimEpoch);
    const rows = tips.map((t) => {
      const isToken = !!t.tip.mint;
      const amt = isToken ? `${usdc(t.tip.amount, 6)} USDC` : `${sol(t.tip.amount, 9)} SOL`;
      const created = Number(t.tip.createdAt);
      const opens = created + windowSecs;
      const status = h("span.receipt-status");
      const action = h("span.receipt-action");
      const line = h("p.receipt-line.small");
      if (t.tip.epoch < epoch) {
        replace(status, h("span.tag.tag-solid", "Claimed by owner"));
        replace(line, `The owner claimed it. The receipt still holds your ${sol(t.lamports, 5)} SOL deposit: closing it sends that back to you.`);
        action.append(
          h(
            "button.btn.btn-small.btn-ghost",
            {
              type: "button",
              onclick: (e) =>
                runTx("Receipt closed, deposit returned", async () => [closeTipIx({ platform: res.platform, id: BigInt(res.id), tipIndex: t.index, sender: t.tip.sender })], {
                  button: e.currentTarget,
                  status: line,
                  failLabel: "Receipt not closed",
                  onDone: refresh,
                }),
            },
            "Close receipt",
          ),
        );
      } else if (res.declined || (!res.claimant && now() >= opens)) {
        replace(status, h("span.tag.tag-accent", res.declined ? "Declined: refundable now" : "Unclaimed: refundable now"));
        replace(line, `Refund sends ${amt} and the ${sol(t.lamports, 5)} SOL deposit back to ${short(t.tip.sender.toBase58())}. Anyone may press it; the money can only go to the sender.`);
        action.append(
          h(
            "button.btn.btn-small.btn-primary",
            {
              type: "button",
              onclick: (e) =>
                runTx("Refund sent back to you", async (payer) => {
                  const ixs = [];
                  if (isToken) ixs.push(createAtaIdempotentIx({ payer, owner: t.tip.sender, mint: t.tip.mint }));
                  ixs.push(refundIxForTip({ platform: res.platform, id: BigInt(res.id), tipIndex: t.index, tip: t.tip }));
                  return ixs;
                }, { button: e.currentTarget, status: line, failLabel: "Refund not sent", onDone: refresh }),
            },
            "Refund",
          ),
        );
      } else if (res.claimant) {
        replace(status, h("span.tag", "With the owner"));
        replace(line, "The vault has an owner, so this tip is theirs to claim and can no longer be refunded. When they claim, you can close the receipt to get the deposit back.");
      } else {
        replace(status, h("span.tag", `Refund opens ${fmtDate(opens)}`));
        replace(line, `If nobody claims the vault by ${fmtDateTime(opens)} (${relTime(opens)}), the refund button appears here.`);
      }
      return h(
        "li.receipt",
        h("span.receipt-no.mono", `#${t.index}`),
        h("span.receipt-amt", amt),
        h("span.receipt-date.small.muted", `sent ${fmtDate(created)}`),
        status,
        action,
        line,
      );
    });
    replace(body, h("ol.receipts", rows));
  }

  const off = onWallet((s) => load(s.address));
  panel.append(
    h(
      "p.fine.small",
      `How refunds work: a direct tip waits ${duration(windowSecs)} for the owner. If the vault is still unclaimed after that, or the owner declines, the tip can be refunded to its sender by anyone. Once an owner claims, your tip is consumed and only the receipt deposit remains yours: “Close receipt” returns it.`,
    ),
  );
  track(off);
  return panel;
}

// ---- Owner's panel -------------------------------------------------------------------------------

export function ownerPanel(res, { refresh, claimHref, inClaim = false, track = () => {} }) {
  const body = h("div.panel-body");
  const panel = h("section.panel.panel-owner", { "aria-labelledby": "owner-title" }, h("h2#owner-title.panel-title", "Owner"), body);
  const now = () => Math.floor(Date.now() / 1000);

  function draw(address) {
    const me = address;
    const items = [];
    const pendingDue = res.pending && now() >= res.pending.effectiveAt;
    if (res.claimant && me === res.claimant) {
      const b = res.balances;
      const claimSol = toBig(b?.claimableLamports);
      const claimTok = toBig(b?.usdc?.claimable);
      const status = h("p.form-status", { role: "status" });
      const nothing = claimSol === 0n && claimTok === 0n;
      const claimBtn = h(
        "button.btn.btn-primary",
        {
          type: "button",
          disabled: nothing,
          onclick: (e) =>
            runTx("Claimed to your wallet", (claimant) => claimAllInstructions(connection(), { platform: res.platform, id: BigInt(res.id), claimant }), {
              button: e.currentTarget,
              status,
              failLabel: "Claim not sent",
              onDone: refresh,
            }),
        },
        nothing ? "Nothing to claim yet" : "Claim everything",
      );
      items.push(
        h("p", "This wallet owns the vault. Claimable now: ", h("strong", `${sol(claimSol, 6)} SOL`), " and ", h("strong", `${usdc(claimTok, 6)} USDC`), ". The vault keeps its rent."),
        h("div.row", claimBtn),
        status,
      );
      if (res.pending) {
        const st2 = h("p.form-status", { role: "status" });
        items.push(
          h(
            "div.notice.notice-red",
            h("p", h("strong", "Someone asked the attester to rebind this vault to "), h("span.mono", short(res.pending.claimant)), `. It takes effect ${fmtDateTime(res.pending.effectiveAt)}.`),
            h("p", "If that was not you: claim everything first, then cancel. Cancelling alone leaves the funds exposed to the next request."),
            h(
              "button.btn.btn-ghost",
              {
                type: "button",
                onclick: (e) =>
                  runTx("Change of claimant cancelled", async (claimant) => [cancelRebindIx({ platform: res.platform, id: BigInt(res.id), claimant })], {
                    button: e.currentTarget,
                    status: st2,
                    failLabel: "Cancel not sent",
                    onDone: refresh,
                  }),
              },
              "Cancel the change",
            ),
            st2,
          ),
        );
      }
      if (!res.declined) {
        items.push(declineBlock(res, refresh));
      } else {
        items.push(h("p.muted", "You declined tips. Outstanding tips can be refunded to their senders by anyone; fee inflows stay claimable by you."));
      }
    } else if (res.pending && me === res.pending.claimant) {
      items.push(h("p", `This wallet is waiting to become the owner. The rebind takes effect ${fmtDateTime(res.pending.effectiveAt)} (${relTime(res.pending.effectiveAt)}) unless the current owner cancels it.`));
    } else if (res.claimant) {
      items.push(h("p", "Owned by ", h("span.mono", short(res.claimant)), ". Only that wallet can claim, decline or cancel a rebind. ", me ? "Your connected wallet is not it." : "Connect it to manage the vault."));
    } else if (inClaim) {
      items.push(h("p.muted", "Nobody has claimed this vault yet. Once your bind lands, this panel shows the Claim button, the decline switch and any pending rebind."));
    } else {
      items.push(
        h("p", `Nobody has claimed this vault yet. If you control this ${platformLabel(res.platformName)}, prove it once and the vault binds to your wallet.`),
        h("a.btn.btn-primary", { href: claimHref }, "Claim this vault"),
      );
    }
    if (pendingDue) {
      const st3 = h("p.form-status", { role: "status" });
      items.push(
        h(
          "div.notice",
          h("p", "The requested rebind is due. Anyone may finalize it."),
          h(
            "button.btn.btn-ghost",
            {
              type: "button",
              onclick: (e) =>
                runTx("Rebind finalized", async () => [finalizeRebindIx({ platform: res.platform, id: BigInt(res.id) })], { button: e.currentTarget, status: st3, onDone: refresh }),
            },
            "Finalize the rebind",
          ),
          st3,
        ),
      );
    }
    replace(body, items);
  }

  track(onWallet((s) => draw(s.address)));
  return panel;
}

function declineBlock(res, refresh) {
  const status = h("p.form-status", { role: "status" });
  const confirm = h("input#decline-confirm", { type: "checkbox" });
  const btn = h(
    "button.btn.btn-danger",
    {
      type: "button",
      disabled: true,
      onclick: (e) =>
        runTx("Tips declined", async (claimant) => [declineIx({ platform: res.platform, id: BigInt(res.id), claimant })], { button: e.currentTarget, status, failLabel: "Decline not sent", onDone: refresh }),
    },
    "Decline tips for good",
  );
  confirm.addEventListener("change", () => (btn.disabled = !confirm.checked));
  return h(
    "details.decline",
    h("summary", "Don't want tips? Decline them"),
    h(
      "p",
      "Declining is permanent in this version. New direct tips are rejected, every outstanding tip becomes refundable to its sender at once, and routed fees stay claimable by you.",
    ),
    h("label.check", confirm, " I understand that declining cannot be undone."),
    h("div.row", btn),
    status,
  );
}

// ---- Trust notes ---------------------------------------------------------------------------------

export function trustNotes(res) {
  const days = duration(res.config?.refundWindowSecs ?? 2_592_000);
  const delay = duration(res.config?.rebindDelaySecs ?? 172_800);
  return h(
    "section.panel.panel-trust",
    { "aria-labelledby": "trust-title" },
    h("h2#trust-title.panel-title", "Before you send"),
    h(
      "ul.trust-list",
      h("li", h("strong", "Unverified until claimed. "), "Anyone can look up any account's vault. It says nothing about whether the owner knows anyfee, wants tips, or endorses anything. Not an endorsement."),
      h("li", h("strong", "The recipient may decline. "), "If they do, direct tips go back to their senders."),
      h("li", h("strong", `Direct tips return after ${days}. `), "If nobody claims the vault by then, any tip can be refunded to its sender. Once someone claims, tips are theirs."),
      h("li", h("strong", "Routed fees stay. "), "Fees from pump.fun or Bags have no single sender; they wait for the owner."),
      h("li", h("strong", "The attester binds, never withdraws. "), `It signs “this vault may be bound to wallet W”; only W can then move money. Until a vault is first claimed you are trusting the attester to bind the right person. After that, re-pointing it takes ${delay} and the owner can cancel.`),
      h("li", h("strong", "Devnet only. "), "Test network, test money, unaudited program."),
    ),
  );
}
