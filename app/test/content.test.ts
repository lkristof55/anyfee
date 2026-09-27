import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as C from "../src/content.js";
import * as T from "../src/token.js";
import { routeMeta } from "../src/routes.js";

const all = JSON.stringify(C);
const TICKER = /\$[A-Z]{2,}/;

test("copy uses the protocol's word: vault, never the old P.O.-box theme", () => {
  assert.doesNotMatch(all, /\bbox(es)?\b|P\.O\.|lobby|stamp|return to sender|mail/i);
  assert.match(C.HERO.coins, /creator fees/);
  assert.match(C.HERO.coins, /vault/);
});

test("how it works: derive, fund, claim, refund, each with a described diagram", () => {
  assert.deepEqual(C.STEPS.map((s) => s.id), ["derive", "fund", "claim", "refund"]);
  for (const s of C.STEPS) assert.ok(s.figure.length > 40 && s.title && s.body && s.code, s.id);
  assert.match(C.STEPS[0].code, /PDA\("vault", platform, id\)/);
  assert.match(C.STEPS[2].code, /attester signature.*check.*bind.*withdraw/);
  assert.match(C.STEPS[3].body, /30 days/);
  assert.match(C.STEPS[3].body, /no single sender/);
});

test("honesty rules (SPEC): not an endorsement, may decline, 30-day refunds, fees stay, devnet only", () => {
  const trust = JSON.stringify(C.TRUST);
  for (const re of [/Non-custodial/, /48 hours/, /not an endorsement/i, /may decline/i, /no ranking of unclaimed balances/i, /Devnet only/]) assert.match(trust, re);
  const coins = C.COIN_NOTES.join(" ");
  assert.match(coins, /never refunded/);
  assert.match(coins, /not an endorsement/);
  assert.match(coins, /Devnet only/);
});

test("the planned coin's ticker appears only in its home section (token.js) and its FAQ entries", () => {
  assert.equal(T.TICKER, "$ANYFEE");
  const { QA, TOKEN_QA_IDS, ...rest } = C;
  assert.doesNotMatch(JSON.stringify(rest), TICKER, "hero, flow, steps, coin launchers and safety copy");
  for (const [id, q, a] of QA) if (TICKER.test(q + a)) assert.ok(TOKEN_QA_IDS.includes(id), `FAQ ${id} names a ticker`);
  for (const p of ["/", "/claim", "/how", "/faq", "/v/x/jack", "/nope"]) assert.doesNotMatch(JSON.stringify(routeMeta(p)), TICKER, p);
  const shell = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(shell, TICKER, "header and footer");
  assert.doesNotMatch(JSON.stringify(T.TOKEN_COPY).replaceAll(T.TICKER, ""), TICKER, "no other ticker");
});

test("no investment or price language, no launch theatre, no lures", () => {
  const copy = all + JSON.stringify(T);
  const banned = [
    /\bprices?\b/i, /\bprofits?\b/i, /to the moon|\bmoon\b/i, /\bgains?\b/i, /\bROI\b|\bAPY\b|\byield\b/i, /\b\d+x\b/i,
    /\bbuy\b/i, /market cap|\bmcap\b/i, /\bchart\b/i, /tokenomics|presale|airdrop|whitelist/i, /\broadmap\b|\bcountdown\b/i,
    /(mint|contract) address/i, /\b(high|guaranteed|expected|huge) returns?\b|\breturns? on\b/i,
  ];
  for (const re of banned) assert.doesNotMatch(copy, re);
  const tokenText = JSON.stringify(T.TOKEN_COPY) + JSON.stringify(C.QA.filter(([id]) => C.TOKEN_QA_IDS.includes(id)));
  for (const m of tokenText.matchAll(/\b(\w+) returns?\b/gi)) assert.match(m[1], /^no$/i, `"${m[0]}": returns are only ever mentioned to deny them`);
  const lure = /claim your (anyfee )?funds|claim your share/i;
  for (const [id, q, a] of C.QA) if (lure.test(q + a)) assert.match(a, /phishing/, `${id}: the only mention of "claim your funds" is the phishing warning`);
  assert.doesNotMatch(JSON.stringify(T), lure);
  assert.equal(new Set(C.QA.map(([id]) => id)).size, C.QA.length, "FAQ anchors are unique");
});
