#!/usr/bin/env bash
set -euo pipefail

# Rer needs 20 GiB for native builds and independent restore checkouts.
target=$((20 * 1024 * 1024 * 1024))
free_bytes() { df -B1 --output=avail "$GITHUB_WORKSPACE" | tail -n 1 | tr -d ' '; }
for directory in /usr/local/lib/android /usr/share/dotnet /opt/ghc; do
  if [ "$(free_bytes)" -ge "$target" ]; then break; fi
  sudo rm -rf -- "$directory"
done
df -h "$GITHUB_WORKSPACE"
if [ "$(free_bytes)" -lt "$target" ]; then
  echo 'Native verification requires 20 GiB of free disk space.' >&2
  exit 1
fi
