use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::{
    constants::*,
    error::AnyfeeError,
    events::Claimed,
    state::{Config, Vault},
};

/// After a claim that is not made while declined: if the epoch had live tips, they are now
/// consumed (accepted by the claimant). Both counters reset because the epoch is shared by
/// SOL and token tips; the consumed tips' funds simply stay claimable by the claimant.
fn consume_tips(vault: &mut Vault) -> Result<bool> {
    if vault.declined {
        return Ok(false);
    }
    if vault.outstanding_tip_lamports == 0 && vault.outstanding_tip_tokens == 0 {
        return Ok(false);
    }
    vault.claim_epoch = vault
        .claim_epoch
        .checked_add(1)
        .ok_or(AnyfeeError::MathOverflow)?;
    vault.outstanding_tip_lamports = 0;
    vault.outstanding_tip_tokens = 0;
    Ok(true)
}

#[derive(Accounts)]
#[instruction(platform: u8, id: u64)]
pub struct ClaimSol<'info> {
    pub claimant: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, platform.to_le_bytes().as_ref(), id.to_le_bytes().as_ref()],
        bump = vault.bump,
        constraint = vault.is_bound() @ AnyfeeError::VaultUnbound,
        constraint = vault.claimant == claimant.key() @ AnyfeeError::NotClaimant
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: any writable account chosen by the claimant receives the lamports.
    #[account(mut, constraint = destination.key() != vault.key() @ AnyfeeError::InvalidDestination)]
    pub destination: UncheckedAccount<'info>,
}

/// Sends everything above the vault's rent-exempt minimum to `destination`. While declined,
/// `outstanding_tip_lamports` stays behind for refunds. Allowed while a rebind is pending.
pub fn handle_claim_sol(ctx: Context<ClaimSol>, platform: u8, id: u64) -> Result<()> {
    let vault_info = ctx.accounts.vault.to_account_info();
    let rent_min = Rent::get()?.minimum_balance(vault_info.data_len());
    let reserved = if ctx.accounts.vault.declined {
        ctx.accounts.vault.outstanding_tip_lamports
    } else {
        0
    };
    let amount = vault_info
        .lamports()
        .checked_sub(rent_min)
        .and_then(|v| v.checked_sub(reserved))
        .ok_or(AnyfeeError::NothingToClaim)?;
    require!(amount > 0, AnyfeeError::NothingToClaim);

    ctx.accounts.vault.sub_lamports(amount)?;
    ctx.accounts.destination.add_lamports(amount)?;

    let vault_key = ctx.accounts.vault.key();
    let vault = &mut ctx.accounts.vault;
    let consumed_tips = consume_tips(vault)?;
    vault.total_claimed_lamports = vault
        .total_claimed_lamports
        .checked_add(amount)
        .ok_or(AnyfeeError::MathOverflow)?;

    emit!(Claimed {
        vault: vault_key,
        platform,
        id,
        claimant: vault.claimant,
        destination: ctx.accounts.destination.key(),
        mint: Pubkey::default(),
        amount,
        consumed_tips,
        claim_epoch: vault.claim_epoch,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(platform: u8, id: u64)]
pub struct ClaimToken<'info> {
    pub claimant: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [VAULT_SEED, platform.to_le_bytes().as_ref(), id.to_le_bytes().as_ref()],
        bump = vault.bump,
        constraint = vault.is_bound() @ AnyfeeError::VaultUnbound,
        constraint = vault.claimant == claimant.key() @ AnyfeeError::NotClaimant
    )]
    pub vault: Account<'info, Vault>,

    #[account(address = config.usdc_mint)]
    pub usdc_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// Any token account for `config.usdc_mint`, chosen by the claimant.
    #[account(
        mut,
        token::mint = usdc_mint,
        token::token_program = token_program,
        constraint = destination.key() != vault_token_account.key() @ AnyfeeError::InvalidDestination
    )]
    pub destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Sends the vault ATA's balance to `destination`. While declined, `outstanding_tip_tokens`
/// stays behind for refunds. Allowed while a rebind is pending.
pub fn handle_claim_token(ctx: Context<ClaimToken>, platform: u8, id: u64) -> Result<()> {
    let reserved = if ctx.accounts.vault.declined {
        ctx.accounts.vault.outstanding_tip_tokens
    } else {
        0
    };
    let amount = ctx
        .accounts
        .vault_token_account
        .amount
        .checked_sub(reserved)
        .ok_or(AnyfeeError::NothingToClaim)?;
    require!(amount > 0, AnyfeeError::NothingToClaim);

    let id_bytes = id.to_le_bytes();
    let platform_bytes = [platform];
    let bump = [ctx.accounts.vault.bump];
    let seeds: &[&[u8]] = &[VAULT_SEED, &platform_bytes, &id_bytes, &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(
            token::ID,
            TransferChecked {
                from: ctx.accounts.vault_token_account.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let vault_key = ctx.accounts.vault.key();
    let mint = ctx.accounts.usdc_mint.key();
    let destination = ctx.accounts.destination.key();
    let vault = &mut ctx.accounts.vault;
    let consumed_tips = consume_tips(vault)?;
    vault.total_claimed_tokens = vault
        .total_claimed_tokens
        .checked_add(amount)
        .ok_or(AnyfeeError::MathOverflow)?;

    emit!(Claimed {
        vault: vault_key,
        platform,
        id,
        claimant: vault.claimant,
        destination,
        mint,
        amount,
        consumed_tips,
        claim_epoch: vault.claim_epoch,
    });
    Ok(())
}
