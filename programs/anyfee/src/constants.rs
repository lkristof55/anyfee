use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

#[constant]
pub const TIP_SEED: &[u8] = b"tip";

/// Domain separator at the start of the attestation message `M`.
#[constant]
pub const BIND_DOMAIN: &[u8] = b"anyfee:bind:v1";

/// `M` = domain (14) || program_id (32) || platform (1) || id u64 LE (8) || claimant (32) || expires_at i64 LE (8).
#[constant]
pub const BIND_MESSAGE_LEN: u16 = 95;

#[constant]
pub const PLATFORM_GITHUB_USER: u8 = 1;

#[constant]
pub const PLATFORM_GITHUB_REPO: u8 = 2;

#[constant]
pub const PLATFORM_X: u8 = 3;

#[constant]
pub const DEFAULT_REFUND_WINDOW_SECS: i64 = 2_592_000; // 30 days

#[constant]
pub const DEFAULT_REBIND_DELAY_SECS: i64 = 172_800; // 48 hours

/// Lower bound for `refund_window_secs` (1 day): tips cannot be bounced before a recipient can react.
#[constant]
pub const MIN_REFUND_WINDOW_SECS: i64 = 86_400;

/// Upper bound for `refund_window_secs` (365 days): sender funds are never locked indefinitely.
#[constant]
pub const MAX_REFUND_WINDOW_SECS: i64 = 31_536_000;

/// Lower bound for `rebind_delay_secs` (1 day): a claimant always has at least a day to cancel
/// a rebind requested by a compromised attester.
#[constant]
pub const MIN_REBIND_DELAY_SECS: i64 = 86_400;

/// Upper bound for `rebind_delay_secs` (30 days).
#[constant]
pub const MAX_REBIND_DELAY_SECS: i64 = 2_592_000;

pub fn is_known_platform(platform: u8) -> bool {
    matches!(
        platform,
        PLATFORM_GITHUB_USER | PLATFORM_GITHUB_REPO | PLATFORM_X
    )
}
