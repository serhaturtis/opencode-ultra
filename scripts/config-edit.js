/**
 * config-edit.js — pure transforms over an opencode config object.
 *
 * opencode's plugin array accepts either a bare string or a `[ref, options]`
 * tuple, and its root forbids unknown keys (additionalProperties:false). So
 * plugin settings live in the tuple's options, NOT as top-level config keys.
 *
 * No I/O — install.js handles reading/writing/backups. Idempotent, non-mutating.
 * Tested in test/scripts/config-edit.test.ts.
 */

/** The ref of a plugin entry, whether it's a bare string or a [ref, options] tuple. */
function refOf(entry) {
  return Array.isArray(entry) ? entry[0] : entry
}

/** The options object of a plugin entry, or {} for a bare string / no options. */
function optionsOf(entry) {
  return Array.isArray(entry) && entry[1] && typeof entry[1] === "object" ? entry[1] : {}
}

/** Ensure `ref` is present as a bare string entry (idempotent; matches tuples too). */
export function withPlugin(config, ref) {
  const plugins = Array.isArray(config.plugin) ? config.plugin : []
  if (plugins.some((e) => refOf(e) === ref)) return config
  return { ...config, plugin: [...plugins, ref] }
}

/** Remove every entry (string or tuple) whose ref matches `ref`. */
export function withoutPlugin(config, ref) {
  const plugins = Array.isArray(config.plugin) ? config.plugin : []
  const next = plugins.filter((e) => refOf(e) !== ref)
  if (next.length === plugins.length) return config
  const out = { ...config, plugin: next }
  if (next.length === 0) delete out.plugin
  return out
}

/** Read the options currently attached to `ref` (for merging on re-install). */
export function getPluginOptions(config, ref) {
  const plugins = Array.isArray(config.plugin) ? config.plugin : []
  return optionsOf(plugins.find((e) => refOf(e) === ref))
}

/** Register `ref` as a `[ref, options]` tuple (replacing any existing entry for it). */
export function withPluginOptions(config, ref, options) {
  const plugins = Array.isArray(config.plugin) ? config.plugin : []
  const others = plugins.filter((e) => refOf(e) !== ref)
  return { ...config, plugin: [...others, [ref, options]] }
}

/** Build the plugin options that enable both features, preserving existing settings. */
export function featureOptions(existing = {}) {
  return {
    ...existing,
    autoMode: { defaultMode: false, ...(existing.autoMode || {}), enabled: true },
    ultracode: { ...(existing.ultracode || {}), enabled: true },
  }
}

/** Drop legacy top-level autoMode/ultracode keys (from the pre-tuple approach). */
export function stripLegacyKeys(config) {
  if (!("autoMode" in config) && !("ultracode" in config)) return config
  const out = { ...config }
  delete out.autoMode
  delete out.ultracode
  return out
}
