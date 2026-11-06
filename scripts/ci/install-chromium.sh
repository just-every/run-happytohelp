#!/usr/bin/env bash
# Seed-owned equivalent of Base 0.2.90 export/verify.yml's launch-before-apt step.
set -euo pipefail
pnpm exec playwright install chromium
if pnpm exec node scripts/chromium-probe.mjs; then
  exit 0
else
  status=$?
  if [ "$status" -eq 77 ]; then exit "$status"; fi
  sudo env "PATH=$PATH" "APT_ARCHIVES=$RUNNER_TEMP/rer-apt/archives" python3 scripts/ci/install-chromium-deps.py
  pnpm exec node scripts/chromium-probe.mjs
fi
