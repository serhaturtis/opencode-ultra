#!/usr/bin/env node

/**
 * install.js — Register opencode-ultra as a plugin in opencode config.
 *
 * Usage:
 *   node scripts/install.js              # Install as npm package "opencode-ultra"
 *   node scripts/install.js --local      # Install from current directory (local dev)
 *   node scripts/install.js --global     # Install to global config (~/.config/opencode/)
 *   node scripts/install.js --dry-run    # Show what would be done without doing it
 *
 * Non-destructive: creates a .backup copy before modifying any config file.
 * Also works as "uninstall.js" when symlinked/copied under that name.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { fileURLToPath } from "node:url"
import { parseJsonc } from "./jsonc.js"
import { withPlugin, withoutPlugin, withPluginOptions, getPluginOptions, featureOptions, stripLegacyKeys } from "./config-edit.js"

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ASSET_DIRS = ["command", "skills", "agent"]

// ── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const isLocal = args.includes("--local")
const isGlobal = args.includes("--global")
const isDryRun = args.includes("--dry-run")
const isEnable = args.includes("--enable")
const isUninstall = process.argv[1]?.includes("uninstall") ?? false

const PLUGIN_NAME = "opencode-ultra"

// The canonical plugin reference. For a local build it MUST be the built ESM
// file: opencode imports plugins as ES modules, and ESM cannot import a directory
// (ERR_UNSUPPORTED_DIR_IMPORT). For an npm install, the package name resolves to
// dist/index.js via package.json "main".
const pluginRef = isLocal ? path.join(PACKAGE_ROOT, "dist", "index.js") : PLUGIN_NAME

// Every local form this plugin might have been registered as — so install/uninstall
// can self-heal stale or wrong entries (e.g. an old dist/plugin/index.js or a bare
// directory path) instead of leaving duplicates that break opencode startup.
const localRefs = [
  PACKAGE_ROOT,
  path.join(PACKAGE_ROOT, "dist", "index.js"),
  path.join(PACKAGE_ROOT, "dist", "plugin", "index.js"),
]

// ── Config Discovery ─────────────────────────────────────────────────────────

function findConfigFiles() {
  const candidates = []

  if (isGlobal) {
    const dir = path.join(os.homedir(), ".config", "opencode")
    candidates.push(
      path.join(dir, "opencode.jsonc"),
      path.join(dir, "opencode.json"),
      path.join(dir, "config.jsonc"),
      path.join(dir, "config.json"),
    )
  } else {
    const cwd = process.cwd()
    candidates.push(
      path.join(cwd, ".opencode", "opencode.jsonc"),
      path.join(cwd, ".opencode", "opencode.json"),
      path.join(cwd, "opencode.jsonc"),
      path.join(cwd, "opencode.json"),
    )
  }

  return candidates.filter(f => fs.existsSync(f))
}

// ── Config (de)serialization ───────────────────────────────────────────────

function stringifyConfig(config) {
  return JSON.stringify(config, null, 2) + "\n"
}

// ── Plugin Management ────────────────────────────────────────────────────────

function addPlugin(filePath) {
  const existed = fs.existsSync(filePath)
  let config = {}
  if (existed) {
    try {
      config = parseJsonc(fs.readFileSync(filePath, "utf-8"))
    } catch (err) {
      return { file: filePath, action: "error", error: `Failed to parse: ${err.message}` }
    }
  }

  // Clean up the pre-tuple approach (top-level keys) and any stale local refs.
  let next = stripLegacyKeys(config)
  for (const ref of localRefs) if (ref !== pluginRef) next = withoutPlugin(next, ref)

  // Settings ride the plugin tuple's options (opencode forbids unknown root keys).
  if (isEnable) {
    next = withPluginOptions(next, pluginRef, featureOptions(getPluginOptions(next, pluginRef)))
  } else {
    next = withPlugin(next, pluginRef)
  }

  if (existed && JSON.stringify(next) === JSON.stringify(config)) {
    return { file: filePath, action: "already-present" }
  }
  return writeConfig(filePath, config, next, existed ? "added" : "created", existed)
}

function removePlugin(filePath) {
  if (!fs.existsSync(filePath)) {
    return { file: filePath, action: "error", error: "Config file not found" }
  }
  let config
  try {
    config = parseJsonc(fs.readFileSync(filePath, "utf-8"))
  } catch (err) {
    return { file: filePath, action: "error", error: `Failed to parse: ${err.message}` }
  }

  // Remove the canonical ref, every stale local variant, and legacy top-level keys.
  let next = stripLegacyKeys(config)
  for (const ref of [pluginRef, ...localRefs]) next = withoutPlugin(next, ref)
  if (JSON.stringify(next) === JSON.stringify(config)) {
    return { file: filePath, action: "already-absent" }
  }
  return writeConfig(filePath, config, next, "removed", true)
}

/** Write `next` to `filePath`, backing up the prior content first. Honors --dry-run. */
function writeConfig(filePath, _prev, next, action, backupExisting) {
  const backup = backupExisting ? filePath + ".backup" : undefined
  if (!isDryRun) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    if (backup) fs.copyFileSync(filePath, backup)
    fs.writeFileSync(filePath, stringifyConfig(next), "utf-8")
  }
  return { file: filePath, action, ...(backup ? { backup } : {}) }
}

