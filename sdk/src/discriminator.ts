import { sha256 } from "@noble/hashes/sha2.js";
import { utf8 } from "./bytes.ts";

/** Anchor instruction discriminator: `sha256("global:<ix_name>")[..8]` (snake_case name). */
export function instructionDiscriminator(ixName: string): Uint8Array {
  return sha256(utf8(`global:${ixName}`)).slice(0, 8);
}

/** Anchor account discriminator: `sha256("account:<Name>")[..8]` (PascalCase name). */
export function accountDiscriminator(accountName: string): Uint8Array {
  return sha256(utf8(`account:${accountName}`)).slice(0, 8);
}

/** Anchor event discriminator: `sha256("event:<Name>")[..8]`. */
export function eventDiscriminator(eventName: string): Uint8Array {
  return sha256(utf8(`event:${eventName}`)).slice(0, 8);
}
