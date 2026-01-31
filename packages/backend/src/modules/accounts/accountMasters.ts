import { CustomAccount, type AccountInput } from "@repo/contracts";
import { and, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { schema, type Db } from "../../db/client";
import { AppError } from "../../lib/app-error";
import { isUniqueViolation } from "../masters/shared";
import { rememberAnswer, replayOf, type Idem } from "../vouchers/idempotency";

const { accounts } = schema;

export async function listAccounts(db: Pick<Db, "select">, firmId: string) {
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.firmId, firmId));
  return rows.map((row) => CustomAccount.parse(row));
}

export async function readAccount(
  db: Pick<Db, "select">,
  firmId: string,
  id: string,
) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.firmId, firmId), eq(accounts.id, id)));
  return row ? CustomAccount.parse(row) : null;
}

/** Serialize creation with journals and remember network retries in the same transaction. */
export async function createAccount(
  db: Db,
  firmId: string,
  userId: string,
  input: AccountInput,
  idem?: Idem,
) {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${firmId}, 0))`,
      );
      if (idem) {
        const saved = await replayOf<CustomAccount>(tx, userId, idem);
        if (saved) return saved;
      }
      const [row] = await tx
        .insert(accounts)
        .values({ id: uuidv7(), firmId, ...input })
        .returning();
      const result = CustomAccount.parse(row);
      if (idem) await rememberAnswer(tx, userId, idem, 201, result);
      return result;
    });
  } catch (err) {
    if (isUniqueViolation(err))
      throw new AppError(
        "DUPLICATE",
        "An account with this name already exists.",
        409,
      );
    throw err;
  }
}
