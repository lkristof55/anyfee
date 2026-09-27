// Chain access through the same-origin RPC proxy (/api/rpc; the real RPC URL and its API key stay
// on the server). Transactions: simulate -> wallet signs -> send -> poll for confirmation.
// No websockets: confirmation is polled, so a plain HTTP proxy is enough.
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  PROGRAM_ID,
  TIP_ACCOUNT_SIZE,
  decodeTip,
  describeProgramError,
  fromBase64,
  tipPda,
  toBase64,
  tokenAccountAmount,
  associatedTokenAddress,
} from "@anyfee/sdk";

const RPC_PATH = "/api/rpc";
const GENESIS = {
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: "devnet",
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY": "testnet",
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d": "mainnet-beta",
};

export class ChainError extends Error {
  constructor(message, { code, logs, raw } = {}) {
    super(message);
    this.name = "ChainError";
    this.code = code;
    this.logs = logs;
    this.raw = raw;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch that waits and retries when the RPC is busy (429/503), quietly. */
async function busyFetch(input, init) {
  let r = await fetch(input, init);
  for (let i = 0; (r.status === 429 || r.status === 503) && i < 3; i++) {
    await sleep(600 * 2 ** i);
    r = await fetch(input, init);
  }
  return r;
}

let conn = null;
/** web3.js Connection for the SDK's read helpers (getMultipleAccountsInfo, rent). */
export function connection() {
  if (!conn) {
    conn = new Connection(new URL(RPC_PATH, location.origin).toString(), { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: busyFetch });
  }
  return conn;
}

let rid = 0;
export async function rpc(method, params) {
  let r;
  try {
    r = await busyFetch(RPC_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rid, method, ...(params ? { params } : {}) }),
    });
  } catch {
    throw new ChainError("Could not reach the Solana RPC. Check your connection and try again.", { code: "network" });
  }
  const j = await r.json().catch(() => null);
  if (!j) throw new ChainError(`The RPC answered ${r.status}.`, { code: "rpc" });
  if (j.error) throw new ChainError(j.error.message || "RPC error", { code: j.error.code, logs: j.error.data?.logs, raw: j.error });
  return j.result;
}

let clusterP = null;
export function cluster() {
  clusterP ??= rpc("getGenesisHash")
    .then((g) => GENESIS[g] ?? "localnet")
    .catch(() => {
      clusterP = null;
      return "devnet";
    });
  return clusterP;
}

export async function balance(owner) {
  const r = await rpc("getBalance", [String(owner), { commitment: "confirmed" }]);
  return BigInt(r.value);
}

export async function tokenBalance(owner, mint) {
  const ata = associatedTokenAddress(new PublicKey(owner), new PublicKey(mint));
  const info = await connection().getAccountInfo(ata, "confirmed");
  return { ata, exists: !!info, amount: tokenAccountAmount(info) };
}

export async function rentExempt(size) {
  return BigInt(await rpc("getMinimumBalanceForRentExemption", [size]));
}

// ---- Errors -----------------------------------------------------------------------------------

const FRIENDLY = {
  VaultDeclined: "The owner declined tips: this box returns all mail.",
  Paused: "anyfee is paused right now (the brake for attester incidents). Claims, refunds, cancels and declines still work.",
  NotClaimant: "This wallet is not the claimant of this box.",
  BadAttestation: "The attestation does not match this bind (different box, wallet or expiry).",
  AttestationExpired: "The attestation expired. Ask the attester for a fresh one (they last 15 minutes).",
  RebindNotReady: "The change of claimant is not due yet.",
  NothingToClaim: "There is nothing to claim right now.",
  RefundNotYet: "This tip cannot be refunded yet.",
  TipAlreadySettled: "This tip was already refunded or consumed.",
  VaultUnbound: "Nobody has claimed this box yet.",
  NoPendingRebind: "There is no pending change of claimant.",
  AlreadyClaimant: "This wallet already holds the box.",
  AlreadyDeclined: "This box is already declined.",
  WrongAttester: "The attestation was signed by a key that is not the program's attester.",
  NotRefundable: "The box is claimed, so this tip went to the owner and cannot be refunded.",
  TipNotConsumed: "This receipt is still live: it can be refunded, not closed.",
  ZeroAmount: "The amount must be more than zero.",
};

/** Human sentence for anything thrown by a wallet, the RPC or the program. */
export function explainError(e) {
  if (!e) return "Something went wrong.";
  const msg = String(e?.message ?? e);
  if (e?.code === 4001 || /user rejected|rejected the request|user denied|declined by user|cancell?ed/i.test(msg)) return "You cancelled in your wallet.";
  const pe = describeProgramError(e) ?? describeProgramError({ logs: e.logs, raw: e.raw });
  if (pe) return FRIENDLY[pe.name] ?? `${pe.name}: ${pe.msg}`;
  const logs = (e.logs ?? []).join("\n");
  const all = `${msg}\n${logs}`;
  if (/AccountNotInitialized|Error Number: 3012/.test(all)) return "This box has not been opened on-chain yet.";
  if (/ConstraintSeeds|Error Number: 2006/.test(all)) return "Someone else tipped this box at the same moment. Try again.";
  if (/insufficient (funds|lamports)|no record of a prior credit|InsufficientFundsForRent|insufficient funds for rent/i.test(all)) {
    return "Not enough devnet SOL in this wallet for the amount, the deposits and the fee. Get devnet SOL at faucet.solana.com.";
  }
  if (/insufficient funds/i.test(all) && /token/i.test(all)) return "Not enough devnet USDC in this wallet.";
  if (/Blockhash not found|block height exceeded|expired/i.test(all)) return "The transaction expired before it landed. Try again.";
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}

