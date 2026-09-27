//! bind (Ed25519 introspection), rebind, finalize, cancel.

use anyfee::AnyfeeError;
use anyfee_program_tests::*;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_signer::Signer;

const P: u8 = 2; // GitHub repo
const ID: u64 = 1_234_567_890;

fn setup() -> (Env, Keypair) {
    let mut env = Env::initialized();
    let payer = env.funded_keypair(10);
    assert_ok(env.init_vault(&payer, P, ID));
    (env, payer)
}

/// Builds the data of an Ed25519SigVerify instruction with explicit offsets/indices.
/// Layout: header(2) offsets(14) pubkey(32 @16) signature(64 @48) message(@112).
fn ed25519_data(
    pubkey: &[u8],
    sig: &[u8],
    msg: &[u8],
    idx: [u16; 3],
    offsets: [u16; 3],
) -> Vec<u8> {
    let mut d = vec![1u8, 0];
    let [sig_off, pk_off, msg_off] = offsets;
    for v in [
        sig_off,
        idx[0],
        pk_off,
        idx[1],
        msg_off,
        msg.len() as u16,
        idx[2],
    ] {
        d.extend_from_slice(&v.to_le_bytes());
    }
    d.extend_from_slice(pubkey);
    d.extend_from_slice(sig);
    d.extend_from_slice(msg);
    d
}

fn raw_ed25519(data: Vec<u8>) -> Instruction {
    Instruction {
        program_id: solana_sdk_ids::ed25519_program::ID,
        accounts: vec![],
        data,
    }
}

#[test]
fn bind_happy_path() {
    let (mut env, payer) = setup();
    let claimant = Keypair::new().pubkey();
    let meta = assert_ok(env.bind_as_attester(&payer, P, ID, &claimant));
    let v = env.vault(P, ID);
    assert_eq!(v.claimant, claimant);
    assert_eq!(v.bound_at, env.now());
    assert_eq!(v.pending_claimant, Pubkey::default());
    assert!(meta.logs.iter().any(|l| l.starts_with("Program data:")));

    // Anyone may submit the bind transaction (here: a random fee payer, not the attester).
    let (mut env2, _) = setup();
    let random = env2.funded_keypair(1);
    assert_ok(env2.bind_as_attester(&random, P, ID, &claimant));

    // Same claimant again is rejected (replay of a still-valid attestation does nothing).
    assert_err(
        env.bind_as_attester(&payer, P, ID, &claimant),
        AnyfeeError::AlreadyClaimant,
    );
}

#[test]
fn bind_wrong_attester_fails() {
    let (mut env, payer) = setup();
    let claimant = Keypair::new().pubkey();
    let impostor = Keypair::new();
    let exp = env.now() + 900;
    let ed = Env::attest_with(&impostor, P, ID, &claimant, exp);
    let bind = ix_bind(P, ID, claimant, exp);
    assert_err(env.send(&[ed, bind], &[&payer]), AnyfeeError::WrongAttester);
    assert_eq!(env.vault(P, ID).claimant, Pubkey::default());
}

#[test]
fn bind_wrong_message_fails() {
    let (mut env, payer) = setup();
    let claimant = Keypair::new().pubkey();
    let attacker = Keypair::new().pubkey();
    let exp = env.now() + 900;

    // Attestation for `claimant`, bind asks for `attacker`.
    let ed = env.attest(P, ID, &claimant, exp);
    assert_err(
        env.send(&[ed, ix_bind(P, ID, attacker, exp)], &[&payer]),
        AnyfeeError::BadAttestation,
    );
    // Attestation for another id / platform / expiry.
    let ed = env.attest(P, ID + 1, &claimant, exp);
    assert_err(
        env.send(&[ed, ix_bind(P, ID, claimant, exp)], &[&payer]),
        AnyfeeError::BadAttestation,
    );
    let payer2 = env.funded_keypair(1);
    assert_ok(env.init_vault(&payer2, 1, ID));
    let ed = env.attest(P, ID, &claimant, exp);
    assert_err(
        env.send(&[ed, ix_bind(1, ID, claimant, exp)], &[&payer]),
        AnyfeeError::BadAttestation,
    );
    let ed = env.attest(P, ID, &claimant, exp + 1);
    assert_err(
        env.send(&[ed, ix_bind(P, ID, claimant, exp)], &[&payer]),
        AnyfeeError::BadAttestation,
    );
    // A valid signature by the attester over some other message (wrong domain / program).
    let mut m = anyfee::attestation::bind_message(&PROGRAM_ID, P, ID, &claimant, exp);
    m[0] = b'X';
    let ed = Env::ed25519_ix(&env.attester, &m);
    assert_err(
        env.send(&[ed, ix_bind(P, ID, claimant, exp)], &[&payer]),
        AnyfeeError::BadAttestation,
    );
    let other_program = Keypair::new().pubkey();
    let m = anyfee::attestation::bind_message(&other_program, P, ID, &claimant, exp);
    let ed = Env::ed25519_ix(&env.attester, &m);
    assert_err(
        env.send(&[ed, ix_bind(P, ID, claimant, exp)], &[&payer]),
        AnyfeeError::BadAttestation,
    );
    // Message of the wrong length (M plus a trailing byte), validly signed.
    let mut long = anyfee::attestation::bind_message(&PROGRAM_ID, P, ID, &claimant, exp).to_vec();
    long.push(0);
    let ed = Env::ed25519_ix(&env.attester, &long);
    assert_err(
        env.send(&[ed, ix_bind(P, ID, claimant, exp)], &[&payer]),
        AnyfeeError::BadAttestation,
    );
    assert_eq!(env.vault(P, ID).claimant, Pubkey::default());
}

