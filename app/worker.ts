// Cloudflare Worker: the same site as netlify.toml, deployed with wrangler.jsonc. Static dist/
// comes from the ASSETS binding; /api/* runs the attester handler plus the devnet RPC proxy
// (as netlify/functions/api.ts does) and /v/* serves the page shell with per-vault meta tags
// (as netlify/functions/vault-page.ts does). Secrets come from `wrangler secret put`.
import { createHandler, loadConfig, type Env as AttesterEnv } from "@anyfee/attester";
import { createRpcProxy } from "./server/rpc-proxy.ts";
import { renderShell } from "./server/shell.ts";

interface Env {
  ASSETS: { fetch(req: Request | string): Promise<Response> };
  SITE_URL?: string;
  [name: string]: unknown;
}

let api: ((req: Request) => Promise<Response>) | null = null;
let rpc: ((req: Request) => Promise<Response>) | null = null;
let template: string | null = null;

// Bindings (ASSETS) are objects, the attester config wants strings only.
function stringEnv(env: Env): AttesterEnv {
  const out: AttesterEnv = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === "string") out[k] = v;
  return out;
}

async function vaultPage(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (!template) {
    const r = await env.ASSETS.fetch(new URL("/", url.origin).toString());
    if (!r.ok) return new Response("site shell unavailable", { status: 502 });
    template = await r.text();
  }
  const { status, html } = renderShell(template, url.pathname, env.SITE_URL || url.origin);
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");
    if (path === "/api/rpc") {
      if (!rpc) {
        const cfg = loadConfig(stringEnv(env));
        rpc = createRpcProxy({ rpcUrl: cfg.rpcUrl, programId: cfg.programId.toBase58() });
      }
      return rpc(req);
    }
    if (path === "/api" || path.startsWith("/api/")) {
      if (!api) api = createHandler({ config: loadConfig(stringEnv(env)) });
      return api(req);
    }
    if (url.pathname.startsWith("/v/")) return vaultPage(req, env);
    return env.ASSETS.fetch(req);
  },
};
