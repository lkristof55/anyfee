// History-API router: same-origin links are handled client-side; everything else is left alone.
import { matchRoute } from "./routes.js";

let renderFn = () => {};

export function navigate(path, { replace = false } = {}) {
  const url = new URL(path, location.origin);
  const same = url.pathname + url.search === location.pathname + location.search;
  if (same && !replace) return;
  history[replace ? "replaceState" : "pushState"]({}, "", url.pathname + url.search + url.hash);
  renderFn(location, { replace });
}

export function startRouter(fn) {
  renderFn = fn;
  window.addEventListener("popstate", () => renderFn(location, { pop: true }));
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.("a[href]");
    if (!a || a.target || a.hasAttribute("download") || a.getAttribute("rel")?.includes("external")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
    if (/\.[a-z0-9]+$/i.test(url.pathname)) return; // files
    if (matchRoute(url.pathname).name === "notfound") return;
    e.preventDefault();
    if (url.pathname === location.pathname && url.search === location.search && url.hash) {
      document.getElementById(url.hash.slice(1))?.scrollIntoView();
      return;
    }
    navigate(url.pathname + url.search + url.hash);
  });
  renderFn(location, { initial: true });
}