#[test]
fn bind_expired_fails() {
    let (mut env, payer) = setup();
    let claimant = Keypair::new().pubkey();
    let exp = env.now() + 900;
    let ed = env.attest(P, ID, &claimant, exp);
    env.advance(900); // now == expires_at -> expired (strict <)
    assert_err(
        env.send(&[ed, ix_bind(P, ID, claimant, exp)], &[&payer]),
        AnyfeeError::AttestationExpired,
    );
    let past = env.now() - 1;
    let ed = env.attest(P, ID, &claimant, past);
    assert_err(
        env.send(&[ed, ix_bind(P, ID, claimant, past)], &[&payer]),
        AnyfeeError::AttestationExpired,
    );
}

#[test]
fn bind_missing_ed25519_fails() {
    let (mut env, payer) = setup();
    let claimant = Keypair::new().pubkey();
    let exp = env.now() + 900;
    // bind alone (index 0)
    assert_err(
        env.send(&[ix_bind(P, ID, claimant, exp)], &[&payer]),
        AnyfeeError::MissingEd25519Instruction,
    );
    // preceded by a non-ed25519 instruction
    let transfer =
        solana_system_interface::instruction::transfer(&payer.pubkey(), &claimant, 1_000_000);
    assert_err(
        env.send(&[transfer, ix_bind(P, ID, claimant, exp)], &[&payer]),
        AnyfeeError::MissingEd25519Instruction,
    );
}

#[test]
fn bind_misplaced_ed25519_fails() {
    let (mut env, payer) = setup();
    let claimant = Keypair::new().pubkey();
    let exp = env.now() + 900;
    // Valid attestation, but not *immediately* before bind.
    let ed = env.attest(P, ID, &claimant, exp);
    let transfer =
        solana_system_interface::instruction::transfer(&payer.pubkey(), &claimant, 1_000_000);
    assert_err(
        env.send(
            &[ed.clone(), transfer, ix_bind(P, ID, claimant, exp)],
            &[&payer],
        ),
        AnyfeeError::MissingEd25519Instruction,
    );
    // After bind instead of before.
    assert_err(
        env.send(&[ix_bind(P, ID, claimant, exp), ed], &[&payer]),
        AnyfeeError::MissingEd25519Instruction,
    );
}

