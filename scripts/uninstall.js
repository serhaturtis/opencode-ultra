#!/usr/bin/env node

/**
 * uninstall.js — Remove opencode-ultra from opencode config.
 *
 * install.js implements both directions and detects uninstall mode from the
 * invoked filename (process.argv[1] contains "uninstall"). Re-exporting keeps a
 * single source of truth instead of a drifting byte-for-byte copy.
 *
 * Usage:
 *   node scripts/uninstall.js            # Remove from local/project config
 *   node scripts/uninstall.js --global   # Remove from global config (~/.config/opencode/)
 */
import "./install.js"
