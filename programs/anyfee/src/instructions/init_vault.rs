use anchor_lang::prelude::*;

use crate::{constants::*, error::AnyfeeError, events::VaultInitialized, state::Vault};

#[derive(Accounts)]
#[instruction(platform: u8, id: u64)]
pub struct InitVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Anchor's `init` handles an address that already holds lamports (routed fees sent
    /// before initialization): it tops up to rent exemption, then allocates and assigns
    /// with the PDA signature. Pre-existing lamports stay in the vault and are claimable.
    #[account(
        init,
        payer = payer,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, platform.to_le_bytes().as_ref(), id.to_le_bytes().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    pub system_program: Program<'info, System>,
}

pub fn handle_init_vault(ctx: Context<InitVault>, platform: u8, id: u64) -> Result<()> {
    require!(is_known_platform(platform), AnyfeeError::UnknownPlatform);

    let now = Clock::get()?.unix_timestamp;
    let vault_key = ctx.accounts.vault.key();
    let rent_min = Rent::get()?.minimum_balance(8 + Vault::INIT_SPACE);
    let lamports = ctx.accounts.vault.get_lamports();

    let vault = &mut ctx.accounts.vault;
    vault.platform = platform;
    vault.id = id;
    vault.claimant = Pubkey::default();
    vault.pending_claimant = Pubkey::default();
    vault.pending_effective_at = 0;
    vault.bound_at = 0;
    vault.created_at = now;
    vault.declined = false;
    vault.claim_epoch = 0;
    vault.tip_count = 0;
    vault.outstanding_tip_lamports = 0;
    vault.outstanding_tip_tokens = 0;
    vault.total_claimed_lamports = 0;
    vault.total_claimed_tokens = 0;
    vault.bump = ctx.bumps.vault;

    emit!(VaultInitialized {
        vault: vault_key,
        platform,
        id,
        prefunded_lamports: lamports.saturating_sub(rent_min),
    });
    Ok(())
}