#[test]
fn bind_ed25519_offsets_into_other_instruction_fail() {
    let (mut env, payer) = setup();
    let claimant = Keypair::new().pubkey();
    let exp = env.now() + 900;
    let m = anyfee::attestation::bind_message(&PROGRAM_ID, P, ID, &claimant, exp);

    // The attacker signs M with their own key in instruction 0 (a valid precompile ix).
    let attacker = Keypair::new();
    let attacker_sig: [u8; 64] = attacker.sign_message(&m).into();
    let ix0 = raw_ed25519(ed25519_data(
        &attacker.pubkey().to_bytes(),
        &attacker_sig,
        &m,
        [u16::MAX; 3],
        [48, 16, 112],
    ));
    // Instruction 1 makes the precompile verify the bytes of instruction 0, while its own
    // bytes at the same offsets carry the attester's pubkey and M. A naive program that reads
    // offsets from instruction 1's data would accept it.
    let fake_sig = [0u8; 64];
    let ix1 = raw_ed25519(ed25519_data(
        &env.attester.pubkey().to_bytes(),
        &fake_sig,
        &m,
        [0, 0, 0],
        [48, 16, 112],
    ));
    assert_err(
        env.send(
            &[ix0.clone(), ix1, ix_bind(P, ID, claimant, exp)],
            &[&payer],
        ),
        AnyfeeError::MalformedEd25519Instruction,
    );

    // Only the public key taken from another instruction.
    let ix1 = raw_ed25519(ed25519_data(
        &env.attester.pubkey().to_bytes(),
        &attacker_sig,
        &m,
        [u16::MAX, 0, u16::MAX],
        [48, 16, 112],
    ));
    assert_err(
        env.send(
            &[ix0.clone(), ix1, ix_bind(P, ID, claimant, exp)],
            &[&payer],
        ),
        AnyfeeError::MalformedEd25519Instruction,
    );

    // Only the message taken from another instruction (attester really signed some other
    // message placed in ix0; ix1 carries M locally).
    let other_msg = anyfee::attestation::bind_message(&PROGRAM_ID, P, ID, &attacker.pubkey(), exp);
    let att_sig_other: [u8; 64] = env.attester.sign_message(&other_msg).into();
    let ix0b = raw_ed25519(ed25519_data(
        &env.attester.pubkey().to_bytes(),
        &att_sig_other,
        &other_msg,
        [u16::MAX; 3],
        [48, 16, 112],
    ));
    let ix1 = raw_ed25519(ed25519_data(
        &env.attester.pubkey().to_bytes(),
        &att_sig_other,
        &m,
        [u16::MAX, u16::MAX, 0],
        [48, 16, 112],
    ));
    assert_err(
        env.send(&[ix0b, ix1, ix_bind(P, ID, claimant, exp)], &[&payer]),
        AnyfeeError::MalformedEd25519Instruction,
    );
    assert_eq!(env.vault(P, ID).claimant, Pubkey::default());
}

#[test]
fn bind_ed25519_with_two_signatures_fails() {
    let (mut env, payer) = setup();
    let claimant = Keypair::new().pubkey();
    let exp = env.now() + 900;
    let m = anyfee::attestation::bind_message(&PROGRAM_ID, P, ID, &claimant, exp);
    let sig: [u8; 64] = env.attester.sign_message(&m).into();
    // Two identical, valid signature entries in one instruction.
    // header(2) + 2 * offsets(14) = 30; pubkey @30, sig @62, msg @126
    let mut d = vec![2u8, 0];
    for _ in 0..2 {
        for v in [62u16, u16::MAX, 30, u16::MAX, 126, 95, u16::MAX] {
            d.extend_from_slice(&v.to_le_bytes());
        }
    }
    d.extend_from_slice(&env.attester.pubkey().to_bytes());
    d.extend_from_slice(&sig);
    d.extend_from_slice(&m);
    assert_err(
        env.send(&[raw_ed25519(d), ix_bind(P, ID, claimant, exp)], &[&payer]),
        AnyfeeError::MalformedEd25519Instruction,
    );
}

#[test]
fn bind_rejects_default_claimant_and_uninitialized_vault() {
    let (mut env, payer) = setup();
    assert_err(
        env.bind_as_attester(&payer, P, ID, &Pubkey::default()),
        AnyfeeError::InvalidClaimant,
    );
    let claimant = Keypair::new().pubkey();
    // Vault not initialized -> Anchor AccountNotInitialized (3012).
    let f = assert_fails(env.bind_as_attester(&payer, P, ID + 7, &claimant));
    assert!(
        format!("{:?}", f.err).contains("Custom(3012)"),
        "{:?}",
        f.err
    );
}

