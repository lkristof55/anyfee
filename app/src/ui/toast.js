// Transaction notices ("slips") in a polite live region.
import { h } from "../lib/dom.js";
import { explorerTx } from "../lib/format.js";

function region() {
  let r = document.getElementById("toasts");
  if (!r) {
    r = h("div#toasts.toasts", { "aria-live": "polite" });
    document.body.append(r);
  }
  return r;
}

/** kind: "ok" | "error" | "info". Returns a function that removes the slip. */
export function toast({ title, body, sig, kind = "info", timeout = kind === "error" ? 12000 : 8000 }) {
  const close = h("button.toast-close", { type: "button", "aria-label": "Dismiss" }, "×");
  const el = h(
    `div.toast.toast-${kind}`,
    { role: kind === "error" ? "alert" : "status" },
    h("p.toast-title", title),
    body ? h("p.toast-body", body) : null,
    sig ? h("a.toast-link", { href: explorerTx(sig), target: "_blank", rel: "noopener" }, "View the transaction on Solana Explorer ↗") : null,
    close,
  );
  const remove = () => el.remove();
  close.addEventListener("click", remove);
  region().append(el);
  if (timeout) setTimeout(remove, timeout);
  return remove;
}
