// Route table shared by the browser router and the server (meta tags, status codes).
// Pure functions, no DOM, no Node APIs.

const GH_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const GH_REPO = /^[A-Za-z0-9._-]{1,100}$/;
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const PLATFORM_NAMES = new Set(["github-repo", "github-user", "x"]);

function dec(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/**
 * @typedef {{ name: "home" } | { name: "claim" } | { name: "how" } | { name: "faq" } | { name: "notfound" }
 *   | { name: "vault", kind: "github-repo" | "github-user" | "x" | "id", query: string, label: string, platformName: string }} Route
 */

/** @returns {Route} */
export function matchRoute(pathname) {
  const p = (pathname || "/").replace(/\/+$/, "") || "/";
  if (p === "/" || p === "/index.html") return { name: "home" };
  if (p === "/claim") return { name: "claim" };
  if (p === "/how") return { name: "how" };
  if (p === "/faq") return { name: "faq" };
  let m;
  if ((m = /^\/v\/github\/([^/]+)\/([^/]+)$/.exec(p))) {
    const owner = dec(m[1]);
    const repo = dec(m[2]);
    if (owner && repo && GH_LOGIN.test(owner) && GH_REPO.test(repo) && repo !== "." && repo !== "..") {
      return { name: "vault", kind: "github-repo", platformName: "github-repo", query: `github.com/${owner}/${repo}`, label: `${owner}/${repo}` };
    }
  }
  if ((m = /^\/v\/gh\/([^/]+)$/.exec(p))) {
    const login = dec(m[1]);
    if (login && GH_LOGIN.test(login)) {
      return { name: "vault", kind: "github-user", platformName: "github-user", query: `github.com/${login}`, label: login };
    }
  }
  if ((m = /^\/v\/x\/([^/]+)$/.exec(p))) {
    const handle = dec(m[1])?.replace(/^@/, "");
    if (handle && X_HANDLE.test(handle)) return { name: "vault", kind: "x", platformName: "x", query: `@${handle}`, label: `@${handle}` };
  }
  if ((m = /^\/v\/id\/([a-z-]+)\/([0-9]{1,20})$/.exec(p))) {
    if (PLATFORM_NAMES.has(m[1]) && BigInt(m[2]) < 1n << 64n) {
      return { name: "vault", kind: "id", platformName: m[1], query: `${m[1]}:${m[2]}`, label: `${m[1]}:${m[2]}` };
    }
  }
  return { name: "notfound" };
}

/** Canonical, shareable path for a /api/resolve result. */
export function vaultPath(r) {
  if (r.platformName === "github-repo" && r.display && r.display.includes("/") && !r.display.includes(":")) {
    const [o, n] = r.display.split("/");
    return `/v/github/${encodeURIComponent(o)}/${encodeURIComponent(n)}`;
  }
  if (r.platformName === "github-user" && r.display && GH_LOGIN.test(r.display)) return `/v/gh/${encodeURIComponent(r.display)}`;
  if (r.platformName === "x" && r.display && /^@[A-Za-z0-9_]{1,15}$/.test(r.display)) return `/v/x/${encodeURIComponent(r.display.slice(1))}`;
  return idPath(r.platformName, r.id);
}

/** Stable path by numeric id: survives renames and handle changes. */
export function idPath(platformName, id) {
  return `/v/id/${platformName}/${id}`;
}

const PLATFORM_LABEL = { "github-repo": "GitHub repository", "github-user": "GitHub account", x: "X account" };

export function platformLabel(name) {
  return PLATFORM_LABEL[name] ?? name;
}

/** Title / description / status for a path (used for <title> and Open Graph tags). */
export function routeMeta(pathname) {
  const r = matchRoute(pathname);
  const tail = "Devnet only: test network, no real funds.";
  switch (r.name) {
    case "home":
      return {
        status: 200,
        title: "anyfee — every account already has a P.O. box",
        description: `Tip any GitHub repo, GitHub user or X account in SOL or USDC, or route pump.fun and Bags creator fees to it. The owner claims by proving control; unclaimed tips go back to the sender after 30 days. ${tail}`,
      };
    case "claim":
      return {
        status: 200,
        title: "Claim your box · anyfee",
        description: `Prove you control a GitHub repository, GitHub account or X account and bind its anyfee box to your Solana wallet. ${tail}`,
      };
    case "how":
      return {
        status: 200,
        title: "How it works · anyfee",
        description: `How anyfee boxes are derived, how claims are proven, and what the attester and admin can and cannot do. ${tail}`,
      };
    case "faq":
      return { status: 200, title: "Questions · anyfee", description: `Straight answers about anyfee boxes, refunds, fees and trust. ${tail}` };
    case "vault": {
      const what = r.kind === "id" ? r.label : `${platformLabel(r.platformName)} ${r.label}`;
      return {
        status: 200,
        title: `${r.label} · anyfee box`,
        description: `The anyfee box of the ${what}. Anyone can tip it or route creator fees to it; the owner claims by proving control. Unverified until claimed, not an endorsement. ${tail}`,
      };
    }
    default:
      return { status: 404, title: "No such box · anyfee", description: `Return to sender: this address has no box. ${tail}` };
  }
}
