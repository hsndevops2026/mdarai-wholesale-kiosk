const MAX_BACKOFF_MS = 5 * 60 * 1000;

export function retryDelayMs(attempts: number): number {
  return Math.min(5000 * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

/** Order lines sorted for a picking walk: by aisle, shelf, then SKU; unknown locations last. */
export function pickingOrder<T extends { aisle: string | null; shelf: string | null; sku: string }>(items: T[]): T[] {
  const key = (v: string | null) => v ?? '￿';
  return [...items].sort(
    (a, b) =>
      key(a.aisle).localeCompare(key(b.aisle), 'en', { numeric: true }) ||
      key(a.shelf).localeCompare(key(b.shelf), 'en', { numeric: true }) ||
      a.sku.localeCompare(b.sku, 'en', { numeric: true }),
  );
}
