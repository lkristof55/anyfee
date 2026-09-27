// Drives the website against the live devnet program with headless Chromium and a test wallet
// that implements Wallet Standard (signing happens in Node; the key never enters the page).
//
//   RPC_URL=https://devnet.helius-rpc.com/?api-key=… \
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs \
//   npm run e2e:devnet -w @anyfee/app
//
// Needs keys/devnet-deployer.json (funds the test wallet, at most 0.05 SOL in total across runs,
// tracked in keys/site-test-wallet.funding.json) and keys/attester-devnet.json (signs the
// attestations pasted in the X-style claim). The test wallet is keys/site-test-wallet.json.
// Flows:
//   A  lkristof55/ox81: look it up, connect, tip 0.001 SOL, the vault shows the tip and the receipt
//   B  synthetic X id: tip, claim page → paste attestation → bind → claim → close the consumed receipt
//      → a rebind request for another wallet → the holder cancels it
//   C  synthetic X id: tip, bind → holder declines → sender refunds
// Then desktop + mobile screenshots of every page into app/test/screenshots/. Fails on any
// console error, page error or failed request.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { Platform, createAttestation, fetchTip, fetchVaultState, tipPda, vaultPda } from "@anyfee/sdk";
import { build } from "../scripts/build.ts";
import { CHROMIUM_ARGS, loadPlaywright } from "./playwright.ts";

const root = new URL("../../", import.meta.url).pathname;
const appDir = join(root, "app");
const shots = join(appDir, "test", "screenshots");
const RPC = process.env.RPC_URL;
if (!RPC) throw new Error("set RPC_URL (devnet)");
const PORT = Number(process.env.E2E_PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const FUNDING_CAP = 50_000_000; // 0.05 SOL, all runs together

const conn = new Connection(RPC, "confirmed");
if ((await conn.getGenesisHash()) !== DEVNET_GENESIS) throw new Error("RPC_URL is not devnet — refusing to run");
const loadKey = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(root, p), "utf8"))));
const deployer = loadKey("keys/devnet-deployer.json");
const attester = loadKey("keys/attester-devnet.json");
const walletFile = join(root, "keys/site-test-wallet.json");
const fundingFile = join(root, "keys/site-test-wallet.funding.json");
if (!existsSync(walletFile)) writeFileSync(walletFile, JSON.stringify(Array.from(Keypair.generate().secretKey)));
const wallet = loadKey("keys/site-test-wallet.json");
const W = wallet.publicKey.toBase58();
const sol = (l: number | bigint) => (Number(l) / LAMPORTS_PER_SOL).toFixed(6);
const log = (...a: unknown[]) => console.log(...a);
const ok = (cond: unknown, what: string) => {
  if (!cond) throw new Error(`FAIL: ${what}`);
  log(`  ✓ ${what}`);
};

