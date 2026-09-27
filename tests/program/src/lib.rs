//! Test harness for the anyfee program on LiteSVM.
//!
//! Loads the compiled program from `target/deploy/anyfee.so` (build it first with
//! `scripts/build-program.sh` or `anchor build`), marks `admin` as its upgrade authority,
//! and offers instruction builders plus helpers for time travel, tokens and attestations.

use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use anchor_spl::{associated_token, token::spl_token};
use anyfee::{attestation::bind_message, AnyfeeError, Config, Tip, Vault};
use litesvm::{
    types::{FailedTransactionMetadata, TransactionMetadata},
    LiteSVM,
};
use solana_account::Account;
use solana_clock::Clock;
use solana_instruction::{error::InstructionError, AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_program_pack::Pack;
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;

pub use anchor_lang::prelude::Pubkey;

pub const PROGRAM_ID: Pubkey = anyfee::ID;
pub const T0: i64 = 1_750_000_000;
pub const DAY: i64 = 86_400;
pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
pub const USDC_DECIMALS: u8 = 6;

pub type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

pub fn program_so_path() -> std::path::PathBuf {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest.join("../../target/deploy/anyfee.so")
}

pub fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[anyfee::CONFIG_SEED], &PROGRAM_ID).0
}

pub fn vault_pda(platform: u8, id: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[anyfee::VAULT_SEED, &[platform], &id.to_le_bytes()],
        &PROGRAM_ID,
    )
    .0
}

pub fn tip_pda(vault: &Pubkey, index: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[anyfee::TIP_SEED, vault.as_ref(), &index.to_le_bytes()],
        &PROGRAM_ID,
    )
    .0
}

pub fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    associated_token::get_associated_token_address(owner, mint)
}

pub fn programdata_pda() -> Pubkey {
    Pubkey::find_program_address(
        &[PROGRAM_ID.as_ref()],
        &solana_sdk_ids::bpf_loader_upgradeable::ID,
    )
    .0
}

/// Returns the custom program error code of a failed transaction, if any.
pub fn custom_code(res: &TxResult) -> Option<u32> {
    match res {
        Err(f) => match &f.err {
            TransactionError::InstructionError(_, InstructionError::Custom(c)) => Some(*c),
            _ => None,
        },
        Ok(_) => None,
    }
}

#[track_caller]
pub fn assert_err(res: TxResult, expected: AnyfeeError) {
    let code = u32::from(expected);
    match &res {
        Ok(meta) => panic!(
            "expected {expected:?} ({code}), transaction succeeded. logs:\n{}",
            meta.logs.join("\n")
        ),
        Err(f) => assert_eq!(
            custom_code(&res),
            Some(code),
            "expected {expected:?} ({code}), got {:?}. logs:\n{}",
            f.err,
            f.meta.logs.join("\n")
        ),
    }
}

#[track_caller]
pub fn assert_fails(res: TxResult) -> FailedTransactionMetadata {
    match res {
        Ok(meta) => panic!(
            "expected failure, transaction succeeded. logs:\n{}",
            meta.logs.join("\n")
        ),
        Err(f) => f,
    }
}

#[track_caller]
pub fn assert_ok(res: TxResult) -> TransactionMetadata {
    match res {
        Ok(meta) => meta,
        Err(f) => panic!("transaction failed: {:?}\nlogs:\n{}", f.err, f.meta.logs.join("\n")),
    }
}

pub struct Env {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub attester: Keypair,
    pub mint_authority: Keypair,
    pub usdc_mint: Pubkey,
}

impl Default for Env {
    fn default() -> Self {
        Self::new()
    }
}

impl Env {
    /// Program loaded, admin is upgrade authority, a USDC-like mint exists, clock at `T0`.
    /// Config is NOT initialized (see [`Env::initialized`]).
    pub fn new() -> Self {
        let mut svm = LiteSVM::new();
        let so = std::fs::read(program_so_path()).unwrap_or_else(|e| {
            panic!(
                "cannot read {} ({e}); build the program first: scripts/build-program.sh",
                program_so_path().display()
            )
        });
        svm.add_program(PROGRAM_ID, &so).unwrap();

        let admin = Keypair::new();
        let attester = Keypair::new();
        let mint_authority = Keypair::new();
        svm.airdrop(&admin.pubkey(), 100 * LAMPORTS_PER_SOL).unwrap();
        svm.airdrop(&mint_authority.pubkey(), 10 * LAMPORTS_PER_SOL)
            .unwrap();

        // Make `admin` the program's upgrade authority (LiteSVM loads programs with none).
        let pd = programdata_pda();
        let mut acc = svm.get_account(&pd).unwrap();
        acc.data[12] = 1;
        acc.data[13..45].copy_from_slice(admin.pubkey().as_ref());
        svm.set_account(pd, acc).unwrap();

        let mut env = Env {
            svm,
            admin,
            attester,
            mint_authority,
            usdc_mint: Pubkey::default(),
        };
        env.set_time(T0);
        env.usdc_mint = env.create_mint(USDC_DECIMALS);
        env
    }

