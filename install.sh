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

echo "==> building (tsc → dist/)"
npm run build

# Fail fast if the built plugin can't load — never register a broken build.
echo "==> verifying the build loads as opencode would"
node scripts/verify-dist.mjs

# --enable also writes the feature config (auto mode + ultracode enabled),
# preserving any existing settings — so no manual config edit is needed.
# Global only: installs into ~/.config/opencode (plugin + command/skills/agent
# assets) so it works in every project, and this repo never grows a .opencode/.
echo "==> registering plugin + enabling features in the global opencode config"
node scripts/install.js --global --enable

CONFIG_DIR="$HOME/.config/opencode"
cat <<EOF

==> Done — features are enabled, no manual edit needed.
    Config dir : $CONFIG_DIR
    Plugin     : $ROOT/dist/index.js  (verified to load)
    Settings   : stored in the plugin entry's options (opencode forbids unknown
                 top-level config keys) — autoMode + ultracode enabled, defaultMode off.
                 Existing settings are preserved; auto mode stays off until you run /auto.

    Note: any same-named global commands under $CONFIG_DIR were overwritten with
    this plugin's versions (auto.md, ultracode.md, workflows.md, etc.).

Restart opencode, then:  /auto on   ·   /ultracode on   ·   /workflows
Want auto mode on for every session? set "defaultMode": true in the plugin's autoMode options.

Rebuild + re-register after changes:  ./install.sh
Remove:                               ./uninstall.sh
EOF
