import { and, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import * as c from "@repo/contracts/src/associates";
import { schema, type Db } from "@repo/backend/db/client";
import { associates, associateEvents } from "@repo/backend/db/schema/associates";
import { AppError } from "@repo/backend/lib/app-error";
import { withFirmWrite } from "@repo/backend/lib/firm-write";
import { rememberAnswer, replayOf, type Idem } from "@repo/backend/modules/vouchers/idempotency";
import { isUniqueViolation, notFound } from "@repo/backend/modules/masters/shared";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Reader = Pick<Db, "select">;
export type AssociateActor = {
  firmId: string;
  userId: string;
  userName: string;
  idem: Idem;
};
export type HookActor = {
  firmId: string;
  id: string;
  name: string;
  role?: string;
};
export const scoped = (firmId: string, id: string) =>
  and(eq(associates.firmId, firmId), eq(associates.id, id));
export const invalid = (message: string) =>
  new AppError("INVALID_ASSOCIATE", message, 422);
export const conflict = () =>
  new AppError(
    "VERSION_CONFLICT",
    "This record changed. Reload and review it before saving.",
    409,
  );
export function record(row: typeof associates.$inferSelect | undefined) {
  if (!row) throw new Error("Associate row missing after write.");
  return c.AssociateRecord.parse({
    ...row.profile,
    id: row.id,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
export async function readAssociate(db: Reader, firmId: string, id: string) {
  const [row] = await db.select().from(associates).where(scoped(firmId, id));
  if (!row) throw notFound("associate");
  return record(row);
}
export async function requireAssociateWriter(
  db: Reader,
  firmId: string,
  userId: string,
) {
  const [member] = await db
    .select()
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, firmId),
        eq(schema.member.userId, userId),
      ),
    );
  if (!member || !["owner", "accountant"].includes(member.role))
    throw new AppError(
      "FORBIDDEN",
      "Only an owner or accountant can change associates or commissions.",
      403,
    );
  return member.role;
}
export async function associateWrite<T>(
  db: Db,
  actor: AssociateActor,
  status: number,
  change: (tx: Tx) => Promise<T>,
) {
  try {
    return await withFirmWrite(db, actor.firmId, async (tx) => {
      await requireAssociateWriter(tx, actor.firmId, actor.userId);
      const replay = await replayOf<T>(tx, actor.userId, actor.idem);
      if (replay !== undefined && replay !== null) return replay;
      const result = await change(tx);
      await rememberAnswer(tx, actor.userId, actor.idem, status, result);
      return result;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AppError(
        "DUPLICATE",
        "That payable account or commission entry is already registered.",
        409,
      );
    throw error;
  }
}
export async function associateAudit(
  tx: Tx,
  actor: Pick<AssociateActor, "firmId" | "userId" | "userName">,
  associateId: string | null,
  action: string,
  reason: string,
  before: unknown,
  after: unknown,
) {
  await tx.insert(associateEvents).values({
    id: uuidv7(),
    firmId: actor.firmId,
    associateId,
    action,
    reason,
    userId: actor.userId,
    userName: actor.userName,
    before: before ?? sql`'null'::jsonb`,
    after: after ?? sql`'null'::jsonb`,
  });
}
