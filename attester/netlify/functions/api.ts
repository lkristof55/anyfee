// Netlify Function (v2): serves /api/* from the runtime-agnostic attester handler.
// Deploy with base directory `attester/` (see attester/netlify.toml); secrets are Netlify env vars.
import { netlifyHandler } from "../../src/netlify.ts";

export default netlifyHandler();

export const config = { path: "/api/*" };
