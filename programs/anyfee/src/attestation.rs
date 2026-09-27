//! Attestation message `M` and Ed25519SigVerify instruction introspection.
//!
//! `bind` does not verify signatures itself. The runtime verifies every Ed25519SigVerify
//! precompile instruction in a transaction before (or while) the transaction executes and
//! fails the whole transaction if any signature is invalid. `bind` therefore only has to
//! prove that the precompile instruction immediately before it verified *our* statement:
//! exactly one signature, whose public key, signature and message all live inside that same
//! instruction (instruction_index == u16::MAX), with public key == `config.attester` and
//! message == `M` byte for byte.

use anchor_lang::prelude::*;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

use crate::{constants::BIND_DOMAIN, error::AnyfeeError};

pub const BIND_MESSAGE_SIZE: usize = 95;

const ED25519_PUBKEY_SIZE: usize = 32;
const ED25519_SIGNATURE_SIZE: usize = 64;
/// num_signatures (u8) + padding (u8)
const ED25519_OFFSETS_START: usize = 2;
/// 7 x u16
const ED25519_OFFSETS_SIZE: usize = 14;
/// Marker meaning "this same instruction".
const CURRENT_INSTRUCTION: u16 = u16::MAX;

/// Builds `M` (95 bytes, little-endian integers):
/// `b"anyfee:bind:v1" || program_id || platform || id || claimant || expires_at`.
pub fn bind_message(
    program_id: &Pubkey,
    platform: u8,
    id: u64,
    claimant: &Pubkey,
    expires_at: i64,
) -> [u8; BIND_MESSAGE_SIZE] {
    let mut m = [0u8; BIND_MESSAGE_SIZE];
    m[0..14].copy_from_slice(BIND_DOMAIN);
    m[14..46].copy_from_slice(program_id.as_ref());
    m[46] = platform;
    m[47..55].copy_from_slice(&id.to_le_bytes());
    m[55..87].copy_from_slice(claimant.as_ref());
    m[87..95].copy_from_slice(&expires_at.to_le_bytes());
    m
}

