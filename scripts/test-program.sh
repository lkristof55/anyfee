#!/usr/bin/env bash
# One command for the program: build (.so + IDL), then run unit tests and the LiteSVM suite.
set -euo pipefail
cd "$(dirname "$0")/.."
scripts/build-program.sh
cargo test -p anyfee -p anyfee-program-tests
