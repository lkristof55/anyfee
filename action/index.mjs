// Entry point of the anyfee claim action (runs.using: node24, no build step, no dependencies).
import { run } from "./lib.mjs";

process.exitCode = await run(process.env);
