// Browser smoke test of the site, offline from any wallet: no keys, no funds, public devnet RPC.
// Builds, serves dist/ with the attester in resolve-only mode, then with headless Chromium:
//   - every page at 390x844 and 1440x900, light and dark: no console errors, no failed requests,
//     no horizontal overflow; screenshots into test/screenshots/smoke/
//   - the home page's diagrams go live on WebGL and actually draw (non-blank pixels)
//   - prefers-reduced-motion and a browser without WebGL: static SVG diagrams with their labels,
//     and three.js is never downloaded
//   - with a connected wallet (a Wallet Standard stub holding no key: it connects, it cannot
//     sign): the GitHub claim flow with its workflow YAML and a vault page, without overflow
//
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs npm run smoke -w @anyfee/app
import { spawn } from "node:child_process";
import { Keypair } from "@solana/web3.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { build } from "../scripts/build.ts";
import { RECIPIENTS, STATUS } from "../src/token.js";
import { CHROMIUM_ARGS, loadPlaywright } from "./playwright.ts";

const appDir = new URL("..", import.meta.url).pathname;
const shots = process.env.SMOKE_OUT ?? join(appDir, "test", "screenshots", "smoke");
const PORT = Number(process.env.SMOKE_PORT ?? 8798);
const BASE = process.env.SMOKE_BASE ?? `http://127.0.0.1:${PORT}`;
const VAULT = process.env.SMOKE_VAULT ?? "/v/github/lkristof55/anyfee";
mkdirSync(shots, { recursive: true });

let stop = () => {};
if (!process.env.SMOKE_BASE) {
  await build({ log: false });
  const env = { ...process.env, PORT: String(PORT) };
  delete env.ATTESTER_SECRET_KEY;
  delete env.ATTESTER_SECRET_KEY_FILE;
  const server = spawn(process.execPath, [join(appDir, "server/dev.ts"), "--no-build"], { env, stdio: "ignore" });
  stop = () => server.exitCode === null && server.kill("SIGTERM");
  process.on("exit", stop);
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {
      /* not yet */
    }
    if (i > 60) throw new Error("server did not start");
    await new Promise((r) => setTimeout(r, 250));
  }
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: CHROMIUM_ARGS });
const problems: string[] = [];
const ok = (cond: unknown, what: string) => (cond ? console.log(`  ✓ ${what}`) : problems.push(what));
// Connect-only Wallet Standard wallet: a random public key, no secret, signing always fails.
const STUB = Keypair.generate().publicKey;
const STUB_WALLET = `(() => {
  const account = Object.freeze({ address: ${JSON.stringify(STUB.toBase58())}, publicKey: new Uint8Array(${JSON.stringify(Array.from(STUB.toBytes()))}),
    chains: ["solana:devnet"], features: ["solana:signTransaction"], label: "smoke" });
  let connected = false;
  const listeners = {};
  const emit = (ev, arg) => (listeners[ev] || []).forEach((fn) => fn(arg));
  const wallet = {
    version: "1.0.0", name: "Smoke Wallet", icon: "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#888"/></svg>'),
    chains: ["solana:devnet"],
    get accounts() { return connected ? [account] : []; },
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => { connected = true; emit("change", { accounts: [account] }); return { accounts: [account] }; } },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => { connected = false; emit("change", { accounts: [] }); } },
      "standard:events": { version: "1.0.0", on: (ev, fn) => { (listeners[ev] ||= []).push(fn); return () => {}; } },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: async () => { throw new Error("smoke wallet cannot sign"); } },
    },
  };
  const cb = ({ register }) => register(wallet);
  try { window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: cb })); } catch {}
  try { window.addEventListener("wallet-standard:app-ready", ({ detail }) => cb(detail)); } catch {}
  try { localStorage.setItem("anyfee.lastWallet", "Smoke Wallet"); } catch {}
})();`;

const NO_WEBGL = `(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(t) ? null : g.call(this, t, ...a); }; })();`;

