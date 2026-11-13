// Lists are read a page at a time. A cursor is the offset of the page's first
// row, as text ("30", "60"…), so a client that knows the total can ask for
// every page at once (the offline download does). Rows must be in a stable
// order, with a unique tie-break, so pages never overlap.

/** Rows per page in the app. */
export const PAGE_SIZE = 30;
/** Largest page a client may ask for. */
export const MAX_PAGE_SIZE = 200;

export interface PageQuery {
  cursor?: string;
  limit?: number;
}

export interface Page<T> {
  items: T[];
  /** Cursor of the next page; null on the last one. */
  nextCursor: string | null;
  /** Rows matching the filters, across all pages. */
  total: number;
}

/** The offset a cursor names; anything unreadable starts at the top. */
export function cursorOffset(cursor?: string): number {
  if (!cursor || !/^\d{1,9}$/.test(cursor)) return 0;
  return Number(cursor);
}

export const pageCursor = (offset: number) => String(offset);

/** One page of already filtered and sorted rows. */
export function pageRows<T>(rows: T[], query: PageQuery = {}): Page<T> {
  const limit = Math.min(Math.max(query.limit ?? PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const start = Math.min(cursorOffset(query.cursor), rows.length);
  const end = start + limit;
  return {
    items: rows.slice(start, end),
    nextCursor: end < rows.length ? pageCursor(end) : null,
    total: rows.length,
  };
}

/**
 * A statement as a paged list: its rows a page at a time, everything else
 * (opening, totals, closing) as the summary.
 */
export function statementAsPage<T extends { rows: unknown[] }>(
  statement: T,
  query: PageQuery = {},
): Page<T["rows"][number]> & { summary: Omit<T, "rows"> } {
  const { rows, ...summary } = statement;
  return { ...pageRows(rows, query), summary };
}

/** Cursors of every page after the first, for a list of `total` rows. */
export function laterPageCursors(total: number, limit = PAGE_SIZE): string[] {
  const cursors: string[] = [];
  for (let offset = limit; offset < total; offset += limit)
    cursors.push(pageCursor(offset));
  return cursors;
}

/** Case-insensitive "contains" over a few text fields. */
export function matchesSearch(
  search: string | undefined,
  ...fields: (string | undefined | null)[]
): boolean {
  const q = search?.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().includes(q));
}
