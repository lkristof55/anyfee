import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { CLAIM_PREFIX, Platform } from "./constants.ts";

export type Target =
  | { kind: "github-repo"; owner: string; repo: string }
  | { kind: "github-user"; login: string }
  | { kind: "x"; handle: string; tweetId?: string }
  | { kind: "address"; address: PublicKey }
  | { kind: "id"; platform: Platform; id: bigint };

export class TargetParseError extends Error {
  override name = "TargetParseError";
}

const GH_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const GH_REPO = /^[A-Za-z0-9._-]{1,100}$/;
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const DIGITS = /^[0-9]{1,20}$/;

const GH_HOSTS = new Set(["github.com", "www.github.com"]);
const X_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "mobile.x.com",
  "fxtwitter.com",
  "vxtwitter.com",
  "fixupx.com",
]);

// First path segments on github.com that are not users/orgs.
const GH_RESERVED = new Set([
  "about", "account", "apps", "blog", "codespaces", "collections", "contact", "customer-stories", "dashboard",
  "enterprise", "events", "explore", "features", "gist", "issues", "join", "login", "logout", "marketplace",
  "new", "notifications", "organizations", "pricing", "pulls", "search", "security", "settings", "site",
  "stars", "topics", "trending", "watching", "readme", "team", "copilot", "codesearch",
]);
// Top-level x.com paths that are not handles.
const X_RESERVED = new Set([
  "home", "explore", "notifications", "messages", "search", "settings", "i", "compose", "login", "logout",
  "signup", "tos", "privacy", "hashtag", "intent", "share", "jobs",
]);

function ghLogin(s: string): string {
  if (!GH_LOGIN.test(s)) throw new TargetParseError(`"${s}" is not a valid GitHub login`);
  return s;
}

function xHandle(s: string): string {
  const h = s.replace(/^@/, "");
  if (!X_HANDLE.test(h)) throw new TargetParseError(`"${s}" is not a valid X handle`);
  return h;
}

function parseGithubPath(segments: string[]): Target {
  const [a, b, c] = segments;
  if (!a) throw new TargetParseError("GitHub URL has no owner");
  if (a === "orgs" || a === "sponsors" || a === "users") {
    if (!b) throw new TargetParseError(`GitHub URL /${a} has no name`);
    return { kind: "github-user", login: ghLogin(b) };
  }
  if (GH_RESERVED.has(a.toLowerCase())) throw new TargetParseError(`github.com/${a} is not a user or repository`);
  const login = ghLogin(a);
  if (!b) return { kind: "github-user", login };
  const repo = b.replace(/\.git$/, "");
  if (!GH_REPO.test(repo) || repo === "." || repo === "..") throw new TargetParseError(`"${b}" is not a valid repository name`);
  void c;
  return { kind: "github-repo", owner: login, repo };
}

function parseXPath(segments: string[]): Target {
  const [a, b, c] = segments;
  if (!a) throw new TargetParseError("X URL has no handle");
  if (a === "i" && b === "web" && segments[2] === "status" && segments[3] && DIGITS.test(segments[3])) {
    throw new TargetParseError("x.com/i/web/status/<id> links have no handle; use the author's profile or x.com/<handle>/status/<id>");
  }
  if (X_RESERVED.has(a.toLowerCase())) throw new TargetParseError(`x.com/${a} is not a profile`);
  const handle = xHandle(a);
  if ((b === "status" || b === "statuses") && c && DIGITS.test(c)) return { kind: "x", handle, tweetId: c };
  return { kind: "x", handle };
}

function tryAddress(s: string): PublicKey | null {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return null;
  try {
    const bytes = bs58.decode(s);
    if (bytes.length !== 32) return null;
    return new PublicKey(bytes);
  } catch {
    return null;
  }
}

/**
 * Parses what a user types into "who do you want to pay?":
 * - `github.com/owner/repo`, `https://github.com/owner/repo/tree/main`, `owner/repo`, `git@github.com:owner/repo.git`
 * - `github.com/user`, `github.com/orgs/name`, `github.com/sponsors/name`
 * - `@handle`, `x.com/handle`, `twitter.com/handle/status/123`
 * - a Solana address (e.g. a vault address)
 * - canonical ids: `github-repo:<id>`, `github-user:<id>`, `x:<numeric id>` (numeric only)
 * Never resolves anything over the network; see `resolveTarget`.
 */
export function parseTarget(input: string): Target {
  let s = input.trim();
  if (!s) throw new TargetParseError("empty input");

  const idForm = /^(github-repo|github-user|x):([0-9]{1,20})$/i.exec(s);
  if (idForm) {
    const platform = { "github-user": Platform.GithubUser, "github-repo": Platform.GithubRepo, x: Platform.X }[
      idForm[1]!.toLowerCase() as "github-user" | "github-repo" | "x"
    ];
    const id = BigInt(idForm[2]!);
    if (id >= 1n << 64n) throw new TargetParseError("id out of u64 range");
    return { kind: "id", platform, id };
  }

  if (s.toLowerCase().startsWith(CLAIM_PREFIX)) throw new TargetParseError(`"${CLAIM_PREFIX}…" is a claim proof, not a payment target`);

  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(s);
  if (ssh) return parseGithubPath([ssh[1]!, ssh[2]!]);

  if (s.startsWith("@")) return { kind: "x", handle: xHandle(s) };

  const addr = tryAddress(s);
  if (addr) return { kind: "address", address: addr };

  // URL-ish: add a scheme when a known host is present.
  const hostMatch = /^(?:https?:\/\/)?([^/?#\s]+)(\/[^?#\s]*)?/i.exec(s);
  const host = hostMatch?.[1]?.toLowerCase();
  if (host && (GH_HOSTS.has(host) || X_HOSTS.has(host))) {
    if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      throw new TargetParseError(`"${input}" is not a valid URL`);
    }
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    return GH_HOSTS.has(url.hostname.toLowerCase()) ? parseGithubPath(segments) : parseXPath(segments);
  }
  if (/^https?:\/\//i.test(s)) throw new TargetParseError(`unsupported site "${host ?? s}"; use a github.com or x.com link`);

  // owner/repo shorthand
  const parts = s.split("/");
  if (parts.length === 2 && parts[0] && parts[1]) return parseGithubPath(parts);

  throw new TargetParseError(
    `"${input}" is ambiguous: use github.com/<user>, github.com/<owner>/<repo>, @<x_handle> or a Solana address`,
  );
}
