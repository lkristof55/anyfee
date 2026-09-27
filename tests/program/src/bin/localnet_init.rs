//! Sends `initialize` to a running validator (used by scripts/localnet.sh).
//!
//! Usage: anyfee-localnet-init --url <rpc> --admin <keypair.json> --attester <pubkey>
//!        --usdc-mint <pubkey> [--refund-window <secs>] [--rebind-delay <secs>]
//!        [--smoke-attester <attester keypair.json>]
//!
//! Idempotent: if the config account already exists it only prints it.
//! With `--smoke-attester`, it then runs init_vault + tip_sol, ed25519 + bind, claim_sol
//! against the live validator (checks the precompile path on a real runtime).

use anchor_lang::AccountDeserialize;
use anyfee::Config;
use anyfee_program_tests::{
    config_pda, ix_bind, ix_claim_sol, ix_init_vault, ix_initialize, ix_tip_sol, vault_pda, Env,
    Pubkey, PROGRAM_ID,
};
use solana_commitment_config::CommitmentConfig;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_rpc_client::rpc_client::RpcClient;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::{collections::HashMap, process::exit, str::FromStr};

fn read_keypair(path: &str) -> Keypair {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| {
        eprintln!("cannot read keypair {path}: {e}");
        exit(2)
    });
    let bytes: Vec<u8> = text
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split(',')
        .map(|b| {
            b.trim()
                .parse::<u8>()
                .expect("keypair file must be a JSON byte array")
        })
        .collect();
    Keypair::try_from(bytes.as_slice()).expect("invalid keypair bytes")
}

fn send(rpc: &RpcClient, ixs: &[solana_instruction::Instruction], signers: &[&Keypair]) -> String {
    let blockhash = rpc.get_latest_blockhash().expect("blockhash");
    let msg = Message::new_with_blockhash(ixs, Some(&signers[0].pubkey()), &blockhash);
    let mut tx = Transaction::new_unsigned(msg);
    tx.sign(signers, blockhash);
    match rpc.send_and_confirm_transaction(&tx) {
        Ok(sig) => sig.to_string(),
        Err(e) => {
            eprintln!("transaction failed: {e}");
            exit(1)
        }
    }
}

/// init_vault + tip_sol, [ed25519, bind], claim_sol on the live validator.
fn smoke(rpc: &RpcClient, admin: &Keypair, attester: &Keypair) {
    let platform = 2u8;
    let id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64;
    let vault = vault_pda(platform, id);
    let claimant = Keypair::new();
    send(
        rpc,
        &[
            ix_init_vault(&admin.pubkey(), platform, id),
            ix_tip_sol(&admin.pubkey(), platform, id, 0, 10_000_000),
            solana_system_interface::instruction::transfer(
                &admin.pubkey(),
                &claimant.pubkey(),
                10_000_000,
            ),
        ],
        &[admin],
    );
    let now = rpc
        .get_block_time(rpc.get_slot().expect("slot"))
        .expect("block time");
    let expires_at = now + 900;
    let ed = Env::attest_with(attester, platform, id, &claimant.pubkey(), expires_at);
    send(
        rpc,
        &[ed, ix_bind(platform, id, claimant.pubkey(), expires_at)],
        &[admin],
    );
    let before = rpc.get_balance(&claimant.pubkey()).expect("balance");
    send(
        rpc,
        &[ix_claim_sol(
            &claimant.pubkey(),
            platform,
            id,
            &claimant.pubkey(),
        )],
        &[&claimant],
    );
    let after = rpc.get_balance(&claimant.pubkey()).expect("balance");
    let got = after + 5_000 - before;
    assert_eq!(got, 10_000_000, "claimed amount");
    println!("smoke ok: vault {vault} (platform {platform}, id {id}) tipped, bound, claimed {got} lamports");
}

fn print_config(c: &Config) {
    println!("config    {}", config_pda());
    println!("admin     {}", c.admin);
    println!("attester  {}", c.attester);
    println!("usdc_mint {}", c.usdc_mint);
    println!("refund_window_secs {}", c.refund_window_secs);
    println!("rebind_delay_secs  {}", c.rebind_delay_secs);
    println!("paused    {}", c.paused);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut opts = HashMap::new();
    for pair in args.chunks(2) {
        match pair {
            [k, v] if k.starts_with("--") => {
                opts.insert(k.trim_start_matches("--").to_string(), v.clone());
            }
            _ => {
                eprintln!("usage: anyfee-localnet-init --url <rpc> --admin <keypair.json> --attester <pubkey> --usdc-mint <pubkey> [--refund-window <secs>] [--rebind-delay <secs>]");
                exit(2);
            }
        }
    }
    let get = |k: &str| {
        opts.get(k).cloned().unwrap_or_else(|| {
            eprintln!("missing --{k}");
            exit(2)
        })
    };
    let url = opts
        .get("url")
        .cloned()
        .unwrap_or_else(|| "http://127.0.0.1:8899".into());
    let admin = read_keypair(&get("admin"));
    let attester = Pubkey::from_str(&get("attester")).expect("bad attester pubkey");
    let usdc_mint = Pubkey::from_str(&get("usdc-mint")).expect("bad usdc mint pubkey");
    let refund_window: i64 = opts
        .get("refund-window")
        .map(|v| v.parse().expect("bad --refund-window"))
        .unwrap_or(anyfee::DEFAULT_REFUND_WINDOW_SECS);
    let rebind_delay: i64 = opts
        .get("rebind-delay")
        .map(|v| v.parse().expect("bad --rebind-delay"))
        .unwrap_or(anyfee::DEFAULT_REBIND_DELAY_SECS);

    let rpc = RpcClient::new_with_commitment(url, CommitmentConfig::confirmed());

    let smoke_attester = opts.get("smoke-attester").map(|p| read_keypair(p));

    if let Ok(acc) = rpc.get_account(&config_pda()) {
        let c = Config::try_deserialize(&mut acc.data.as_slice()).expect("config decode");
        println!("already initialized (program {PROGRAM_ID})");
        print_config(&c);
        if let Some(att) = &smoke_attester {
            smoke(&rpc, &admin, att);
        }
        return;
    }

    let ix = ix_initialize(
        &admin.pubkey(),
        attester,
        usdc_mint,
        refund_window,
        rebind_delay,
    );
    let sig = send(&rpc, &[ix], &[&admin]);
    println!("initialize: {sig}");
    let acc = rpc.get_account(&config_pda()).expect("config account");
    let c = Config::try_deserialize(&mut acc.data.as_slice()).expect("config decode");
    print_config(&c);
    if let Some(att) = &smoke_attester {
        smoke(&rpc, &admin, att);
    }
}
