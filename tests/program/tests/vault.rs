//! init_vault, SOL tips, refunds, claims, decline, raw inflows, close_tip.

use anyfee::AnyfeeError;
use anyfee_program_tests::*;
use solana_account::Account;
use solana_signer::Signer;

const P: u8 = 2;
const ID: u64 = 987_654;

fn vault_len() -> usize {
    8 + <anyfee::Vault as anchor_lang::Space>::INIT_SPACE
}

fn tip_len() -> usize {
    8 + <anyfee::Tip as anchor_lang::Space>::INIT_SPACE
}

#[test]
fn account_sizes() {
    assert_eq!(vault_len(), 155);
    assert_eq!(tip_len(), 130);
    assert_eq!(8 + <anyfee::Config as anchor_lang::Space>::INIT_SPACE, 122);
}

#[test]
fn init_vault_fresh_and_unknown_platform() {
    let mut env = Env::initialized();
    let payer = env.funded_keypair(10);
    assert_ok(env.init_vault(&payer, P, ID));
    let v = env.vault(P, ID);
    assert_eq!((v.platform, v.id), (P, ID));
    assert_eq!(v.claimant, Pubkey::default());
    assert_eq!(v.created_at, T0);
    assert_eq!(v.claim_epoch, 0);
    assert_eq!(env.lamports(&vault_pda(P, ID)), env.rent_min(vault_len()));

    // Twice fails.
    assert_fails(env.init_vault(&payer, P, ID));
    // Unknown / reserved platforms.
    for p in [0u8, 4, 5, 255] {
        assert_err(env.init_vault(&payer, p, ID), AnyfeeError::UnknownPlatform);
    }
    for p in [1u8, 3] {
        assert_ok(env.init_vault(&payer, p, ID));
    }
}

#[test]
fn init_vault_on_prefunded_address() {
    let mut env = Env::initialized();
    let funder = env.funded_keypair(10);
    let payer = env.funded_keypair(10);
    let vault = vault_pda(P, ID);

    // Fees routed to the deterministic address before anyone initialized it.
    assert_ok(env.transfer_lamports(&funder, &vault, 3 * LAMPORTS_PER_SOL));
    assert_eq!(env.lamports(&vault), 3 * LAMPORTS_PER_SOL);

    let payer_before = env.lamports(&payer.pubkey());
    assert_ok(env.init_vault(&payer, P, ID));
    // Already above rent: the payer only pays the fee.
    assert_eq!(payer_before - env.lamports(&payer.pubkey()), 5_000);
    let acc = env.svm.get_account(&vault).unwrap();
    assert_eq!(acc.owner, PROGRAM_ID);
    assert_eq!(acc.lamports, 3 * LAMPORTS_PER_SOL);
    assert_eq!(env.vault(P, ID).outstanding_tip_lamports, 0);

    // Pre-funded with less than rent: init tops up.
    let small = 1_000_000u64;
    let vault2 = vault_pda(P, ID + 1);
    assert_ok(env.transfer_lamports(&funder, &vault2, small));
    assert_ok(env.init_vault(&payer, P, ID + 1));
    assert_eq!(env.lamports(&vault2), env.rent_min(vault_len()));

    // Pre-funded tip address does not block tipping either.
    let vault3 = vault_pda(P, ID + 2);
    assert_ok(env.init_vault(&payer, P, ID + 2));
    assert_ok(env.transfer_lamports(&funder, &tip_pda(&vault3, 0), 2_000_000));
    assert_ok(env.tip_sol(&funder, P, ID + 2, 10_000_000));
    assert_eq!(env.tip(P, ID + 2, 0).unwrap().amount, 10_000_000);
}

