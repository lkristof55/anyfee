use anchor_lang::prelude::*;

#[error_code]
pub enum AnyfeeError {
    #[msg("Vault has been declined by its claimant; it accepts no new tips")]
    VaultDeclined,
    #[msg("Program is paused (tips, binds and rebind finalization are disabled)")]
    Paused,
    #[msg("Signer is not the vault's claimant")]
    NotClaimant,
    #[msg("Attestation message does not match the expected bind message")]
    BadAttestation,
    #[msg("Attestation has expired")]
    AttestationExpired,
    #[msg("Pending rebind is not effective yet")]
    RebindNotReady,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Tip is not refundable yet")]
    RefundNotYet,
    #[msg("Tip was already refunded or consumed by a claim")]
    TipAlreadySettled,
    #[msg("Unknown platform")]
    UnknownPlatform,
    #[msg("Vault is not bound to a claimant")]
    VaultUnbound,
    #[msg("Vault has no pending rebind")]
    NoPendingRebind,
    #[msg("Claimant is already bound to this vault")]
    AlreadyClaimant,
    #[msg("Vault is already declined")]
    AlreadyDeclined,
    #[msg("Invalid claimant")]
    InvalidClaimant,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Configuration value out of bounds")]
    InvalidConfig,
    #[msg("Signer is not the admin")]
    NotAdmin,
    #[msg("Signer is not the program's upgrade authority")]
    NotUpgradeAuthority,
    #[msg("The instruction before bind must be an Ed25519SigVerify instruction")]
    MissingEd25519Instruction,
    #[msg("Malformed Ed25519SigVerify instruction (need exactly one signature, all offsets inside the same instruction)")]
    MalformedEd25519Instruction,
    #[msg("Attestation was not signed by the configured attester")]
    WrongAttester,
    #[msg("Tip is not refundable: the vault is bound and not declined")]
    NotRefundable,
    #[msg("Wrong refund instruction for this tip's asset (use refund_tip for SOL, refund_tip_token for tokens)")]
    WrongTipKind,
    #[msg("Tip has not been consumed by a claim")]
    TipNotConsumed,
    #[msg("Invalid destination")]
    InvalidDestination,
    #[msg("Vault balance is below its reserved amount")]
    InsufficientVaultBalance,
}