// ---- fund the test wallet (capped) ------------------------------------------------------------
{
  const funded: number = existsSync(fundingFile) ? JSON.parse(readFileSync(fundingFile, "utf8")).lamports : 0;
  const bal = await conn.getBalance(wallet.publicKey);
  log(`test wallet ${W}: ${sol(bal)} SOL (funded so far ${sol(funded)} of ${sol(FUNDING_CAP)})`);
  if (bal < 15_000_000) {
    const top = Math.min(30_000_000, FUNDING_CAP - funded);
    if (top <= 0) throw new Error("test wallet funding cap reached; refusing to transfer more");
    const sig = await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: wallet.publicKey, lamports: top })), [deployer]);
    writeFileSync(fundingFile, JSON.stringify({ lamports: funded + top }));
    log(`  funded +${sol(top)} SOL: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  }
}
const startBalance = await conn.getBalance(wallet.publicKey);

// ---- build and serve ---------------------------------------------------------------------------
await build({ log: true });
const server = spawn(process.execPath, [join(appDir, "server/dev.ts"), "--no-build"], {
  env: { ...process.env, PORT: String(PORT), ATTESTER_SECRET_KEY_FILE: join(root, "keys/attester-devnet.json") },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
const stopServer = () => {
  if (server.exitCode === null) server.kill("SIGTERM");
};
process.on("exit", stopServer);
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) break;
  } catch {
    /* not yet */
  }
  if (i > 60) throw new Error(`server did not start:\n${serverLog}`);
  await new Promise((r) => setTimeout(r, 250));
}
log(`site + api on ${BASE} (pid ${server.pid})`);

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: CHROMIUM_ARGS });
const problems: string[] = [];
const txs: Array<{ step: string; sig: string }> = [];
let step = "";

async function newContext(viewport: { width: number; height: number }, scale = 1) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale });
  await context.exposeFunction("__anyfeeTestSign", (b64: string) => {
    const tx = Transaction.from(Buffer.from(b64, "base64"));
    if (!tx.feePayer?.equals(wallet.publicKey)) throw new Error("test wallet only signs as fee payer");
    tx.partialSign(wallet);
    txs.push({ step, sig: bs58.encode(tx.signature!) });
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  });
  await context.addInitScript({ content: walletScript(W, Array.from(wallet.publicKey.toBytes())) });
  return context;
}

let expect404 = false; // the in-character 404 page is supposed to answer 404
function watch(page: import("playwright").Page, tag: string) {
  page.on("console", (m) => {
    if (m.type() === "error" && !(expect404 && /status of 404/.test(m.text()))) problems.push(`[${tag}] console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`[${tag}] pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`[${tag}] request failed: ${r.url()} (${r.failure()?.errorText})`));
  page.on("response", (r) => {
    if (r.status() >= 400 && !(expect404 && r.status() === 404 && r.request().resourceType() === "document")) problems.push(`[${tag}] HTTP ${r.status()}: ${r.url()}`);
  });
}

async function waitToast(page: import("playwright").Page, text: string) {
  const t = page.locator(".toast", { hasText: text }).last();
  const err = page.locator(".toast-error").last();
  await Promise.race([t.waitFor({ timeout: 120_000 }), err.waitFor({ timeout: 120_000 })]).catch(async (e) => {
    await page.screenshot({ path: join(shots, "failure.png"), fullPage: true });
    throw e;
  });
  if ((await err.count()) && !(await t.count())) {
    await page.screenshot({ path: join(shots, "failure.png"), fullPage: true });
    throw new Error(`expected “${text}”, got: ${await err.innerText()}`);
  }
  if (await t.evaluate((el) => el.classList.contains("toast-error"))) throw new Error(`error toast: ${await t.innerText()}`);
  return t;
}

async function tip(page: import("playwright").Page, amount: string) {
  await page.fill("#tip-amount", amount);
  const submit = page.locator(".tipform button[type=submit]");
  await page.waitForFunction((a) => document.querySelector(".tipform button[type=submit]")?.textContent?.includes(`Send ${a} SOL`), amount);
  await submit.click();
  await waitToast(page, `Tip of ${amount} SOL confirmed`);
}

/** X-style claim in paste mode: an attestation signed locally with the devnet attester key. */
async function pasteBind(page: import("playwright").Page, id: bigint, claimant = wallet.publicKey, toast = "Bound X account") {
  await page.goto(`${BASE}/claim?type=x&q=x:${id}&paste`);
  const att = await createAttestation(
    { platform: Platform.X, id, claimant, expiresAt: Math.floor(Date.now() / 1000) + 600 },
    { publicKey: attester.publicKey, sign: (m) => nacl.sign.detached(m, attester.secretKey) },
  );
  await page.locator("textarea.paste").waitFor();
  await page.fill("textarea.paste", JSON.stringify({ attestations: [att] }, null, 2));
  await page.click("text=Check attestation");
  await page.locator(".att", { hasText: `#` }).first().waitFor();
  await page.click("text=Bind with my wallet");
  await waitToast(page, toast);
  await page.locator(".notice-green", { hasText: "Bound to your wallet" }).waitFor({ timeout: 30_000 });
}

