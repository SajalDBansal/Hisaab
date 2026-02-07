import { UploadRequest, UploadTicket } from "@repo/contracts";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@repo/backend/db/client";
import { operationReceipts } from "@repo/backend/db/schema/operations";
import { AppError } from "@repo/backend/lib/app-error";
import { documentsRepo } from "../documents/documents.repo";
import { legacyHashes, type OperationActor } from "./operations.engine";
import { OperationResult } from "./operations.schema";

export const ReservationAnswer = z.discriminatedUnion("state", [
  z.object({ state: z.literal("found"), id: z.uuid() }),
  z.object({ state: z.literal("unknown"), message: z.string() }),
]);
export function reservationId(
  firmId: string,
  body: z.infer<typeof UploadRequest>,
  receipt: { requestHash: string; response: unknown },
) {
  const hashes = legacyHashes(firmId, {
    method: "POST",
    path: "/documents/upload-url",
    body: UploadRequest.parse(body),
    role: "owner",
  });
  if (!hashes.includes(receipt.requestHash))
    throw new AppError(
      "KEY_REUSED",
      "This reservation belongs to another request or firm.",
      422,
    );
  return UploadTicket.parse(receipt.response).document.id;
}
// Read-only identity reconciliation. Renewal/confirmation keep their existing role checks.
export function lookupDocumentReservation(
  db: Db,
  actor: OperationActor,
  key: string,
  body: z.infer<typeof UploadRequest>,
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${actor.firmId}, 0))`,
    );
    const [member] = await tx
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, actor.firmId),
          eq(schema.member.userId, actor.id),
        ),
      );
    if (!member || member.role !== actor.role)
      throw new AppError(
        "ACCESS_CHANGED",
        "Verify the original firm membership before recovery.",
        403,
      );
    const [retained] = await tx
      .select()
      .from(operationReceipts)
      .where(
        and(
          eq(operationReceipts.userId, actor.id),
          eq(operationReceipts.key, key),
        ),
      );
    const result = retained
      ? OperationResult.parse(retained.result)
      : undefined;
    const [legacy] = result
      ? []
      : await tx
          .select()
          .from(schema.idempotencyKeys)
          .where(
            and(
              eq(schema.idempotencyKeys.userId, actor.id),
              eq(schema.idempotencyKeys.key, key),
            ),
          );
    const receipt =
      retained && result?.state === "committed"
        ? { requestHash: retained.requestHash, response: result.response }
        : legacy;
    if (!receipt)
      return {
        state: "unknown" as const,
        message:
          "No retained reservation answer exists. Keep the original copy and key; a replacement reservation will not be created.",
      };
    const id = reservationId(actor.firmId, body, receipt);
    if (
      !(await documentsRepo.canRead(
        tx as unknown as Db,
        actor.firmId,
        id,
        actor.role,
      ))
    )
      throw new AppError(
        "RESERVATION_UNAVAILABLE",
        "The original document was removed or is not accessible. It will not be recreated.",
        403,
      );
    return { state: "found" as const, id };
  });
}
