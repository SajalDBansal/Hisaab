import type { z } from "zod";
import { pageOf } from "@repo/contracts";
import { PAGE_SIZE } from "@repo/core";
import { pendingWriteHeaders } from "./pendingWrites";

export type RequestOptions = {
  method?: string;
  body?: object;
  headers?: Record<string, string>;
  validate?: (data: unknown) => unknown;
};
export type Transport = (
  path: string,
  options?: RequestOptions,
) => Promise<unknown>;

export function queryString(
  values: Record<string, string | number | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * A list page's query string: keys sorted, empty values left out, so a screen
 * and the offline download ask for exactly the same path for the same view.
 */
export function pageQuery(values: object) {
  const fields = values as Record<string, unknown>;
  const kept: Record<string, string> = {};
  for (const key of Object.keys(fields).sort()) {
    const value = fields[key];
    if (
      value === undefined ||
      value === null ||
      value === "" ||
      value === false
    )
      continue;
    kept[key] = String(value);
  }
  return queryString(kept);
}

/** A statement answer as a paged list: rows as items, the rest as the summary. */
export function statementPageOf<
  T extends {
    rows: unknown[];
    rowsTotal?: number;
    nextCursor?: string | null;
  },
>(statement: T) {
  const { rows, rowsTotal, nextCursor, ...summary } = statement;
  return {
    items: rows as T["rows"][number][],
    nextCursor: nextCursor ?? null,
    total: rowsTotal ?? rows.length,
    summary,
  };
}

/** A client belongs to one firm for its entire lifetime, including in-flight calls. */
export function createClient(transport: Transport, firmId: string | null) {
  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    options?: RequestOptions,
  ) {
    if (!firmId) throw new Error("Choose a firm first.");
    const data = await transport(`/v1${path}`, {
      ...options,
      headers: {
        ...(options?.body ? pendingWriteHeaders(options.body, path) : {}),
        ...options?.headers,
        "x-firm-id": firmId,
      },
      validate: (value) => schema.parse(value),
    });
    return schema.parse(data);
  }

  async function pages<T>(
    path: string,
    schema: z.ZodType<T>,
    params: Record<string, string | number | undefined> = {},
    max?: number,
  ) {
    const result: T[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await request(
        path +
          queryString({ ...params, limit: Math.min(max ?? 200, 200), cursor }),
        pageOf(schema),
      );
      result.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      if (cursor && seen.has(cursor))
        throw new Error("The server repeated a page. Please refresh.");
      if (cursor) seen.add(cursor);
    } while (cursor && (max === undefined || result.length < max));
    return max === undefined ? result : result.slice(0, max);
  }

  /**
   * One page of a list the server pages with its own cursor. The server
   * doesn't count these, so `total` is -1 (unknown).
   */
  async function page<T>(
    path: string,
    schema: z.ZodType<T>,
    params: Record<string, string | number | undefined> = {},
    cursor?: string,
  ) {
    const answer = await request(
      path + queryString({ ...params, limit: PAGE_SIZE, cursor }),
      pageOf(schema),
    );
    return {
      items: answer.items,
      nextCursor: answer.nextCursor ?? null,
      total: -1,
      summary: null,
    };
  }

  return { request, pages, page };
}
export type Client = ReturnType<typeof createClient>;
