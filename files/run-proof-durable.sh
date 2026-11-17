#!/usr/bin/env bash
set -uo pipefail
cd /home/agent/rer-consolidation/work/hh-procedures-race-2/repo
. /tmp/rer-cloud-toolchain.sh
export PATH="$HOME/.rer/node/node-v22.20.0-linux-x64/bin:$PATH"
cloud_run env H2H_CHROMIUM_PATH=/usr/bin/chromium H2H_EVIDENCE_DIR=/home/agent/rer-consolidation/work/hh-procedures-race-2/proof-images-durable HH_PROOF_DIRECTORY=/home/agent/rer-consolidation/work/hh-procedures-race-2/proof-traces-durable HH_MIGRATED_STATE=/tmp/hh-migrated-snapshot-JHbkWs node --import ../proof-preload.mjs --test --test-concurrency=1 --test-name-pattern='^a lead compares saved procedure definitions' ../repeat-registered.mjs > ../proof-20-durable.raw.tap 2>&1
proof_result=$?
python3 ../finish-proof.py "$proof_result"
exit "$proof_result"
