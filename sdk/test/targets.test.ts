import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTarget, TargetParseError, type Target } from "../src/index.ts";

const plain = (t: Target) => (t.kind === "address" ? { kind: t.kind, address: t.address.toBase58() } : t);

test("GitHub repositories", () => {
  const repo = { kind: "github-repo", owner: "solana-foundation", repo: "anchor" };
  for (const s of [
    "github.com/solana-foundation/anchor",
    "https://github.com/solana-foundation/anchor",
    "http://www.github.com/solana-foundation/anchor/",
    "https://github.com/solana-foundation/anchor/tree/master/lang",
    "https://github.com/solana-foundation/anchor.git",
    "https://github.com/solana-foundation/anchor?tab=readme#top",
    "git@github.com:solana-foundation/anchor.git",
    "solana-foundation/anchor",
    "  github.com/solana-foundation/anchor  ",
  ]) {
    assert.deepEqual(parseTarget(s), repo, s);
  }
  assert.deepEqual(parseTarget("github.com/octocat/.github"), { kind: "github-repo", owner: "octocat", repo: ".github" });
  assert.deepEqual(parseTarget("github.com/a-b/c_d.e-f"), { kind: "github-repo", owner: "a-b", repo: "c_d.e-f" });
});

test("GitHub users and organizations", () => {
  for (const s of ["github.com/octocat", "https://github.com/octocat/", "github.com/users/octocat", "https://github.com/sponsors/octocat"]) {
    assert.deepEqual(parseTarget(s), { kind: "github-user", login: "octocat" }, s);
  }
  assert.deepEqual(parseTarget("https://github.com/orgs/solana-foundation/people"), { kind: "github-user", login: "solana-foundation" });
});

test("X accounts", () => {
  for (const s of ["@solana", "x.com/solana", "https://x.com/solana", "https://twitter.com/solana/", "mobile.twitter.com/solana", "https://www.x.com/solana?lang=en"]) {
    assert.deepEqual(parseTarget(s), { kind: "x", handle: "solana" }, s);
  }
  assert.deepEqual(parseTarget("https://x.com/jack/status/20"), { kind: "x", handle: "jack", tweetId: "20" });
  assert.deepEqual(parseTarget("https://fxtwitter.com/jack/status/20/photo/1"), { kind: "x", handle: "jack", tweetId: "20" });
});

test("Solana addresses", () => {
  assert.deepEqual(plain(parseTarget("4uLkRptxsriRYbarGiMi4zf69NHXL5ivU6EEuF5v88yY")), {
    kind: "address",
    address: "4uLkRptxsriRYbarGiMi4zf69NHXL5ivU6EEuF5v88yY",
  });
  assert.deepEqual(plain(parseTarget("11111111111111111111111111111111")), { kind: "address", address: "11111111111111111111111111111111" });
});

test("canonical id forms", () => {
  assert.deepEqual(parseTarget("github-repo:1296269"), { kind: "id", platform: 2, id: 1296269n });
  assert.deepEqual(parseTarget("github-user:583231"), { kind: "id", platform: 1, id: 583231n });
  assert.deepEqual(parseTarget("x:12"), { kind: "id", platform: 3, id: 12n });
  assert.throws(() => parseTarget("x:99999999999999999999"), /u64/);
});

test("rejects ambiguous or invalid input with a helpful error", () => {
  const bad = [
    "",
    "octocat",
    "@this_handle_is_too_long",
    "@bad-handle",
    "https://gitlab.com/a/b",
    "github.com/-bad",
    "github.com/settings/profile",
    "github.com/marketplace",
    "x.com/home",
    "x.com/i/web/status/123",
    "anyfee:9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    "github.com/owner/..",
  ];
  for (const s of bad) assert.throws(() => parseTarget(s), TargetParseError, s);
});
