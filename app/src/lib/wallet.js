// Wallet Standard connection (Phantom, Solflare, Backpack and any other standard wallet).
// The site only ever asks for `solana:signTransaction`; it sends through its own devnet RPC.
import { getWallets } from "@wallet-standard/app";

const CONNECT = "standard:connect";
const DISCONNECT = "standard:disconnect";
const EVENTS = "standard:events";
const SIGN_TX = "solana:signTransaction";
const SIGN_AND_SEND = "solana:signAndSendTransaction";
const CHAIN = "solana:devnet";
const LAST_KEY = "anyfee.lastWallet";

const state = { wallets: [], wallet: null, account: null };
const listeners = new Set();
let offChange = null;

function emit() {
  for (const fn of listeners) {
    try {
      fn(snapshot());
    } catch (e) {
      console.warn(e);
    }
  }
}

function snapshot() {
  return {
    wallets: state.wallets,
    wallet: state.wallet,
    address: state.account?.address ?? null,
    connected: !!state.account,
  };
}

function eligible(w) {
  return w.chains.some((c) => c.startsWith("solana:")) && CONNECT in w.features && (SIGN_TX in w.features || SIGN_AND_SEND in w.features);
}

export function onWallet(fn) {
  listeners.add(fn);
  fn(snapshot());
  return () => listeners.delete(fn);
}

export function current() {
  return snapshot();
}

function remember(name) {
  try {
    if (name) localStorage.setItem(LAST_KEY, name);
    else localStorage.removeItem(LAST_KEY);
  } catch {
    /* storage blocked */
  }
}

function lastWallet() {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

function pickAccount(accounts) {
  return accounts.find((a) => a.chains?.some((c) => c === CHAIN)) ?? accounts.find((a) => a.chains?.some((c) => c.startsWith("solana:"))) ?? accounts[0] ?? null;
}

function attach(wallet, account) {
  offChange?.();
  state.wallet = wallet;
  state.account = account;
  offChange =
    EVENTS in wallet.features
      ? wallet.features[EVENTS].on("change", ({ accounts }) => {
          if (!accounts) return;
          state.account = pickAccount(accounts);
          if (!state.account) {
            state.wallet = null;
            remember(null);
          }
          emit();
        })
      : null;
  emit();
}

export async function connect(wallet, { silent = false } = {}) {
  const { accounts } = await wallet.features[CONNECT].connect(silent ? { silent: true } : undefined);
  const account = pickAccount(accounts);
  if (!account) {
    if (silent) return null;
    throw new Error(`${wallet.name} did not share an account.`);
  }
  attach(wallet, account);
  remember(wallet.name);
  return account.address;
}

export async function disconnect() {
  const w = state.wallet;
  offChange?.();
  offChange = null;
  state.wallet = null;
  state.account = null;
  remember(null);
  emit();
  try {
    await w?.features[DISCONNECT]?.disconnect();
  } catch {
    /* the wallet may not support it */
  }
}

/** The connected signer, shaped for chain.sendInstructions. Throws when nothing is connected. */
export function signer() {
  const { wallet, account } = state;
  if (!wallet || !account) throw new Error("Connect a wallet first.");
  return {
    address: account.address,
    async signTransaction(bytes) {
      if (SIGN_TX in wallet.features) {
        const [out] = await wallet.features[SIGN_TX].signTransaction({ account, transaction: bytes, chain: CHAIN });
        return out.signedTransaction;
      }
      throw new Error(`${wallet.name} cannot sign without sending; use Phantom, Solflare or Backpack.`);
    },
  };
}

export function init() {
  const api = getWallets();
  const refresh = () => {
    state.wallets = api.get().filter(eligible);
    emit();
  };
  refresh();
  api.on("register", (...added) => {
    refresh();
    const last = lastWallet();
    const w = added.find((x) => x.name === last && eligible(x));
    if (w && !state.account) connect(w, { silent: true }).catch(() => {});
  });
  api.on("unregister", () => {
    refresh();
    if (state.wallet && !api.get().includes(state.wallet)) disconnect();
  });
  const last = lastWallet();
  const w = last && state.wallets.find((x) => x.name === last);
  if (w) connect(w, { silent: true }).catch(() => {});
}