try {
  const context = await newContext({ width: 1440, height: 900 });
  const page = await context.newPage();
  watch(page, "desktop");

  // ---- A: real repo, tip 0.001 SOL -----------------------------------------------------------------
  log("\nA  lkristof55/ox81: look up, connect, tip 0.001 SOL");
  step = "A tip 0.001 SOL to lkristof55/ox81";
  await page.goto(`${BASE}/`);
  await page.fill("#to", "lkristof55/ox81");
  await page.press("#to", "Enter");
  await page.waitForURL("**/v/github/lkristof55/ox81");
  await page.locator(".record-name", { hasText: "lkristof55/ox81" }).waitFor();
  ok(true, "resolve opened the vault page: /v/github/lkristof55/ox81");
  const [vaultA] = vaultPda(Platform.GithubRepo, 1388837158n);
  const beforeA = await fetchVaultState(conn, Platform.GithubRepo, 1388837158n);
  const countBefore = beforeA.account?.tipCount ?? 0n;
  await page.click(".tipform button[type=submit]"); // "Connect a wallet to send"
  await page.click(".wallet-option:has-text('anyfee Test Wallet')");
  await page.locator(".btn-wallet", { hasText: W.slice(0, 4) }).waitFor();
  ok(true, "Wallet Standard test wallet connected");
  await tip(page, "0.001");
  await page.waitForFunction((n) => document.querySelector(".field-tips .amount")?.textContent?.startsWith(String(n)), Number(countBefore + 1n), { timeout: 30_000 });
  ok(true, `vault card shows ${countBefore + 1n} tip(s)`);
  const afterA = await fetchVaultState(conn, Platform.GithubRepo, 1388837158n);
  const tipA = await fetchTip(conn, vaultA, countBefore);
  ok(afterA.account!.tipCount === countBefore + 1n && tipA?.sender.equals(wallet.publicKey) && tipA.amount === 1_000_000n, "on-chain: tip receipt from the test wallet for 0.001 SOL");
  await page.locator(".panel-tips .receipt", { hasText: "Refund opens" }).first().waitFor({ timeout: 30_000 });
  ok(true, "“Your tips to this vault” lists the receipt with its refund date");
  await page.screenshot({ path: join(shots, "vault-after-tip-desktop.png") });

  // ---- B: synthetic X identity: tip → paste attestation → bind → claim → close receipt -------------------------------
  const idB = 18_400_000_000_000_000_000n + BigInt(Date.now() % 1_000_000_000);
  log(`\nB  synthetic X account #${idB}: tip, paste-bind, claim, close receipt`);
  step = "B init_vault + tip 0.002 SOL";
  await page.goto(`${BASE}/v/id/x/${idB}`);
  await page.locator(".record-name", { hasText: `x:${idB}` }).waitFor();
  await page.locator(".btn-wallet", { hasText: W.slice(0, 4) }).waitFor(); // silent reconnect after reload
  ok(true, "wallet reconnected silently after a full page load");
  await tip(page, "0.002");
  step = "B ed25519 + bind (pasted attestation)";
  await pasteBind(page, idB);
  ok(true, "pasted attestation verified in the browser and bound by the wallet");
  step = "B claim_sol";
  const balBeforeClaim = await conn.getBalance(wallet.publicKey);
  await page.locator(".panel-owner button", { hasText: "Claim everything" }).click();
  await waitToast(page, "Claimed to your wallet");
  const sB = await fetchVaultState(conn, Platform.X, idB);
  ok(sB.account?.claimant?.equals(wallet.publicKey) && sB.account.claimEpoch === 1n && sB.claimableLamports === 0n, "on-chain: bound to the test wallet, claim consumed the tip (epoch 1), nothing left above rent");
  ok((await conn.getBalance(wallet.publicKey)) - balBeforeClaim > 1_990_000, "the claim paid the 0.002 SOL tip back to the claimant");
  step = "B close_tip (consumed receipt)";
  await page.goto(`${BASE}/v/id/x/${idB}`);
  await page.locator(".panel-tips .receipt", { hasText: "Claimed by owner" }).waitFor({ timeout: 30_000 });
  await page.locator(".panel-tips button", { hasText: "Close receipt" }).click();
  await waitToast(page, "Receipt closed");
  ok((await conn.getAccountInfo(tipPda(vaultPda(Platform.X, idB)[0], 0n)[0])) === null, "on-chain: consumed receipt closed, deposit returned");
  step = "B ed25519 + bind for another wallet (rebind request)";
  const intruder = Keypair.generate().publicKey;
  await pasteBind(page, idB, intruder, "Rebind requested");
  step = "B cancel_rebind";
  await page.goto(`${BASE}/v/id/x/${idB}`);
  await page.locator(".readout .readout-tag", { hasText: "Rebind pending" }).waitFor({ timeout: 30_000 });
  await page.locator(".panel-owner button", { hasText: "Cancel the change" }).click();
  await waitToast(page, "Change of claimant cancelled");
  const sB2 = await fetchVaultState(conn, Platform.X, idB);
  ok(sB2.account?.pendingClaimant === null && sB2.account.claimant?.equals(wallet.publicKey), "on-chain: a rebind request to another wallet showed as pending and the holder cancelled it");
  await page.screenshot({ path: join(shots, "vault-claimed-desktop.png"), fullPage: true });

  // ---- C: decline → refund ----------------------------------------------------------------------------
  const idC = idB + 1n;
  log(`\nC  synthetic X account #${idC}: tip, bind, decline, refund`);
  step = "C init_vault + tip 0.001 SOL";
  await page.goto(`${BASE}/v/id/x/${idC}`);
  await page.locator(".record-name", { hasText: `x:${idC}` }).waitFor();
  await page.locator(".btn-wallet", { hasText: W.slice(0, 4) }).waitFor();
  await tip(page, "0.001");
  step = "C ed25519 + bind (pasted attestation)";
  await pasteBind(page, idC);
  step = "C decline";
  await page.goto(`${BASE}/v/id/x/${idC}`);
  await page.locator(".panel-owner details.decline summary").click();
  await page.check("#decline-confirm");
  await page.locator(".panel-owner button", { hasText: "Decline tips for good" }).click();
  await waitToast(page, "Tips declined");
  step = "C refund_tip (permissionless crank)";
  await page.locator(".panel-tips .receipt", { hasText: "refundable now" }).waitFor({ timeout: 30_000 });
  await page.locator(".readout-tag", { hasText: "Declined" }).first().waitFor();
  await page.locator(".panel-tips button", { hasText: "Refund" }).click();
  await waitToast(page, "Refund sent back to you");
  const sC = await fetchVaultState(conn, Platform.X, idC);
  ok(sC.account?.declined && sC.account.outstandingTipLamports === 0n, "on-chain: declined, refund returned the tip (nothing outstanding)");
  ok((await conn.getAccountInfo(tipPda(vaultPda(Platform.X, idC)[0], 0n)[0])) === null, "on-chain: refunded receipt closed");
  await context.close();

  // ---- screenshots -------------------------------------------------------------------------------------
  log("\nscreenshots");
  mkdirSync(shots, { recursive: true });
  const pages: Array<[string, string]> = [
    ["home", "/"],
    ["vault", "/v/github/lkristof55/ox81"],
    ["vault-declined", `/v/id/x/${idC}`],
    ["claim-github", "/claim?type=github-repo&q=github-repo:1388837158"],
    ["claim-x", "/claim?type=x"],
    ["how", "/how"],
    ["faq", "/faq"],
    ["404", "/no/such/vault"],
  ];
  for (const [label, viewport, scale] of [
    ["desktop", { width: 1440, height: 900 }, 1],
    ["mobile", { width: 390, height: 844 }, 2],
  ] as const) {
    const ctx = await newContext(viewport, scale);
    const p = await ctx.newPage();
    watch(p, label);
    await p.goto(`${BASE}/`);
    await p.evaluate(() => localStorage.setItem("anyfee.lastWallet", "anyfee Test Wallet"));
    for (const [name, path] of pages) {
      expect404 = name === "404";
      const resp = await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      if (name === "404") ok(resp?.status() === 404 && (await p.locator(".page-404").count()) === 1, `${label}: unknown path answers 404 with the not-found page`);
      await p.waitForTimeout(name.startsWith("vault") || name === "home" ? 2600 : 900);
      await p.screenshot({ path: join(shots, `${name}-${label}.png`), fullPage: name !== "home" });
      expect404 = false;
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) problems.push(`[${label}] ${path}: horizontal overflow ${overflow}px`);
    }
    await ctx.close();
  }
  log(`  saved to ${shots}`);
} finally {
  await browser.close();
  stopServer();
}

