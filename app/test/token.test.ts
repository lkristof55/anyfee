import { test } from "node:test";
import assert from "node:assert/strict";
import { Platform, vaultPda } from "@anyfee/sdk";
import { PLATFORM, RECIPIENTS, STATUS, TICKER, TOKEN_COPY, pct, repoName } from "../src/token.js";
import { QA, TOKEN_QA_IDS } from "../src/content.js";
import { matchRoute } from "../src/routes.js";
import { SCENES, splitOrder } from "../src/diagrams/scenes.js";

test("the share list is a valid pump.fun fee-sharing config: 1-10 shareholders, all > 0, summing to 10,000 bps", () => {
  assert.equal(RECIPIENTS.reduce((a, r) => a + r.bps, 0), 10_000);
  assert.ok(RECIPIENTS.length >= 1 && RECIPIENTS.length <= 10);
  for (const r of RECIPIENTS) assert.ok(Number.isInteger(r.bps) && r.bps > 0, r.slug);
  assert.equal(new Set(RECIPIENTS.map((r) => r.id)).size, RECIPIENTS.length, "no duplicate repositories");
});

test("recipients are GitHub repositories keyed by permanent numeric id, each with its own vault page", () => {
  assert.equal(PLATFORM, Platform.GithubRepo);
  for (const r of RECIPIENTS) {
    assert.match(r.id, /^[1-9][0-9]{0,19}$/, r.slug);
    assert.ok(BigInt(r.id) < 1n << 64n);
    assert.equal(matchRoute(`/v/github/${r.slug}`).name, "vault", r.slug);
    assert.equal(matchRoute(`/v/id/github-repo/${r.id}`).name, "vault", r.slug);
    assert.ok(r.reason.length > 8, r.slug);
  }
  const vaults = RECIPIENTS.map((r) => vaultPda(Platform.GithubRepo, BigInt(r.id))[0].toBase58());
  assert.equal(new Set(vaults).size, vaults.length);
  assert.equal(RECIPIENTS[0].slug, "lkristof55/anyfee");
  assert.equal(vaults[0], vaultPda(Platform.GithubRepo, 1390597639n)[0].toBase58());
});

test("share formatting", () => {
  assert.deepEqual([5000, 1000, 1250, 3333, 10000].map(pct), ["50%", "10%", "12.5%", "33.33%", "100%"]);
  assert.equal(repoName("mrdoob/three.js"), "three.js");
});

test("status and honesty lines are part of the section, not fine print", () => {
  assert.match(STATUS, /Planned · not launched/);
  const status = Object.fromEntries(TOKEN_COPY.status);
  assert.match(status.Status, /not launched.*mainnet program and an audit.*devnet only/s);
  assert.match(status["Not affiliated"], /not affiliated.*do not endorse.*did not ask.*may decline/s);
  assert.match(status["Unclaimed fees"], /never refunded.*never claims.*waiting in its vault/s);
  assert.match(status["Not an investment"], /No returns are promised.*holders receive nothing/s);
  assert.match(status["Fixed split"], /published here before launch.*set once/s);
  assert.match(TOKEN_COPY.function, /planned pump\.fun coin/);
  for (const r of RECIPIENTS) assert.ok(TOKEN_COPY.figure.includes(`${repoName(r.slug)} ${pct(r.bps)}`), "figure text follows the list");
  const all = JSON.stringify(TOKEN_COPY);
  assert.doesNotMatch(all, /[1-9A-HJ-NP-Za-km-z]{32,44}/, "no mint or contract address");
});

test("the FAQ explains the coin from the same list, including who can change the split", () => {
  const byId = Object.fromEntries(QA.map(([id, q, a]) => [id, { q, a }]));
  assert.deepEqual(TOKEN_QA_IDS.filter((id) => byId[id]).length, 4);
  assert.equal(byId["anyfee-coin"].q, `What is ${TICKER}?`);
  for (const r of RECIPIENTS) assert.ok(byId["coin-fees"].a.includes(pct(r.bps)) && byId["coin-fees"].a.includes(repoName(r.slug)), r.slug);
  assert.match(byId["coin-split"].a, /admin.*only once.*nobody can change/s);
  assert.match(byId["coin-split"].a, /published/);
  assert.match(byId["coin-unclaimed"].a, /never refunded.*possibly forever/s);
  assert.match(byId["anyfee-coin"].a, /not an investment/i);
});

test("split diagram: fee cubes fill each vault in proportion to its share", () => {
  const order = splitOrder([5000, 1000, 1000, 1000, 1000, 1000], 20);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((k) => order.filter((d) => d === k).length), [10, 2, 2, 2, 2, 2]);
  const shares = RECIPIENTS.map((r) => ({ label: pct(r.bps), name: repoName(r.slug), bps: r.bps }));
  for (const [t, still] of [[10.9, false], [0, true]] as const) {
    const out = SCENES.split.build(t, { shares, ticker: TICKER }, { static: still });
    const fill = (k: number) => out.prims.find((p: { id: string }) => p.id === `v${k}.fill`)!.s[1];
    for (let k = 1; k < shares.length; k++) assert.ok(Math.abs(fill(0) / fill(k) - 5) < 0.01, `vault ${k}`);
    assert.deepEqual(out.labels.filter((l: { id: string }) => /^v\d$/.test(l.id)).map((l: { text: string }) => l.text), shares.map((s) => s.label));
    assert.equal(out.labels.find((l: { id: string }) => l.id === "coin").text, TICKER);
  }
});
