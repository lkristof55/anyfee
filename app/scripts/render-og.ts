// Renders app/public/og.png (1200x630), favicon.png and apple-touch-icon.png from the site
// itself: the real three.js wall with one box pulled out, plus the wordmark.
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
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector(".lobby-wall.is-ready"));
  await page.addStyleTag({
    content: `
      .devnet, .masthead, .counter, .below, .colophon, .wall-sign, .toasts { display: none !important; }
      .lobby { min-height: 630px !important; height: 630px; }
      .lobby-wall::after { background: linear-gradient(90deg, #16211c 0%, rgba(22,33,28,.94) 34%, rgba(22,33,28,.3) 55%, transparent 68%) !important; }
      .og { position: absolute; z-index: 5; left: 64px; top: 0; bottom: 0; width: 640px; display: flex; flex-direction: column; justify-content: center; gap: 22px; }
      .og .brand { font-size: 0; }
      .og .brand-word { font-size: 44px; }
      .og .brand-mark { width: 52px; height: 52px; }
      .og h1 { margin: 0; font: 800 70px/0.94 "Big Shoulders Display", sans-serif; color: #e7eae1; }
      .og p { margin: 0; max-width: 520px; font: 400 22px/1.4 "Public Sans", sans-serif; color: #a6b2a8; }
      .og .devnet-tag { align-self: flex-start; font: 800 18px/1 "Big Shoulders Display"; letter-spacing: .14em; color: #ffb3a6; border: 2px solid currentColor; padding: 4px 9px; transform: rotate(-2deg); }
    `,
  });
  await page.evaluate(() => {
    const mark = document.querySelector(".brand")!.cloneNode(true) as HTMLElement;
    const og = document.createElement("div");
    og.className = "og";
    const h1 = document.createElement("h1");
    h1.textContent = "Every account already has a P.O. box.";
    const p = document.createElement("p");
    p.textContent = "Tip any GitHub repo, GitHub user or X account in SOL or USDC. The owner claims by proving control; unclaimed tips go back.";
    const tag = document.createElement("span");
    tag.className = "devnet-tag";
    tag.textContent = "DEVNET";
    og.append(mark, h1, p, tag);
    document.querySelector(".lobby")!.append(og);
    (window as any).__anyfee.wall.showBox({ key: "og", number: "1296269", platformLabel: "P.O. BOX", holder: "your repository", status: "unclaimed" });
  });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: join(publicDir, "og.png") });
  await page.close();
}

// ---- icons from favicon.svg
for (const [size, file] of [
  [64, "favicon.png"],
  [180, "apple-touch-icon.png"],
] as const) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const svg = readFileSync(join(publicDir, "favicon.svg"), "utf8").replace("<svg ", `<svg width="${size}" height="${size}" `);
  await page.setContent(`<html><body style="margin:0;background:#16211c">${svg}</body></html>`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(publicDir, file) });
  await page.close();
}
await browser.close();
console.log("wrote public/og.png, public/favicon.png, public/apple-touch-icon.png");