    /// [`Env::new`] + `initialize` with default windows.
    pub fn initialized() -> Self {
        let mut env = Self::new();
        let admin = env.admin.insecure_clone();
        let attester = env.attester.pubkey();
        let mint = env.usdc_mint;
        assert_ok(env.initialize(
            &admin,
            attester,
            mint,
            anyfee::DEFAULT_REFUND_WINDOW_SECS,
            anyfee::DEFAULT_REBIND_DELAY_SECS,
        ));
        env
    }

    // ---------------------------------------------------------------- basics

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn set_time(&mut self, unix_timestamp: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = unix_timestamp;
        clock.slot += 1;
        self.svm.set_sysvar(&clock);
    }

    pub fn advance(&mut self, secs: i64) {
        let t = self.now() + secs;
        self.set_time(t);
    }

    pub fn funded_keypair(&mut self, sol: u64) -> Keypair {
        let kp = Keypair::new();
        self.svm
            .airdrop(&kp.pubkey(), sol * LAMPORTS_PER_SOL)
            .unwrap();
        kp
    }

    pub fn lamports(&self, key: &Pubkey) -> u64 {
        self.svm.get_account(key).map(|a| a.lamports).unwrap_or(0)
    }

    pub fn account_exists(&self, key: &Pubkey) -> bool {
        self.svm
            .get_account(key)
            .map(|a| a.lamports > 0)
            .unwrap_or(false)
    }

    pub fn rent_min(&self, len: usize) -> u64 {
        self.svm.minimum_balance_for_rent_exemption(len)
    }

    /// Sends `ixs` in one transaction; `signers[0]` pays fees. Expires the blockhash first so
    /// identical transactions never collide.
    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> TxResult {
        self.svm.expire_blockhash();
        let payer = signers[0].pubkey();
        let msg = Message::new_with_blockhash(ixs, Some(&payer), &self.svm.latest_blockhash());
        let mut tx = Transaction::new_unsigned(msg);
        tx.sign(signers, self.svm.latest_blockhash());
        self.svm.send_transaction(tx)
    }

    /// Plain system transfer, e.g. a "raw" inflow such as a pump.fun shareholder payout.
    pub fn transfer_lamports(&mut self, from: &Keypair, to: &Pubkey, lamports: u64) -> TxResult {
        let ix = solana_system_interface::instruction::transfer(&from.pubkey(), to, lamports);
        self.send(&[ix], &[from])
    }

    // ---------------------------------------------------------------- state

