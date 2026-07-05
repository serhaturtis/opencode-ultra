#!/usr/bin/env node

/**
 * install.js — Install opencode-ultra into the opencode config as a SELF-CONTAINED
 * plugin (bundled code + command/skills/agent assets), then register its path.
 * Nothing points back at the source repo, so the repo can be deleted after install.
 *
 * Usage:
 *   node scripts/install.js              # Install into the current project's .opencode/
 *   node scripts/install.js --global     # Install into ~/.config/opencode (recommended)
 *   node scripts/install.js --enable     # also enable autoMode + ultracode in the config
 *   node scripts/install.js --dry-run    # Show what would be done without doing it
 *
 * Non-destructive: creates a .backup copy before modifying any config file.
 * Also works as "uninstall.js" when invoked under that name.
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
const isGlobal = args.includes("--global")
const isDryRun = args.includes("--dry-run")
const isEnable = args.includes("--enable")
const isUninstall = process.argv[1]?.includes("uninstall") ?? false

const PLUGIN_NAME = "opencode-ultra"

/** The opencode config dir we install into: global (~/.config/opencode) or a project's .opencode. */
function configDir() {
  return isGlobal ? path.join(os.homedir(), ".config", "opencode") : path.join(process.cwd(), ".opencode")
}

/**
 * Where the SELF-CONTAINED plugin is installed — a stable dir inside the opencode
 * config, holding the bundled index.js + a package.json. This is the whole point:
 * the plugin no longer references the repo, so the repo can be deleted after install.
 */
function pluginInstallDir() {
  return path.join(configDir(), PLUGIN_NAME)
}

// The canonical plugin reference: the absolute path to the installed, self-contained
// plugin dir (a directory with package.json → opencode resolves main = index.js).
const pluginRef = pluginInstallDir()

// Every OTHER form this plugin may have been registered as — stripped on install
// and uninstall so configs from earlier versions self-heal instead of leaving stale
// entries (the bare package name, or paths into a now-deleted repo).
const localRefs = [
  PLUGIN_NAME,
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
/**
 * Copy the SELF-CONTAINED bundle (dist/index.js — esbuild output with all runtime
 * deps inlined) plus a tiny package.json into the install dir. After this, nothing
 * the plugin loads points back at the repo, so the repo can be deleted.
 */
function installPluginCode() {
  const bundle = path.join(PACKAGE_ROOT, "dist", "index.js")
  if (!fs.existsSync(bundle)) {
    console.error("✗ dist/index.js not found — run `npm run build` (esbuild bundle) before installing.")
    process.exit(1)
  }
  const dir = pluginInstallDir()
  const version = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf-8")).version
  const manifest = { name: PLUGIN_NAME, version, type: "module", main: "index.js" }
  if (isDryRun) {
    console.log(`[DRY RUN] Would install self-contained plugin -> ${dir}`)
    return
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(bundle, path.join(dir, "index.js"))
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8")
  console.log(`✓ ${dir} — self-contained plugin installed`)
}

/** Remove the installed plugin dir (uninstall). */
function removePluginCode() {
  const dir = pluginInstallDir()
  if (!fs.existsSync(dir)) return
  if (isDryRun) {
    console.log(`[DRY RUN] Would remove ${dir}`)
    return
  }
  fs.rmSync(dir, { recursive: true, force: true })
  console.log(`✓ removed ${dir}`)
}

function installAssets() {
  const targetRoot = configDir()

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
  installPluginCode()
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

if (isUninstall) {
  removePluginCode()
} else {
  installPluginCode()
  installAssets()
}
