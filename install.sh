#!/usr/bin/env bash
#
# install.sh — build opencode-ultra and register it GLOBALLY for testing.
#
# Builds the plugin (opencode loads package.json "main" → dist/index.js), then
# registers this repo's absolute path in the global opencode config and copies the
# bundled command/ skills/ agent/ assets into ~/.config/opencode. Re-run after code
# changes to rebuild.
#
# Config/asset handling is delegated to scripts/install.js (the single source of
# truth, with JSONC parsing + backups), invoked with:
#   --global  → register + install assets under ~/.config/opencode (works everywhere)
#   --local   → (end-user option) install into the current project's .opencode/ instead
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "==> opencode-ultra: global install (local build)"
command -v node >/dev/null 2>&1 || { echo "error: node is required" >&2; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "error: npm is required" >&2; exit 1; }

if [ ! -d node_modules ]; then
  echo "==> installing dependencies"
  npm install
fi

# esbuild transpiles without type-checking, so type-check first (fail fast).
echo "==> type-checking"
npm run typecheck

echo "==> bundling (esbuild → dist/index.js, self-contained, deps inlined)"
npm run build

# Fail fast if the bundle can't load — never install a broken build.
echo "==> verifying the bundle loads as opencode would"
node scripts/verify-dist.mjs

# Installs a SELF-CONTAINED copy into ~/.config/opencode/opencode-ultra (the bundle +
# package.json) and the command/skills/agent assets, then registers the installed
# path — NOT this repo. --enable also turns on autoMode + ultracode (preserving any
# existing settings). After this you can delete this repo.
echo "==> installing the self-contained plugin into the global opencode config"
node scripts/install.js --global --enable

CONFIG_DIR="$HOME/.config/opencode"
cat <<EOF

==> Done — installed and enabled. THIS REPO IS NO LONGER NEEDED (safe to delete).
    Config dir : $CONFIG_DIR
    Plugin     : $CONFIG_DIR/opencode-ultra/  (self-contained bundle — repo-independent)
    Assets     : $CONFIG_DIR/{command,skills,agent}
    Settings   : autoMode + ultracode enabled, defaultMode off (auto mode waits for /auto).
                 Existing settings preserved.

    Note: same-named global commands/skills/agents were overwritten with this
    plugin's versions (auto.md, ultracode.md, workflows.md, the skills, etc.).

Restart opencode, then:  /auto on   ·   /ultracode on   ·   /workflows

Rebuild + reinstall after changes:  ./install.sh
Remove:                             ./uninstall.sh
EOF