type Page = import("playwright").Page;
function watch(page: Page, tag: string, opts: { expect404?: boolean } = {}) {
  const seen = { gl: false };
  page.on("console", (m) => {
    if (m.type() === "error" && !(opts.expect404 && /status of 404/.test(m.text()))) problems.push(`[${tag}] console.error: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => problems.push(`[${tag}] pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`[${tag}] request failed: ${r.url()}`));
  page.on("request", (r) => /\/assets\/gl-/.test(r.url()) && (seen.gl = true));
  return seen;
}

try {
  const pages: Array<[string, string]> = [
    ["home", "/"],
    ["vault", VAULT],
    ["claim", "/claim"],
    ["claim-x", "/claim?type=x"],
    ["how", "/how"],
    ["faq", "/faq"],
    ["404", "/no/such/vault"],
  ];
  for (const scheme of ["light", "dark"] as const) {
    for (const [label, viewport, scale] of [
      ["phone", { width: 390, height: 844 }, 2],
      ["desktop", { width: 1440, height: 900 }, 1],
    ] as const) {
      console.log(`\n${label} · ${scheme}`);
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: scheme });
      for (const [name, path] of pages) {
        const page = await ctx.newPage();
        watch(page, `${label} ${scheme} ${name}`, { expect404: name === "404" });
        const resp = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
        if (name === "404") ok(resp?.status() === 404, `${label}: unknown path answers 404`);
        if (name === "vault") await page.locator(".readout").first().waitFor({ timeout: 30_000 });
        await page.waitForTimeout(name === "home" ? 2500 : 1200);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        ok(overflow <= 0, `${label} ${scheme} ${path}: no horizontal overflow (${overflow}px)`);
        await page.screenshot({ path: join(shots, `${name}-${label}-${scheme}.png`), fullPage: name !== "home" });
        if (name === "home") {
          await page.screenshot({ path: join(shots, `${name}-${label}-${scheme}-full.png`), fullPage: true });
          const inView = await page.evaluate(() => {
            const r = document.querySelector(".hero-fig")!.getBoundingClientRect();
            const f = document.querySelector(".finder")!.getBoundingClientRect();
            return { fig: r.bottom <= innerHeight + 1, finder: f.bottom <= innerHeight };
          });
          ok(inView.finder && inView.fig, `${label} ${scheme}: headline, lookup and the whole flow diagram fit the first screen`);
          const drawn = await page.evaluate(() => {
            const c = document.querySelector(".dg-hero canvas.dg-canvas") as HTMLCanvasElement | null;
            if (!c || !document.querySelector(".dg-hero.is-live")) return 0;
            const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
            let n = 0;
            for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
            return n / (c.width * c.height);
          });
          ok(drawn > 0.05, `${label} ${scheme}: the hero diagram renders with WebGL (${(drawn * 100).toFixed(0)}% of pixels drawn)`);
          const coin = await page.evaluate(() => {
            const s = document.querySelector("#anyfee-coin")!;
            return {
              rows: s.querySelectorAll(".token-table tbody tr").length,
              links: [...s.querySelectorAll(".token-table tbody th a")].map((a) => a.getAttribute("href")),
              status: s.querySelector(".token-label .tag")?.textContent,
              statusVisible: (s.querySelector(".token-status > div dd") as HTMLElement)?.offsetHeight > 0,
              text: s.textContent ?? "",
            };
          });
          ok(coin.rows === RECIPIENTS.length && coin.links.every((h) => h?.startsWith("/v/github/")), `${label} ${scheme}: $ANYFEE split table lists ${coin.rows} vaults, each linking to its vault page`);
          ok(coin.status === STATUS && coin.statusVisible, `${label} ${scheme}: $ANYFEE status "${coin.status}" is shown in the section`);
          ok(!/\bbuy\b|\bprice\b|market cap/i.test(coin.text), `${label} ${scheme}: no buy button, price or market cap`);
        }
        await page.close();
      }
      await ctx.close();
    }
  }

  console.log("\nconnected wallet");
  for (const [label, viewport, scale] of [
    ["phone", { width: 390, height: 844 }, 2],
    ["desktop", { width: 1440, height: 900 }, 1],
  ] as const) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale });
    await ctx.addInitScript({ content: STUB_WALLET });
    for (const [name, path, ready] of [
      ["claim-github-connected", "/claim?type=github-repo&q=github-repo:1388837158", ".workflow pre.code"],
      ["vault-connected", VAULT, ".panel-owner .panel-body p"],
    ] as const) {
      const page = await ctx.newPage();
      watch(page, `${label} ${name}`);
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await page.locator(".btn-wallet", { hasText: STUB.toBase58().slice(0, 4) }).waitFor({ timeout: 15_000 });
      await page.locator(ready).first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(800);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(overflow <= 0, `${label} ${name}: wallet connected, no horizontal overflow (${overflow}px)`);
      await page.screenshot({ path: join(shots, `${name}-${label}.png`), fullPage: true });
      await page.close();
    }
    await ctx.close();
  }

  console.log("\nfallbacks");
  for (const [mode, opts, init] of [
    ["reduced-motion", { reducedMotion: "reduce" as const }, null],
    ["no-webgl", {}, NO_WEBGL],
  ] as const) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...opts });
    if (init) await ctx.addInitScript({ content: init });
    const page = await ctx.newPage();
    const seen = watch(page, mode);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const s = await page.evaluate(() => ({
      diagrams: document.querySelectorAll(".dg").length,
      live: document.querySelectorAll(".dg.is-live").length,
      withSvg: [...document.querySelectorAll(".dg")].filter((d) => d.querySelector(".dg-static svg polygon")).length,
      heroLabels: [...document.querySelectorAll(".dg-hero .dg-label:not([hidden]) .dg-l1")].map((e) => e.textContent),
    }));
    ok(s.diagrams >= 5 && s.withSvg === s.diagrams && s.live === 0, `${mode}: all ${s.diagrams} diagrams are static SVG`);
    ok(s.heroLabels.length >= 5, `${mode}: hero labels shown (${s.heroLabels.join(", ")})`);
    ok(!seen.gl, `${mode}: three.js is never downloaded`);
    await page.screenshot({ path: join(shots, `home-phone-${mode}.png`) });
    await ctx.close();
  }
} finally {
  await browser.close();
  stop();
}

console.log(`\nscreenshots: ${shots}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("all smoke checks passed");
process.exit(0);
