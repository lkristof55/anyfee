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

// ---- three.js shaders ------------------------------------------------------------------------------
// three's WebGLRenderer bundles the GLSL of every built-in material. The diagrams (src/diagrams/gl.js)
// draw only with MeshBasicMaterial and LineBasic/LineDashedMaterial, whose programs are the
// ShaderLib "meshbasic" and "linedashed" shaders. Every shader chunk those two #include (resolved
// recursively from three's own sources, so this follows three upgrades) is kept with comments
// and indentation stripped; every other chunk becomes an empty string. If the engine ever uses
// another material, add its ShaderLib file to THREE_SHADERS.
const THREE_SHADERS = ["meshbasic", "linedashed"];
const THREE_EXTRA_CHUNKS = ["tonemapping_pars_fragment", "colorspace_pars_fragment"]; // WebGLOutput
const shaderDir = join(appDir, "..", "node_modules", "three", "src", "renderers", "shaders");

export async function keptThreeChunks(): Promise<Set<string>> {
  const keep = new Set<string>();
  const include = /#include +<([\w\d./]+)>/g;
  const visit = async (text: string) => {
    for (const [, name] of text.matchAll(include)) {
      if (keep.has(name)) continue;
      keep.add(name);
      await visit(await readFile(join(shaderDir, "ShaderChunk", `${name}.glsl.js`), "utf8"));
    }
  };
  for (const s of THREE_SHADERS) await visit(await readFile(join(shaderDir, "ShaderLib", `${s}.glsl.js`), "utf8"));
  for (const c of THREE_EXTRA_CHUNKS) await visit(`#include <${c}>`);
  return keep;
}

export function minifyGlsl(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter(Boolean)
    .join("\n");
}

function threeShaders(): esbuild.Plugin {
  let keep: Promise<Set<string>> | null = null;
  return {
    name: "three-shaders",
    setup(b) {
      b.onLoad({ filter: /[\\/]three[\\/]src[\\/]renderers[\\/]shaders[\\/](ShaderChunk|ShaderLib)[\\/][\w]+\.glsl\.js$/ }, async (a) => {
        keep ??= keptThreeChunks();
        const kept = await keep;
        const [, kind, name] = /(ShaderChunk|ShaderLib)[\\/](\w+)\.glsl\.js$/.exec(a.path)!;
        const used = kind === "ShaderLib" ? THREE_SHADERS.includes(name) : kept.has(name);
        const text = await readFile(a.path, "utf8");
        const contents = text.replace(/`([\s\S]*?)`/g, (_m, body: string) => (used ? "`\n" + minifyGlsl(body) + "\n`" : "``"));
        return { contents, loader: "js" };
      });
    },
  };
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
    plugins: [threeShaders(), pages],
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
