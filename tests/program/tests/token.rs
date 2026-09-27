//! USDC-like (classic SPL Token, 6 decimals) tips, claims and refunds.

use anyfee::AnyfeeError;
use anyfee_program_tests::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

const P: u8 = 3; // X account
const ID: u64 = 44_196_397;
const USDC: u64 = 1_000_000;

fn setup() -> (Env, Keypair) {
    let mut env = Env::initialized();
    let payer = env.funded_keypair(10);
    assert_ok(env.init_vault(&payer, P, ID));
    (env, payer)
}

#[test]
fn token_tip_creates_vault_ata_and_records_receipt() {
    let (mut env, _payer) = setup();
    let sender = env.funded_keypair(5);
    let sender_ata = env.mint_usdc_to(&sender.pubkey(), 100 * USDC);
    let vault = vault_pda(P, ID);
    let vault_ata = ata(&vault, &env.usdc_mint);
    assert!(!env.account_exists(&vault_ata));

    assert_ok(env.tip_token(&sender, P, ID, 25 * USDC));
    assert_eq!(env.token_balance(&vault_ata), 25 * USDC);
    assert_eq!(env.token_balance(&sender_ata), 75 * USDC);
    let v = env.vault(P, ID);
    assert_eq!(v.outstanding_tip_tokens, 25 * USDC);
    assert_eq!(v.outstanding_tip_lamports, 0);
    let t = env.tip(P, ID, 0).unwrap();
    assert_eq!(
        (t.mint, t.amount, t.sender),
        (env.usdc_mint, 25 * USDC, sender.pubkey())
    );

    // ATA exists now; a second tip reuses it.
    assert_ok(env.tip_token(&sender, P, ID, 5 * USDC));
    assert_eq!(env.token_balance(&vault_ata), 30 * USDC);
    assert_eq!(env.vault(P, ID).tip_count, 2);
}

#[test]
fn token_tip_rejects_other_mints_and_zero() {
    let (mut env, _payer) = setup();
    let sender = env.funded_keypair(5);
    env.mint_usdc_to(&sender.pubkey(), 10 * USDC);
    assert_err(env.tip_token(&sender, P, ID, 0), AnyfeeError::ZeroAmount);

    // A different mint is refused (address constraint on usdc_mint).
    let other_mint = env.create_mint(6);
    let idx = env.vault(P, ID).tip_count;
    let ix = ix_tip_token(&sender.pubkey(), &other_mint, P, ID, idx, USDC);
    assert_fails(env.send(&[ix], &[&sender]));
}

#[test]
fn token_claim_and_consumption() {
    let (mut env, payer) = setup();
    let sender = env.funded_keypair(5);
    let owner = env.funded_keypair(1);
    env.mint_usdc_to(&sender.pubkey(), 100 * USDC);
    let vault = vault_pda(P, ID);
    let vault_ata = ata(&vault, &env.usdc_mint);

    assert_ok(env.tip_token(&sender, P, ID, 40 * USDC));
    assert_ok(env.tip_sol(&sender, P, ID, 10_000_000));
    // Tokens that arrive at the vault ATA directly (e.g. fee routing) are claimable too.
    let mint = env.usdc_mint;
    let auth = env.mint_authority.insecure_clone();
    let mint_ix = anchor_spl::token::spl_token::instruction::mint_to(
        &anchor_spl::token::ID,
        &mint,
        &vault_ata,
        &auth.pubkey(),
        &[],
        2 * USDC,
    )
    .unwrap();
    assert_ok(env.send(&[mint_ix], &[&auth]));

    let dest = env.mint_usdc_to(&owner.pubkey(), 0);
    assert_err(
        env.claim_token(&owner, P, ID, &dest),
        AnyfeeError::VaultUnbound,
    );
    assert_ok(env.bind_as_attester(&payer, P, ID, &owner.pubkey()));
    let thief = env.funded_keypair(1);
    let thief_ata = env.mint_usdc_to(&thief.pubkey(), 0);
    assert_err(
        env.claim_token(&thief, P, ID, &thief_ata),
        AnyfeeError::NotClaimant,
    );
    // Destination == the vault ATA itself is refused (Anchor's duplicate-mutable-account
    // check fires before our InvalidDestination constraint).
    assert_fails(env.claim_token(&owner, P, ID, &vault_ata));

    assert_ok(env.claim_token(&owner, P, ID, &dest));
    assert_eq!(env.token_balance(&dest), 42 * USDC);
    assert_eq!(env.token_balance(&vault_ata), 0);
    let v = env.vault(P, ID);
    // The claim consumed the epoch's tips: token AND SOL receipts (shared epoch).
    assert_eq!(v.claim_epoch, 1);
    assert_eq!(v.outstanding_tip_tokens, 0);
    assert_eq!(v.outstanding_tip_lamports, 0);
    assert_eq!(v.total_claimed_tokens, 42 * USDC);
    assert_err(
        env.claim_token(&owner, P, ID, &dest),
        AnyfeeError::NothingToClaim,
    );

    // The SOL tip's lamports are still there and still the claimant's.
    let before = env.lamports(&owner.pubkey());
    assert_ok(env.claim_sol(&owner, P, ID, &owner.pubkey()));
    assert_eq!(env.lamports(&owner.pubkey()) + 5_000 - before, 10_000_000);
    assert_eq!(env.vault(P, ID).claim_epoch, 1);

    // Consumed token receipts: not refundable even after a later decline; closable.
    assert_ok(env.decline(&owner, P, ID));
    assert_err(
        env.refund_tip_token(&payer, P, ID, 0, &sender.pubkey()),
        AnyfeeError::TipAlreadySettled,
    );
    assert_ok(env.close_tip(&payer, P, ID, 0, &sender.pubkey()));
    assert_ok(env.close_tip(&payer, P, ID, 1, &sender.pubkey()));
}

