#!/bin/bash
# Build / prepare dsh-ugreen-nas.
#
# The plugin ships plain ESM JavaScript (no TypeScript step). This script:
#   1. links the two DSH peer packages the host provides at runtime
#   2. syntax-checks the host, client, codec and test files
#   3. runs the host-entry + live smoke test (live part is skipped when no token)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
CANDIDATES=(
  "$DSH_HOME_DIR/profiles/web/node_modules"
  "$DSH_HOME_DIR/profiles/node_modules"
  "$HOME/.dsh-runtime/lib/node_modules/@deepseek-ai/dsh/node_modules"
  "/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules"
)
DEP_ROOT=""
for candidate in "${CANDIDATES[@]}"; do
  if [ -d "$candidate/@deepseek-ai/dsh-tools" ] && [ -d "$candidate/@deepseek-ai/schemastery" ]; then
    DEP_ROOT="$candidate"
    break
  fi
done
if [ -z "$DEP_ROOT" ]; then
  echo "build: cannot locate @deepseek-ai/dsh-tools / @deepseek-ai/schemastery" >&2
  exit 1
fi
echo "=== dependency root: $DEP_ROOT ==="

link_pkg() {
  local name="$1"
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const [link, target] = process.argv.slice(1);
    if (!fs.existsSync(target)) { console.error("build: missing dependency target " + target); process.exit(1); }
    fs.rmSync(link, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.resolve(target), path.resolve(link), process.platform === "win32" ? "junction" : "dir");
  ' "node_modules/$name" "$DEP_ROOT/$name"
}

for pkg in @deepseek-ai/dsh-tools @deepseek-ai/schemastery; do
  link_pkg "$pkg"
  echo "  linked $pkg"
done

echo "=== syntax check ==="
for file in lib/*.js scripts/*.mjs test/*.mjs; do
  [ -f "$file" ] || continue
  node --check "$file"
  echo "  ok $file"
done

echo "=== smoke test ==="
node test/smoke.test.mjs
echo "=== build complete: $ROOT ==="
