import { PublicKey } from "@solana/web3.js";
import { BorshReader, bytesEqual, fromBase64 } from "./bytes.ts";
import { PROGRAM_ID } from "./constants.ts";
import { eventDiscriminator } from "./discriminator.ts";
import { EVENTS, PROGRAM_ERRORS } from "./layout.ts";
import type { AccountDataLayout, FieldType } from "./layout-types.ts";

export type EventName = keyof typeof EVENTS;

export interface DecodedEvent {
  name: EventName;
  /** camelCase fields; u64/i64 as bigint, pubkeys as PublicKey. */
  data: Record<string, bigint | number | boolean | PublicKey>;
}

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function read(r: BorshReader, t: FieldType) {
  switch (t) {
    case "u8":
      return r.u8();
    case "bool":
      return r.bool();
    case "u64":
      return r.u64();
    case "i64":
      return r.i64();
    case "pubkey":
      return new PublicKey(r.bytes(32));
  }
}

const DISCS = (Object.values(EVENTS) as AccountDataLayout[]).map((l) => ({ layout: l, disc: eventDiscriminator(l.name) }));

/** Decodes one Anchor event payload (`emit!`), or returns null if it is not an anyfee event. */
export function decodeEvent(data: Uint8Array): DecodedEvent | null {
  if (data.length < 8) return null;
  const hit = DISCS.find((d) => bytesEqual(d.disc, data.subarray(0, 8)));
  if (!hit) return null;
  const r = new BorshReader(data, 8);
  const out: DecodedEvent["data"] = {};
  for (const f of hit.layout.fields) out[camel(f.name)] = read(r, f.type);
  return { name: hit.layout.name as EventName, data: out };
}

/**
 * Extracts anyfee events from transaction logs (`Program data: <base64>` lines emitted while the
 * anyfee program is executing).
 */
export function parseEventsFromLogs(logs: readonly string[], programId: PublicKey = PROGRAM_ID): DecodedEvent[] {
  const stack: string[] = [];
  const out: DecodedEvent[] = [];
  const id = programId.toBase58();
  for (const line of logs) {
    const invoke = /^Program (\S+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]!);
      continue;
    }
    if (/^Program (\S+) (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (stack[stack.length - 1] === id && line.startsWith("Program data: ")) {
      try {
        const ev = decodeEvent(fromBase64(line.slice("Program data: ".length).trim()));
        if (ev) out.push(ev);
      } catch {
        /* not an event */
      }
    }
  }
  return out;
}

/**
 * Maps an anyfee custom error (Anchor code >= 6000) found in an error object, message or logs to
 * `{ code, name, msg }`. Returns null for anything else.
 */
export function describeProgramError(err: unknown): { code: number; name: string; msg: string } | null {
  const candidates: number[] = [];
  const visit = (v: unknown, depth: number): void => {
    if (depth > 6 || v === null || v === undefined) return;
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.Custom === "number") candidates.push(o.Custom);
      for (const k of Object.keys(o)) visit(o[k], depth + 1);
      if (v instanceof Error) visit(v.message, depth + 1);
      return;
    }
    if (typeof v === "string") {
      for (const m of v.matchAll(/custom program error: 0x([0-9a-f]+)/gi)) candidates.push(parseInt(m[1]!, 16));
      for (const m of v.matchAll(/Error Number: (\d+)/g)) candidates.push(Number(m[1]));
    }
  };
  visit(err, 0);
  for (const code of candidates) {
    const e = PROGRAM_ERRORS[code];
    if (e) return { code, ...e };
  }
  return null;
}
