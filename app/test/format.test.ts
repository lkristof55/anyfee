import { test } from "node:test";
import assert from "node:assert/strict";
import { duration, formatUnits, groupDigits, parseUnits, short } from "../src/lib/format.js";
import { parseAttestations } from "../src/lib/attestations.js";

test("parseUnits / formatUnits round-trip without floats", () => {
  assert.equal(parseUnits("0.001", 9), 1_000_000n);
  assert.equal(parseUnits("1", 6), 1_000_000n);
  assert.equal(parseUnits(".5", 6), 500_000n);
  assert.equal(parseUnits("1,000.25", 6), 1_000_250_000n);
  assert.equal(parseUnits("0.0000000001", 9), null);
  for (const bad of ["", ".", "-1", "1e3", "abc", "1.2.3"]) assert.equal(parseUnits(bad, 9), null, bad);
  assert.equal(formatUnits(1_310_640n, 9, 6), "0.00131");
  assert.equal(formatUnits(12_345_000_000_000n, 9), "12,345");
  assert.equal(formatUnits("0", 6), "0");
});

test("display helpers", () => {
  assert.equal(groupDigits("1296269"), "1 296 269");
  assert.equal(short("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"), "9WzD…AWWM");
  assert.equal(duration(2_592_000), "30 days");
  assert.equal(duration(172_800), "48 hours");
  assert.equal(duration(900), "15 min");
});

test("parseAttestations accepts a single one, a list, or the attester's response", () => {
  const a = { platform: 3, id: "12", claimant: "c", expiresAt: 1, message: "bQ==", signature: "cw==", attester: "a" };
  assert.equal(parseAttestations(JSON.stringify(a)).length, 1);
  assert.equal(parseAttestations(JSON.stringify([a, a])).length, 2);
  assert.equal(parseAttestations(JSON.stringify({ claimant: "c", attestations: [a] })).length, 1);
  assert.throws(() => parseAttestations("{"), /not valid JSON/);
  assert.throws(() => parseAttestations("[]"), /No attestation/);
  assert.throws(() => parseAttestations('{"platform":3}'), /needs/);
});