#[test]
fn tip_requires_initialized_vault_and_positive_amount() {
    let mut env = Env::initialized();
    let sender = env.funded_keypair(10);
    let ix = ix_tip_sol(&sender.pubkey(), P, ID, 0, 1_000);
    let f = assert_fails(env.send(&[ix], &[&sender]));
    assert!(
        format!("{:?}", f.err).contains("Custom(3012)"),
        "{:?}",
        f.err
    );

    // init + tip in one transaction works (what the SDK does for a fresh vault).
    let ixs = [
        ix_init_vault(&sender.pubkey(), P, ID),
        ix_tip_sol(&sender.pubkey(), P, ID, 0, 1_000_000),
    ];
    assert_ok(env.send(&ixs, &[&sender]));
    assert_err(env.tip_sol(&sender, P, ID, 0), AnyfeeError::ZeroAmount);
}

#[test]
fn tip_then_refund_after_window() {
    let mut env = Env::initialized();
    let payer = env.funded_keypair(10);
    let sender = env.funded_keypair(10);
    let cranker = env.funded_keypair(1);
    let vault = vault_pda(P, ID);
    assert_ok(env.init_vault(&payer, P, ID));

    let s0 = env.lamports(&sender.pubkey());
    let amount = 250_000_000u64;
    assert_ok(env.tip_sol(&sender, P, ID, amount));
    let tip_rent = env.rent_min(tip_len());
    assert_eq!(
        s0 - env.lamports(&sender.pubkey()),
        amount + tip_rent + 5_000
    );
    let v = env.vault(P, ID);
    assert_eq!(v.tip_count, 1);
    assert_eq!(v.outstanding_tip_lamports, amount);
    let t = env.tip(P, ID, 0).unwrap();
    assert_eq!(
        (t.sender, t.amount, t.epoch, t.mint),
        (sender.pubkey(), amount, 0, Pubkey::default())
    );
    assert_eq!(t.vault, vault);
    assert_eq!(t.created_at, T0);

    // Before the window: refused (also 1s before).
    assert_err(
        env.refund_tip(&cranker, P, ID, 0, &sender.pubkey()),
        AnyfeeError::RefundNotYet,
    );
    env.advance(anyfee::DEFAULT_REFUND_WINDOW_SECS - 1);
    assert_err(
        env.refund_tip(&cranker, P, ID, 0, &sender.pubkey()),
        AnyfeeError::RefundNotYet,
    );
    env.advance(1);

    // Refund goes to tip.sender only, never to the cranker.
    assert_fails(env.refund_tip(&cranker, P, ID, 0, &cranker.pubkey()));

    let s1 = env.lamports(&sender.pubkey());
    let c1 = env.lamports(&cranker.pubkey());
    assert_ok(env.refund_tip(&cranker, P, ID, 0, &sender.pubkey()));
    assert_eq!(env.lamports(&sender.pubkey()) - s1, amount + tip_rent);
    assert_eq!(c1 - env.lamports(&cranker.pubkey()), 5_000);
    assert!(!env.account_exists(&tip_pda(&vault, 0)));
    assert_eq!(env.vault(P, ID).outstanding_tip_lamports, 0);
    assert_eq!(env.lamports(&vault), env.rent_min(vault_len()));

    // Double refund impossible (account closed).
    assert_fails(env.refund_tip(&cranker, P, ID, 0, &sender.pubkey()));
}

#[test]
fn refund_before_window_fails_and_bound_vault_is_not_refundable() {
    let mut env = Env::initialized();
    let payer = env.funded_keypair(10);
    let sender = env.funded_keypair(10);
    assert_ok(env.init_vault(&payer, P, ID));
    assert_ok(env.tip_sol(&sender, P, ID, 1_000_000));
    env.advance(DAY);
    assert_err(
        env.refund_tip(&payer, P, ID, 0, &sender.pubkey()),
        AnyfeeError::RefundNotYet,
    );

    // Once bound (and not declined), direct tips belong to the recipient.
    let owner = env.funded_keypair(1);
    assert_ok(env.bind_as_attester(&payer, P, ID, &owner.pubkey()));
    env.advance(40 * DAY);
    assert_err(
        env.refund_tip(&payer, P, ID, 0, &sender.pubkey()),
        AnyfeeError::NotRefundable,
    );
    // The token refund path cannot be used for a SOL tip either.
    assert_fails(env.refund_tip_token(&payer, P, ID, 0, &sender.pubkey()));
}

