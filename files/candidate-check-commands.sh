#!/bin/bash
set -eu
. /tmp/rer-cloud-toolchain.sh
cloud_run npx -y @runeditrun/rer setup --owner-email fleet@runeditrun.com --answers .rer/hh-setup-answers.json --non-interactive > /tmp/hh-setup-contained.log 2>&1
python3 /tmp/fleet-cloud-hooks.py
cloud_run pnpm run typecheck > ../packet/typecheck.log 2>&1
cloud_run npx -y @runeditrun/rer build > ../packet/build.log 2>&1
cloud_run env H2H_CHROMIUM_PATH=/usr/bin/chromium node ../move-in-proof.mjs after > ../packet/after-move-in.log 2>&1
cloud_run env H2H_CHROMIUM_PATH=/usr/bin/chromium H2H_EVIDENCE_DIR=/home/agent/rer-consolidation/work/hh-stranger11-copy-2/packet/after-inbox node --input-type=module -e 'import {newTicketConfigurationBrowser} from "./tests/helpers/inbox/new-ticket-configuration.mjs"; await newTicketConfigurationBrowser(); console.log("PASS assigned call reload on candidate product")' > ../packet/after-inbox.log 2>&1
node scripts/edition-authoring/cli.mjs lock > ../packet/source-lock.log 2>&1
node scripts/edition-authoring/cli.mjs check > ../packet/source-check.log 2>&1
cloud_run pnpm exec rer check --profile first-party > ../packet/rer-check.log 2>&1
git diff --check
printf '%s\n' 'PASS all targeted checks'
