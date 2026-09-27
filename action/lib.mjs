// anyfee claim action — dependency-free logic (Node 20+). index.mjs is the entry point.
import { appendFileSync } from "node:fs";
// Flow: mint a GitHub Actions OIDC token with audience `anyfee:<claimant>` -> POST it to the
// attester -> print the attestations (and transaction signatures if the attester submitted them).

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function countLeadingOnes(s) {
  let n = 0;
  for (const ch of s) {
    if (ch !== "1") break;
    n++;
  }
  return n;
}

/** True when `s` is a canonical base58 32-byte Solana address other than the all-zero key. */
export function isSolanaAddress(s) {
  if (typeof s !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  const b = decodeFixed(s, 32);
  return b !== null && b.some((x) => x !== 0);
}

/** Strict fixed-length base58 decode (big-integer arithmetic; fine for 32 bytes). */
export function decodeFixed(s, len) {
  let n = 0n;
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const ones = countLeadingOnes(s);
  const body = [];
  while (n > 0n) {
    body.push(Number(n & 0xffn));
    n >>= 8n;
  }
  const out = [...new Array(ones).fill(0), ...body.reverse()];
  if (out.length !== len) return null;
  return Uint8Array.from(out);
}

export class ActionError extends Error {}

export function readInputs(env) {
  const input = (name) => (env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "").trim();
  const claimant = input("claimant");
  const attesterUrl = input("attester-url").replace(/\/+$/, "");
  const claim = input("claim") || "both";
  if (!claimant) throw new ActionError("input `claimant` is required (your Solana wallet address)");
  if (!isSolanaAddress(claimant)) throw new ActionError("input `claimant` is not a valid Solana address");
  if (!attesterUrl) throw new ActionError("input `attester-url` is required");
  let u;
  try {
    u = new URL(attesterUrl);
  } catch {
    throw new ActionError("input `attester-url` is not a URL");
  }
  const local = u.hostname === "127.0.0.1" || u.hostname === "localhost";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new ActionError("input `attester-url` must be https://");
  if (!["both", "repo", "user"].includes(claim)) throw new ActionError("input `claim` must be repo, user or both");
  return { claimant, attesterUrl, claim };
}

/** Requests an OIDC ID token from the Actions runtime (needs `permissions: id-token: write`). */
export async function mintIdToken(env, audience, fetchImpl = fetch) {
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) {
    throw new ActionError(
      "no OIDC token available: add `permissions: id-token: write` to the job (tokens are never issued to pull requests from forks)",
    );
  }
  const sep = url.includes("?") ? "&" : "?";
  const res = await fetchImpl(`${url}${sep}audience=${encodeURIComponent(audience)}`, {
    headers: { authorization: `Bearer ${bearer}`, accept: "application/json; api-version=2.0" },
  });
  if (!res.ok) throw new ActionError(`could not mint the OIDC token (HTTP ${res.status})`);
  const body = await res.json().catch(() => null);
  if (!body || typeof body.value !== "string") throw new ActionError("OIDC token response had no value");
  return body.value;
}

export async function requestAttestation(attesterUrl, oidcToken, claim, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(`${attesterUrl}/api/attest/github`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ oidcToken, claim }),
    });
  } catch (e) {
    throw new ActionError(`could not reach the attester at ${attesterUrl}: ${e.message}`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    const code = body?.error?.code ? ` [${body.error.code}]` : "";
    throw new ActionError(`attester rejected the claim${code}: ${msg}`);
  }
  if (!body || !Array.isArray(body.attestations)) throw new ActionError("attester returned no attestations");
  return body;
}

const PLATFORM = { 1: "GitHub user", 2: "GitHub repository", 3: "X account" };

