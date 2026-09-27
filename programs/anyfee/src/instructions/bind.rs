use anchor_lang::prelude::*;

use crate::{
    attestation::{bind_message, verify_preceding_ed25519},
    constants::*,
    error::AnyfeeError,
    events::*,
    state::{Config, Vault},
};

#[derive(Accounts)]
#[instruction(platform: u8, id: u64)]
pub struct Bind<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [VAULT_SEED, &[platform], &id.to_le_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: address-constrained to the instructions sysvar; read via instruction introspection.
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

/// Anyone may submit. Authorisation is the attester's ed25519 signature over `M`, verified by
/// the Ed25519SigVerify instruction immediately before this one.
pub fn handle_bind(
    ctx: Context<Bind>,
    platform: u8,
    id: u64,
    claimant: Pubkey,
    expires_at: i64,
) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, AnyfeeError::Paused);
    require_keys_neq!(claimant, Pubkey::default(), AnyfeeError::InvalidClaimant);
    require_keys_neq!(
        claimant,
        ctx.accounts.vault.key(),
        AnyfeeError::InvalidClaimant
    );

    let now = Clock::get()?.unix_timestamp;
    require!(now < expires_at, AnyfeeError::AttestationExpired);

    let message = bind_message(&crate::ID, platform, id, &claimant, expires_at);
    verify_preceding_ed25519(
        &ctx.accounts.instructions_sysvar.to_account_info(),
        &config.attester,
        &message,
    )?;

    let rebind_delay = config.rebind_delay_secs;
    let vault_key = ctx.accounts.vault.key();
    let vault = &mut ctx.accounts.vault;

    if !vault.is_bound() {
        vault.claimant = claimant;
        vault.bound_at = now;
        vault.pending_claimant = Pubkey::default();
        vault.pending_effective_at = 0;
        emit!(Bound {
            vault: vault_key,
            platform,
            id,
            claimant,
        });
    } else {
        require_keys_neq!(claimant, vault.claimant, AnyfeeError::AlreadyClaimant);
        let effective_at = now
            .checked_add(rebind_delay)
            .ok_or(AnyfeeError::MathOverflow)?;
        vault.pending_claimant = claimant;
        vault.pending_effective_at = effective_at;
        emit!(RebindRequested {
            vault: vault_key,
            platform,
            id,
            current_claimant: vault.claimant,
            pending_claimant: claimant,
            effective_at,
        });
    }
    Ok(())
}

#[derive(Accounts)]
#[instruction(platform: u8, id: u64)]
pub struct FinalizeRebind<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [VAULT_SEED, &[platform], &id.to_le_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
}

/// Permissionless once `now >= pending_effective_at`.
pub fn handle_finalize_rebind(ctx: Context<FinalizeRebind>, platform: u8, id: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, AnyfeeError::Paused);
    let now = Clock::get()?.unix_timestamp;
    let vault_key = ctx.accounts.vault.key();
    let vault = &mut ctx.accounts.vault;
    require!(vault.has_pending_rebind(), AnyfeeError::NoPendingRebind);
    require!(
        now >= vault.pending_effective_at,
        AnyfeeError::RebindNotReady
    );

    let old_claimant = vault.claimant;
    let new_claimant = vault.pending_claimant;
    vault.claimant = new_claimant;
    vault.bound_at = now;
    vault.pending_claimant = Pubkey::default();
    vault.pending_effective_at = 0;

    emit!(RebindFinalized {
        vault: vault_key,
        platform,
        id,
        old_claimant,
        new_claimant,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(platform: u8, id: u64)]
pub struct ClaimantOnly<'info> {
    pub claimant: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, &[platform], &id.to_le_bytes()],
        bump = vault.bump,
        constraint = vault.is_bound() @ AnyfeeError::VaultUnbound,
        constraint = vault.claimant == claimant.key() @ AnyfeeError::NotClaimant
    )]
    pub vault: Account<'info, Vault>,
}

/// Current claimant clears a pending rebind.
pub fn handle_cancel_rebind(ctx: Context<ClaimantOnly>, platform: u8, id: u64) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    let vault = &mut ctx.accounts.vault;
    require!(vault.has_pending_rebind(), AnyfeeError::NoPendingRebind);
    let cancelled_claimant = vault.pending_claimant;
    vault.pending_claimant = Pubkey::default();
    vault.pending_effective_at = 0;

    emit!(RebindCancelled {
        vault: vault_key,
        platform,
        id,
        claimant: vault.claimant,
        cancelled_claimant,
    });
    Ok(())
}

/// Current claimant declines direct tips: new tips are rejected, outstanding tips become
/// refundable immediately, raw inflows (routed fees) stay claimable. Permanent in v0.1.
pub fn handle_decline(ctx: Context<ClaimantOnly>, platform: u8, id: u64) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    let vault = &mut ctx.accounts.vault;
    require!(!vault.declined, AnyfeeError::AlreadyDeclined);
    vault.declined = true;

    emit!(Declined {
        vault: vault_key,
        platform,
        id,
        claimant: vault.claimant,
    });
    Ok(())
}
