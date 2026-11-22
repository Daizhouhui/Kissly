/**
 * Decide whether a serialized `{ at, value }` cache entry is older than its
 * TTL. Malformed or legacy entries without `at` are left for the loader to
 * ignore instead of deleting user data blindly.
 */
export function shouldPruneCacheEntry(
  raw: string | null,
  ttlMs: number,
  now = Date.now()
): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { at?: unknown };
    const at = Number(parsed?.at);
    return Number.isFinite(at) && at > 0 && now - at > ttlMs;
  } catch {
    return false;
  }
}
