// Optional (ATTESTER_SUBMIT=1): send `[init_vault?] + Ed25519SigVerify + bind` as fee payer.
import { ComputeBudgetProgram, Transaction, type Connection, type Keypair, type PublicKey } from "@solana/web3.js";
import {
  MAINNET_GENESIS_HASH,
  attestationToInstructions,
  describeProgramError,
  fetchVaultState,
  initVaultIx,
  type AttestationJson,
} from "@anyfee/sdk";

export type SubmitConnection = Pick<
  Connection,
  | "getGenesisHash"
  | "getLatestBlockhash"
  | "getMultipleAccountsInfo"
  | "getMinimumBalanceForRentExemption"
  | "sendRawTransaction"
  | "confirmTransaction"
>;

export interface SubmitResult {
  platform: number;
  id: string;
  status: "sent" | "already_bound" | "rebind_already_pending" | "failed";
  signature?: string;
  error?: string;
}

let genesisChecked: Promise<void> | null = null;

async function refuseMainnet(conn: SubmitConnection): Promise<void> {
  if (!genesisChecked) {
    genesisChecked = conn.getGenesisHash().then((h) => {
      if (h === MAINNET_GENESIS_HASH) throw new Error("refusing to submit on mainnet-beta (devnet only until legal review)");
    });
    genesisChecked.catch(() => {
      genesisChecked = null;
    });
  }
  return genesisChecked;
}

/** Test hook: forget the cached genesis check. */
export function resetSubmitState(): void {
  genesisChecked = null;
}

export async function submitAttestation(
  conn: SubmitConnection,
  feePayer: Keypair,
  a: AttestationJson,
  opts: { programId: PublicKey; fallbackUsdcMint: PublicKey; confirmTimeoutMs?: number },
): Promise<SubmitResult> {
  const base = { platform: a.platform, id: a.id };
  try {
    await refuseMainnet(conn);
    const state = await fetchVaultState(conn, a.platform, a.id, { programId: opts.programId, fallbackUsdcMint: opts.fallbackUsdcMint });
    if (state.account?.claimant?.toBase58() === a.claimant) return { ...base, status: "already_bound" };
    if (state.account?.pendingClaimant?.toBase58() === a.claimant) return { ...base, status: "rebind_already_pending" };
    if (state.config?.paused) return { ...base, status: "failed", error: "the program is paused" };

    const [ed, bind] = attestationToInstructions(a, { programId: opts.programId });
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
    if (!state.initialized) tx.add(initVaultIx({ payer: feePayer.publicKey, platform: a.platform, id: a.id, programId: opts.programId }));
    tx.add(ed, bind); // adjacent: bind checks the immediately preceding instruction
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = feePayer.publicKey;
    tx.sign(feePayer);
    const signature = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
    const confirm = conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    confirm.catch(() => {}); // a late rejection after the timeout must not become unhandled
    const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), opts.confirmTimeoutMs ?? 20_000).unref?.());
    const res = await Promise.race([confirm, timeout]);
    if (res === "timeout") return { ...base, status: "sent", signature, error: "not confirmed yet; check the signature on an explorer" };
    if (res.value.err) {
      const pe = describeProgramError(res.value.err);
      return { ...base, status: "failed", signature, error: pe ? `${pe.name}: ${pe.msg}` : `transaction failed: ${JSON.stringify(res.value.err)}` };
    }
    return { ...base, status: "sent", signature };
  } catch (e) {
    const pe = describeProgramError(e);
    return { ...base, status: "failed", error: pe ? `${pe.name}: ${pe.msg}` : (e as Error).message };
  }
}
