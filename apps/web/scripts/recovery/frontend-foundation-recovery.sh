#!/usr/bin/env bash
# RUN_FRONTEND_FOUNDATION_RECOVERY — delegates to cross-platform Node orchestrator.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec node "$ROOT/scripts/recovery/recover-foundation.mjs" "$@"
