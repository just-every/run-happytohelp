#!/usr/bin/env bash
set -uo pipefail
cd /workspace/run-happytohelp
. /tmp/rer-cloud-toolchain.sh
export PATH="$HOME/.rer/node/node-v22.20.0-linux-x64/bin:$PATH"
proof_root="$HOME/rer-consolidation/work/hh-procedures-race-2-c1"
git status --porcelain > "$proof_root/proof-start-status.txt"
git rev-parse HEAD > "$proof_root/proof-start-head.txt"
cloud_run env H2H_CHROMIUM_PATH=/usr/bin/chromium H2H_EVIDENCE_DIR="$proof_root/proof-images" HH_PROOF_DIRECTORY="$proof_root/proof-traces-private" node --import "$proof_root/proof-preload.mjs" --test --test-concurrency=1 --test-name-pattern='^a lead compares saved procedure definitions' "$proof_root/repeat-registered.mjs" > "$proof_root/proof-20.raw.tap" 2>&1
proof_result=$?
printf '%s\n' "$proof_result" > "$proof_root/proof-exit.txt"
exit "$proof_result"
