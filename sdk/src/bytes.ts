// Minimal little-endian / Borsh helpers. No Buffer dependency so the SDK runs in browsers too.

const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;

/** Accepts bigint, safe-integer number or a decimal string; returns a u64 bigint or throws. */
export function toU64(value: bigint | number | string, what = "value"): bigint {
  let v: bigint;
  if (typeof value === "bigint") v = value;
  else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new RangeError(`${what} must be a safe integer, got ${value}`);
    v = BigInt(value);
  } else {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new RangeError(`${what} must be a decimal integer string, got "${value}"`);
    v = BigInt(value);
  }
  if (v < 0n || v > U64_MAX) throw new RangeError(`${what} out of u64 range: ${v}`);
  return v;
}

export function toI64(value: bigint | number, what = "value"): bigint {
  const v = typeof value === "bigint" ? value : BigInt(value);
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new RangeError(`${what} must be a safe integer`);
  if (v < I64_MIN || v > I64_MAX) throw new RangeError(`${what} out of i64 range: ${v}`);
  return v;
}

export function u64le(value: bigint | number | string): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, toU64(value), true);
  return out;
}

export function i64le(value: bigint | number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, toI64(value), true);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new Error("invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = (bytes[i] as number) << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + "==";
  } else if (rem === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + "=";
  }
  return out;
}

/** Decodes standard or URL-safe base64 (padding optional). Throws on invalid input. */
export function fromBase64(input: string): Uint8Array {
  const s = input.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/]*$/.test(s) || s.length % 4 === 1) throw new Error("invalid base64");
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let buf = 0;
  let bits = 0;
  let o = 0;
  for (const ch of s) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out;
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Sequential Borsh reader used by the account decoders. */
export class BorshReader {
  readonly data: Uint8Array;
  offset: number;
  private readonly view: DataView;

  constructor(data: Uint8Array, offset = 0) {
    this.data = data;
    this.offset = offset;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  private need(n: number): void {
    if (this.offset + n > this.data.length) throw new RangeError(`account data too short: need ${this.offset + n}, have ${this.data.length}`);
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.offset++);
  }

  bool(): boolean {
    const v = this.u8();
    if (v > 1) throw new RangeError(`invalid bool byte ${v} at ${this.offset - 1}`);
    return v === 1;
  }

  u64(): bigint {
    this.need(8);
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }

  i64(): bigint {
    this.need(8);
    const v = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return v;
  }

  bytes(n: number): Uint8Array {
    this.need(n);
    const v = new Uint8Array(this.data.subarray(this.offset, this.offset + n));
    this.offset += n;
    return v;
  }
}

/** Sequential Borsh writer used by the instruction builders. */
export class BorshWriter {
  private parts: Uint8Array[] = [];

  raw(bytes: Uint8Array): this {
    this.parts.push(bytes);
    return this;
  }

  u8(v: number): this {
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new RangeError(`u8 out of range: ${v}`);
    return this.raw(Uint8Array.of(v));
  }

  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }

  u64(v: bigint | number | string): this {
    return this.raw(u64le(v));
  }

  i64(v: bigint | number): this {
    return this.raw(i64le(v));
  }

  pubkey(bytes: Uint8Array): this {
    if (bytes.length !== 32) throw new RangeError("pubkey must be 32 bytes");
    return this.raw(bytes);
  }

  option<T>(v: T | null | undefined, write: (w: this, v: T) => void): this {
    if (v === null || v === undefined) return this.u8(0);
    this.u8(1);
    write(this, v);
    return this;
  }

  toBytes(): Uint8Array {
    return concatBytes(...this.parts);
  }
}
