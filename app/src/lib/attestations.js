// Parsing pasted attestation JSON (pure; verification is the SDK's verifyAttestation).

/** Accepts one attestation, an array, or a whole attester response ({ attestations: [...] }). */
export function parseAttestations(text) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("That is not valid JSON.");
  }
  const list = Array.isArray(j) ? j : Array.isArray(j?.attestations) ? j.attestations : [j];
  if (!list.length) throw new Error("No attestation found in that JSON.");
  for (const a of list) {
    if (!a || typeof a !== "object" || typeof a.message !== "string" || typeof a.signature !== "string") {
      throw new Error("Each attestation needs platform, id, claimant, expiresAt, message, signature and attester.");
    }
  }
  return list;
}
