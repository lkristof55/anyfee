// Playwright is not a dependency of the app (it is large). Point PLAYWRIGHT_MODULE at an
// installed copy (…/node_modules/playwright/index.mjs) or install it next to the repo.
export async function loadPlaywright(): Promise<typeof import("playwright")> {
  const tries = [process.env.PLAYWRIGHT_MODULE, "playwright"].filter(Boolean) as string[];
  for (const spec of tries) {
    try {
      return (await import(spec)) as typeof import("playwright");
    } catch {
      /* next */
    }
  }
  throw new Error("Playwright not found: npm i -D playwright (outside the app) or set PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs");
}

/** Chromium flags that give headless Chromium a real GPU on macOS (software WebGL elsewhere). */
export const CHROMIUM_ARGS = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"];