#[test]
fn claim_by_non_claimant_fails() {
    let mut env = Env::initialized();
    let payer = env.funded_keypair(10);
    let owner = env.funded_keypair(1);
    let thief = env.funded_keypair(1);
    assert_ok(env.init_vault(&payer, P, ID));
    assert_ok(env.transfer_lamports(&payer, &vault_pda(P, ID), LAMPORTS_PER_SOL));

    // Unbound vault: nobody can claim.
    assert_err(
        env.claim_sol(&thief, P, ID, &thief.pubkey()),
        AnyfeeError::VaultUnbound,
    );
    assert_ok(env.bind_as_attester(&payer, P, ID, &owner.pubkey()));
    assert_err(
        env.claim_sol(&thief, P, ID, &thief.pubkey()),
        AnyfeeError::NotClaimant,
    );
    // Thief routing the owner's claim to themselves without the owner's signature: impossible
    // (claimant must sign); with the owner as account but not signer the tx can't be built.
    let mut ix = ix_claim_sol(&owner.pubkey(), P, ID, &thief.pubkey());
    ix.accounts[0].is_signer = false;
    assert_fails(env.send(&[ix], &[&thief]));
    // Destination may not be the vault itself.
    assert_err(
        env.claim_sol(&owner, P, ID, &vault_pda(P, ID)),
        AnyfeeError::InvalidDestination,
    );
    assert_ok(env.claim_sol(&owner, P, ID, &thief.pubkey())); // owner's choice
}

#[test]
fn claim_sol_leaves_rent_and_consumes_tips() {
    let mut env = Env::initialized();
    let payer = env.funded_keypair(10);
    let s1 = env.funded_keypair(10);
    let s2 = env.funded_keypair(10);
    let owner = env.funded_keypair(1);
    let dest = solana_keypair::Keypair::new().pubkey();
    let vault = vault_pda(P, ID);
    assert_ok(env.init_vault(&payer, P, ID));
    assert_ok(env.tip_sol(&s1, P, ID, 100_000_000));
    assert_ok(env.tip_sol(&s2, P, ID, 200_000_000));
    assert_ok(env.transfer_lamports(&payer, &vault, 700_000_000)); // raw fee inflow
    assert_ok(env.bind_as_attester(&payer, P, ID, &owner.pubkey()));

    assert_ok(env.claim_sol(&owner, P, ID, &dest));
    assert_eq!(env.lamports(&dest), 1_000_000_000);
    assert_eq!(env.lamports(&vault), env.rent_min(vault_len()));
    let v = env.vault(P, ID);
    assert_eq!(v.claim_epoch, 1);
    assert_eq!(v.outstanding_tip_lamports, 0);
    assert_eq!(v.total_claimed_lamports, 1_000_000_000);

    // Nothing left.
    assert_err(
        env.claim_sol(&owner, P, ID, &dest),
        AnyfeeError::NothingToClaim,
    );

    // Tips from before the claim can never be refunded, even if the vault is later declined.
    assert_ok(env.decline(&owner, P, ID));
    env.advance(60 * DAY);
    assert_err(
        env.refund_tip(&payer, P, ID, 0, &s1.pubkey()),
        AnyfeeError::TipAlreadySettled,
    );
    assert_err(
        env.refund_tip(&payer, P, ID, 1, &s2.pubkey()),
        AnyfeeError::TipAlreadySettled,
    );

    // Their receipts can be closed; the rent returns to each sender.
    let tip_rent = env.rent_min(tip_len());
    let b = env.lamports(&s1.pubkey());
    assert_ok(env.close_tip(&payer, P, ID, 0, &s1.pubkey()));
    assert_eq!(env.lamports(&s1.pubkey()) - b, tip_rent);
    assert!(!env.account_exists(&tip_pda(&vault, 0)));
    // Wrong sender account is rejected.
    assert_fails(env.close_tip(&payer, P, ID, 1, &s1.pubkey()));
    assert_ok(env.close_tip(&payer, P, ID, 1, &s2.pubkey()));
    // Vault untouched by closing receipts.
    assert_eq!(env.lamports(&vault), env.rent_min(vault_len()));
}

