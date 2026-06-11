#!/usr/bin/env bash
#
# uninstall.sh — remove the global registration of opencode-ultra.
#
# Removes the plugin entry from the global opencode config (via scripts/install.js
# in uninstall mode), then removes the copied command/ skills/ agent/ assets — but
# ONLY the files that are byte-identical to this repo's versions, so a command you
# edited (or one of your own that happens to share a name) is left untouched.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "==> opencode-ultra: global uninstall"
command -v node >/dev/null 2>&1 || { echo "error: node is required" >&2; exit 1; }

echo "==> removing plugin registration from the global config"
node scripts/uninstall.js --global

CONFIG_DIR="$HOME/.config/opencode"
echo "==> removing installed assets (only unmodified copies)"
for sub in command skills agent; do
  [ -d "$ROOT/$sub" ] || continue
  while IFS= read -r -d '' src; do
    rel="${src#"$ROOT"/}"
    target="$CONFIG_DIR/$rel"
    [ -f "$target" ] || continue
    if cmp -s "$src" "$target"; then
      rm -f "$target"
      echo "removed: $target"
    else
      echo "kept (modified or not ours): $target"
    fi
  done < <(find "$ROOT/$sub" -type f -print0)
done

# Prune any dirs we emptied (deepest first); leaves dirs that still hold your files.
for sub in command skills agent; do
  [ -d "$CONFIG_DIR/$sub" ] && find "$CONFIG_DIR/$sub" -depth -type d -empty -delete 2>/dev/null || true
done

echo "==> Done. Restart opencode for the change to take effect."
echo "    (dist/ and node_modules are left in place; delete them manually if you want.)"
