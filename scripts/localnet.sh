#!/usr/bin/env bash
# Local end-to-end environment for anyfee.
#
# Starts solana-test-validator with the anyfee program loaded (upgradeable, authority = a local
# admin key), a USDC-like mint at the devnet USDC address (4zMMC9...; mint authority = a local
# key so tests can mint), funds the admin and the devnet attester, and runs `initialize` with
# the devnet attester pubkey from docs/SPEC.md.
#
#   scripts/localnet.sh            # run in the foreground (Ctrl-C stops the validator)
#   scripts/localnet.sh --detach   # leave the validator running in the background
#   scripts/localnet.sh --smoke    # also run tip -> ed25519+bind -> claim once, signing the
#                                  # attestation with keys/attester-devnet.json (ANYFEE_ATTESTER_KEYPAIR)
#
# Env overrides: ANYFEE_RPC_PORT (8899), ANYFEE_ATTESTER (devnet attester pubkey),
# ANYFEE_USDC_MINT (devnet USDC address), ANYFEE_LOCALNET_DIR (.anchor/localnet).
#
# Local state lives in .anchor/localnet/ (gitignored): admin.json, usdc-mint-authority.json,
# usdc-mint.json, ledger/, validator.log, env (source-able summary).
set -euo pipefail
cd "$(dirname "$0")/.."

PROGRAM_ID="BixfaA4JmPvntZvGZwnqhHdoUQvEzZY6ZBMXCLgF3C9M"
ATTESTER="${ANYFEE_ATTESTER:-FJpnX2EKfLMyFitghtSjZuoisNxP6ZgkNCQi2LgfiiLY}"
USDC_MINT="${ANYFEE_USDC_MINT:-4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU}"
PORT="${ANYFEE_RPC_PORT:-8899}"
FAUCET_PORT="$((PORT + 1001))"
DIR="${ANYFEE_LOCALNET_DIR:-.anchor/localnet}"
URL="http://127.0.0.1:${PORT}"
DETACH=0
SMOKE=0
for arg in "$@"; do
  case "$arg" in
    --detach) DETACH=1 ;;
    --smoke) SMOKE=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done
ATTESTER_KEYPAIR="${ANYFEE_ATTESTER_KEYPAIR:-keys/attester-devnet.json}"

mkdir -p "$DIR"

if [ ! -f target/deploy/anyfee.so ]; then
  echo "target/deploy/anyfee.so missing; building..."
  scripts/build-program.sh
fi

for k in admin usdc-mint-authority; do
  if [ ! -f "$DIR/$k.json" ]; then
    solana-keygen new --no-bip39-passphrase --silent --outfile "$DIR/$k.json" >/dev/null
  fi
done
ADMIN_PUBKEY="$(solana-keygen pubkey "$DIR/admin.json")"
MINT_AUTH_PUBKEY="$(solana-keygen pubkey "$DIR/usdc-mint-authority.json")"

# SPL Token mint account (82 bytes): mint_authority = local key, supply 0, 6 decimals, no freeze.
python3 - "$USDC_MINT" "$MINT_AUTH_PUBKEY" "$DIR/usdc-mint.json" <<'PY'
import base64, json, sys
ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
def b58decode(s):
    n = 0
    for c in s:
        n = n * 58 + ALPHABET.index(c)
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    pad = len(s) - len(s.lstrip("1"))
    out = b"\x00" * pad + raw
    assert len(out) == 32, s
    return out
mint, authority, path = sys.argv[1:4]
data = (b"\x01\x00\x00\x00" + b58decode(authority) + (0).to_bytes(8, "little")
        + bytes([6, 1]) + b"\x00\x00\x00\x00" + b"\x00" * 32)
assert len(data) == 82
json.dump({"pubkey": mint, "account": {"lamports": 1461600,
           "data": [base64.b64encode(data).decode(), "base64"],
           "owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
           "executable": False, "rentEpoch": 18446744073709551615, "space": 82}},
          open(path, "w"))
PY

if solana cluster-version -u "$URL" >/dev/null 2>&1; then
  echo "something is already listening on $URL; stop it or set ANYFEE_RPC_PORT" >&2
  exit 1
fi

echo "starting solana-test-validator on $URL (log: $DIR/validator.log)"
solana-test-validator \
  --reset \
  --quiet \
  --ledger "$DIR/ledger" \
  --rpc-port "$PORT" \
  --faucet-port "$FAUCET_PORT" \
  --upgradeable-program "$PROGRAM_ID" target/deploy/anyfee.so "$ADMIN_PUBKEY" \
  --account "$USDC_MINT" "$DIR/usdc-mint.json" \
  >"$DIR/validator.log" 2>&1 &
VALIDATOR_PID=$!
echo "$VALIDATOR_PID" >"$DIR/validator.pid"

cleanup() { kill "$VALIDATOR_PID" 2>/dev/null || true; }
if [ "$DETACH" = 0 ]; then trap cleanup INT TERM EXIT; fi

for _ in $(seq 1 120); do
  if solana cluster-version -u "$URL" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$VALIDATOR_PID" 2>/dev/null; then
    echo "validator exited; see $DIR/validator.log" >&2
    exit 1
  fi
  sleep 0.5
done
solana cluster-version -u "$URL" >/dev/null

solana airdrop 100 "$ADMIN_PUBKEY" -u "$URL" >/dev/null
solana airdrop 100 "$ATTESTER" -u "$URL" >/dev/null
solana airdrop 10 "$MINT_AUTH_PUBKEY" -u "$URL" >/dev/null

SMOKE_ARGS=()
if [ "$SMOKE" = 1 ]; then
  SMOKE_ARGS=(--smoke-attester "$ATTESTER_KEYPAIR")
fi
cargo run --quiet -p anyfee-program-tests --features localnet --bin anyfee-localnet-init -- \
  --url "$URL" \
  --admin "$DIR/admin.json" \
  --attester "$ATTESTER" \
  --usdc-mint "$USDC_MINT" \
  ${SMOKE_ARGS[@]+"${SMOKE_ARGS[@]}"}

cat >"$DIR/env" <<EOF
ANYFEE_RPC_URL=$URL
ANYFEE_PROGRAM_ID=$PROGRAM_ID
ANYFEE_ATTESTER=$ATTESTER
ANYFEE_USDC_MINT=$USDC_MINT
ANYFEE_ADMIN_KEYPAIR=$DIR/admin.json
ANYFEE_USDC_MINT_AUTHORITY_KEYPAIR=$DIR/usdc-mint-authority.json
EOF

cat <<EOF

anyfee localnet ready
  RPC            $URL   (ws: ws://127.0.0.1:$((PORT + 1)))
  program        $PROGRAM_ID
  attester       $ATTESTER (funded with 100 SOL)
  USDC-like mint $USDC_MINT (6 decimals)
  admin keypair  $DIR/admin.json
  summary        $DIR/env

mint test USDC to a wallet:
  spl-token -u $URL create-account $USDC_MINT --owner <WALLET> --fee-payer $DIR/admin.json
  spl-token -u $URL mint $USDC_MINT 100 --recipient-owner <WALLET> --mint-authority $DIR/usdc-mint-authority.json --fee-payer $DIR/admin.json
EOF

if [ "$DETACH" = 1 ]; then
  echo "validator running in background (pid $VALIDATOR_PID); stop with: kill \$(cat $DIR/validator.pid)"
else
  echo "Ctrl-C to stop."
  wait "$VALIDATOR_PID"
fi
