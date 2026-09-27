// Number, date and address formatting. Amounts are bigint base units everywhere.

export const LAMPORTS_PER_SOL = 1_000_000_000n;
const THIN = " ";

export function toBig(v) {
  if (typeof v === "bigint") return v;
  if (v === null || v === undefined || v === "") return 0n;
  return BigInt(v);
}

/** 1234500000n, 9 -> "1.2345" (trailing zeros trimmed, at most `maxFrac` decimals, rounded down). */
export function formatUnits(value, decimals, maxFrac = decimals) {
  const v = toBig(value);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${w}${frac ? "." + frac : ""}`;
}

export const sol = (lamports, maxFrac = 6) => formatUnits(lamports, 9, maxFrac);
export const usdc = (amount, maxFrac = 2) => formatUnits(amount, 6, maxFrac);

/** "0.01" -> 10000000n for 9 decimals. Returns null for anything that is not a plain positive decimal. */
export function parseUnits(text, decimals) {
  const s = String(text).trim().replace(/,/g, "");
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") return null;
  const [w, f = ""] = s.split(".");
  if (f.length > decimals) return null;
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function short(addr, n = 4) {
  if (!addr) return "";
  const s = String(addr);
  return s.length <= n * 2 + 1 ? s : `${s.slice(0, n)}…${s.slice(-n)}`;
}

/** "1296269" -> "1 296 269" (thin spaces), for engraving-style display. */
export function groupDigits(id) {
  return String(id).replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const fmtDate = (unix) => dateFmt.format(new Date(Number(unix) * 1000));
export const fmtDateTime = (unix) => dateTimeFmt.format(new Date(Number(unix) * 1000));

export function relTime(unix, now = Date.now() / 1000) {
  const d = Number(unix) - now;
  const a = Math.abs(d);
  const units = [
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  let text = "moments";
  for (const [secs, name] of units) {
    if (a >= secs) {
      const n = Math.floor(a / secs);
      text = `${n} ${name}${n === 1 ? "" : "s"}`;
      break;
    }
  }
  if (text === "moments") return d >= 0 ? "in a moment" : "just now";
  return d >= 0 ? `in ${text}` : `${text} ago`;
}

export function duration(secs) {
  const s = Number(secs);
  if (s % 86400 === 0 && s >= 3 * 86400) return `${s / 86400} days`;
  if (s % 3600 === 0 && s >= 3600) return `${s / 3600} hours`;
  return `${Math.round(s / 60)} min`;
}

let cluster = "devnet";
export function setCluster(c) {
  cluster = c;
}
export function getClusterName() {
  return cluster;
}
function clusterParam() {
  return cluster === "devnet" || cluster === "testnet" ? `?cluster=${cluster}` : `?cluster=custom`;
}
export const explorerTx = (sig) => `https://explorer.solana.com/tx/${sig}${clusterParam()}`;
export const explorerAddress = (addr) => `https://explorer.solana.com/address/${addr}${clusterParam()}`;