export function explorerTx(sig) {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

export function summarize(result) {
  const lines = [];
  lines.push(`anyfee: attester verified ${result.repository?.fullName ?? "this repository"} for wallet ${result.claimant}`);
  for (const a of result.attestations) {
    lines.push(`  - ${PLATFORM[a.platform] ?? `platform ${a.platform}`} #${a.id} -> vault ${a.vault ?? "?"} (attestation expires ${new Date(a.expiresAt * 1000).toISOString()})`);
  }
  if (result.userClaim && !result.userClaim.allowed) lines.push(`  - GitHub user vault not claimable from this run: ${result.userClaim.reason}`);
  if (Array.isArray(result.submitted)) {
    for (const s of result.submitted) {
      if (s.signature) lines.push(`  - bind ${PLATFORM[s.platform]} #${s.id}: ${s.status} ${explorerTx(s.signature)}${s.error ? ` (${s.error})` : ""}`);
      else lines.push(`  - bind ${PLATFORM[s.platform]} #${s.id}: ${s.status}${s.error ? ` (${s.error})` : ""}`);
    }
  } else {
    lines.push("  Next: submit the bind with your wallet before the attestation expires (anyfee site or @anyfee/sdk attestationToInstructions).");
  }
  lines.push("  If this vault was already bound, the change takes effect after the rebind delay and the current claimant can cancel it.");
  return lines.join("\n");
}

export function markdownSummary(result) {
  const rows = result.attestations
    .map((a) => {
      const sub = result.submitted?.find((s) => s.platform === a.platform && s.id === a.id);
      const tx = sub?.signature ? `[${sub.status}](${explorerTx(sub.signature)})` : (sub?.status ?? "not submitted");
      return `| ${PLATFORM[a.platform] ?? a.platform} | \`${a.id}\` | \`${a.vault ?? ""}\` | ${tx} |`;
    })
    .join("\n");
  return [
    `### anyfee claim for \`${result.claimant}\``,
    "",
    "| identity | id | vault | bind tx |",
    "|---|---|---|---|",
    rows,
    "",
    result.userClaim && !result.userClaim.allowed ? `GitHub user vault: not claimable from this run — ${result.userClaim.reason}.` : "",
    "The attester can only bind a vault to a wallet; it can never withdraw. A rebind of an already-bound vault waits for the rebind delay and can be cancelled by the current claimant.",
    "",
  ].join("\n");
}

/** Runs the action; returns the process exit code. `io` is injectable for tests. */
export async function run(env, fetchImpl = fetch, io = defaultIo()) {
  try {
    const { claimant, attesterUrl, claim } = readInputs(env);
    const audience = `anyfee:${claimant}`;
    const token = await mintIdToken(env, audience, fetchImpl);
    io.log(`::add-mask::${token}`);
    io.log(`Requested an OIDC token for audience ${audience}; sending it to ${attesterUrl}`);
    const result = await requestAttestation(attesterUrl, token, claim, fetchImpl);
    io.log(summarize(result));
    const sigs = (result.submitted ?? []).map((s) => s.signature).filter(Boolean);
    if (env.GITHUB_OUTPUT) {
      io.appendFile(
        env.GITHUB_OUTPUT,
        `claimant=${result.claimant}\nattestations=${JSON.stringify(result.attestations)}\nsignatures=${sigs.join(",")}\n`,
      );
    }
    if (env.GITHUB_STEP_SUMMARY) io.appendFile(env.GITHUB_STEP_SUMMARY, markdownSummary(result));
    const failed = (result.submitted ?? []).filter((s) => s.status === "failed");
    if (failed.length) {
      io.error(`::error::attester could not submit ${failed.length} bind transaction(s): ${failed.map((f) => f.error).join("; ")}`);
      return 1;
    }
    return 0;
  } catch (e) {
    io.error(`::error::${e instanceof ActionError ? e.message : `unexpected error: ${e.message}`}`);
    return 1;
  }
}

function defaultIo() {
  return {
    log: (s) => console.log(s),
    error: (s) => console.error(s),
    appendFile: (path, s) => appendFileSync(path, s),
  };
}
