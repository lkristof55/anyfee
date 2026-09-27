// Renders app/public/og.png (1200x630), favicon.png and apple-touch-icon.png from the site
// itself: the home page's hero diagram in its static frame (every step of the flow at once, the
// same SVG that reduced-motion and no-WebGL visitors see), beside the headline.
//
//   npm run dev:site   (in another terminal)   then   OG_BASE=http://127.0.0.1:8788 npm run og -w @anyfee/app
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHROMIUM_ARGS, loadPlaywright } from "../test/playwright.ts";

const base = process.env.OG_BASE ?? "http://127.0.0.1:8788";
const publicDir = join(new URL("..", import.meta.url).pathname, "public");
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: CHROMIUM_ARGS });

// ---- og.png
{
  const context = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "light" });
  const page = await context.newPage();
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector(".dg-hero .dg-static svg"));
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({
    content: `
      body > *:not(.og) { display: none !important; }
      body { min-height: 0; }
      .og { position: fixed; inset: 0; display: grid; grid-template-columns: 520px 1fr; gap: 40px; align-items: center;
            padding: 0 56px; background: var(--bg); border: 0; }
      .og::before { content: ""; position: absolute; inset: 24px; border: 1px solid var(--rule); pointer-events: none; }
      .og-copy { display: flex; flex-direction: column; gap: 22px; position: relative; }
      .og .brand { font-size: 0; gap: 12px; }
      .og .brand-mark { width: 34px; height: 34px; }
      .og .brand-word { font-size: 30px; }
      .og h1 { margin: 0; font: 600 50px/1.06 var(--font-sans); letter-spacing: -0.03em; color: var(--fg); }
      .og p { margin: 0; font: 400 21px/1.42 var(--font-sans); color: var(--fg-2); }
      .og .og-tag { align-self: flex-start; display: inline-flex; gap: 10px; align-items: center; font: 500 14px/1 var(--font-mono);
                    letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
      .og .og-tag b { color: var(--accent); font-weight: 500; }
      .og .hero-fig { border: 1px solid var(--rule); position: relative; }
      .og .flow-b { display: block; }
      .og .dg-label { font-size: 11px; }
    `,
  });
  await page.evaluate(() => {
    const og = document.createElement("div");
    og.className = "og";
    const copy = document.createElement("div");
    copy.className = "og-copy";
    const mark = document.querySelector(".brand")!.cloneNode(true) as HTMLElement;
    const h1 = document.createElement("h1");
    h1.textContent = "A Solana vault for every GitHub repo, user and X account.";
    const p = document.createElement("p");
    p.textContent = "Tip it, or route a coin's creator fees to it, before the owner signs up. They claim by proving control.";
    const tag = document.createElement("span");
    tag.className = "og-tag";
    tag.innerHTML = "<b>■ Devnet</b> non-custodial · open source";
    copy.append(mark, h1, p, tag);
    og.append(copy, document.querySelector(".hero-fig")!);
    document.body.append(og);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(publicDir, "og.png") });
  await context.close();
}

// ---- icons from favicon.svg
for (const [size, file] of [
  [64, "favicon.png"],
  [180, "apple-touch-icon.png"],
] as const) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const svg = readFileSync(join(publicDir, "favicon.svg"), "utf8").replace("<svg ", `<svg width="${size}" height="${size}" `);
  await page.setContent(`<html><body style="margin:0;background:#0d0e0e">${svg}</body></html>`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(publicDir, file) });
  await page.close();
}
await browser.close();
console.log("wrote public/og.png, public/favicon.png, public/apple-touch-icon.png");
