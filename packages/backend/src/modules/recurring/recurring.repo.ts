import {
  calcInvoice,
  dueRuns,
  nextOccurrence,
  today as businessDate,
  type RecurringFrequency,
  type RecurringPlan,
} from "@repo/core";
import type {
  PendingEntry,
  RecurringSchedule,
  RecurringType,
} from "@repo/contracts";
import { and, asc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { schema, type Db } from "../../db/client";

// Recurring entries and approvals (doc 37, T03 and T06): rows, the approval
// setting, and the scheduled run the worker does.

type Reader = Pick<Db, "select">;
export type ScheduleRow = typeof schema.recurringSchedules.$inferSelect;
export type EntryRow = typeof schema.pendingEntries.$inferSelect;
export type EntryEvent = PendingEntry["history"][number];

export const planOf = (row: {
  frequency: RecurringFrequency;
  interval: number;
  startDate: string;
  endDate?: string | null;
  maxCount?: number | null;
}): RecurringPlan => ({
  frequency: row.frequency,
  interval: row.interval,
  startDate: row.startDate,
  endDate: row.endDate ?? null,
  maxCount: row.maxCount ?? null,
});

const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** About how much the entry is, for lists (posting works out the exact total). */
export function entryAmount(type: string, input: Record<string, unknown>) {
  if (type === "sale" || type === "purchase") {
    try {
      return calcInvoice({
        lines: (input.lines ?? []) as Parameters<
          typeof calcInvoice
        >[0]["lines"],
        charges: (input.charges ?? []) as Parameters<
          typeof calcInvoice
        >[0]["charges"],
        interState: false,
      }).totalBeforeRound;
    } catch {
      return 0;
    }
  }
  if (type === "journal")
    return ((input.lines ?? []) as { debit?: unknown }[]).reduce(
      (sum, line) => sum + num(line.debit),
      0,
    );
  return num(input.amount);
}

export const entryPartyId = (input: Record<string, unknown>) => {
  const id =
    typeof input.partyId === "string"
      ? input.partyId
      : typeof (input.gst as { partyId?: unknown } | undefined)?.partyId ===
          "string"
        ? (input.gst as { partyId: string }).partyId
        : null;
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
};

async function partyNames(db: Reader, firmId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, string>();
  const rows = await db
    .select({ id: schema.parties.id, name: schema.parties.name })
    .from(schema.parties)
    .where(
      and(
        eq(schema.parties.firmId, firmId),
        inArray(schema.parties.id, unique),
      ),
    );
  return new Map(rows.map((row) => [row.id, row.name]));
}

export async function scheduleViews(
  db: Reader,
  firmId: string,
  rows: ScheduleRow[],
): Promise<RecurringSchedule[]> {
  const names = await partyNames(
    db,
    firmId,
    rows.flatMap((row) => {
      const id = entryPartyId(row.template as Record<string, unknown>);
      return id ? [id] : [];
    }),
  );
  return rows.map((row) => {
    const template = row.template as Record<string, unknown>;
    const partyId = entryPartyId(template);
    return {
      id: row.id,
      name: row.name,
      voucherType: row.voucherType as RecurringType,
      template,
      frequency: row.frequency,
      interval: row.interval,
      startDate: row.startDate,
      endDate: row.endDate,
      maxCount: row.maxCount,
      generatedCount: row.generatedCount,
      nextDate: row.nextDate,
      active: row.active,
      lastSkippedOn: row.lastSkippedOn,
      partyName: partyId ? names.get(partyId) : undefined,
      amount: entryAmount(row.voucherType, template),
      sourceVoucherId: row.sourceVoucherId,
      createdByName: row.createdByName,
      createdAt: row.createdAt.toISOString(),
      version: row.version,
    };
  });
}

export async function entryViews(
  db: Reader,
  firmId: string,
  rows: EntryRow[],
): Promise<PendingEntry[]> {
  const names = await partyNames(
    db,
    firmId,
    rows.flatMap((row) => (row.partyId ? [row.partyId] : [])),
  );
  const scheduleIds = [
    ...new Set(rows.flatMap((row) => (row.scheduleId ? [row.scheduleId] : []))),
  ];
  const schedules = new Map<string, string>(
    scheduleIds.length
      ? (
          await db
            .select({
              id: schema.recurringSchedules.id,
              name: schema.recurringSchedules.name,
            })
            .from(schema.recurringSchedules)
            .where(
              and(
                eq(schema.recurringSchedules.firmId, firmId),
                inArray(schema.recurringSchedules.id, scheduleIds),
              ),
            )
        ).map((row) => [row.id, row.name] as const)
      : [],
  );
  return rows.map((row) => ({
    id: row.id,
    voucherType: row.voucherType as RecurringType,
    status: row.status,
    source: row.source,
    date: row.date,
    partyId: row.partyId,
    partyName: row.partyId ? names.get(row.partyId) : undefined,
    amount: row.amount,
    input: row.input as Record<string, unknown>,
    scheduleId: row.scheduleId,
    scheduleName: row.scheduleId ? schedules.get(row.scheduleId) : undefined,
    note: row.note,
    createdByName: row.createdByName,
    submittedById: row.submittedBy,
    submittedByName: row.submittedByName,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reviewedByName: row.reviewedByName,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    rejectReason: row.rejectReason,
    voucherId: row.voucherId,
    history: row.history as EntryEvent[],
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  }));
}

/** Entry types that need approval in this firm, and the setting's version. */
export async function loadApprovalControls(db: Reader, firmId: string) {
  const [row] = await db
    .select()
    .from(schema.approvalControls)
    .where(eq(schema.approvalControls.firmId, firmId));
  return { types: row?.types ?? [], version: row?.version ?? 0 };
}

// ---------------------------------------------------------------------------
// The scheduled run
// ---------------------------------------------------------------------------

export interface RecurringRunResult {
  schedules: number;
  drafts: number;
  skipped: number;
  firms: string[];
}

/**
 * Make the drafts that are due (on or before today, India time). Each schedule
 * is handled in its own transaction holding its row (`for update skip locked`,
 * so concurrent workers never share one); the draft for a date is unique per
 * schedule and the next date moves in the same transaction, so a retry or a
 * second worker never makes a second draft. Dates in closed books are skipped
 * (no draft) and the owner is told.
 */
export async function runRecurring(
  db: Db,
  now = new Date(),
): Promise<RecurringRunResult> {
  const asOf = businessDate(now);
  const result: RecurringRunResult = {
    schedules: 0,
    drafts: 0,
    skipped: 0,
    firms: [],
  };
  const firms = new Set<string>();
  let after = "";
  for (;;) {
    const due = await db
      .select({ id: schema.recurringSchedules.id })
      .from(schema.recurringSchedules)
      .where(
        and(
          eq(schema.recurringSchedules.active, true),
          isNotNull(schema.recurringSchedules.nextDate),
          lte(schema.recurringSchedules.nextDate, asOf),
          after ? sql`${schema.recurringSchedules.id} > ${after}` : undefined,
        ),
      )
      .orderBy(asc(schema.recurringSchedules.id))
      .limit(100);
    if (!due.length) break;
    after = due[due.length - 1]?.id ?? after;
    for (const { id } of due) {
      const made = await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.recurringSchedules)
          .where(eq(schema.recurringSchedules.id, id))
          .for("update", { skipLocked: true });
        if (!row || !row.active || !row.nextDate || row.nextDate > asOf)
          return null;
        const [control] = await tx
          .select({ closedThrough: schema.bookControls.closedThrough })
          .from(schema.bookControls)
          .where(eq(schema.bookControls.firmId, row.firmId));
        const plan = planOf(row);
        const runs = dueRuns(
          plan,
          row.generatedCount,
          asOf,
          control?.closedThrough,
        );
        if (!runs.length) return null;
        let drafts = 0;
        let skipped = 0;
        let lastSkippedOn = row.lastSkippedOn;
        const template = row.template as Record<string, unknown>;
        for (const run of runs) {
          if (run.action === "skip") {
            skipped += 1;
            lastSkippedOn = run.date;
            continue;
          }
          const input = { ...template, date: run.date };
          const at = new Date().toISOString();
          const inserted = await tx
            .insert(schema.pendingEntries)
            .values({
              id: uuidv7(),
              firmId: row.firmId,
              voucherType: row.voucherType,
              status: "draft",
              source: "recurring",
              scheduleId: row.id,
              dueDate: run.date,
              date: run.date,
              partyId: entryPartyId(input),
              amount: entryAmount(row.voucherType, input),
              input,
              createdBy: row.createdBy,
              createdByName: "Recurring schedule",
              history: [
                {
                  action: "made",
                  at,
                  userName: "Recurring schedule",
                  note: row.name,
                },
              ] satisfies EntryEvent[],
            })
            .onConflictDoNothing()
            .returning({ id: schema.pendingEntries.id });
          drafts += inserted.length;
        }
        const count = (runs[runs.length - 1]?.n ?? row.generatedCount - 1) + 1;
        await tx
          .update(schema.recurringSchedules)
          .set({
            generatedCount: count,
            nextDate: nextOccurrence(plan, count),
            lastSkippedOn,
            version: sql`${schema.recurringSchedules.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(schema.recurringSchedules.id, row.id));
        return { firmId: row.firmId, drafts, skipped };
      });
      if (!made) continue;
      result.schedules += 1;
      result.drafts += made.drafts;
      result.skipped += made.skipped;
      firms.add(made.firmId);
    }
  }
  result.firms = [...firms];
  return result;
}
