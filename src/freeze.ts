/** Recursively Object.freeze — skips RegExp/Date. Deepens shallow freezes. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value
  if (value instanceof RegExp || value instanceof Date) return value
  for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v)
  return Object.freeze(value) as T
}
