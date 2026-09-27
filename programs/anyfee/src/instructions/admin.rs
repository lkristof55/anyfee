use anchor_lang::prelude::*;

use crate::{constants::*, error::AnyfeeError, events::*, program::Anyfee, state::Config};

pub fn check_windows(refund_window_secs: i64, rebind_delay_secs: i64) -> Result<()> {
    require!(
        (MIN_REFUND_WINDOW_SECS..=MAX_REFUND_WINDOW_SECS).contains(&refund_window_secs),
        AnyfeeError::InvalidConfig
    );
    require!(
        (MIN_REBIND_DELAY_SECS..=MAX_REBIND_DELAY_SECS).contains(&rebind_delay_secs),
        AnyfeeError::InvalidConfig
    );
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Becomes `config.admin`. Must be the program's upgrade authority, so nobody can
    /// front-run initialization between deploy and initialize.
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,

    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ AnyfeeError::NotUpgradeAuthority)]
    pub program: Program<'info, Anyfee>,

    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ AnyfeeError::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<Initialize>,
    attester: Pubkey,
    usdc_mint: Pubkey,
    refund_window_secs: i64,
    rebind_delay_secs: i64,
) -> Result<()> {
    require_keys_neq!(attester, Pubkey::default(), AnyfeeError::InvalidConfig);
    require_keys_neq!(usdc_mint, Pubkey::default(), AnyfeeError::InvalidConfig);
    check_windows(refund_window_secs, rebind_delay_secs)?;

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.attester = attester;
    config.usdc_mint = usdc_mint;
    config.refund_window_secs = refund_window_secs;
    config.rebind_delay_secs = rebind_delay_secs;
    config.paused = false;
    config.bump = ctx.bumps.config;

    emit!(ConfigInitialized {
        admin: config.admin,
        attester,
        usdc_mint,
        refund_window_secs,
        rebind_delay_secs,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetConfig<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ AnyfeeError::NotAdmin
    )]
    pub config: Account<'info, Config>,
}

/// Every argument is optional; `None` keeps the current value. `usdc_mint` is immutable
/// (outstanding token tips are accounted in it).
pub fn handle_set_config(
    ctx: Context<SetConfig>,
    new_admin: Option<Pubkey>,
    attester: Option<Pubkey>,
    refund_window_secs: Option<i64>,
    rebind_delay_secs: Option<i64>,
    paused: Option<bool>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if let Some(admin) = new_admin {
        require_keys_neq!(admin, Pubkey::default(), AnyfeeError::InvalidConfig);
        config.admin = admin;
    }
    if let Some(attester) = attester {
        require_keys_neq!(attester, Pubkey::default(), AnyfeeError::InvalidConfig);
        config.attester = attester;
    }
    let refund_window = refund_window_secs.unwrap_or(config.refund_window_secs);
    let rebind_delay = rebind_delay_secs.unwrap_or(config.rebind_delay_secs);
    check_windows(refund_window, rebind_delay)?;
    config.refund_window_secs = refund_window;
    config.rebind_delay_secs = rebind_delay;
    if let Some(paused) = paused {
        config.paused = paused;
    }

    emit!(ConfigUpdated {
        admin: config.admin,
        attester: config.attester,
        refund_window_secs: config.refund_window_secs,
        rebind_delay_secs: config.rebind_delay_secs,
        paused: config.paused,
    });
    Ok(())
}
