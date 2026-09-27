import { test } from "node:test";
import assert from "node:assert/strict";
import { isSolanaAddress, mintIdToken, readInputs, run } from "../lib.mjs";

const CLAIMANT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const TOKEN_URL = "https://pipelines.actions.githubusercontent.com/abc/idtoken?api-version=2.0";

function baseEnv(extra = {}) {
  return {
    INPUT_CLAIMANT: CLAIMANT,
    "INPUT_ATTESTER-URL": "https://attester.example.org/",
    ACTIONS_ID_TOKEN_REQUEST_URL: TOKEN_URL,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runtime-bearer",
    GITHUB_OUTPUT: "/out",
    GITHUB_STEP_SUMMARY: "/summary",
    ...extra,
  };
}

function io() {
  const out = { logs: [], errors: [], files: {} };
  return {
    out,
    log: (s) => out.logs.push(s),
    error: (s) => out.errors.push(s),
    appendFile: (p, s) => (out.files[p] = (out.files[p] ?? "") + s),
  };
}

const attestation = {
  platform: 2,
  id: "1296269",
  claimant: CLAIMANT,
  expiresAt: 1790000900,
  message: "AAAA",
  signature: "BBBB",
  attester: "FJpnX2EKfLMyFitghtSjZuoisNxP6ZgkNCQi2LgfiiLY",
  vault: "4uLkRptxsriRYbarGiMi4zf69NHXL5ivU6EEuF5v88yY",
};

function fakeFetch(attesterResponse, status = 200) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith(TOKEN_URL)) return new Response(JSON.stringify({ value: "eyJ.header.sig" }), { status: 200 });
    if (String(url) === "https://attester.example.org/api/attest/github") return new Response(JSON.stringify(attesterResponse), { status });
    throw new Error(`unexpected ${url}`);
  };
  fn.calls = calls;
  return fn;
}

test("mints a token with audience anyfee:<claimant>, posts it, writes outputs + summary, masks the token", async () => {
  const f = fakeFetch({ claimant: CLAIMANT, repository: { fullName: "octocat/Hello-World" }, userClaim: { allowed: true }, attestations: [attestation] });
  const t = io();
  const code = await run(baseEnv(), f, t);
  assert.equal(code, 0, t.out.errors.join("\n"));
  assert.equal(f.calls[0].url, `${TOKEN_URL}&audience=${encodeURIComponent(`anyfee:${CLAIMANT}`)}`);
  assert.equal(new Headers(f.calls[0].init.headers).get("authorization"), "Bearer runtime-bearer");
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { oidcToken: "eyJ.header.sig", claim: "both" });
  assert.equal(t.out.logs[0], "::add-mask::eyJ.header.sig");
  assert.ok(!t.out.logs.slice(1).some((l) => l.includes("eyJ.header.sig")), "token never printed");
  assert.match(t.out.files["/out"], /^claimant=9WzD.*\nattestations=\[.*\]\nsignatures=\n$/s);
  assert.match(t.out.files["/summary"], /GitHub repository \| `1296269`/);
  assert.match(t.out.logs.join("\n"), /Next: submit the bind/);
});

test("prints explorer links when the attester submitted the bind", async () => {
  const f = fakeFetch({
    claimant: CLAIMANT,
    attestations: [attestation],
    userClaim: { allowed: false, reason: "repository owner github is an Organization, not a personal account" },
    submitted: [{ platform: 2, id: "1296269", status: "sent", signature: "5sig" }],
  });
  const t = io();
  assert.equal(await run(baseEnv(), f, t), 0);
  assert.match(t.out.logs.join("\n"), /explorer\.solana\.com\/tx\/5sig\?cluster=devnet/);
  assert.match(t.out.logs.join("\n"), /not claimable from this run/);
  assert.match(t.out.files["/out"], /signatures=5sig/);
});

test("fails with a clear message without id-token permission, bad inputs, or attester errors", async () => {
  const t1 = io();
  assert.equal(await run(baseEnv({ ACTIONS_ID_TOKEN_REQUEST_URL: "" }), fakeFetch({}), t1), 1);
  assert.match(t1.out.errors[0], /id-token: write/);
  const t2 = io();
  assert.equal(await run(baseEnv({ INPUT_CLAIMANT: "not-a-wallet" }), fakeFetch({}), t2), 1);
  assert.match(t2.out.errors[0], /not a valid Solana address/);
  const t3 = io();
  assert.equal(await run(baseEnv({ "INPUT_ATTESTER-URL": "http://attester.example.org" }), fakeFetch({}), t3), 1);
  assert.match(t3.out.errors[0], /https/);
  const t4 = io();
  const code = await run(baseEnv(), fakeFetch({ error: { code: "not_default_branch", message: "the claim must run on the default branch (main), not refs/heads/dev" } }, 403), t4);
  assert.equal(code, 1);
  assert.match(t4.out.errors[0], /\[not_default_branch\].*default branch/);
  const t5 = io();
  const failed = fakeFetch({ claimant: CLAIMANT, attestations: [attestation], submitted: [{ platform: 2, id: "1296269", status: "failed", error: "insufficient funds" }] });
  assert.equal(await run(baseEnv(), failed, t5), 1);
});

test("inputs and address validation", async () => {
  assert.deepEqual(readInputs(baseEnv({ INPUT_CLAIM: "repo" })), { claimant: CLAIMANT, attesterUrl: "https://attester.example.org", claim: "repo" });
  assert.equal(readInputs(baseEnv({ "INPUT_ATTESTER-URL": "http://127.0.0.1:8787" })).attesterUrl, "http://127.0.0.1:8787");
  assert.throws(() => readInputs(baseEnv({ INPUT_CLAIM: "all" })), /repo, user or both/);
  assert.equal(isSolanaAddress(CLAIMANT), true);
  assert.equal(isSolanaAddress("11111111111111111111111111111111"), false, "all-zero key");
  assert.equal(isSolanaAddress("0OIl"), false);
  await assert.rejects(mintIdToken({ ACTIONS_ID_TOKEN_REQUEST_URL: TOKEN_URL, ACTIONS_ID_TOKEN_REQUEST_TOKEN: "x" }, "aud", async () => new Response("no", { status: 500 })), /HTTP 500/);
});
