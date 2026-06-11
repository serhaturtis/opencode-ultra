export type JsonObject = Record<string, unknown>

/** Ensure the plugin ref is present as a bare string entry (idempotent; matches tuples). */
export function withPlugin(config: JsonObject, ref: string): JsonObject

/** Remove every entry (string or [ref, options] tuple) whose ref matches. */
export function withoutPlugin(config: JsonObject, ref: string): JsonObject

/** Read the options currently attached to a plugin ref. */
export function getPluginOptions(config: JsonObject, ref: string): JsonObject

/** Register the ref as a [ref, options] tuple, replacing any existing entry. */
export function withPluginOptions(config: JsonObject, ref: string, options: JsonObject): JsonObject

/** Build plugin options enabling both features, preserving existing settings. */
export function featureOptions(existing?: JsonObject): JsonObject

/** Drop legacy top-level autoMode/ultracode keys. */
export function stripLegacyKeys(config: JsonObject): JsonObject
