const TTL_MS = 10_000;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const entries = new Map<string, CacheEntry<unknown>>();

export function getCachedUrlList<T>(userId: string): T | undefined {
  const entry = entries.get(userId);

  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    entries.delete(userId);
    return undefined;
  }

  return entry.value as T;
}

export function setCachedUrlList<T>(userId: string, value: T): void {
  entries.set(userId, {
    expiresAt: Date.now() + TTL_MS,
    value,
  });
}

export function invalidateUrlListCache(userId: string): void {
  entries.delete(userId);
}