#[test]
fn token_refund_after_window_to_sender_ata() {
    let (mut env, payer) = setup();
    let sender = env.funded_keypair(5);
    let sender_ata = env.mint_usdc_to(&sender.pubkey(), 10 * USDC);
    let cranker = env.funded_keypair(1);
    assert_ok(env.tip_token(&sender, P, ID, 7 * USDC));
    assert_ok(env.tip_sol(&sender, P, ID, 1_000_000));

    assert_err(
        env.refund_tip_token(&cranker, P, ID, 0, &sender.pubkey()),
        AnyfeeError::RefundNotYet,
    );
    env.advance(anyfee::DEFAULT_REFUND_WINDOW_SECS);

    // Wrong instruction for the asset kind.
    assert_err(
        env.refund_tip(&cranker, P, ID, 0, &sender.pubkey()),
        AnyfeeError::WrongTipKind,
    );
    let _ = payer;
    // Cannot redirect to the cranker's ATA.
    env.mint_usdc_to(&cranker.pubkey(), 0);
    let mut ix = ix_refund_tip_token(&env.usdc_mint, P, ID, 0, &sender.pubkey());
    ix.accounts[6].pubkey = ata(&cranker.pubkey(), &env.usdc_mint);
    assert_fails(env.send(&[ix], &[&cranker]));

    // The sender closed their ATA meanwhile: the cranker recreates it in the same tx.
    let transfer_out = anchor_spl::token::spl_token::instruction::transfer(
        &anchor_spl::token::ID,
        &sender_ata,
        &ata(&cranker.pubkey(), &env.usdc_mint),
        &sender.pubkey(),
        &[],
        3 * USDC,
    )
    .unwrap();
    assert_ok(env.send(&[transfer_out], &[&sender]));
    assert_ok(env.close_token_account(&sender, &sender_ata));
    assert!(!env.account_exists(&sender_ata));

    let recreate = env.create_ata_ix(&cranker.pubkey(), &sender.pubkey(), &env.usdc_mint);
    let refund = ix_refund_tip_token(&env.usdc_mint, P, ID, 0, &sender.pubkey());
    let s_before = env.lamports(&sender.pubkey());
    assert_ok(env.send(&[recreate, refund], &[&cranker]));
    assert_eq!(env.token_balance(&sender_ata), 7 * USDC);
    let tip_rent = env.rent_min(130);
    assert_eq!(env.lamports(&sender.pubkey()) - s_before, tip_rent);
    let v = env.vault(P, ID);
    assert_eq!(v.outstanding_tip_tokens, 0);
    assert_eq!(v.outstanding_tip_lamports, 1_000_000);
    assert_eq!(
        env.token_balance(&ata(&vault_pda(P, ID), &env.usdc_mint)),
        0
    );

    // SOL tip refunds separately.
    assert_ok(env.refund_tip(&cranker, P, ID, 1, &sender.pubkey()));
    assert_eq!(env.vault(P, ID).outstanding_tip_lamports, 0);
}

#[test]
fn declined_vault_token_claim_keeps_outstanding_back() {
    let (mut env, payer) = setup();
    let sender = env.funded_keypair(5);
    let owner = env.funded_keypair(1);
    env.mint_usdc_to(&sender.pubkey(), 100 * USDC);
    let vault_ata = ata(&vault_pda(P, ID), &env.usdc_mint);
    assert_ok(env.tip_token(&sender, P, ID, 30 * USDC));

    // Routed tokens (no receipt).
    let mint = env.usdc_mint;
    let auth = env.mint_authority.insecure_clone();
    let mint_ix = anchor_spl::token::spl_token::instruction::mint_to(
        &anchor_spl::token::ID,
        &mint,
        &vault_ata,
        &auth.pubkey(),
        &[],
        5 * USDC,
    )
    .unwrap();
    assert_ok(env.send(&[mint_ix], &[&auth]));

    assert_ok(env.bind_as_attester(&payer, P, ID, &owner.pubkey()));
    assert_ok(env.decline(&owner, P, ID));
    assert_err(
        env.tip_token(&sender, P, ID, USDC),
        AnyfeeError::VaultDeclined,
    );

    let dest = env.mint_usdc_to(&owner.pubkey(), 0);
    assert_ok(env.claim_token(&owner, P, ID, &dest));
    assert_eq!(env.token_balance(&dest), 5 * USDC);
    assert_eq!(env.token_balance(&vault_ata), 30 * USDC);
    assert_eq!(env.vault(P, ID).claim_epoch, 0);
    assert_err(
        env.claim_token(&owner, P, ID, &dest),
        AnyfeeError::NothingToClaim,
    );

    // Refundable immediately.
    assert_ok(env.refund_tip_token(&payer, P, ID, 0, &sender.pubkey()));
    assert_eq!(
        env.token_balance(&ata(&sender.pubkey(), &env.usdc_mint)),
        100 * USDC
    );
    assert_eq!(env.token_balance(&vault_ata), 0);
}
