// Tip a box on devnet from keys/devnet-deployer.json:  RPC_URL=... node scripts/devnet-tip.ts <platform> <id> <lamports>
import { readFileSync } from "node:fs";
import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { tipSolInstructions, vaultPda } from "../sdk/src/index.ts";
const [platformArg, idArg, lamportsArg] = process.argv.slice(2);
const conn = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
if ((await conn.getGenesisHash()) !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") throw new Error("not devnet");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(new URL("../keys/devnet-deployer.json", import.meta.url), "utf8"))));
const platform = Number(platformArg) as 1 | 2 | 3, id = BigInt(idArg), amount = BigInt(lamportsArg ?? "10000000");
console.log("vault", vaultPda(platform, id)[0].toBase58());
const ixs = await tipSolInstructions(conn, { platform, id, sender: payer.publicKey, amount });
const sig = await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [payer]);
console.log(`tip https://explorer.solana.com/tx/${sig}?cluster=devnet`);
