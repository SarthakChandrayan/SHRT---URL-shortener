const TTL_MS = 10_000;

type CacheEntry = {
  expiresAt: number;
  timezone: string;
  value: unknown;
};

// One entry per user; the list's sparklines depend on the viewer's timezone.
const entries = new Map<string, CacheEntry>();

export function getCachedUrlList<T>(userId: string, timezone: string): T | undefined {
  const entry = entries.get(userId);

  if (!entry || entry.timezone !== timezone) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    entries.delete(userId);
    return undefined;
  }

  return entry.value as T;
}

export function setCachedUrlList<T>(userId: string, timezone: string, value: T): void {
  entries.set(userId, {
    expiresAt: Date.now() + TTL_MS,
    timezone,
    value,
  });
}

export function invalidateUrlListCache(userId: string): void {
  entries.delete(userId);
}