// ---- Sending ----------------------------------------------------------------------------------

/**
 * Builds a legacy transaction from `ixs` with the wallet as fee payer, simulates it (readable
 * errors before the wallet pops up), asks the wallet to sign, sends it and waits for
 * `confirmed`. Returns the signature.
 */
export async function sendInstructions(ixs, wallet, { onStatus = () => {} } = {}) {
  if (!ixs.length) throw new ChainError("Nothing to send.");
  const payer = new PublicKey(wallet.address);
  onStatus("prepare");
  const { value: bh } = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const tx = new Transaction({ feePayer: payer, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }).add(...ixs);
  const unsigned = tx.serialize({ requireAllSignatures: false, verifySignatures: false });

  const sim = await rpc("simulateTransaction", [
    toBase64(unsigned),
    { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" },
  ]);
  if (sim.value.err) throw new ChainError("simulation failed", { logs: sim.value.logs ?? [], raw: sim.value.err });

  onStatus("sign");
  const signed = await wallet.signTransaction(unsigned);
  const wire = toBase64(signed);
  onStatus("send");
  const sig = await rpc("sendTransaction", [wire, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }]);
  onStatus("confirm", sig);

  const started = Date.now();
  for (let i = 0; ; i++) {
    await sleep(i < 4 ? 900 : 1500);
    const { value } = await rpc("getSignatureStatuses", [[sig]]);
    const st = value?.[0];
    if (st?.err) throw new ChainError("transaction failed", { raw: st.err, logs: [] });
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return sig;
    if (i % 3 === 2) {
      rpc("sendTransaction", [wire, { encoding: "base64", skipPreflight: true, maxRetries: 0 }]).catch(() => {});
      const height = await rpc("getBlockHeight", [{ commitment: "confirmed" }]).catch(() => 0);
      if (height > bh.lastValidBlockHeight) throw new ChainError("The transaction expired before it landed. Try again.", { code: "expired" });
    }
    if (Date.now() - started > 90_000) throw new ChainError(`No confirmation after 90 s. It may still land: ${sig}`, { code: "timeout" });
  }
}

// ---- Tips of one sender -------------------------------------------------------------------------

/**
 * Live tip receipts of `sender` in `vault`, with their tip index (needed by refund/close).
 * One filtered getProgramAccounts call; indices are recovered by deriving tip PDAs locally.
 * Falls back to scanning the most recent receipts when the RPC refuses the scan.
 */
export async function tipsOf(vault, sender, tipCount) {
  const vaultKey = new PublicKey(vault);
  const count = Number(tipCount);
  let found = new Map();
  try {
    const res = await rpc("getProgramAccounts", [
      PROGRAM_ID.toBase58(),
      {
        encoding: "base64",
        commitment: "confirmed",
        filters: [{ dataSize: TIP_ACCOUNT_SIZE }, { memcmp: { offset: 8, bytes: vaultKey.toBase58() } }, { memcmp: { offset: 40, bytes: String(sender) } }],
      },
    ]);
    const list = Array.isArray(res) ? res : (res?.value ?? []);
    for (const a of list) found.set(a.pubkey, { address: a.pubkey, lamports: BigInt(a.account.lamports), tip: decodeTip(fromBase64(a.account.data[0])) });
    const out = [];
    for (let i = count - 1; i >= 0 && found.size > 0 && count - i <= 100_000; i--) {
      const addr = tipPda(vaultKey, BigInt(i))[0].toBase58();
      const hit = found.get(addr);
      if (hit) {
        out.push({ index: BigInt(i), ...hit });
        found.delete(addr);
      }
    }
    return out;
  } catch {
    const out = [];
    const from = Math.max(0, count - 300);
    for (let start = from; start < count; start += 100) {
      const idx = [];
      for (let i = start; i < Math.min(count, start + 100); i++) idx.push(i);
      const keys = idx.map((i) => tipPda(vaultKey, BigInt(i))[0]);
      const infos = await connection().getMultipleAccountsInfo(keys, "confirmed");
      infos.forEach((info, k) => {
        if (!info || !info.owner.equals(PROGRAM_ID)) return;
        const tip = decodeTip(info.data);
        if (tip.sender.toBase58() === String(sender)) out.push({ index: BigInt(idx[k]), address: keys[k].toBase58(), lamports: BigInt(info.lamports), tip });
      });
    }
    return out.reverse();
  }
}

export { fromBase64 };
