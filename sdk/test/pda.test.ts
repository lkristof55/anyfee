import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  DEVNET_USDC_MINT,
  PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  accountDiscriminator,
  configPda,
  instructionDiscriminator,
  tipPda,
  toHex,
  vaultAta,
  vaultPda,
} from "../src/index.ts";

test("config PDA = [\"config\"]", () => {
  const [pda, bump] = configPda();
  const [expected, eb] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
  assert.ok(pda.equals(expected));
  assert.equal(bump, eb);
  assert.equal(pda.toBase58(), "AB2iPJfuLv2Bf3JecZ3LcSqsMaAeE8VPfgWSmQ6i9TbA");
});

test("vault PDA = [\"vault\", [platform], id LE]", () => {
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(1234567890n);
  const [expected] = PublicKey.findProgramAddressSync([Buffer.from("vault"), Buffer.from([2]), id], PROGRAM_ID);
  assert.ok(vaultPda(2, 1234567890n)[0].equals(expected));
  assert.equal(vaultPda(2, 1234567890n)[0].toBase58(), "4uLkRptxsriRYbarGiMi4zf69NHXL5ivU6EEuF5v88yY");
  assert.equal(vaultPda(1, "583231")[0].toBase58(), "8ZR2EPwF8PsCbyTfycwwEJV8KT8nDTD2fFbHvVm2n3My");
  assert.equal(vaultPda(3, 12)[0].toBase58(), "CW1eqpiTdpQF5wBKw8QG9U9t4D61uKySDfRgwEMquChK");
  // same id, different platform => different vault
  assert.ok(!vaultPda(1, 5n)[0].equals(vaultPda(2, 5n)[0]));
  assert.throws(() => vaultPda(0 as never, 1n), /unknown platform/);
  assert.throws(() => vaultPda(4 as never, 1n), /unknown platform/);
});

test("tip PDA = [\"tip\", vault, index LE]", () => {
  const vault = vaultPda(2, 1234567890n)[0];
  const idx = Buffer.alloc(8);
  idx.writeBigUInt64LE(7n);
  const [expected] = PublicKey.findProgramAddressSync([Buffer.from("tip"), vault.toBuffer(), idx], PROGRAM_ID);
  assert.ok(tipPda(vault, 7n)[0].equals(expected));
  assert.equal(tipPda(vault, 0)[0].toBase58(), "DT6pRWA1amV8dfQ693soarYbhKj3h7YGGZjKuK7eAS5C");
});

test("vault ATA = ATA(vault PDA, mint), off-curve owner allowed", () => {
  const vault = vaultPda(2, 1234567890n)[0];
  assert.ok(!PublicKey.isOnCurve(vault.toBytes()));
  const [expected] = PublicKey.findProgramAddressSync(
    [vault.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), DEVNET_USDC_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  assert.ok(vaultAta(vault, DEVNET_USDC_MINT).equals(expected));
  assert.equal(expected.toBase58(), "6FopnfGuSY6NDHB3UWVMEiSBJsMoL3kDWYtRXJCbbx88");
});

test("Anchor discriminators = sha256 prefix", () => {
  // Well-known value for "global:initialize" in every Anchor program.
  assert.deepEqual(Array.from(instructionDiscriminator("initialize")), [175, 175, 109, 31, 13, 152, 155, 237]);
  assert.equal(toHex(accountDiscriminator("Vault")), "d308e82b02987577");
});
