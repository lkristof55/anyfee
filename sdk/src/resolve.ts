import { PublicKey, type Connection } from "@solana/web3.js";
import { PLATFORM_NAMES, PROGRAM_ID, Platform } from "./constants.ts";
import { decodeTip, decodeVault, identifyAccount } from "./accounts.ts";
import { ResolveError } from "./resolvers/http.ts";
import {
  resolveGithubRepo,
  resolveGithubRepoById,
  resolveGithubUser,
  resolveGithubUserById,
  type GithubOptions,
  type GithubRepo,
  type GithubUser,
} from "./resolvers/github.ts";
import { defaultXResolver, type XResolver, type XUser } from "./resolvers/x.ts";
import { parseTarget, type Target } from "./targets.ts";

export interface ResolvedIdentity {
  platform: Platform;
  platformName: "github-user" | "github-repo" | "x";
  /** u64 decimal string — the only thing the vault is keyed on. */
  id: string;
  /** Human label: `owner/repo`, `login`, `@handle` (or the id when unknown). */
  display: string;
  url: string | null;
  github?: { repo?: GithubRepo; user?: GithubUser };
  x?: XUser;
  /** Honest caveats to show next to the vault (org accounts, archived repos, …). */
  warnings: string[];
}

export interface ResolveOptions {
  github?: GithubOptions;
  x?: XResolver;
  /** Needed only for Solana-address inputs (reverse lookup of an initialized vault). */
  connection?: Pick<Connection, "getAccountInfo">;
  programId?: PublicKey;
}

function repoWarnings(r: GithubRepo): string[] {
  const w: string[] = [];
  if (r.archived) w.push("This repository is archived: its maintainers cannot run a claim workflow until it is unarchived.");
  if (r.fork) w.push("This repository is a fork; the vault belongs to the fork, not to the original project.");
  return w;
}

function userWarnings(u: GithubUser): string[] {
  if (u.type === "Organization") {
    return [
      "This is a GitHub organization. Only personal accounts can claim a GitHub-user vault, so this vault can never be claimed; pay one of the organization's repositories instead. Direct tips here refund after the refund window.",
    ];
  }
  return [];
}

function fromRepo(r: GithubRepo): ResolvedIdentity {
  return {
    platform: Platform.GithubRepo,
    platformName: "github-repo",
    id: r.id,
    display: r.fullName,
    url: r.htmlUrl,
    github: { repo: r },
    warnings: repoWarnings(r),
  };
}

function fromUser(u: GithubUser): ResolvedIdentity {
  return {
    platform: Platform.GithubUser,
    platformName: "github-user",
    id: u.id,
    display: u.login,
    url: u.htmlUrl,
    github: { user: u },
    warnings: userWarnings(u),
  };
}

function fromX(u: XUser): ResolvedIdentity {
  return { platform: Platform.X, platformName: "x", id: u.id, display: `@${u.handle}`, url: `https://x.com/${u.handle}`, x: u, warnings: [] };
}

async function byId(platform: Platform, id: string, opts: ResolveOptions): Promise<ResolvedIdentity> {
  const base: ResolvedIdentity = { platform, platformName: PLATFORM_NAMES[platform], id, display: `${PLATFORM_NAMES[platform]}:${id}`, url: null, warnings: [] };
  try {
    if (platform === Platform.GithubRepo) return fromRepo(await resolveGithubRepoById(id, opts.github));
    if (platform === Platform.GithubUser) return fromUser(await resolveGithubUserById(id, opts.github));
    const x = opts.x ?? defaultXResolver();
    if (x.userById) return fromX(await x.userById(id));
    return { ...base, url: `https://x.com/i/user/${id}` };
  } catch (e) {
    if (e instanceof ResolveError && e.status === 404) {
      return { ...base, warnings: ["No account with this id was found (deleted, renamed away or private)."] };
    }
    return { ...base, warnings: [`Display lookup failed: ${(e as Error).message}`] };
  }
}

/**
 * Turns user input (see `parseTarget`) into a platform + numeric id + display name.
 * GitHub via REST (optional token), X via the pluggable resolver (fxtwitter by default).
 */
export async function resolveIdentity(input: string | Target, opts: ResolveOptions = {}): Promise<ResolvedIdentity> {
  const t = typeof input === "string" ? parseTarget(input) : input;
  switch (t.kind) {
    case "github-repo":
      return fromRepo(await resolveGithubRepo(t.owner, t.repo, opts.github));
    case "github-user":
      return fromUser(await resolveGithubUser(t.login, opts.github));
    case "x":
      return fromX(await (opts.x ?? defaultXResolver()).userByHandle(t.handle));
    case "id":
      return byId(t.platform, t.id.toString(), opts);
    case "address": {
      if (!opts.connection) throw new ResolveError("resolving a Solana address needs an RPC connection", 400);
      const programId = opts.programId ?? PROGRAM_ID;
      const info = await opts.connection.getAccountInfo(t.address);
      const kind = info && info.owner.equals(programId) ? identifyAccount(info.data) : null;
      if (info && kind === "Vault") {
        const v = decodeVault(info.data);
        return byId(v.platform, v.id.toString(), opts);
      }
      if (info && kind === "Tip") {
        const tip = decodeTip(info.data);
        const vInfo = await opts.connection.getAccountInfo(tip.vault);
        if (vInfo && vInfo.owner.equals(programId) && identifyAccount(vInfo.data) === "Vault") {
          const v = decodeVault(vInfo.data);
          return byId(v.platform, v.id.toString(), opts);
        }
      }
      throw new ResolveError(
        "This address is not an initialized anyfee vault. Vault addresses cannot be reversed before init_vault; search by GitHub or X instead.",
        404,
      );
    }
  }
}
