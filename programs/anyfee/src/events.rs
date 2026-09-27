use anchor_lang::prelude::*;

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub attester: Pubkey,
    pub usdc_mint: Pubkey,
    pub refund_window_secs: i64,
    pub rebind_delay_secs: i64,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub attester: Pubkey,
    pub refund_window_secs: i64,
    pub rebind_delay_secs: i64,
    pub paused: bool,
}

#[event]
pub struct VaultInitialized {
    pub vault: Pubkey,
    pub platform: u8,
    pub id: u64,
    /// Lamports above rent exemption right after initialization, i.e. routed fees that
    /// reached the address before it was initialized (0 for a fresh address).
    pub prefunded_lamports: u64,
}

#[event]
pub struct Tipped {
    pub vault: Pubkey,
    pub platform: u8,
    pub id: u64,
    pub tip: Pubkey,
    pub tip_index: u64,
    pub sender: Pubkey,
    /// `Pubkey::default()` = SOL.
    pub mint: Pubkey,
    pub amount: u64,
    pub epoch: u64,
}

#[event]
pub struct Bound {
    pub vault: Pubkey,
    pub platform: u8,
    pub id: u64,
    pub claimant: Pubkey,
}

#[event]
pub struct RebindRequested {
    pub vault: Pubkey,
    pub platform: u8,
    pub id: u64,
    pub current_claimant: Pubkey,
    pub pending_claimant: Pubkey,
    pub effective_at: i64,
}

#[event]
pub struct RebindFinalized {
    pub vault: Pubkey,
    pub platform: u8,
    pub id: u64,
    pub old_claimant: Pubkey,
    pub new_claimant: Pubkey,
}

#[event]
pub struct RebindCancelled {
    pub vault: Pubkey,
    pub platform: u8,
    pub id: u64,
    pub claimant: Pubkey,
    pub cancelled_claimant: Pubkey,
}

#[event]
pub struct Claimed {
    pub vault: Pubkey,
    pub platform: u8,
    pub id: u64,
    pub claimant: Pubkey,
    pub destination: Pubkey,
    /// `Pubkey::default()` = SOL.
    pub mint: Pubkey,
    pub amount: u64,
    /// True when this claim consumed the epoch's tips (claim_epoch was incremented).
    pub consumed_tips: bool,
    pub claim_epoch: u64,
}

#[event]
pub struct Refunded {
    pub vault: Pubkey,
    pub platform: u8,
    pub id: u64,
    pub tip: Pubkey,
    pub tip_index: u64,
    pub sender: Pubkey,
    /// `Pubkey::default()` = SOL.
    pub mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Declined {
    pub vault: Pubkey,
    pub platform: u8,
    pub id: u64,
    pub claimant: Pubkey,
}

#[event]
pub struct TipClosed {
    pub vault: Pubkey,
    pub tip: Pubkey,
    pub tip_index: u64,
    pub sender: Pubkey,
}
