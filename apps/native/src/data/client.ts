import type { z } from "zod";
import { pageOf } from "@repo/contracts";
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

  return { request, pages };
}
export type Client = ReturnType<typeof createClient>;
