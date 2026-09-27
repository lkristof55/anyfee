//! initialize / set_config / pause / admin powers.

use anyfee::AnyfeeError;
use anyfee_program_tests::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn m_test_vector_matches_spec() {
    let program: Pubkey = "BixfaA4JmPvntZvGZwnqhHdoUQvEzZY6ZBMXCLgF3C9M"
        .parse()
        .unwrap();
    let claimant: Pubkey = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
        .parse()
        .unwrap();
    let m = anyfee::attestation::bind_message(&program, 2, 1_234_567_890, &claimant, 1_790_500_000);
    assert_eq!(
        hex::encode(m),
        "616e796665653a62696e643a76319f549f827029a8031facc0e17c7851c771515d8331a40e119925aa443d66514002d2029649000000007e8c088760bfde1dddcf32c17f209b8242ee52aaf131facd88d0ea2c6d0b06f2a0dcb86a00000000"
    );
    assert_eq!(program, PROGRAM_ID);
}

#[test]
fn initialize_sets_config_once_and_only_by_upgrade_authority() {
    let mut env = Env::new();
    let attester = env.attester.pubkey();
    let mint = env.usdc_mint;

    // A random signer (not the upgrade authority) cannot front-run initialization.
    let stranger = env.funded_keypair(5);
    assert_err(
        env.initialize(&stranger, attester, mint, 2_592_000, 172_800),
        AnyfeeError::NotUpgradeAuthority,
    );

    // Out-of-bounds windows are rejected.
    let admin = env.admin.insecure_clone();
    assert_err(
        env.initialize(&admin, attester, mint, 60, 172_800),
        AnyfeeError::InvalidConfig,
    );
    assert_err(
        env.initialize(&admin, attester, mint, 2_592_000, 3_600),
        AnyfeeError::InvalidConfig,
    );
    assert_err(
        env.initialize(&admin, Pubkey::default(), mint, 2_592_000, 172_800),
        AnyfeeError::InvalidConfig,
    );

    assert_ok(env.initialize(&admin, attester, mint, 2_592_000, 172_800));
    let c = env.config();
    assert_eq!(c.admin, admin.pubkey());
    assert_eq!(c.attester, attester);
    assert_eq!(c.usdc_mint, mint);
    assert_eq!(c.refund_window_secs, 2_592_000);
    assert_eq!(c.rebind_delay_secs, 172_800);
    assert!(!c.paused);

    // Once.
    assert_fails(env.initialize(&admin, attester, mint, 2_592_000, 172_800));
}

#[test]
fn set_config_admin_only_and_bounded() {
    let mut env = Env::initialized();
    let admin = env.admin.insecure_clone();
    let stranger = env.funded_keypair(5);
    let new_attester = Keypair::new().pubkey();

    assert_err(
        env.set_config(&stranger, None, Some(new_attester), None, None, Some(true)),
        AnyfeeError::NotAdmin,
    );
    assert_err(
        env.set_config(&admin, None, None, Some(10), None, None),
        AnyfeeError::InvalidConfig,
    );
    assert_err(
        env.set_config(&admin, None, None, None, Some(0), None),
        AnyfeeError::InvalidConfig,
    );
    assert_err(
        env.set_config(&admin, None, None, None, Some(31 * DAY), None),
        AnyfeeError::InvalidConfig,
    );
    assert_err(
        env.set_config(&admin, None, None, Some(366 * DAY), None, None),
        AnyfeeError::InvalidConfig,
    );
    assert_err(
        env.set_config(&admin, Some(Pubkey::default()), None, None, None, None),
        AnyfeeError::InvalidConfig,
    );

    assert_ok(env.set_config(
        &admin,
        None,
        Some(new_attester),
        Some(7 * DAY),
        Some(3 * DAY),
        Some(true),
    ));
    let c = env.config();
    assert_eq!(c.attester, new_attester);
    assert_eq!(c.refund_window_secs, 7 * DAY);
    assert_eq!(c.rebind_delay_secs, 3 * DAY);
    assert!(c.paused);
    assert_eq!(c.usdc_mint, env.usdc_mint);

    // Hand admin over; the old admin loses its powers.
    let new_admin = env.funded_keypair(5);
    assert_ok(env.set_config(&admin, Some(new_admin.pubkey()), None, None, None, None));
    assert_err(
        env.set_config(&admin, None, None, None, None, Some(false)),
        AnyfeeError::NotAdmin,
    );
    assert_ok(env.set_config(&new_admin, None, None, None, None, Some(false)));
    assert!(!env.config().paused);
}