#[test]
fn rebind_pending_claim_allowed_cancel_and_finalize_after_delay() {
    let (mut env, payer) = setup();
    let vault = vault_pda(P, ID);
    let alice = env.funded_keypair(1);
    let mallory = env.funded_keypair(1);
    let bob = env.funded_keypair(1);
    assert_ok(env.bind_as_attester(&payer, P, ID, &alice.pubkey()));

    // Rebind request -> pending, claimant unchanged.
    let t_req = env.now();
    assert_ok(env.bind_as_attester(&payer, P, ID, &mallory.pubkey()));
    let v = env.vault(P, ID);
    assert_eq!(v.claimant, alice.pubkey());
    assert_eq!(v.pending_claimant, mallory.pubkey());
    assert_eq!(
        v.pending_effective_at,
        t_req + anyfee::DEFAULT_REBIND_DELAY_SECS
    );

    // Current claimant can still claim while pending.
    env.transfer_lamports(&payer, &vault, 2 * LAMPORTS_PER_SOL)
        .unwrap();
    let before = env.lamports(&alice.pubkey());
    assert_ok(env.claim_sol(&alice, P, ID, &alice.pubkey()));
    assert_eq!(
        env.lamports(&alice.pubkey()) - before,
        2 * LAMPORTS_PER_SOL - 5_000
    );

    // Pending claimant can't claim; nobody but alice can cancel.
    assert_err(
        env.claim_sol(&mallory, P, ID, &mallory.pubkey()),
        AnyfeeError::NotClaimant,
    );
    assert_err(env.cancel_rebind(&mallory, P, ID), AnyfeeError::NotClaimant);

    // Too early to finalize.
    env.advance(anyfee::DEFAULT_REBIND_DELAY_SECS - 1);
    assert_err(
        env.finalize_rebind(&payer, P, ID),
        AnyfeeError::RebindNotReady,
    );

    // Alice cancels.
    assert_ok(env.cancel_rebind(&alice, P, ID));
    let v = env.vault(P, ID);
    assert_eq!(v.pending_claimant, Pubkey::default());
    assert_eq!(v.pending_effective_at, 0);
    env.advance(10);
    assert_err(
        env.finalize_rebind(&payer, P, ID),
        AnyfeeError::NoPendingRebind,
    );
    assert_err(
        env.cancel_rebind(&alice, P, ID),
        AnyfeeError::NoPendingRebind,
    );

    // Legit rebind to bob; a newer request replaces the pending one and restarts the timer.
    assert_ok(env.bind_as_attester(&payer, P, ID, &mallory.pubkey()));
    env.advance(DAY);
    let t_bob = env.now();
    assert_ok(env.bind_as_attester(&payer, P, ID, &bob.pubkey()));
    let v = env.vault(P, ID);
    assert_eq!(v.pending_claimant, bob.pubkey());
    assert_eq!(
        v.pending_effective_at,
        t_bob + anyfee::DEFAULT_REBIND_DELAY_SECS
    );

    env.advance(anyfee::DEFAULT_REBIND_DELAY_SECS);
    let cranker = env.funded_keypair(1);
    assert_ok(env.finalize_rebind(&cranker, P, ID));
    let v = env.vault(P, ID);
    assert_eq!(v.claimant, bob.pubkey());
    assert_eq!(v.bound_at, env.now());
    assert_eq!(v.pending_claimant, Pubkey::default());

    // Old claimant lost access; new one has it.
    env.transfer_lamports(&payer, &vault, LAMPORTS_PER_SOL)
        .unwrap();
    assert_err(
        env.claim_sol(&alice, P, ID, &alice.pubkey()),
        AnyfeeError::NotClaimant,
    );
    assert_ok(env.claim_sol(&bob, P, ID, &bob.pubkey()));
}

#[test]
fn rebind_delay_is_snapshotted_at_request_time() {
    let (mut env, payer) = setup();
    let admin = env.admin.insecure_clone();
    let alice = env.funded_keypair(1);
    let eve = env.funded_keypair(1);
    assert_ok(env.bind_as_attester(&payer, P, ID, &alice.pubkey()));
    assert_ok(env.bind_as_attester(&payer, P, ID, &eve.pubkey()));
    // Admin shortening the delay afterwards does not speed up a pending rebind.
    assert_ok(env.set_config(&admin, None, None, None, Some(DAY), None));
    env.advance(DAY);
    assert_err(
        env.finalize_rebind(&payer, P, ID),
        AnyfeeError::RebindNotReady,
    );
}

#[test]
fn rotated_attester_old_key_rejected() {
    let (mut env, payer) = setup();
    let admin = env.admin.insecure_clone();
    let new_attester = Keypair::new();
    assert_ok(env.set_config(&admin, None, Some(new_attester.pubkey()), None, None, None));
    let claimant = Keypair::new().pubkey();
    assert_err(
        env.bind_as_attester(&payer, P, ID, &claimant),
        AnyfeeError::WrongAttester,
    );
    let exp = env.now() + 900;
    let ed = Env::attest_with(&new_attester, P, ID, &claimant, exp);
    assert_ok(env.send(&[ed, ix_bind(P, ID, claimant, exp)], &[&payer]));
}
