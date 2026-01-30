import { Id, IsoDate } from "@repo/contracts";
import { z } from "zod";
import { AppError } from "../../lib/app-error";

/** The version the caller saw, sent as `If-Match: 3`. Without it we can't tell if someone else edited first. */
export function expectedVersion(header: unknown): number {
  const raw = String(Array.isArray(header) ? header[0] : (header ?? ""))
    .replace(/^W\//, "")
    .replaceAll('"', "")
    .trim();
  if (!/^\d+$/.test(raw))
    throw new AppError(
      "VERSION_REQUIRED",
      "Reload this screen and try again.",
      428,
    );
  return Number(raw);
}

export const notFound = (noun: string) =>
  new AppError("NOT_FOUND", `This ${noun} was not found.`, 404);

export const editedElsewhere = (noun: string) =>
  new AppError(
    "EDITED_ELSEWHERE",
    `Someone else changed this ${noun}. Reload and try again.`,
    409,
  );

/** Field-by-field problems, in the same shape as a failed request check. */
export function invalidFields(fields: Record<string, string | undefined>) {
  const clean = Object.fromEntries(
    Object.entries(fields).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  return Object.keys(clean).length > 0
    ? new AppError(
        "INVALID_INPUT",
        "Please check the highlighted fields.",
        400,
        clean,
      )
    : null;
}

/** Lists page with an opaque cursor (the position of the next row). */
export const pageStart = (cursor?: string) => {
  if (!cursor) return 0;
  const raw = decodeCursor(cursor);
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n > 2_147_483_647)
    throw invalidCursor();
  return n;
};

export function pageOf<T>(rows: T[], start: number, limit: number) {
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor:
      rows.length > limit
        ? Buffer.from(String(start + limit)).toString("base64url")
        : null,
  };
}

export type DateIdCursor = { date: string; id: string };
const DateId = z.object({ date: IsoDate, id: Id });

const invalidCursor = () =>
  new AppError("INVALID_CURSOR", "Reload this list and try again.", 400);

function decodeCursor(cursor: string) {
  if (cursor.length > 256 || !/^[\w-]+$/.test(cursor)) throw invalidCursor();
  return Buffer.from(cursor, "base64url").toString();
}

export function dateIdCursor(cursor?: string): DateIdCursor | undefined {
  if (!cursor) return undefined;
  try {
    return DateId.parse(JSON.parse(decodeCursor(cursor)));
  } catch {
    throw invalidCursor();
  }
}

export function encodeDateIdCursor(row: DateIdCursor) {
  return Buffer.from(JSON.stringify({ date: row.date, id: row.id })).toString(
    "base64url",
  );
}

export function pageByDateId<T extends DateIdCursor>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeDateIdCursor(last) : null,
  };
}

/** Postgres "unique constraint" failure, for when two people save the same name at once. */
export const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
};
