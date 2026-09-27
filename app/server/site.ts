// Same-origin /api for the website: the attester's runtime-agnostic handlers (/api/resolve,
// /api/attest/github, /api/attest/x, /api/health) plus the app's RPC proxy (/api/rpc).
import { createHandler, type AttesterConfig } from "@anyfee/attester";
import { createRpcProxy } from "./rpc-proxy.ts";

export type FetchHandler = (req: Request) => Promise<Response>;

export function createApiHandler(config: AttesterConfig, opts: { allowLocalRpc?: boolean; fetch?: typeof fetch } = {}): FetchHandler {
  const attester = createHandler({ config });
  const rpc = createRpcProxy({
    rpcUrl: config.rpcUrl,
    programId: config.programId.toBase58(),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.allowLocalRpc ? { allowLocal: true } : {}),
  });
  return (req: Request) => {
    const path = new URL(req.url).pathname.replace(/\/+$/, "");
    return path === "/api/rpc" ? rpc(req) : attester(req);
  };
}