fn read_u16(data: &[u8], at: usize) -> Result<u16> {
    let bytes = data
        .get(at..at.checked_add(2).ok_or(AnyfeeError::MalformedEd25519Instruction)?)
        .ok_or(AnyfeeError::MalformedEd25519Instruction)?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn slice(data: &[u8], offset: u16, len: usize) -> Result<&[u8]> {
    let start = offset as usize;
    let end = start
        .checked_add(len)
        .ok_or(AnyfeeError::MalformedEd25519Instruction)?;
    Ok(data
        .get(start..end)
        .ok_or(AnyfeeError::MalformedEd25519Instruction)?)
}

/// Checks the data of an Ed25519SigVerify instruction: one signature, every offset inside the
/// instruction itself, signer == `expected_signer`, message == `expected_message`.
pub fn check_ed25519_data(
    data: &[u8],
    expected_signer: &Pubkey,
    expected_message: &[u8],
) -> Result<()> {
    require!(
        data.len() >= ED25519_OFFSETS_START + ED25519_OFFSETS_SIZE,
        AnyfeeError::MalformedEd25519Instruction
    );
    // Exactly one signature. (data[1] is padding and ignored by the precompile.)
    require!(data[0] == 1, AnyfeeError::MalformedEd25519Instruction);

    let o = ED25519_OFFSETS_START;
    let signature_offset = read_u16(data, o)?;
    let signature_ix = read_u16(data, o + 2)?;
    let pubkey_offset = read_u16(data, o + 4)?;
    let pubkey_ix = read_u16(data, o + 6)?;
    let message_offset = read_u16(data, o + 8)?;
    let message_size = read_u16(data, o + 10)?;
    let message_ix = read_u16(data, o + 12)?;

    // Everything must come from this very instruction; otherwise the precompile verified
    // bytes living in another instruction and what we read below would be meaningless.
    require!(
        signature_ix == CURRENT_INSTRUCTION
            && pubkey_ix == CURRENT_INSTRUCTION
            && message_ix == CURRENT_INSTRUCTION,
        AnyfeeError::MalformedEd25519Instruction
    );
    require!(
        message_size as usize == expected_message.len(),
        AnyfeeError::BadAttestation
    );

    // Bounds of every region (the precompile checked these too, but never trust that here).
    slice(data, signature_offset, ED25519_SIGNATURE_SIZE)?;
    let pubkey = slice(data, pubkey_offset, ED25519_PUBKEY_SIZE)?;
    let message = slice(data, message_offset, message_size as usize)?;

    require!(
        pubkey == expected_signer.as_ref(),
        AnyfeeError::WrongAttester
    );
    require!(message == expected_message, AnyfeeError::BadAttestation);
    Ok(())
}

/// Requires the instruction immediately before the current one to be an Ed25519SigVerify
/// instruction proving `expected_signer` signed `expected_message`.
pub fn verify_preceding_ed25519(
    instructions_sysvar: &AccountInfo,
    expected_signer: &Pubkey,
    expected_message: &[u8],
) -> Result<()> {
    let current = load_current_index_checked(instructions_sysvar)?;
    require!(current > 0, AnyfeeError::MissingEd25519Instruction);
    let prev = load_instruction_at_checked((current - 1) as usize, instructions_sysvar)?;
    require_keys_eq!(
        prev.program_id,
        solana_sdk_ids::ed25519_program::ID,
        AnyfeeError::MissingEd25519Instruction
    );
    check_ed25519_data(&prev.data, expected_signer, expected_message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    const VECTOR_HEX: &str = "616e796665653a62696e643a76319f549f827029a8031facc0e17c7851c771515d8331a40e119925aa443d66514002d2029649000000007e8c088760bfde1dddcf32c17f209b8242ee52aaf131facd88d0ea2c6d0b06f2a0dcb86a00000000";

    fn to_hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn bind_message_matches_spec_vector() {
        let program = Pubkey::from_str("BixfaA4JmPvntZvGZwnqhHdoUQvEzZY6ZBMXCLgF3C9M").unwrap();
        let claimant = Pubkey::from_str("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM").unwrap();
        let m = bind_message(&program, 2, 1_234_567_890, &claimant, 1_790_500_000);
        assert_eq!(m.len(), 95);
        assert_eq!(to_hex(&m), VECTOR_HEX);
        assert_eq!(program, crate::ID);
    }

    fn ix_data(pubkey: &[u8; 32], message: &[u8], idx: [u16; 3], count: u8) -> Vec<u8> {
        let pk_off: u16 = 16;
        let sig_off: u16 = 48;
        let msg_off: u16 = 112;
        let mut d = vec![count, 0];
        for v in [
            sig_off,
            idx[0],
            pk_off,
            idx[1],
            msg_off,
            message.len() as u16,
            idx[2],
        ] {
            d.extend_from_slice(&v.to_le_bytes());
        }
        d.extend_from_slice(pubkey);
        d.extend_from_slice(&[7u8; 64]);
        d.extend_from_slice(message);
        d
    }

    #[test]
    fn ed25519_data_checks() {
        let attester = Pubkey::new_from_array([9u8; 32]);
        let other = Pubkey::new_from_array([8u8; 32]);
        let m = bind_message(&crate::ID, 1, 42, &other, 100);
        let max = u16::MAX;

        let ok = ix_data(&attester.to_bytes(), &m, [max; 3], 1);
        assert!(check_ed25519_data(&ok, &attester, &m).is_ok());

        let wrong_key = ix_data(&other.to_bytes(), &m, [max; 3], 1);
        assert!(check_ed25519_data(&wrong_key, &attester, &m).is_err());

        let mut m2 = m;
        m2[94] ^= 1;
        assert!(check_ed25519_data(&ok, &attester, &m2).is_err());

        for idx in [[0, max, max], [max, 1, max], [max, max, 2]] {
            let d = ix_data(&attester.to_bytes(), &m, idx, 1);
            assert!(check_ed25519_data(&d, &attester, &m).is_err());
        }

        let two = ix_data(&attester.to_bytes(), &m, [max; 3], 2);
        assert!(check_ed25519_data(&two, &attester, &m).is_err());

        let truncated = &ok[..ok.len() - 1];
        assert!(check_ed25519_data(truncated, &attester, &m).is_err());
        assert!(check_ed25519_data(&ok[..10], &attester, &m).is_err());
    }
}
