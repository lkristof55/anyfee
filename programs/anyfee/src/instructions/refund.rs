use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::{
    constants::*,
    error::AnyfeeError,
    events::{Refunded, TipClosed},
    state::{Config, Tip, Vault},
};

/// Refund rule: the tip belongs to the current epoch (not consumed by a claim), is not
/// refunded yet, and either the vault is declined, or the vault is unbound and the refund
/// window has elapsed since the tip was sent.
fn check_refundable(config: &Config, vault: &Vault, tip: &Tip) -> Result<()> {
    require!(!tip.refunded, AnyfeeError::TipAlreadySettled);
    require!(
        tip.epoch == vault.claim_epoch,
        AnyfeeError::TipAlreadySettled
    );
    if vault.declined {
        return Ok(());
    }
    require!(!vault.is_bound(), AnyfeeError::NotRefundable);
    let now = Clock::get()?.unix_timestamp;
    let refundable_at = tip
        .created_at
        .checked_add(config.refund_window_secs)
        .ok_or(AnyfeeError::MathOverflow)?;
    require!(now >= refundable_at, AnyfeeError::RefundNotYet);
    Ok(())
}

#[derive(Accounts)]
#[instruction(platform: u8, id: u64, tip_index: u64)]
pub struct RefundTip<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [VAULT_SEED, &[platform], &id.to_le_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    /// Closed on success; its rent goes back to the sender.
    #[account(
        mut,
        close = sender,
        seeds = [TIP_SEED, vault.key().as_ref(), &tip_index.to_le_bytes()],
        bump = tip.bump,
        has_one = vault,
        has_one = sender
    )]
    pub tip: Account<'info, Tip>,

    /// CHECK: must equal `tip.sender` (has_one above); receives the refund and the tip rent.
    #[account(mut)]
    pub sender: UncheckedAccount<'info>,
}

/// Permissionless crank: returns a SOL tip to `tip.sender`.
pub fn handle_refund_tip(ctx: Context<RefundTip>, platform: u8, id: u64, tip_index: u64) -> Result<()> {
    let tip = &ctx.accounts.tip;
    require!(tip.is_sol(), AnyfeeError::WrongTipKind);
    check_refundable(&ctx.accounts.config, &ctx.accounts.vault, tip)?;
    let amount = tip.amount;

    // Invariant: vault lamports >= rent minimum + outstanding_tip_lamports.
    let vault_info = ctx.accounts.vault.to_account_info();
    let rent_min = Rent::get()?.minimum_balance(vault_info.data_len());
    let available = vault_info
        .lamports()
        .checked_sub(rent_min)
        .ok_or(AnyfeeError::InsufficientVaultBalance)?;
    require!(available >= amount, AnyfeeError::InsufficientVaultBalance);

    ctx.accounts.vault.sub_lamports(amount)?;
    ctx.accounts.sender.add_lamports(amount)?;

    let vault_key = ctx.accounts.vault.key();
    let vault = &mut ctx.accounts.vault;
    vault.outstanding_tip_lamports = vault
        .outstanding_tip_lamports
        .checked_sub(amount)
        .ok_or(AnyfeeError::MathOverflow)?;
    ctx.accounts.tip.refunded = true;

    emit!(Refunded {
        vault: vault_key,
        platform,
        id,
        tip: ctx.accounts.tip.key(),
        tip_index,
        sender: ctx.accounts.sender.key(),
        mint: Pubkey::default(),
        amount,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(platform: u8, id: u64, tip_index: u64)]
pub struct RefundTipToken<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [VAULT_SEED, &[platform], &id.to_le_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    /// Closed on success; its rent goes back to the sender.
    #[account(
        mut,
        close = sender,
        seeds = [TIP_SEED, vault.key().as_ref(), &tip_index.to_le_bytes()],
        bump = tip.bump,
        has_one = vault,
        has_one = sender
    )]
    pub tip: Account<'info, Tip>,

    /// CHECK: must equal `tip.sender` (has_one above); receives the tip rent.
    #[account(mut)]
    pub sender: UncheckedAccount<'info>,

    #[account(address = config.usdc_mint)]
    pub usdc_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// The sender's associated token account for `config.usdc_mint`. If the sender closed it,
    /// the cranker can recreate it first (ATA `create_idempotent`) in the same transaction.
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = sender,
        associated_token::token_program = token_program
    )]
    pub sender_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Permissionless crank: returns a token tip to `tip.sender`'s associated token account.
pub fn handle_refund_tip_token(
    ctx: Context<RefundTipToken>,
    platform: u8,
    id: u64,
    tip_index: u64,
) -> Result<()> {
    let tip = &ctx.accounts.tip;
    require_keys_eq!(
        tip.mint,
        ctx.accounts.config.usdc_mint,
        AnyfeeError::WrongTipKind
    );
    check_refundable(&ctx.accounts.config, &ctx.accounts.vault, tip)?;
    let amount = tip.amount;
    require!(
        ctx.accounts.vault_token_account.amount >= amount,
        AnyfeeError::InsufficientVaultBalance
    );

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
                to: ctx.accounts.sender_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let vault_key = ctx.accounts.vault.key();
    let mint = ctx.accounts.usdc_mint.key();
    let vault = &mut ctx.accounts.vault;
    vault.outstanding_tip_tokens = vault
        .outstanding_tip_tokens
        .checked_sub(amount)
        .ok_or(AnyfeeError::MathOverflow)?;
    ctx.accounts.tip.refunded = true;

    emit!(Refunded {
        vault: vault_key,
        platform,
        id,
        tip: ctx.accounts.tip.key(),
        tip_index,
        sender: ctx.accounts.sender.key(),
        mint,
        amount,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(platform: u8, id: u64, tip_index: u64)]
pub struct CloseTip<'info> {
    #[account(
        seeds = [VAULT_SEED, &[platform], &id.to_le_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        close = sender,
        seeds = [TIP_SEED, vault.key().as_ref(), &tip_index.to_le_bytes()],
        bump = tip.bump,
        has_one = vault,
        has_one = sender
    )]
    pub tip: Account<'info, Tip>,

    /// CHECK: must equal `tip.sender` (has_one above); receives the tip account's rent.
    #[account(mut)]
    pub sender: UncheckedAccount<'info>,
}

/// Permissionless crank (addition to spec v0.1): once a claim has consumed a tip
/// (`tip.epoch < vault.claim_epoch`), the receipt is useless; close it and return its rent to
/// the sender. Moves no vault funds.
pub fn handle_close_tip(ctx: Context<CloseTip>, _platform: u8, _id: u64, tip_index: u64) -> Result<()> {
    require!(
        ctx.accounts.tip.epoch < ctx.accounts.vault.claim_epoch,
        AnyfeeError::TipNotConsumed
    );
    emit!(TipClosed {
        vault: ctx.accounts.vault.key(),
        tip: ctx.accounts.tip.key(),
        tip_index,
        sender: ctx.accounts.sender.key(),
    });
    Ok(())
}
