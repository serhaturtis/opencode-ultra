/** Parse JSON or JSONC text (strict JSON first, then a string-aware JSONC strip). */
export function parseJsonc(text: string): unknown

/** Strip `//` and block comments + trailing commas, never touching string literals. */
export function stripJsonc(text: string): string