#[test]
fn close_tip_refuses_live_tips() {
    let mut env = Env::initialized();
    let payer = env.funded_keypair(10);
    let sender = env.funded_keypair(10);
    assert_ok(env.init_vault(&payer, P, ID));
    assert_ok(env.tip_sol(&sender, P, ID, 5_000_000));
    env.advance(100 * DAY);
    assert_err(
        env.close_tip(&payer, P, ID, 0, &sender.pubkey()),
        AnyfeeError::TipNotConsumed,
    );
}

#[test]
fn tips_after_claim_start_a_new_epoch() {
    let mut env = Env::initialized();
    let payer = env.funded_keypair(10);
    let sender = env.funded_keypair(10);
    let owner = env.funded_keypair(1);
    assert_ok(env.init_vault(&payer, P, ID));
    assert_ok(env.bind_as_attester(&payer, P, ID, &owner.pubkey()));
    assert_ok(env.tip_sol(&sender, P, ID, 10_000_000));
    assert_ok(env.claim_sol(&owner, P, ID, &owner.pubkey()));
    assert_ok(env.tip_sol(&sender, P, ID, 20_000_000));
    let t = env.tip(P, ID, 1).unwrap();
    assert_eq!(t.epoch, 1);
    let v = env.vault(P, ID);
    assert_eq!(
        (v.claim_epoch, v.outstanding_tip_lamports, v.tip_count),
        (1, 20_000_000, 2)
    );
    // Claiming again consumes tip #1 (epoch 2) ...
    assert_ok(env.claim_sol(&owner, P, ID, &owner.pubkey()));
    assert_eq!(env.vault(P, ID).claim_epoch, 2);
    // ... while a claim with no live tips (only a raw inflow) does not bump the epoch.
    env.transfer_lamports(&payer, &vault_pda(P, ID), 1_000_000)
        .unwrap();
    assert_ok(env.claim_sol(&owner, P, ID, &owner.pubkey()));
    assert_eq!(env.vault(P, ID).claim_epoch, 2);
}

#[test]
fn declined_vault_rejects_tips_refunds_immediately_and_claim_keeps_outstanding() {
    let mut env = Env::initialized();
    let payer = env.funded_keypair(10);
    let s1 = env.funded_keypair(10);
    let s2 = env.funded_keypair(10);
    let owner = env.funded_keypair(1);
    let vault = vault_pda(P, ID);
    assert_ok(env.init_vault(&payer, P, ID));
    assert_ok(env.tip_sol(&s1, P, ID, 100_000_000));
    assert_ok(env.tip_sol(&s2, P, ID, 300_000_000));
    assert_ok(env.transfer_lamports(&payer, &vault, 500_000_000)); // fees
    assert_ok(env.bind_as_attester(&payer, P, ID, &owner.pubkey()));

    // Only the claimant can decline.
    assert_err(env.decline(&s1, P, ID), AnyfeeError::NotClaimant);
    assert_ok(env.decline(&owner, P, ID));
    assert!(env.vault(P, ID).declined);
    assert_err(env.decline(&owner, P, ID), AnyfeeError::AlreadyDeclined);

    // New tips rejected.
    assert_err(env.tip_sol(&s1, P, ID, 1_000), AnyfeeError::VaultDeclined);

    // Claim takes the fees but keeps outstanding tips back; epoch unchanged.
    assert_ok(env.claim_sol(&owner, P, ID, &owner.pubkey()));
    let v = env.vault(P, ID);
    assert_eq!(v.claim_epoch, 0);
    assert_eq!(v.outstanding_tip_lamports, 400_000_000);
    assert_eq!(v.total_claimed_lamports, 500_000_000);
    assert_eq!(
        env.lamports(&vault),
        env.rent_min(vault_len()) + 400_000_000
    );
    assert_err(
        env.claim_sol(&owner, P, ID, &owner.pubkey()),
        AnyfeeError::NothingToClaim,
    );

    // Outstanding tips are refundable immediately (no window).
    let b1 = env.lamports(&s1.pubkey());
    assert_ok(env.refund_tip(&payer, P, ID, 0, &s1.pubkey()));
    assert_eq!(
        env.lamports(&s1.pubkey()) - b1,
        100_000_000 + env.rent_min(tip_len())
    );

    // New raw inflow after decline stays claimable.
    assert_ok(env.transfer_lamports(&payer, &vault, 50_000_000));
    assert_ok(env.claim_sol(&owner, P, ID, &owner.pubkey()));
    assert_eq!(
        env.lamports(&vault),
        env.rent_min(vault_len()) + 300_000_000
    );

    assert_ok(env.refund_tip(&payer, P, ID, 1, &s2.pubkey()));
    assert_eq!(env.lamports(&vault), env.rent_min(vault_len()));
    assert_eq!(env.vault(P, ID).outstanding_tip_lamports, 0);
}

