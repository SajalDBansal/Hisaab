import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { schema, type Db } from "../../db/client";
import { AppError } from "../../lib/app-error";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The `Idempotency-Key` of a create request and a fingerprint of what was asked. */
export interface Idem {
  key: string;
  hash: string;
}

/** Same key + same firm + same route + same body = the same request, sent again. */
export function idemOf(
  key: string | undefined,
  req: { firmId: string; route: string; body: unknown },
): Idem | undefined {
  if (!key) return undefined;
  const hash = createHash("sha256")
    .update(JSON.stringify([req.firmId, req.route, req.body]))
    .digest("hex");
  return { key, hash };
}

/**
 * The answer saved for this key, if the request was already done.
 * Call inside the firm's lock: a duplicate that arrives while the first is still saving
 * waits for it, then finds the key here, so it can never save a second bill.
 */
export async function replayOf<T>(
  tx: Tx,
  userId: string,
  idem: Idem,
): Promise<T | undefined> {
  const [row] = await tx
    .select()
    .from(schema.idempotencyKeys)
    .where(
      and(
        eq(schema.idempotencyKeys.userId, userId),
        eq(schema.idempotencyKeys.key, idem.key),
      ),
    );
  if (!row) return undefined;
  if (row.requestHash !== idem.hash)
    throw new AppError(
      "KEY_REUSED",
      "This request key was already used for something different. Start again from the form.",
      422,
    );
  return row.response as T;
}

/** Saved in the same transaction as the voucher, so a saved bill always has its key. */
export async function rememberAnswer(
  tx: Tx,
  userId: string,
  idem: Idem,
  statusCode: number,
  response: unknown,
) {
  await tx.insert(schema.idempotencyKeys).values({
    userId,
    key: idem.key,
    requestHash: idem.hash,
    statusCode,
    response,
  });
}

/** Keys are only needed while a phone might still retry. A nightly job calls this. */
export async function purgeOldKeys(db: Db, days = 7) {
  const rows = await db
    .delete(schema.idempotencyKeys)
    .where(
      lt(
        schema.idempotencyKeys.createdAt,
        sql`now() - make_interval(days => ${days})`,
      ),
    )
    .returning({ key: schema.idempotencyKeys.key });
  return rows.length;
}
