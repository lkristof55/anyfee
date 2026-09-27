// Claim a box on devnet with a local claimant key (fee payer: keys/devnet-deployer.json):
//   RPC_URL=... node scripts/devnet-claim.ts <platform> <id> <claimant-keypair.json>
import { readFileSync } from "node:fs";
import { Connection, Keypair, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { claimAllInstructions, fetchVaultState } from "../sdk/src/index.ts";
const [platformArg, idArg, keyPath] = process.argv.slice(2);
const conn = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
if ((await conn.getGenesisHash()) !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") throw new Error("not devnet");
const kp = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
const payer = kp(new URL("../keys/devnet-deployer.json", import.meta.url).pathname), claimant = kp(keyPath);
const platform = Number(platformArg) as 1 | 2 | 3, id = BigInt(idArg);
const s = await fetchVaultState(conn, platform, id);
console.log("vault bound to", s.account?.claimant.toBase58(), "| claimant key", claimant.publicKey.toBase58());
const before = await conn.getBalance(claimant.publicKey);
const ixs = await claimAllInstructions(conn, { platform, id, claimant: claimant.publicKey });
const tx = new Transaction().add(...ixs); tx.feePayer = payer.publicKey;
const sig = await sendAndConfirmTransaction(conn, tx, [payer, claimant]);
console.log(`claim https://explorer.solana.com/tx/${sig}?cluster=devnet`);
console.log("claimant received", ((await conn.getBalance(claimant.publicKey)) - before) / LAMPORTS_PER_SOL, "SOL");