// ── Asset Installation ─────────────────────────────────────────────────────────

/**
 * opencode loads commands/skills/agents from `<configdir>/{command,skills,agent}`.
 * The package's bundled assets (the top-level command/ skills/ agent/ dirs) are
 * copied INTO the active config dir — global (~/.config/opencode) or a project's
 * own .opencode/ — or they never load. The repo itself carries no .opencode/.
 */
function assetTargetDir() {
  return isGlobal
    ? path.join(os.homedir(), ".config", "opencode")
    : path.join(process.cwd(), ".opencode")
}

function installAssets() {
  const targetRoot = assetTargetDir()

  for (const sub of ASSET_DIRS) {
    const src = path.join(PACKAGE_ROOT, sub)
    if (!fs.existsSync(src)) continue
    const dest = path.join(targetRoot, sub)
    if (isDryRun) {
      console.log(`[DRY RUN] Would copy assets: ${path.relative(process.cwd(), src)} -> ${dest}`)
      continue
    }
    fs.mkdirSync(dest, { recursive: true })
    fs.cpSync(src, dest, { recursive: true })
    console.log(`✓ ${path.relative(process.cwd(), dest)} — assets installed`)
  }
}

// ── Output ───────────────────────────────────────────────────────────────────

function printResult(result) {
  if (isDryRun) {
    const actionText = result.action === "error" ? "ERROR" : result.action.toUpperCase()
    console.log(`[DRY RUN] Would ${result.action}: ${path.relative(process.cwd(), result.file)}`)
    return
  }

  const icon = result.action === "error" ? "\u2717" : "\u2713"
  let msg = `${icon} ${path.relative(process.cwd(), result.file)}`

  switch (result.action) {
    case "added":
      msg += " — plugin added"
      if (result.backup) msg += ` (backup: ${path.basename(result.backup)})`
      break
    case "removed":
      msg += " — plugin removed"
      if (result.backup) msg += ` (backup: ${path.basename(result.backup)})`
      break
    case "created":
      msg += " — config created with plugin"
      break
    case "already-present":
      msg += " — plugin already present"
      break
    case "already-absent":
      msg += " — plugin already absent"
      break
    case "error":
      msg += ` — ${result.error}`
      break
  }

  console.log(msg)
}

// ── Main ─────────────────────────────────────────────────────────────────────

const configFiles = findConfigFiles()

if (configFiles.length === 0) {
  if (isUninstall) {
    console.log("No opencode config files found. Nothing to uninstall.")
    process.exit(0)
  }

  const defaultPath = isGlobal
    ? path.join(os.homedir(), ".config", "opencode", "opencode.jsonc")
    : path.join(process.cwd(), ".opencode", "opencode.jsonc")

  if (isDryRun) {
    console.log(`[DRY RUN] Would create: ${defaultPath}`)
    console.log(`[DRY RUN] Would add plugin: ${pluginRef}`)
    process.exit(0)
  }

  const result = addPlugin(defaultPath)
  printResult(result)
  installAssets()
  process.exit(0)
}

console.log(`Plugin: ${pluginRef}`)
console.log(`Config files found: ${configFiles.length}`)
if (isDryRun) console.log("[DRY RUN — no changes will be made]")
console.log()

for (const file of configFiles) {
  const result = isUninstall ? removePlugin(file) : addPlugin(file)
  printResult(result)
}

if (!isUninstall) {
  installAssets()
}