    pub fn config(&self) -> Config {
        let acc = self.svm.get_account(&config_pda()).expect("config");
        Config::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    pub fn vault(&self, platform: u8, id: u64) -> Vault {
        let acc = self
            .svm
            .get_account(&vault_pda(platform, id))
            .expect("vault");
        Vault::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    pub fn tip(&self, platform: u8, id: u64, index: u64) -> Option<Tip> {
        let acc = self
            .svm
            .get_account(&tip_pda(&vault_pda(platform, id), index))?;
        if acc.data.is_empty() {
            return None;
        }
        Some(Tip::try_deserialize(&mut acc.data.as_slice()).unwrap())
    }

    /// Lamports the claimant could take right now (not counting reserved tips).
    pub fn vault_surplus(&self, platform: u8, id: u64) -> u64 {
        let key = vault_pda(platform, id);
        let acc = self.svm.get_account(&key).unwrap();
        acc.lamports - self.rent_min(acc.data.len())
    }

    // ---------------------------------------------------------------- tokens

    pub fn create_mint(&mut self, decimals: u8) -> Pubkey {
        let mint = Keypair::new();
        let rent = self.rent_min(spl_token::state::Mint::LEN);
        let auth = self.mint_authority.insecure_clone();
        let create = solana_system_interface::instruction::create_account(
            &auth.pubkey(),
            &mint.pubkey(),
            rent,
            spl_token::state::Mint::LEN as u64,
            &spl_token::ID,
        );
        let init = spl_token::instruction::initialize_mint2(
            &spl_token::ID,
            &mint.pubkey(),
            &auth.pubkey(),
            None,
            decimals,
        )
        .unwrap();
        assert_ok(self.send(&[create, init], &[&auth, &mint]));
        mint.pubkey()
    }

    pub fn create_ata_ix(&self, payer: &Pubkey, owner: &Pubkey, mint: &Pubkey) -> Instruction {
        associated_token::spl_associated_token_account::instruction::create_associated_token_account_idempotent(
            payer,
            owner,
            mint,
            &spl_token::ID,
        )
    }

    /// Creates `owner`'s ATA for the USDC-like mint (idempotent) and mints `amount` into it.
    pub fn mint_usdc_to(&mut self, owner: &Pubkey, amount: u64) -> Pubkey {
        let auth = self.mint_authority.insecure_clone();
        let mint = self.usdc_mint;
        let create = self.create_ata_ix(&auth.pubkey(), owner, &mint);
        let dest = ata(owner, &mint);
        let mint_ix =
            spl_token::instruction::mint_to(&spl_token::ID, &mint, &dest, &auth.pubkey(), &[], amount)
                .unwrap();
        assert_ok(self.send(&[create, mint_ix], &[&auth]));
        dest
    }

    pub fn token_balance(&self, token_account: &Pubkey) -> u64 {
        match self.svm.get_account(token_account) {
            Some(acc) if !acc.data.is_empty() => {
                spl_token::state::Account::unpack(&acc.data).unwrap().amount
            }
            _ => 0,
        }
    }

    pub fn close_token_account(&mut self, owner: &Keypair, account: &Pubkey) -> TxResult {
        let ix = spl_token::instruction::close_account(
            &spl_token::ID,
            account,
            &owner.pubkey(),
            &owner.pubkey(),
            &[],
        )
        .unwrap();
        self.send(&[ix], &[owner])
    }

    pub fn set_raw_account(&mut self, key: Pubkey, account: Account) {
        self.svm.set_account(key, account).unwrap();
    }

    // ---------------------------------------------------------------- attestation

    /// Ed25519SigVerify instruction: `signer` signs `M(platform, id, claimant, expires_at)`.
    pub fn attest_with(
        signer: &Keypair,
        platform: u8,
        id: u64,
        claimant: &Pubkey,
        expires_at: i64,
    ) -> Instruction {
        let m = bind_message(&PROGRAM_ID, platform, id, claimant, expires_at);
        Self::ed25519_ix(signer, &m)
    }

    pub fn ed25519_ix(signer: &Keypair, message: &[u8]) -> Instruction {
        let sig = signer.sign_message(message);
        let sig_bytes: [u8; 64] = sig.into();
        solana_ed25519_program::new_ed25519_instruction_with_signature(
            message,
            &sig_bytes,
            &signer.pubkey().to_bytes(),
        )
    }

    pub fn attest(&self, platform: u8, id: u64, claimant: &Pubkey, expires_at: i64) -> Instruction {
        Self::attest_with(&self.attester, platform, id, claimant, expires_at)
    }

    /// `[ed25519(M), bind]` signed by `payer` with a 15-minute expiry.
    pub fn bind_as_attester(
        &mut self,
        payer: &Keypair,
        platform: u8,
        id: u64,
        claimant: &Pubkey,
    ) -> TxResult {
        let expires_at = self.now() + 900;
        let ed = self.attest(platform, id, claimant, expires_at);
        let bind = ix_bind(platform, id, *claimant, expires_at);
        self.send(&[ed, bind], &[payer])
    }

    // ---------------------------------------------------------------- program calls

    pub fn initialize(
        &mut self,
        signer: &Keypair,
        attester: Pubkey,
        usdc_mint: Pubkey,
        refund_window_secs: i64,
        rebind_delay_secs: i64,
    ) -> TxResult {
        let ix = Instruction::new_with_bytes(
            PROGRAM_ID,
            &anyfee::instruction::Initialize {
                attester,
                usdc_mint,
                refund_window_secs,
                rebind_delay_secs,
            }
            .data(),
            anyfee::accounts::Initialize {
                admin: signer.pubkey(),
                config: config_pda(),
                program: PROGRAM_ID,
                program_data: programdata_pda(),
                system_program: solana_sdk_ids::system_program::ID,
            }
            .to_account_metas(None),
        );
        self.send(&[ix], &[signer])
    }

    pub fn init_vault(&mut self, payer: &Keypair, platform: u8, id: u64) -> TxResult {
        let ix = ix_init_vault(&payer.pubkey(), platform, id);
        self.send(&[ix], &[payer])
    }

    pub fn tip_sol(&mut self, sender: &Keypair, platform: u8, id: u64, amount: u64) -> TxResult {
        let index = self.vault(platform, id).tip_count;
        let ix = ix_tip_sol(&sender.pubkey(), platform, id, index, amount);
        self.send(&[ix], &[sender])
    }

    pub fn tip_token(&mut self, sender: &Keypair, platform: u8, id: u64, amount: u64) -> TxResult {
        let index = self.vault(platform, id).tip_count;
        let ix = ix_tip_token(&sender.pubkey(), &self.usdc_mint, platform, id, index, amount);
        self.send(&[ix], &[sender])
    }

    pub fn claim_sol(&mut self, claimant: &Keypair, platform: u8, id: u64, dest: &Pubkey) -> TxResult {
        let ix = ix_claim_sol(&claimant.pubkey(), platform, id, dest);
        self.send(&[ix], &[claimant])
    }

    pub fn claim_token(&mut self, claimant: &Keypair, platform: u8, id: u64, dest: &Pubkey) -> TxResult {
        let ix = ix_claim_token(&claimant.pubkey(), &self.usdc_mint, platform, id, dest);
        self.send(&[ix], &[claimant])
    }

    pub fn refund_tip(&mut self, cranker: &Keypair, platform: u8, id: u64, index: u64, sender: &Pubkey) -> TxResult {
        let ix = ix_refund_tip(platform, id, index, sender);
        self.send(&[ix], &[cranker])
    }

    pub fn refund_tip_token(&mut self, cranker: &Keypair, platform: u8, id: u64, index: u64, sender: &Pubkey) -> TxResult {
        let ix = ix_refund_tip_token(&self.usdc_mint, platform, id, index, sender);
        self.send(&[ix], &[cranker])
    }

    pub fn close_tip(&mut self, cranker: &Keypair, platform: u8, id: u64, index: u64, sender: &Pubkey) -> TxResult {
        let ix = ix_close_tip(platform, id, index, sender);
        self.send(&[ix], &[cranker])
    }

    pub fn decline(&mut self, claimant: &Keypair, platform: u8, id: u64) -> TxResult {
        let ix = ix_decline(&claimant.pubkey(), platform, id);
        self.send(&[ix], &[claimant])
    }

    pub fn cancel_rebind(&mut self, claimant: &Keypair, platform: u8, id: u64) -> TxResult {
        let ix = ix_cancel_rebind(&claimant.pubkey(), platform, id);
        self.send(&[ix], &[claimant])
    }

    pub fn finalize_rebind(&mut self, cranker: &Keypair, platform: u8, id: u64) -> TxResult {
        let ix = ix_finalize_rebind(platform, id);
        self.send(&[ix], &[cranker])
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_config(
        &mut self,
        signer: &Keypair,
        new_admin: Option<Pubkey>,
        attester: Option<Pubkey>,
        refund_window_secs: Option<i64>,
        rebind_delay_secs: Option<i64>,
        paused: Option<bool>,
    ) -> TxResult {
        let ix = Instruction::new_with_bytes(
            PROGRAM_ID,
            &anyfee::instruction::SetConfig {
                new_admin,
                attester,
                refund_window_secs,
                rebind_delay_secs,
                paused,
            }
            .data(),
            anyfee::accounts::SetConfig {
                admin: signer.pubkey(),
                config: config_pda(),
            }
            .to_account_metas(None),
        );
        self.send(&[ix], &[signer])
    }
}

// -------------------------------------------------------------------- instruction builders

fn ix(data: Vec<u8>, accounts: Vec<AccountMeta>) -> Instruction {
    Instruction::new_with_bytes(PROGRAM_ID, &data, accounts)
}

pub fn ix_init_vault(payer: &Pubkey, platform: u8, id: u64) -> Instruction {
    ix(
        anyfee::instruction::InitVault { platform, id }.data(),
        anyfee::accounts::InitVault {
            payer: *payer,
            vault: vault_pda(platform, id),
            system_program: solana_sdk_ids::system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_tip_sol(sender: &Pubkey, platform: u8, id: u64, tip_index: u64, amount: u64) -> Instruction {
    let vault = vault_pda(platform, id);
    ix(
        anyfee::instruction::TipSol { platform, id, amount }.data(),
        anyfee::accounts::TipSol {
            sender: *sender,
            config: config_pda(),
            vault,
            tip: tip_pda(&vault, tip_index),
            system_program: solana_sdk_ids::system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_tip_token(
    sender: &Pubkey,
    mint: &Pubkey,
    platform: u8,
    id: u64,
    tip_index: u64,
    amount: u64,
) -> Instruction {
    let vault = vault_pda(platform, id);
    ix(
        anyfee::instruction::TipToken { platform, id, amount }.data(),
        anyfee::accounts::TipToken {
            sender: *sender,
            config: config_pda(),
            vault,
            tip: tip_pda(&vault, tip_index),
            usdc_mint: *mint,
            sender_token_account: ata(sender, mint),
            vault_token_account: ata(&vault, mint),
            token_program: spl_token::ID,
            associated_token_program: associated_token::ID,
            system_program: solana_sdk_ids::system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_bind(platform: u8, id: u64, claimant: Pubkey, expires_at: i64) -> Instruction {
    ix(
        anyfee::instruction::Bind {
            platform,
            id,
            claimant,
            expires_at,
        }
        .data(),
        anyfee::accounts::Bind {
            config: config_pda(),
            vault: vault_pda(platform, id),
            instructions_sysvar: solana_sdk_ids::sysvar::instructions::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_finalize_rebind(platform: u8, id: u64) -> Instruction {
    ix(
        anyfee::instruction::FinalizeRebind { platform, id }.data(),
        anyfee::accounts::FinalizeRebind {
            config: config_pda(),
            vault: vault_pda(platform, id),
        }
        .to_account_metas(None),
    )
}

pub fn ix_cancel_rebind(claimant: &Pubkey, platform: u8, id: u64) -> Instruction {
    ix(
        anyfee::instruction::CancelRebind { platform, id }.data(),
        anyfee::accounts::ClaimantOnly {
            claimant: *claimant,
            vault: vault_pda(platform, id),
        }
        .to_account_metas(None),
    )
}

pub fn ix_decline(claimant: &Pubkey, platform: u8, id: u64) -> Instruction {
    ix(
        anyfee::instruction::Decline { platform, id }.data(),
        anyfee::accounts::ClaimantOnly {
            claimant: *claimant,
            vault: vault_pda(platform, id),
        }
        .to_account_metas(None),
    )
}

pub fn ix_claim_sol(claimant: &Pubkey, platform: u8, id: u64, destination: &Pubkey) -> Instruction {
    ix(
        anyfee::instruction::ClaimSol { platform, id }.data(),
        anyfee::accounts::ClaimSol {
            claimant: *claimant,
            vault: vault_pda(platform, id),
            destination: *destination,
        }
        .to_account_metas(None),
    )
}

pub fn ix_claim_token(
    claimant: &Pubkey,
    mint: &Pubkey,
    platform: u8,
    id: u64,
    destination: &Pubkey,
) -> Instruction {
    let vault = vault_pda(platform, id);
    ix(
        anyfee::instruction::ClaimToken { platform, id }.data(),
        anyfee::accounts::ClaimToken {
            claimant: *claimant,
            config: config_pda(),
            vault,
            usdc_mint: *mint,
            vault_token_account: ata(&vault, mint),
            destination: *destination,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_refund_tip(platform: u8, id: u64, tip_index: u64, sender: &Pubkey) -> Instruction {
    let vault = vault_pda(platform, id);
    ix(
        anyfee::instruction::RefundTip {
            platform,
            id,
            tip_index,
        }
        .data(),
        anyfee::accounts::RefundTip {
            config: config_pda(),
            vault,
            tip: tip_pda(&vault, tip_index),
            sender: *sender,
        }
        .to_account_metas(None),
    )
}

pub fn ix_refund_tip_token(
    mint: &Pubkey,
    platform: u8,
    id: u64,
    tip_index: u64,
    sender: &Pubkey,
) -> Instruction {
    let vault = vault_pda(platform, id);
    ix(
        anyfee::instruction::RefundTipToken {
            platform,
            id,
            tip_index,
        }
        .data(),
        anyfee::accounts::RefundTipToken {
            config: config_pda(),
            vault,
            tip: tip_pda(&vault, tip_index),
            sender: *sender,
            usdc_mint: *mint,
            vault_token_account: ata(&vault, mint),
            sender_token_account: ata(sender, mint),
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_close_tip(platform: u8, id: u64, tip_index: u64, sender: &Pubkey) -> Instruction {
    let vault = vault_pda(platform, id);
    ix(
        anyfee::instruction::CloseTip {
            platform,
            id,
            tip_index,
        }
        .data(),
        anyfee::accounts::CloseTip {
            vault,
            tip: tip_pda(&vault, tip_index),
            sender: *sender,
        }
        .to_account_metas(None),
    )
}
