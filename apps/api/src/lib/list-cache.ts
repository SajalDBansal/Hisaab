// Paged lists are worked out from the firm's whole books, which can take a
// second for a large firm. The rows behind a list are kept here for a short
// while, keyed by the firm's data version, so the second and later pages only
// slice and filter. Any write bumps the version, so a cached list is never
// stale. Nothing here must survive a restart: it is a cache, not state.

const TTL_MS = 120_000;
const MAX_ENTRIES = 200;

/** Cache key for a list: the firm, its current data version and the list. */
export const listKey = (
  req: { firm: { id: string }; firmDataVersion?: string },
  list: string,
) => `${req.firm.id}:${req.firmDataVersion ?? "?"}:${list}`;

/** A statement's rows, cut to the asked page; the whole statement without `limit`. */
export function statementPage<T extends { rows: unknown[] }>(
  statement: T,
  query: { limit?: number; cursor?: string },
) {
  if (!query.limit) return statement;
  const start = Math.min(Number(query.cursor ?? 0), statement.rows.length);
  const end = start + query.limit;
  return {
    ...statement,
    rows: statement.rows.slice(start, end),
    rowsTotal: statement.rows.length,
    nextCursor: end < statement.rows.length ? String(end) : null,
  };
}

export type ListCache = <T>(
  key: string,
  compute: () => Promise<T>,
) => Promise<T>;

export function createListCache(now = () => Date.now()): ListCache {
  const entries = new Map<string, { at: number; value: Promise<unknown> }>();
  return <T>(key: string, compute: () => Promise<T>) => {
    const hit = entries.get(key);
    if (hit && now() - hit.at < TTL_MS) {
      // Recently used entries stay longest.
      entries.delete(key);
      entries.set(key, hit);
      return hit.value as Promise<T>;
    }
    // Concurrent pages of one list (an offline download) share one computation.
    const value = compute();
    entries.set(key, { at: now(), value });
    value.catch(() => entries.delete(key));
    while (entries.size > MAX_ENTRIES)
      entries.delete(entries.keys().next().value as string);
    return value;
  };
}
