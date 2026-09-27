// Builds the static site into app/dist with esbuild.
//
//   npm run build -w @anyfee/app      (or `node scripts/build.ts` in app/)
//
// Output: hashed JS/CSS in dist/assets, public/ copied as-is, and one HTML shell per static route
// (/, /claim, /how, /faq, 404.html) with route-specific meta tags. Vault pages (/v/…) are served
// by the same shell: the dev server and the Netlify function inject their meta tags per request;
// plain static hosts fall back to 404.html, which boots the same app.
import * as esbuild from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { renderShell } from "../server/shell.ts";

const appDir = new URL("..", import.meta.url).pathname;
const src = join(appDir, "src");
const dist = join(appDir, "dist");

const STATIC_ROUTES: Array<[string, string]> = [
  ["/", "index.html"],
  ["/claim", "claim/index.html"],
  ["/how", "how/index.html"],
  ["/faq", "faq/index.html"],
  ["/404", "404.html"],
];

function kb(n: number): string {
  return `${(n / 1024).toFixed(1)} KB`;
}

async function writePages(meta: esbuild.Metafile, log: boolean): Promise<void> {
  const outputs = Object.entries(meta.outputs);
  const entry = (name: string, ext: string) => {
    const hit = outputs.find(([file, o]) => file.endsWith(ext) && o.entryPoint && o.entryPoint.includes(name));
    if (!hit) throw new Error(`build: no output for ${name}`);
    return "/" + relative(dist, join(appDir, hit[0]));
  };
  const js = entry("src/main.js", ".js");
  const css = entry("src/styles/main.css", ".css");
  // Static imports of the entry chunk: preload them so the first paint is not a waterfall.
  const mainOut = outputs.find(([f]) => "/" + relative(dist, join(appDir, f)) === js)![1];
  const preloads = mainOut.imports.filter((i) => i.kind === "import-statement").map((i) => "/" + relative(dist, join(appDir, i.path)));

  const template = (await readFile(join(src, "index.html"), "utf8"))
    .replace("%CSS%", css)
    .replace("%JS%", js)
    .replace("%PRELOADS%", preloads.map((p) => `<link rel="modulepreload" href="${p}">`).join("\n    "));
  const origin = process.env.SITE_URL || process.env.URL || undefined;
  for (const [route, file] of STATIC_ROUTES) {
    const out = join(dist, file);
    await mkdir(join(out, ".."), { recursive: true });
    await writeFile(out, renderShell(template, route, origin).html);
  }

  if (!log) return;
  let initial = 0;
  let lazy = 0;
  const rows: string[] = [];
  const initialSet = new Set([js, ...preloads]);
  for (const [file, o] of outputs) {
    if (!/\.(js|css)$/.test(file)) continue;
    const body = await readFile(join(appDir, file));
    const gz = gzipSync(body, { level: 9 }).length;
    const rel = "/" + relative(dist, join(appDir, file));
    const kind = file.endsWith(".css") ? "css" : initialSet.has(rel) ? "js (initial)" : "js (lazy)";
    if (file.endsWith(".js")) {
      if (initialSet.has(rel)) initial += gz;
      else lazy += gz;
    }
    rows.push(`  ${rel.padEnd(44)} ${kb(o.bytes).padStart(10)}  ${kb(gz).padStart(9)} gz  ${kind}`);
  }
  console.log(rows.join("\n"));
  console.log(`  JS gzip: initial ${kb(initial)} + lazy ${kb(lazy)} = ${kb(initial + lazy)}`);
}

export async function build(opts: { watch?: boolean; log?: boolean } = {}): Promise<void> {
  const log = opts.log ?? true;
  await rm(dist, { recursive: true, force: true });
  await mkdir(join(dist, "assets"), { recursive: true });
  await cp(join(appDir, "public"), dist, { recursive: true });

  const pages: esbuild.Plugin = {
    name: "pages",
    setup(b) {
      b.onEnd(async (result) => {
        if (result.errors.length || !result.metafile) return;
        await writePages(result.metafile, log);
      });
    },
  };

  const options: esbuild.BuildOptions = {
    absWorkingDir: appDir,
    entryPoints: [join(src, "main.js"), join(src, "styles/main.css")],
    outdir: join(dist, "assets"),
    entryNames: "[name]-[hash]",
    chunkNames: "[name]-[hash]",
    assetNames: "[name]-[hash]",
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: ["es2022", "chrome111", "safari16.4", "firefox115"],
    minify: true,
    sourcemap: "linked",
    legalComments: "linked",
    metafile: true,
    external: ["/fonts/*"],
    define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
    loader: { ".svg": "text" },
    logLevel: "warning",
    plugins: [pages],
  };

  if (opts.watch) {
    const ctx = await esbuild.context(options);
    await ctx.rebuild();
    await ctx.watch();
    return;
  }
  await esbuild.build(options);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await build();
  console.log("built app/dist");
}