#[test]
fn admin_cannot_withdraw_vault_funds() {
    let mut env = Env::initialized();
    let admin = env.admin.insecure_clone();
    let (p, id) = (2u8, 555u64);
    let payer = env.funded_keypair(10);
    assert_ok(env.init_vault(&payer, p, id));
    let sender = env.funded_keypair(10);
    assert_ok(env.tip_sol(&sender, p, id, LAMPORTS_PER_SOL));
    let vault = vault_pda(p, id);
    let before = env.lamports(&vault);

    // Unbound vault: the admin is not the claimant.
    assert_err(
        env.claim_sol(&admin, p, id, &admin.pubkey()),
        AnyfeeError::VaultUnbound,
    );
    // Refunds only ever go to tip.sender, never to the admin (has_one = sender).
    env.advance(31 * DAY);
    assert_fails(env.refund_tip(&admin, p, id, 0, &admin.pubkey()));

    // Bound to someone else: still no access.
    let owner = env.funded_keypair(1);
    assert_ok(env.bind_as_attester(&payer, p, id, &owner.pubkey()));
    assert_err(
        env.claim_sol(&admin, p, id, &admin.pubkey()),
        AnyfeeError::NotClaimant,
    );
    assert_err(env.decline(&admin, p, id), AnyfeeError::NotClaimant);
    assert_err(env.cancel_rebind(&admin, p, id), AnyfeeError::NotClaimant);
    assert_eq!(env.lamports(&vault), before);

    // Pausing never blocks the claimant's claim.
    assert_ok(env.set_config(&admin, None, None, None, None, Some(true)));
    assert_ok(env.claim_sol(&owner, p, id, &owner.pubkey()));
}

#[test]
fn pause_blocks_tips_binds_and_finalize_but_not_claims_or_refunds() {
    let mut env = Env::initialized();
    let admin = env.admin.insecure_clone();
    let payer = env.funded_keypair(10);
    let sender = env.funded_keypair(10);
    let (p, id) = (1u8, 42u64);
    assert_ok(env.init_vault(&payer, p, id));
    assert_ok(env.tip_sol(&sender, p, id, 1_000_000));

    assert_ok(env.set_config(&admin, None, None, None, None, Some(true)));
    assert_err(env.tip_sol(&sender, p, id, 1_000_000), AnyfeeError::Paused);
    let claimant = env.funded_keypair(1);
    assert_err(
        env.bind_as_attester(&payer, p, id, &claimant.pubkey()),
        AnyfeeError::Paused,
    );
    // init_vault stays permissionless while paused.
    assert_ok(env.init_vault(&payer, p, id + 1));

    // Refunds still work while paused.
    env.advance(30 * DAY);
    assert_ok(env.refund_tip(&payer, p, id, 0, &sender.pubkey()));

    // Finalize is blocked while paused; claims are not.
    assert_ok(env.set_config(&admin, None, None, None, None, Some(false)));
    assert_ok(env.bind_as_attester(&payer, p, id, &claimant.pubkey()));
    let other = env.funded_keypair(1);
    assert_ok(env.bind_as_attester(&payer, p, id, &other.pubkey()));
    env.transfer_lamports(&sender, &vault_pda(p, id), 5_000_000)
        .unwrap();
    assert_ok(env.set_config(&admin, None, None, None, None, Some(true)));
    env.advance(3 * DAY);
    assert_err(env.finalize_rebind(&payer, p, id), AnyfeeError::Paused);
    assert_ok(env.claim_sol(&claimant, p, id, &claimant.pubkey()));
    assert_ok(env.cancel_rebind(&claimant, p, id));
}
