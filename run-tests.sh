#!/usr/bin/env bash
# =============================================================================
# run-tests.sh — deterministic UI tests for pi-minimalist
# =============================================================================
# No network, no model calls, no tmux/VHS, no screenshots, no background
# processes, and no writes to user settings or sessions.
#
#   ./run-tests.sh              unit + integration tests
#   ./run-tests.sh --unit       unit tests only (skips the Pi-core integration)
#   ./run-tests.sh --typecheck  tsc --noEmit via tsconfig.json (needs network
#                               the first time: npx downloads typescript)
#
# The extension imports @earendil-works/pi-tui, which only exists inside Pi's
# install tree, so this script symlinks it into a local node_modules/ first
# (gitignored). PI_ROOT is exported for the integration test; it skips itself
# when unset.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")"

# Resolve Pi's real install path the same way patch-pi.sh does: the `pi` binary
# lives at <root>/dist/bundle/cli.js, so three dirname steps reach the root.
PI_BIN="$(readlink -f "$(command -v pi)")"
PI_ROOT="$(dirname "$(dirname "$(dirname "$PI_BIN")")")"
PI_MODULES="$PI_ROOT/node_modules/@earendil-works"

if [[ ! -d "$PI_MODULES/pi-tui" ]]; then
  echo "error: cannot find pi-tui under $PI_MODULES" >&2
  exit 1
fi

# Local resolution only; never modifies Pi's own tree.
mkdir -p node_modules/@earendil-works node_modules/@types
ln -sfn "$PI_MODULES/pi-tui" node_modules/@earendil-works/pi-tui
ln -sfn "$PI_ROOT" node_modules/@earendil-works/pi-coding-agent
# Reuse Pi's own @types/node so the typecheck needs no extra download.
if [[ -d "$PI_ROOT/node_modules/@types/node" ]]; then
  ln -sfn "$PI_ROOT/node_modules/@types/node" node_modules/@types/node
fi

if [[ "${1:-}" == "--typecheck" ]]; then
  exec npx --yes -p typescript@5 tsc -p tsconfig.json
fi

if [[ "${1:-}" == "--unit" ]]; then
  unset PI_ROOT
else
  export PI_ROOT
fi

# Node runs TypeScript directly by stripping types (Node >= 22.6), so no build
# step and no test framework dependency. --test-force-exit is deliberately NOT
# used: a leaked interval must fail the run, not be papered over.
exec node --test --experimental-strip-types src/*.test.ts
