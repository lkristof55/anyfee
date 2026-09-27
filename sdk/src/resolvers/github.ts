import { Platform } from "../constants.ts";
import { ResolveError, fetchJson, idString, isRecord, type FetchLike } from "./http.ts";

export interface GithubOptions {
  /** Optional token (raises the rate limit from 60 to 5000 req/h; needed for private repos). */
  token?: string;
  fetch?: FetchLike;
  apiBase?: string;
  userAgent?: string;
}

export interface GithubOwner {
  id: string;
  login: string;
  type: "User" | "Organization" | string;
}

export interface GithubRepo {
  platform: typeof Platform.GithubRepo;
  /** Numeric `repository_id` as a decimal string (the vault key). */
  id: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  fork: boolean;
  private: boolean;
  archived: boolean;
  owner: GithubOwner;
}

export interface GithubUser {
  platform: typeof Platform.GithubUser;
  /** Numeric user id as a decimal string (the vault key). */
  id: string;
  login: string;
  type: "User" | "Organization" | string;
  name: string | null;
  htmlUrl: string;
  avatarUrl: string | null;
}

const DEFAULT_API = "https://api.github.com";

async function ghGet(path: string, opts: GithubOptions, what: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": opts.userAgent ?? "anyfee-sdk",
  };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const { status, body, headers: h } = await fetchJson(opts.fetch ?? fetch, `${opts.apiBase ?? DEFAULT_API}${path}`, { headers }, what);
  if (status === 404) throw new ResolveError(`${what}: not found`, 404);
  if (status === 403 || status === 429) {
    const rl = h.get("x-ratelimit-remaining") === "0";
    throw new ResolveError(`${what}: ${rl ? "GitHub API rate limit exceeded" : `forbidden (${status})`}`, rl ? 429 : 502);
  }
  if (status !== 200 || !isRecord(body)) throw new ResolveError(`${what}: GitHub API returned ${status}`, 502);
  return body;
}

function parseOwner(v: unknown): GithubOwner {
  if (!isRecord(v)) throw new ResolveError("GitHub API: repository has no owner", 502);
  const id = idString(v.id);
  if (!id || typeof v.login !== "string") throw new ResolveError("GitHub API: malformed owner", 502);
  return { id, login: v.login, type: typeof v.type === "string" ? v.type : "User" };
}

export function parseGithubRepo(b: Record<string, unknown>): GithubRepo {
  const id = idString(b.id);
  if (!id || typeof b.full_name !== "string" || typeof b.default_branch !== "string") {
    throw new ResolveError("GitHub API: malformed repository", 502);
  }
  return {
    platform: Platform.GithubRepo,
    id,
    fullName: b.full_name,
    htmlUrl: typeof b.html_url === "string" ? b.html_url : `https://github.com/${b.full_name}`,
    defaultBranch: b.default_branch,
    fork: b.fork === true,
    private: b.private === true,
    archived: b.archived === true,
    owner: parseOwner(b.owner),
  };
}

export function parseGithubUser(b: Record<string, unknown>): GithubUser {
  const id = idString(b.id);
  if (!id || typeof b.login !== "string") throw new ResolveError("GitHub API: malformed user", 502);
  return {
    platform: Platform.GithubUser,
    id,
    login: b.login,
    type: typeof b.type === "string" ? b.type : "User",
    name: typeof b.name === "string" ? b.name : null,
    htmlUrl: typeof b.html_url === "string" ? b.html_url : `https://github.com/${b.login}`,
    avatarUrl: typeof b.avatar_url === "string" ? b.avatar_url : null,
  };
}

/** `GET /repos/{owner}/{repo}` — renamed/transferred repos are followed by GitHub's redirect. */
export async function resolveGithubRepo(owner: string, repo: string, opts: GithubOptions = {}): Promise<GithubRepo> {
  const b = await ghGet(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, opts, `GitHub repo ${owner}/${repo}`);
  return parseGithubRepo(b);
}

/** `GET /repositories/{id}` — stable across renames and transfers. */
export async function resolveGithubRepoById(id: string | bigint, opts: GithubOptions = {}): Promise<GithubRepo> {
  const b = await ghGet(`/repositories/${String(id)}`, opts, `GitHub repository #${String(id)}`);
  return parseGithubRepo(b);
}

/** `GET /users/{login}` — works for users and organizations (see `type`). */
export async function resolveGithubUser(login: string, opts: GithubOptions = {}): Promise<GithubUser> {
  const b = await ghGet(`/users/${encodeURIComponent(login)}`, opts, `GitHub user ${login}`);
  return parseGithubUser(b);
}

/** `GET /user/{id}` */
export async function resolveGithubUserById(id: string | bigint, opts: GithubOptions = {}): Promise<GithubUser> {
  const b = await ghGet(`/user/${String(id)}`, opts, `GitHub user #${String(id)}`);
  return parseGithubUser(b);
}
