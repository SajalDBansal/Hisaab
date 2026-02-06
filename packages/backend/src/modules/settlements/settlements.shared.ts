import { and, eq, inArray, or } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  createJournal,
  today,
  type Allocation,
  type JournalLine,
  type Voucher,
} from "@repo/core";
import type { SettlementRecord } from "@repo/contracts/src/settlements";
import {
  importedOpeningBillId,
  isOpeningBillId,
} from "@repo/core/src/accounting/openingImport";
import { schema, type Db } from "../../db/client";
import {
  settlementEntries,
  settlementAllocations,
} from "../../db/schema/settlements";
import { AppError } from "../../lib/app-error";
import { assertOpenPeriod } from "../../lib/book-period";
import { withFirmWrite } from "../../lib/firm-write";
import { replayOf, rememberAnswer, type Idem } from "../vouchers/idempotency";
import { loadBooks } from "../vouchers/snapshot";
import { saveChanges } from "../vouchers/persist";

export type SettlementTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export interface SettlementActor {
  firmId: string;
  userId: string;
  userName: string;
  idem: Idem;
}
export function invalid(
  message: string,
  code = "INVALID_SETTLEMENT",
  status = 422,
): never {
  throw new AppError(code, message, status);
}
export const required = <T>(value: T | undefined, message: string): T =>
  value ?? invalid(message, "NOT_FOUND", 404);
export const record = (
  row: typeof settlementEntries.$inferSelect,
): SettlementRecord => ({
  ...row,
  version: 1,
  createdAt: row.createdAt.toISOString(),
});

export async function settlementWrite<T>(
  db: Db,
  actor: SettlementActor,
  work: (tx: SettlementTx, role: string) => Promise<T>,
  ownerOnly = false,
): Promise<T> {
  return withFirmWrite(db, actor.firmId, async (tx) => {
    const [member] = await tx
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, actor.firmId),
          eq(schema.member.userId, actor.userId),
        ),
      )
      .for("share");
    if (
      !member ||
      (member.role !== "owner" && (ownerOnly || member.role !== "accountant"))
    )
      invalid(
        "Your current role cannot authorize this settlement.",
        "FORBIDDEN",
        403,
      );
    const replay = await replayOf<T>(tx, actor.userId, actor.idem);
    if (replay) return replay;
    await assertOpenPeriod(tx, actor.firmId, [today()]);
    const result = await work(tx, member.role);
    await rememberAnswer(tx, actor.userId, actor.idem, 201, result);
    return result;
  });
}

/** Attach read-only signed deltas; never copy them into the legacy allocations table. */
export async function hydrateSettlementVouchers(
  db: Pick<Db, "select">,
  firmId: string,
  vouchers: Voucher[],
): Promise<Voucher[]> {
  if (!vouchers.length) return vouchers;
  const entries = await db
    .select()
    .from(settlementEntries)
    .where(eq(settlementEntries.firmId, firmId));
  const deltas = await db
    .select()
    .from(settlementAllocations)
    .where(
      and(
        eq(settlementAllocations.firmId, firmId),
        or(
          inArray(
            settlementAllocations.voucherId,
            vouchers.map((v) => v.id),
          ),
          inArray(
            settlementAllocations.billId,
            vouchers.map((v) => v.id),
          ),
        ),
      ),
    );
  const kinds = new Map(entries.map((e) => [e.voucherId, e.kind]));
  const sources = new Map(
    entries.map((e) => [e.voucherId, e.sourceVoucherId ?? undefined]),
  );
  const locked = new Set([
    ...entries.flatMap((e) =>
      e.sourceVoucherId ? [e.voucherId, e.sourceVoucherId] : [e.voucherId],
    ),
    ...deltas.flatMap((a) => (a.billId ? [a.billId] : [])),
  ]);
  return vouchers.map((v) => ({
    ...v,
    settlementKind: kinds.get(v.id),
    settlementSourceVoucherId: sources.get(v.id),
    settlementLocked: locked.has(v.id),
    settlementAllocations: deltas
      .filter((a) => a.voucherId === v.id)
      .map((a) => ({
        voucherId: a.openingBillId
          ? importedOpeningBillId(a.openingBillId)
          : (a.billId ?? `opening:${a.openingPartyId}`),
        amount: a.amount,
      })),
  }));
}

export async function postSettlement(
  tx: SettlementTx,
  actor: SettlementActor,
  input: Omit<
    typeof settlementEntries.$inferInsert,
    | "id"
    | "firmId"
    | "voucherId"
    | "userId"
    | "userName"
    | "version"
    | "createdAt"
  >,
  lines: JournalLine[],
  allocations: Allocation[] = [],
): Promise<SettlementRecord> {
  const snap = await loadBooks(
    tx,
    actor.firmId,
    { id: actor.userId, name: actor.userName },
    {
      parties: input.partyId ? [input.partyId] : [],
    },
  );
  const journal = createJournal(snap.books, {
    date: input.date,
    bookScope: input.bookScope,
    lines,
    narration: input.reason,
  });
  if (input.partyId) journal.partyId = input.partyId;
  const saved = await saveChanges(
    tx,
    actor.firmId,
    { id: actor.userId, name: actor.userName },
    snap,
  );
  const id = uuidv7(),
    voucherId = saved.idOf(journal.id);
  const [entry] = await tx
    .insert(settlementEntries)
    .values({
      ...input,
      id,
      firmId: actor.firmId,
      voucherId,
      userId: actor.userId,
      userName: actor.userName,
    })
    .returning();
  if (allocations.length)
    await tx.insert(settlementAllocations).values(
      allocations.map((a) => ({
        id: uuidv7(),
        firmId: actor.firmId,
        entryId: id,
        voucherId,
        billId: isOpeningBillId(a.voucherId) ? null : a.voucherId,
        openingPartyId: a.voucherId.startsWith("opening:")
          ? a.voucherId.slice(8)
          : null,
        openingBillId: a.voucherId.startsWith("opening-bill:")
          ? a.voucherId.slice("opening-bill:".length)
          : null,
        amount: a.amount,
      })),
    );
  return record(required(entry, "The settlement was not saved."));
}
