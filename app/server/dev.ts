// Local server: builds the site and serves it together with the attester's handlers on one port.
//
//   ATTESTER_SECRET_KEY_FILE=keys/attester-devnet.json RPC_URL=https://devnet.helius-rpc.com/?api-key=… npm run dev:site
//
// Keys and the RPC URL come from the environment only (never printed; only the RPC host is
// logged). A relative ATTESTER_SECRET_KEY_FILE is resolved against the directory npm was
// started from. Without a key the attester runs resolve-only (attest endpoints answer 503).
import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, resolve } from "node:path";
import { describeConfig, loadConfig, serve } from "@anyfee/attester";
import { build } from "../scripts/build.ts";
import { renderShell } from "./shell.ts";
import { createApiHandler } from "./site.ts";

const appDir = new URL("..", import.meta.url).pathname;
const distDir = join(appDir, "dist");
const watch = process.argv.includes("--watch");
const noBuild = process.argv.includes("--no-build");

const env = { ...process.env };
if (env.ATTESTER_SECRET_KEY_FILE && !isAbsolute(env.ATTESTER_SECRET_KEY_FILE)) {
  env.ATTESTER_SECRET_KEY_FILE = resolve(process.env.INIT_CWD ?? process.cwd(), env.ATTESTER_SECRET_KEY_FILE);
}
const config = loadConfig(env, (p) => readFileSync(p, "utf8"));
const api = createApiHandler(config, { allowLocalRpc: env.ALLOW_LOCAL_RPC === "1" });

if (!noBuild) await build({ watch });

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

async function file(path: string): Promise<Buffer | null> {
  try {
    const s = await stat(path);
    return s.isFile() ? await readFile(path) : null;
  } catch {
    return null;
  }
}

const security = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
};

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return api(req);
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return new Response("bad request", { status: 400 });
  }
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const target = join(distDir, rel);
  if (!target.startsWith(distDir)) return new Response("not found", { status: 404 });
  if (extname(rel) && extname(rel) !== ".html") {
    const body = await file(target);
    if (!body) return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    const immutable = rel.startsWith("/assets/") || rel.startsWith("/fonts/");
    return new Response(new Uint8Array(body), {
      headers: {
        "content-type": TYPES[extname(rel)] ?? "application/octet-stream",
        "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
        ...security,
      },
    });
  }
  // Every page is the same shell; the router renders the view and the server sets the meta tags.
  const template = await file(join(distDir, "index.html"));
  if (!template) return new Response("site not built", { status: 503 });
  const { status, html } = renderShell(template.toString("utf8"), url.pathname, url.origin);
  return new Response(html, { status, headers: { "content-type": TYPES[".html"]!, "cache-control": "no-cache", ...security } });
}

const port = Number(process.env.PORT ?? 8788);
const host = process.env.HOST ?? "127.0.0.1";
const server = await serve(handler, port, host);
const info = describeConfig(config);
console.log(`anyfee site + api on http://${host}:${port}`);
console.log(`  attester ${info.attester ?? "(none: resolve-only, attest endpoints answer 503)"} · submit ${info.submit} · rpc host ${info.rpcHost}`);
console.log(`  ${watch ? "watching app/src for changes" : "built once (pass --watch to rebuild on change)"}`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
