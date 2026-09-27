import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../src/content.js";

const all = JSON.stringify(C);

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
  assert.match(coins, /no token of its own/);
  assert.match(coins, /Devnet only/);
});

test("no token, no ticker, no lures", () => {
  assert.doesNotMatch(all, /\$[A-Z]{2,}|tokenomics|presale|airdrop/i);
  const lure = /claim your (anyfee )?funds/i;
  for (const [id, q, a] of C.QA) if (lure.test(q + a)) assert.match(a, /phishing/, `${id}: the only mention of "claim your funds" is the phishing warning`);
  assert.ok(C.QA.some(([id]) => id === "token"));
  assert.equal(new Set(C.QA.map(([id]) => id)).size, C.QA.length, "FAQ anchors are unique");
});
