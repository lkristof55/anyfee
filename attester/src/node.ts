// Node http adapter: IncomingMessage -> Request -> handler -> ServerResponse.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type FetchHandler = (req: Request) => Promise<Response>;

const MAX_BODY = 64 * 1024;

async function toRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else if (v !== undefined) headers.set(k, v);
  }
  let body: Uint8Array | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_BODY) throw new Error("body too large");
      chunks.push(c as Buffer);
    }
    body = new Uint8Array(Buffer.concat(chunks));
  }
  return new Request(new URL(req.url ?? "/", origin), { method: req.method ?? "GET", headers, ...(body ? { body } : {}) });
}

export function nodeListener(handler: FetchHandler, origin = "http://localhost") {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const response = await handler(await toRequest(req, origin));
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      res.statusCode = (e as Error).message === "body too large" ? 413 : 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { code: res.statusCode === 413 ? "body_too_large" : "internal", message: "request failed" } }));
    }
  };
}

export function serve(handler: FetchHandler, port: number, host = "127.0.0.1"): Promise<Server> {
  const server = createServer(nodeListener(handler, `http://${host}:${port}`));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
