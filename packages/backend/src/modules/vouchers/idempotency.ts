import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { isDurableRequestId } from "@repo/contracts";
import { z } from "zod";
import { schema, type Db } from "../../db/client";
import { AppError } from "../../lib/app-error";

/** The `Idempotency-Key` of a create request and a fingerprint of what was asked. */
export interface Idem {
  key: string;
  hash: string;
  replayOnly?: boolean;
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
  return { key, hash, replayOnly: !isDurableRequestId(key) };
}

export const unknownRetry = () =>
  new AppError(
    "RETRY_RESULT_UNKNOWN",
    "The original save cannot be verified. Keep this request and check the books before creating another entry. It has not been posted again.",
    409,
  );

const committedAnswer = z.object({
  state: z.literal("committed"),
  response: z.unknown(),
});

/**
 * The answer saved for this key, if the request was already done.
 * Call inside the firm's lock: a duplicate that arrives while the first is still saving
 * waits for it, then finds the key here, so it can never save a second bill.
 */
export async function replayOf<T>(
  tx: Pick<Db, "select">,
  userId: string,
  idem: Idem,
): Promise<T | undefined> {
  // A permanent receipt wins even if an old cache row is still present.
  const [retained] = await tx
    .select()
    .from(schema.operationReceipts)
    .where(
      and(
        eq(schema.operationReceipts.userId, userId),
        eq(schema.operationReceipts.key, idem.key),
      ),
    );
  if (retained) {
    checkHash(retained.requestHash, idem.hash);
    const answer = committedAnswer.safeParse(retained.result);
    if (!answer.success) throw unknownRetry();
    return answer.data.response as T;
  }
  const [row] = await tx
    .select()
    .from(schema.idempotencyKeys)
    .where(
      and(
        eq(schema.idempotencyKeys.userId, userId),
        eq(schema.idempotencyKeys.key, idem.key),
      ),
    );
  if (row) {
    checkHash(row.requestHash, idem.hash);
    return row.response as T;
  }
  if (idem.replayOnly) throw unknownRetry();
  return undefined;
}

function checkHash(saved: string, requested: string) {
  if (saved !== requested)
    throw new AppError(
      "KEY_REUSED",
      "This request key was already used for something different. Start again from the form.",
      422,
    );
}

/** Saved in the same transaction as the voucher, so a saved bill always has its key. */
export async function rememberAnswer(
  tx: Pick<Db, "insert">,
  userId: string,
  idem: Idem,
  statusCode: number,
  response: unknown,
) {
  // Store every answer, including settlements and sync envelopes, in the same transaction.
  await tx.insert(schema.operationReceipts).values({
    userId,
    key: idem.key,
    requestHash: idem.hash,
    legacy: 1,
    result: { state: "committed", response },
  });
  await tx.insert(schema.idempotencyKeys).values({
    userId,
    key: idem.key,
    requestHash: idem.hash,
    statusCode,
    response,
  });
}

/** Only discard the short-lived copy after its permanent answer exists. */
export async function purgeOldKeys(db: Db, days = 7) {
  const rows = await db
    .delete(schema.idempotencyKeys)
    .where(
      and(
        lt(
          schema.idempotencyKeys.createdAt,
          sql`now() - make_interval(days => ${days})`,
        ),
        sql`exists (
          select 1 from ${schema.operationReceipts} receipt
          where receipt.user_id = ${schema.idempotencyKeys.userId}
            and receipt.key = ${schema.idempotencyKeys.key}
            and receipt.request_hash = ${schema.idempotencyKeys.requestHash}
            and receipt.result->>'state' = 'committed'
        )`,
      ),
    )
    .returning({ key: schema.idempotencyKeys.key });
  return rows.length;
}
