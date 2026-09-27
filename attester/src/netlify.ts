// Netlify Functions (v2) adapter. Functions v2 already speak (Request) => Response, so the
// adapter only builds the handler once per instance from environment variables.
import { loadConfig, type Env } from "./config.ts";
import { createHandler } from "./handler.ts";

let cached: ((req: Request) => Promise<Response>) | null = null;

export function netlifyHandler(env: Env = process.env): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (!cached) cached = createHandler({ config: loadConfig(env) }); // no key-file support in serverless
    return cached(req);
  };
}
