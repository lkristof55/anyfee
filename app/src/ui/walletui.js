// Header wallet button, the wallet chooser dialog and `ensureWallet()` for actions.
import { h, replace, copyText } from "../lib/dom.js";
import { short, sol } from "../lib/format.js";
import { balance } from "../lib/chain.js";
import { connect, current, disconnect, onWallet } from "../lib/wallet.js";

let dialog = null;
let pending = null; // { resolve, reject } of an ensureWallet() waiting on the chooser

function chooser() {
  if (dialog) return dialog;
  const list = h("ul.wallet-list");
  const note = h("p.sheet-note");
  const close = h("button.btn.btn-ghost.btn-small", { type: "button" }, "Close");
  dialog = h(
    "dialog.sheet",
    { "aria-labelledby": "wallet-sheet-title" },
    h("div.sheet-head", h("h2#wallet-sheet-title.sheet-title", "Choose a wallet"), close),
    h(
      "p.sheet-lede",
      "anyfee runs on Solana ",
      h("strong", "devnet"),
      ". Switch your wallet to devnet (Phantom: Settings → Developer settings → Testnet mode). The site only asks your wallet to sign; it never sees a key.",
    ),
    list,
    note,
  );
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    if (pending && !current().connected) pending.reject(new Error("No wallet connected."));
    pending = null;
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  document.body.append(dialog);

  onWallet(({ wallets }) => {
    replace(
      list,
      wallets.map((w) =>
        h(
          "li",
          h(
            "button.wallet-option",
            {
              type: "button",
              onclick: async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                note.textContent = `Waiting for ${w.name}…`;
                try {
                  const addr = await connect(w);
                  note.textContent = "";
                  const p = pending;
                  pending = null;
                  dialog.close();
                  p?.resolve(addr);
                } catch (err) {
                  note.textContent = /reject|denied|cancel/i.test(String(err?.message)) ? "You cancelled in the wallet." : `${w.name}: ${err?.message ?? err}`;
                } finally {
                  btn.disabled = false;
                }
              },
            },
            w.icon ? h("img.wallet-icon", { src: w.icon, alt: "", width: 28, height: 28 }) : h("span.wallet-icon"),
            h("span.wallet-name", w.name),
          ),
        ),
      ),
    );
    if (!wallets.length) {
      replace(
        list,
        h(
          "li.wallet-none",
          "No Solana wallet found in this browser. Install ",
          h("a", { href: "https://phantom.com", target: "_blank", rel: "noopener" }, "Phantom"),
          ", ",
          h("a", { href: "https://solflare.com", target: "_blank", rel: "noopener" }, "Solflare"),
          " or ",
          h("a", { href: "https://backpack.app", target: "_blank", rel: "noopener" }, "Backpack"),
          ", then reload this page.",
        ),
      );
    }
  });
  return dialog;
}

export function openChooser() {
  chooser().showModal();
}

/** Resolves with the connected address, opening the chooser when needed. */
export function ensureWallet() {
  const s = current();
  if (s.connected) return Promise.resolve(s.address);
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    openChooser();
  });
}

/** The header button (connect / connected menu). */
export function mountWalletButton(slot) {
  const menu = h("div.wallet-menu", { hidden: true });
  const btn = h("button.btn.btn-wallet", { type: "button", "aria-haspopup": "true", "aria-expanded": "false" });
  replace(slot, btn, menu);
  let open = false;
  const setOpen = (v) => {
    open = v;
    menu.hidden = !v;
    btn.setAttribute("aria-expanded", String(v));
  };
  btn.addEventListener("click", async () => {
    if (!current().connected) {
      ensureWallet().catch(() => {});
      return;
    }
    setOpen(!open);
    if (open) {
      const s = current();
      const bal = h("span.mono", "…");
      replace(
        menu,
        h("p.wallet-menu-addr.mono", s.address),
        h("p.wallet-menu-bal", "Balance ", bal, " devnet SOL"),
        h(
          "div.wallet-menu-actions",
          h("button.btn.btn-small.btn-ghost", { type: "button", onclick: async (e) => ((e.target.textContent = (await copyText(s.address)) ? "Copied" : "Copy failed")) }, "Copy address"),
          h(
            "a.btn.btn-small.btn-ghost",
            { href: "https://faucet.solana.com", target: "_blank", rel: "noopener" },
            "Devnet faucet ↗",
          ),
          h("button.btn.btn-small.btn-ghost", { type: "button", onclick: () => (setOpen(false), disconnect()) }, "Disconnect"),
        ),
      );
      balance(s.address)
        .then((b) => (bal.textContent = sol(b, 4)))
        .catch(() => (bal.textContent = "?"));
    }
  });
  document.addEventListener("click", (e) => {
    if (open && !slot.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (open && e.key === "Escape") {
      setOpen(false);
      btn.focus();
    }
  });
  onWallet((s) => {
    btn.disabled = false;
    if (s.connected) {
      replace(btn, s.wallet?.icon ? h("img.wallet-icon-small", { src: s.wallet.icon, alt: "" }) : null, h("span.mono", short(s.address)));
      btn.setAttribute("aria-label", `Wallet ${s.address}. Open wallet menu`);
    } else {
      setOpen(false);
      replace(btn, "Connect", h("span.nav-long", " wallet"));
      btn.removeAttribute("aria-label");
    }
  });
}
