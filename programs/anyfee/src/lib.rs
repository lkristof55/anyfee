//! anyfee: one address for anyone. Tips (SOL / USDC) and routed creator fees go to a vault
//! keyed to a GitHub user, GitHub repo or X account's permanent numeric id. The owner claims
//! after an attester binds the vault to their wallet; unclaimed direct tips go back to their
//! senders. No admin or attester can ever move funds to itself.
//!
//! See docs/SPEC.md (contract), docs/THREAT-MODEL.md and docs/DECISIONS.md.
#![allow(unexpected_cfgs)]

pub mod attestation;
pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::AnyfeeError;
pub use events::*;
pub use instructions::*;
pub use state::*;

declare_id!("BixfaA4JmPvntZvGZwnqhHdoUQvEzZY6ZBMXCLgF3C9M");

#[program]
pub mod anyfee {
    use super::*;

    /// One-time setup. The signer must be the program's upgrade authority and becomes admin.
    pub fn initialize(
        ctx: Context<Initialize>,
        attester: Pubkey,
        usdc_mint: Pubkey,
        refund_window_secs: i64,
        rebind_delay_secs: i64,
    ) -> Result<()> {
        instructions::admin::handle_initialize(
            ctx,
            attester,
            usdc_mint,
            refund_window_secs,
            rebind_delay_secs,
        )
    }

    /// Admin only. `None` keeps a value. Cannot touch vault funds or `usdc_mint`.
    pub fn set_config(
        ctx: Context<SetConfig>,
        new_admin: Option<Pubkey>,
        attester: Option<Pubkey>,
        refund_window_secs: Option<i64>,
        rebind_delay_secs: Option<i64>,
        paused: Option<bool>,
    ) -> Result<()> {
        instructions::admin::handle_set_config(
            ctx,
            new_admin,
            attester,
            refund_window_secs,
            rebind_delay_secs,
            paused,
        )
    }

    /// Permissionless; the payer funds rent. Works on an address that already holds lamports.
    pub fn init_vault(ctx: Context<InitVault>, platform: u8, id: u64) -> Result<()> {
        instructions::init_vault::handle_init_vault(ctx, platform, id)
    }

    /// Direct SOL tip with a refundable receipt. The vault must exist.
    pub fn tip_sol(ctx: Context<TipSol>, platform: u8, id: u64, amount: u64) -> Result<()> {
        instructions::tip::handle_tip_sol(ctx, platform, id, amount)
    }

    /// Direct `config.usdc_mint` tip into the vault's ATA (created if missing). The vault must exist.
    pub fn tip_token(ctx: Context<TipToken>, platform: u8, id: u64, amount: u64) -> Result<()> {
        instructions::tip::handle_tip_token(ctx, platform, id, amount)
    }

    /// Binds (or requests a rebind of) a vault to `claimant`. Requires the immediately
    /// preceding instruction to be an Ed25519SigVerify of `M` by `config.attester`.
    pub fn bind(
        ctx: Context<Bind>,
        platform: u8,
        id: u64,
        claimant: Pubkey,
        expires_at: i64,
    ) -> Result<()> {
        instructions::bind::handle_bind(ctx, platform, id, claimant, expires_at)
    }

    /// Permissionless once the rebind delay has passed.
    pub fn finalize_rebind(ctx: Context<FinalizeRebind>, platform: u8, id: u64) -> Result<()> {
        instructions::bind::handle_finalize_rebind(ctx, platform, id)
    }

    /// Current claimant clears a pending rebind.
    pub fn cancel_rebind(ctx: Context<ClaimantOnly>, platform: u8, id: u64) -> Result<()> {
        instructions::bind::handle_cancel_rebind(ctx, platform, id)
    }

    /// Current claimant withdraws all lamports above rent (minus outstanding tips if declined).
    pub fn claim_sol(ctx: Context<ClaimSol>, platform: u8, id: u64) -> Result<()> {
        instructions::claim::handle_claim_sol(ctx, platform, id)
    }

    /// Current claimant withdraws the vault ATA balance (minus outstanding tips if declined).
    pub fn claim_token(ctx: Context<ClaimToken>, platform: u8, id: u64) -> Result<()> {
        instructions::claim::handle_claim_token(ctx, platform, id)
    }

    /// Permissionless crank: refunds a SOL tip to its sender when the refund rules allow it.
    pub fn refund_tip(ctx: Context<RefundTip>, platform: u8, id: u64, tip_index: u64) -> Result<()> {
        instructions::refund::handle_refund_tip(ctx, platform, id, tip_index)
    }

    /// Permissionless crank: refunds a token tip to its sender's ATA when the rules allow it.
    pub fn refund_tip_token(
        ctx: Context<RefundTipToken>,
        platform: u8,
        id: u64,
        tip_index: u64,
    ) -> Result<()> {
        instructions::refund::handle_refund_tip_token(ctx, platform, id, tip_index)
    }

    /// Current claimant declines: no new tips, outstanding tips refundable immediately.
    pub fn decline(ctx: Context<ClaimantOnly>, platform: u8, id: u64) -> Result<()> {
        instructions::bind::handle_decline(ctx, platform, id)
    }

    /// Permissionless crank: closes a tip receipt consumed by a claim; rent back to its sender.
    pub fn close_tip(ctx: Context<CloseTip>, platform: u8, id: u64, tip_index: u64) -> Result<()> {
        instructions::refund::handle_close_tip(ctx, platform, id, tip_index)
    }
}
