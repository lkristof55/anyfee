// In-memory chain reader for tests and offline development (import from "@anyfee/sdk/testing").
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { Buffer } from "buffer";
import { PROGRAM_ID, TOKEN_PROGRAM_ID } from "./constants.ts";

export interface MemoryAccount {
  lamports: number;
  owner?: PublicKey;
  data?: Uint8Array;
}

/** Rent-exempt minimum with the default rent parameters (3480 lamports/byte-year x 2 years, 128-byte overhead). */
export function rentExemptMinimum(dataLen: number): number {
  return (128 + dataLen) * 6960;
}

export function memoryChain(initial: Record<string, MemoryAccount> = {}) {
  const accounts = new Map<string, MemoryAccount>(Object.entries(initial));
  const toInfo = (a: MemoryAccount | undefined): AccountInfo<Buffer> | null =>
    a
      ? {
          lamports: a.lamports,
          owner: a.owner ?? new PublicKey("11111111111111111111111111111111"),
          data: Buffer.from(a.data ?? new Uint8Array()),
          executable: false,
          rentEpoch: 0,
        }
      : null;
  return {
    accounts,
    set(address: PublicKey | string, a: MemoryAccount) {
      accounts.set(typeof address === "string" ? address : address.toBase58(), a);
    },
    async getAccountInfo(address: PublicKey) {
      return toInfo(accounts.get(address.toBase58()));
    },
    async getMultipleAccountsInfo(addresses: PublicKey[]) {
      return addresses.map((a) => toInfo(accounts.get(a.toBase58())));
    },
    async getMinimumBalanceForRentExemption(dataLen: number) {
      return rentExemptMinimum(dataLen);
    },
  };
}

/** A 165-byte SPL token account with `amount` at offset 64. */
export function tokenAccountData(mint: PublicKey, owner: PublicKey, amount: bigint): Uint8Array {
  const d = new Uint8Array(165);
  d.set(mint.toBytes(), 0);
  d.set(owner.toBytes(), 32);
  new DataView(d.buffer).setBigUint64(64, amount, true);
  d[108] = 1; // state = initialized
  return d;
}

export const TESTING_OWNERS = { program: PROGRAM_ID, token: TOKEN_PROGRAM_ID };