#[test]
fn raw_lamport_inflow_is_claimable_after_bind() {
    // Simulates a pump.fun SharingConfig shareholder payout / Bags fee earner: plain system
    // transfers to the vault PDA, before and after initialization, with no Tip receipts.
    let mut env = Env::initialized();
    let pump = env.funded_keypair(100);
    let owner = env.funded_keypair(1);
    let vault = vault_pda(P, ID);

    assert_ok(env.transfer_lamports(&pump, &vault, 7 * LAMPORTS_PER_SOL));
    let payer = env.funded_keypair(1);
    assert_ok(env.init_vault(&payer, P, ID));
    assert_ok(env.transfer_lamports(&pump, &vault, 3 * LAMPORTS_PER_SOL));

    // Not refundable by anyone (no receipts), not claimable before binding.
    assert_err(
        env.claim_sol(&owner, P, ID, &owner.pubkey()),
        AnyfeeError::VaultUnbound,
    );

    assert_ok(env.bind_as_attester(&payer, P, ID, &owner.pubkey()));
    let dest = solana_keypair::Keypair::new().pubkey();
    let rent = env.rent_min(vault_len());
    // Pre-init lamports above rent (7 SOL covered rent, so init added nothing) + 3 SOL.
    let expected = 10 * LAMPORTS_PER_SOL - rent;
    assert_ok(env.claim_sol(&owner, P, ID, &dest));
    assert_eq!(env.lamports(&dest), expected);
    let v = env.vault(P, ID);
    assert_eq!(v.claim_epoch, 0, "no tips were consumed");
    assert_eq!(v.total_claimed_lamports, expected);
}

#[test]
fn unexpected_extra_lamports_are_claimable() {
    // Lamports that arrive without any instruction of ours (e.g. a closed account's rent sent
    // to the vault): claim uses the actual balance minus rent; accounting never underflows.
    let mut env = Env::initialized();
    let payer = env.funded_keypair(10);
    let owner = env.funded_keypair(1);
    assert_ok(env.init_vault(&payer, P, ID));
    let vault = vault_pda(P, ID);
    let mut acc: Account = env.svm.get_account(&vault).unwrap();
    acc.lamports += 42;
    env.set_raw_account(vault, acc);
    assert_ok(env.bind_as_attester(&payer, P, ID, &owner.pubkey()));
    let before = env.lamports(&owner.pubkey());
    assert_ok(env.claim_sol(&owner, P, ID, &owner.pubkey()));
    assert_eq!(env.lamports(&owner.pubkey()) + 5_000 - before, 42);
}
