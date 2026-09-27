// Netlify Function (v2): /api/* for the website. The attester's own Netlify adapter serves
// /api/resolve, /api/attest/github, /api/attest/x and /api/health; /api/rpc is the app's
// devnet-only RPC proxy (keeps the RPC API key on the server).
import { loadConfig, netlifyHandler } from "@anyfee/attester";
import { createRpcProxy } from "../../server/rpc-proxy.ts";

const attester = netlifyHandler();
let rpc: ((req: Request) => Promise<Response>) | null = null;

export default async function handler(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  if (path !== "/api/rpc") return attester(req);
  if (!rpc) {
    const cfg = loadConfig(process.env);
    rpc = createRpcProxy({ rpcUrl: cfg.rpcUrl, programId: cfg.programId.toBase58() });
  }
  return rpc(req);
}

export const config = { path: "/api/*" };
