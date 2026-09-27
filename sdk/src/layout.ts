// Instruction, account and event layouts of the anyfee program.
//
// `idl-layout.ts` is generated from the program's Anchor IDL (programs/anyfee/idl/anyfee.json) by
// `npm run sync-idl`; `test/idl-conformance.test.ts` fails if it drifts from the IDL files in the
// repo. Builders pass a superset of named accounts and the layout picks and orders them.
export * from "./layout-types.ts";
export { ACCOUNTS, EVENTS, IDL_PROGRAM_ADDRESS, INSTRUCTIONS, PROGRAM_ERRORS } from "./idl-layout.ts";
import type { INSTRUCTIONS } from "./idl-layout.ts";

export type InstructionName = keyof typeof INSTRUCTIONS;