log("\ndevnet transactions signed by the test wallet:");
for (const t of txs) log(`  ${t.step}: https://explorer.solana.com/tx/${t.sig}?cluster=devnet`);
log(`test wallet spent ${sol(startBalance - (await conn.getBalance(wallet.publicKey)))} SOL this run (rent left in the new vaults, the ox81 tip + its receipt deposit, fees)`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.join("\n")}`);
  process.exit(1);
}
log("\nall site checks passed on devnet · zero console errors");
process.exit(0);

// ---- the injected wallet ----------------------------------------------------------------------------------
function walletScript(address: string, publicKey: number[]): string {
  return `(() => {
  const account = Object.freeze({ address: ${JSON.stringify(address)}, publicKey: new Uint8Array(${JSON.stringify(publicKey)}),
    chains: ["solana:devnet", "solana:testnet"], features: ["solana:signTransaction"], label: "anyfee test" });
  const listeners = {};
  let connected = false;
  const emit = (ev, arg) => (listeners[ev] || []).forEach((fn) => fn(arg));
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const icon = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#2d3f8c"/><text x="16" y="21" font-size="14" text-anchor="middle" fill="#fff" font-family="monospace">T</text></svg>');
  const wallet = {
    version: "1.0.0",
    name: "anyfee Test Wallet",
    icon,
    chains: ["solana:devnet", "solana:testnet"],
    get accounts() { return connected ? [account] : []; },
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => { connected = true; emit("change", { accounts: [account] }); return { accounts: [account] }; } },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => { connected = false; emit("change", { accounts: [] }); } },
      "standard:events": { version: "1.0.0", on: (ev, fn) => { (listeners[ev] ||= []).push(fn); return () => { listeners[ev] = listeners[ev].filter((f) => f !== fn); }; } },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
        signTransaction: async (...inputs) => Promise.all(inputs.map(async (i) => ({ signedTransaction: unb64(await window.__anyfeeTestSign(b64(i.transaction))) }))) },
    },
  };
  const callback = ({ register }) => register(wallet);
  try { window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: callback })); } catch {}
  try { window.addEventListener("wallet-standard:app-ready", ({ detail }) => callback(detail)); } catch {}
})();`;
}
