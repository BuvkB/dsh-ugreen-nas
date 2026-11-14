#!/bin/bash
# Build / prepare dsh-ugreen-nas.
#
# The plugin ships plain ESM JavaScript (no TypeScript step). This script:
#   1. links the DSH peer packages the host provides at runtime (link-peers.mjs)
#   2. syntax-checks the host, client, codec and test files
#   3. runs the host-entry + live smoke test (live part is skipped when no token)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== peer links ==="
node scripts/link-peers.mjs

echo "=== syntax check ==="
for file in lib/*.js scripts/*.mjs test/*.mjs; do
  [ -f "$file" ] || continue
  node --check "$file"
  echo "  ok $file"
done

echo "=== tests ==="
node test/smoke.test.mjs
node test/unit.test.mjs
echo "=== build complete: $ROOT ==="
