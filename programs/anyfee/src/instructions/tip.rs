use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, TransferChecked},
};

use crate::{
    constants::*,
    error::AnyfeeError,
    events::Tipped,
    state::{Config, Tip, Vault},
};

/// Shared bookkeeping for both tip kinds: fills the receipt, bumps counters, emits `Tipped`.
fn record_tip(
    vault: &mut Account<Vault>,
    tip: &mut Account<Tip>,
    tip_bump: u8,
    sender: Pubkey,
    mint: Pubkey,
    amount: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let tip_index = vault.tip_count;

    tip.vault = vault.key();
    tip.sender = sender;
    tip.mint = mint;
    tip.amount = amount;
    tip.created_at = now;
    tip.epoch = vault.claim_epoch;
    tip.refunded = false;
    tip.bump = tip_bump;

    vault.tip_count = vault
        .tip_count
        .checked_add(1)
        .ok_or(AnyfeeError::MathOverflow)?;
    if mint == Pubkey::default() {
        vault.outstanding_tip_lamports = vault
            .outstanding_tip_lamports
            .checked_add(amount)
            .ok_or(AnyfeeError::MathOverflow)?;
    } else {
        vault.outstanding_tip_tokens = vault
            .outstanding_tip_tokens
            .checked_add(amount)
            .ok_or(AnyfeeError::MathOverflow)?;
    }

    emit!(Tipped {
        vault: vault.key(),
        platform: vault.platform,
        id: vault.id,
        tip: tip.key(),
        tip_index,
        sender,
        mint,
        amount,
        epoch: vault.claim_epoch,
    });
    Ok(())
}

fn check_can_tip(config: &Config, vault: &Vault, amount: u64) -> Result<()> {
    require!(!config.paused, AnyfeeError::Paused);
    require!(!vault.declined, AnyfeeError::VaultDeclined);
    require!(amount > 0, AnyfeeError::ZeroAmount);
    Ok(())
}

#[derive(Accounts)]
#[instruction(platform: u8, id: u64)]
pub struct TipSol<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// Must already be initialized (prepend `init_vault` if it is not).
    #[account(
        mut,
        seeds = [VAULT_SEED, platform.to_le_bytes().as_ref(), id.to_le_bytes().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = sender,
        space = 8 + Tip::INIT_SPACE,
        seeds = [TIP_SEED, vault.key().as_ref(), vault.tip_count.to_le_bytes().as_ref()],
        bump
    )]
    pub tip: Account<'info, Tip>,

    pub system_program: Program<'info, System>,
}

pub fn handle_tip_sol(ctx: Context<TipSol>, _platform: u8, _id: u64, amount: u64) -> Result<()> {
    check_can_tip(&ctx.accounts.config, &ctx.accounts.vault, amount)?;

    system_program::transfer(
        CpiContext::new(
            system_program::ID,
            system_program::Transfer {
                from: ctx.accounts.sender.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        amount,
    )?;

    record_tip(
        &mut ctx.accounts.vault,
        &mut ctx.accounts.tip,
        ctx.bumps.tip,
        ctx.accounts.sender.key(),
        Pubkey::default(),
        amount,
    )
}

#[derive(Accounts)]
#[instruction(platform: u8, id: u64)]
pub struct TipToken<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// Must already be initialized (prepend `init_vault` if it is not).
    #[account(
        mut,
        seeds = [VAULT_SEED, platform.to_le_bytes().as_ref(), id.to_le_bytes().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = sender,
        space = 8 + Tip::INIT_SPACE,
        seeds = [TIP_SEED, vault.key().as_ref(), vault.tip_count.to_le_bytes().as_ref()],
        bump
    )]
    pub tip: Account<'info, Tip>,

    #[account(address = config.usdc_mint)]
    pub usdc_mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = sender,
        token::token_program = token_program
    )]
    pub sender_token_account: Account<'info, TokenAccount>,

    /// The vault's associated token account for `config.usdc_mint`; created if missing.
    #[account(
        init_if_needed,
        payer = sender,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_tip_token(
    ctx: Context<TipToken>,
    _platform: u8,
    _id: u64,
    amount: u64,
) -> Result<()> {
    check_can_tip(&ctx.accounts.config, &ctx.accounts.vault, amount)?;

    token::transfer_checked(
        CpiContext::new(
            token::ID,
            TransferChecked {
                from: ctx.accounts.sender_token_account.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.sender.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let mint = ctx.accounts.usdc_mint.key();
    record_tip(
        &mut ctx.accounts.vault,
        &mut ctx.accounts.tip,
        ctx.bumps.tip,
        ctx.accounts.sender.key(),
        mint,
        amount,
    )
}
