#!/usr/bin/env bash
# Builds the anyfee program (target/deploy/anyfee.so), generates the IDL and TS types, and
# copies them to programs/anyfee/idl/ (the committed, stable location the SDK reads).
#
# Toolchain: Anchor CLI 1.2.0, solana-cli 4.2.x, platform-tools v1.54, SBPF v3.
# Override with ANYFEE_SBF_TOOLS_VERSION / ANYFEE_SBF_ARCH if needed.
set -euo pipefail
cd "$(dirname "$0")/.."

TOOLS_VERSION="${ANYFEE_SBF_TOOLS_VERSION:-v1.54}"
ARCH="${ANYFEE_SBF_ARCH:-v3}"

# Anchor wants target/deploy/anyfee-keypair.json. The program id inside the .so comes from
# declare_id! either way; the real keypair (keys/, gitignored) is only needed to deploy.
if [ -f keys/program-keypair.json ] && [ ! -f target/deploy/anyfee-keypair.json ]; then
  mkdir -p target/deploy
  cp keys/program-keypair.json target/deploy/anyfee-keypair.json
fi

anchor build --tools-version "$TOOLS_VERSION" --arch "$ARCH"

mkdir -p programs/anyfee/idl
cp target/idl/anyfee.json programs/anyfee/idl/anyfee.json
cp target/types/anyfee.ts programs/anyfee/idl/anyfee.ts
echo "built target/deploy/anyfee.so ($(wc -c < target/deploy/anyfee.so | tr -d ' ') bytes); IDL -> programs/anyfee/idl/"
