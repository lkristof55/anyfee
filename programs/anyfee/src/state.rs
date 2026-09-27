use anchor_lang::prelude::*;

/// Global configuration. PDA seeds: `["config"]`.
#[account]
#[derive(InitSpace, Debug)]
pub struct Config {
    /// May change attester, windows, pause flag and admin. Can never move vault funds.
    pub admin: Pubkey,
    /// ed25519 key whose signature over the bind message `M` authorises `bind`.
    pub attester: Pubkey,
    /// The only SPL mint accepted by `tip_token` / `claim_token` / `refund_tip_token`.
    pub usdc_mint: Pubkey,
    /// An unbound vault's direct tips become refundable this long after they were sent.
    pub refund_window_secs: i64,
    /// Delay between a rebind request and when it can be finalized.
    pub rebind_delay_secs: i64,
    /// Blocks new tips, binds and rebind finalization. Never blocks claims, refunds,
    /// cancel_rebind or decline.
    pub paused: bool,
    pub bump: u8,
}

/// One vault per (platform, id). PDA seeds: `["vault", [platform], id.to_le_bytes()]`.
///
/// The address is deterministic and can receive lamports (and, through its associated
/// token account, tokens) before the account is initialized.
#[account]
#[derive(InitSpace, Debug)]
pub struct Vault {
    pub platform: u8,
    pub id: u64,
    /// `Pubkey::default()` = unbound.
    pub claimant: Pubkey,
    /// `Pubkey::default()` = no pending rebind.
    pub pending_claimant: Pubkey,
    pub pending_effective_at: i64,
    pub bound_at: i64,
    pub created_at: i64,
    pub declined: bool,
    /// +1 on every claim that consumes tips; tips from an older epoch can no longer be refunded.
    pub claim_epoch: u64,
    /// Number of tips ever received; the next tip's index.
    pub tip_count: u64,
    /// Lamports of receipted tips of the current epoch that are not refunded yet.
    pub outstanding_tip_lamports: u64,
    /// Token base units of receipted tips of the current epoch that are not refunded yet.
    pub outstanding_tip_tokens: u64,
    pub total_claimed_lamports: u64,
    pub total_claimed_tokens: u64,
    pub bump: u8,
}

impl Vault {
    pub fn is_bound(&self) -> bool {
        self.claimant != Pubkey::default()
    }

    pub fn has_pending_rebind(&self) -> bool {
        self.pending_claimant != Pubkey::default()
    }
}

/// Receipt for one direct tip. PDA seeds: `["tip", vault, tip_index.to_le_bytes()]`.
#[account]
#[derive(InitSpace, Debug)]
pub struct Tip {
    pub vault: Pubkey,
    pub sender: Pubkey,
    /// `Pubkey::default()` = SOL; otherwise `config.usdc_mint`.
    pub mint: Pubkey,
    pub amount: u64,
    pub created_at: i64,
    pub epoch: u64,
    pub refunded: bool,
    pub bump: u8,
}

impl Tip {
    pub fn is_sol(&self) -> bool {
        self.mint == Pubkey::default()
    }
}
