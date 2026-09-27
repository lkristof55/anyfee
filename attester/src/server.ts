// Local development server: `npm run dev` (port 8787). Keys come from env only; for local dev
// point ATTESTER_SECRET_KEY_FILE at a keypair file explicitly, e.g.
//   ATTESTER_SECRET_KEY_FILE=../keys/attester-devnet.json npm run dev
import { readFileSync } from "node:fs";
import { describeConfig, loadConfig } from "./config.ts";
import { createHandler } from "./handler.ts";
import { serve } from "./node.ts";

const config = loadConfig(process.env, (p) => readFileSync(p, "utf8"));
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const server = await serve(createHandler({ config }), port, host);

console.log(`anyfee attester listening on http://${host}:${port}`);
console.log(JSON.stringify(describeConfig(config)));
if (!config.attesterKey) {
  console.log("no ATTESTER_SECRET_KEY / ATTESTER_SECRET_KEY_FILE: resolve-only mode (attest endpoints answer 503)");
}
console.log("endpoints: GET /api/health · GET /api/resolve?q= · POST /api/attest/github · POST /api/attest/x");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
