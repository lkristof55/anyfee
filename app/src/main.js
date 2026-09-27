// anyfee website entry: router, wallet, cluster banner.
import { cluster } from "./lib/chain.js";
import { setCluster } from "./lib/format.js";
import { init as initWallet } from "./lib/wallet.js";
import { matchRoute, routeMeta } from "./routes.js";
import { startRouter } from "./router.js";
import { mountWalletButton } from "./ui/walletui.js";
import { leaveClaim, renderClaim } from "./views/claim.js";
import { leaveLobby, renderLobby } from "./views/lobby.js";
import { renderFaq, renderHow, renderNotFound } from "./views/pages.js";
import { wall } from "./wall/index.js";

const main = document.getElementById("main");
let lastView = null;

function setNav(pathname) {
  for (const a of document.querySelectorAll(".nav a")) {
    const href = a.getAttribute("href");
    const on = href === "/" ? pathname === "/" || pathname.startsWith("/v/") : pathname.startsWith(href);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

function render(loc, how = {}) {
  const route = matchRoute(loc.pathname);
  const view = route.name === "home" || route.name === "vault" ? "lobby" : route.name;
  if (view !== "lobby") leaveLobby();
  if (view !== "claim") leaveClaim();
  document.title = routeMeta(loc.pathname).title;
  setNav(loc.pathname);
  switch (view) {
    case "lobby":
      renderLobby(main, route);
      break;
    case "claim":
      renderClaim(main, loc);
      break;
    case "how":
      renderHow(main);
      break;
    case "faq":
      renderFaq(main);
      break;
    default:
      renderNotFound(main);
  }
  document.body.dataset.view = view;
  if (view !== lastView && !how.initial && !how.pop) {
    window.scrollTo({ top: 0 });
    main.focus({ preventScroll: true });
  }
  if (loc.hash && view !== "lobby") document.getElementById(loc.hash.slice(1))?.scrollIntoView();
  lastView = view;
}

mountWalletButton(document.getElementById("wallet-slot"));
initWallet();
startRouter(render);
window.__ready = true;
window.__anyfee = { wall }; // used by scripts/render-og.ts

cluster().then((c) => {
  setCluster(c);
  const banner = document.querySelector(".devnet-name");
  if (banner && c !== "devnet") banner.textContent = c.toUpperCase();
});
