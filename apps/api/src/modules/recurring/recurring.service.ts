import {
  canApprove,
  canVoucher,
  formatDate,
  isRecurringType,
  needsApproval,
  nextOccurrence,
  recurringProblem,
  recurringTemplate,
  roleFlag,
  type VoucherType,
} from "@repo/core";
import {
  ENTRY_INPUTS,
  type EntryActionResult,
  type PendingEntry,
  type PendingEntryList,
  type RecurringFromVoucherInput,
  type RecurringSchedule,
  type RecurringScheduleInput,
  type RecurringScheduleUpdate,
  type RecurringType,
  type Voucher,
} from "@repo/contracts";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { assertOpenPeriod } from "@repo/backend/lib/book-period";
import { withFirmWrite } from "@repo/backend/lib/firm-write";
import { notFound } from "@repo/backend/modules/masters/shared";
import {
  entryAmount,
  entryPartyId,
  entryViews,
  loadApprovalControls,
  planOf,
  scheduleViews,
  type EntryEvent,
  type EntryRow,
} from "@repo/backend/modules/recurring/recurring.repo";
import {
  requireRight,
  vouchersService,
  type Ctx,
} from "../vouchers/vouchers.service";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const { recurringSchedules: schedules, pendingEntries: entries } = schema;

/** Fields a repeated or pending entry never carries: each stands on its own. */
const NOT_REPEATED = ["paidNow", "creditOverrideId", "sourceId", "date"];

/** Check an entry's input against its type's own create schema. */
export function parseEntry(
  type: RecurringType,
  input: Record<string, unknown>,
) {
  const parsed = ENTRY_INPUTS[type].safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AppError(
      "INVALID_INPUT",
      issue?.message ?? "Please check the entry.",
      400,
      issue?.path.length
        ? { [issue.path.join(".")]: issue.message }
        : undefined,
    );
  }
  return parsed.data as Record<string, unknown> & { date: string };
}

function cleanTemplate(
  type: RecurringType,
  template: Record<string, unknown>,
  date: string,
) {
  const parsed = parseEntry(type, { ...template, date });
  const out: Record<string, unknown> = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => !NOT_REPEATED.includes(key)),
  );
  if (type === "receipt" || type === "payment") out.allocations = [];
  return out;
}

const POSTERS: Record<
  RecurringType,
  (db: Db, ctx: Ctx, input: never) => Promise<Voucher>
> = {
  sale: vouchersService.sale,
  purchase: vouchersService.purchase,
  receipt: vouchersService.receipt,
  payment: vouchersService.payment,
  expense: vouchersService.expense,
  journal: vouchersService.journal,
  contra: vouchersService.contra,
};

function planCheck(plan: Parameters<typeof recurringProblem>[0]) {
  const problem = recurringProblem(plan);
  if (problem) throw new AppError("INVALID_INPUT", problem, 400);
}

const conflict = (what: string) =>
  new AppError(
    "EDITED_ELSEWHERE",
    `Someone changed this ${what}. Reload and try again.`,
    409,
  );

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

function canSchedule(
  ctx: Ctx,
  row: { voucherType: string; createdBy: string },
) {
  return (
    isRecurringType(row.voucherType) &&
    canVoucher(ctx.role, row.voucherType, "create") &&
    (!roleFlag(ctx.role, "ownRecordsOnly") || row.createdBy === ctx.id)
  );
}

async function scheduleRow(
  db: Pick<Db, "select">,
  ctx: Ctx,
  id: string,
  lock = false,
) {
  const query = db
    .select()
    .from(schedules)
    .where(and(eq(schedules.firmId, ctx.firmId), eq(schedules.id, id)));
  const [row] = lock ? await query.for("update") : await query;
  if (!row || !canSchedule(ctx, row)) throw notFound("schedule");
  return row;
}

async function oneSchedule(db: Pick<Db, "select">, ctx: Ctx, id: string) {
  const row = await scheduleRow(db, ctx, id);
  const [view] = await scheduleViews(db, ctx.firmId, [row]);
  if (!view) throw notFound("schedule");
  return view;
}

export const recurringService = {
  async list(db: Db, ctx: Ctx): Promise<RecurringSchedule[]> {
    const rows = await db
      .select()
      .from(schedules)
      .where(eq(schedules.firmId, ctx.firmId))
      .orderBy(desc(schedules.createdAt))
      .limit(500);
    return scheduleViews(
      db,
      ctx.firmId,
      rows.filter((row) => canSchedule(ctx, row)),
    );
  },

  async get(db: Db, ctx: Ctx, id: string) {
    return oneSchedule(db, ctx, id);
  },

  async create(
    db: Db,
    ctx: Ctx,
    input: RecurringScheduleInput,
    sourceVoucherId: string | null = null,
  ): Promise<RecurringSchedule> {
    requireRight(ctx.role, input.voucherType, "create");
    const plan = planOf(input);
    planCheck(plan);
    const template = cleanTemplate(
      input.voucherType,
      input.template,
      input.startDate,
    );
    const id = uuidv7();
    await db.insert(schedules).values({
      id,
      firmId: ctx.firmId,
      name: input.name,
      voucherType: input.voucherType,
      template,
      frequency: input.frequency,
      interval: input.interval,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      maxCount: input.maxCount ?? null,
      generatedCount: 0,
      nextDate: nextOccurrence(plan, 0),
      active: input.active,
      sourceVoucherId,
      createdBy: ctx.id,
      createdByName: ctx.name,
    });
    return oneSchedule(db, ctx, id);
  },

  /** Repeat a saved entry: its party, items or accounts and amounts. */
  async fromVoucher(
    db: Db,
    ctx: Ctx,
    voucherId: string,
    input: RecurringFromVoucherInput,
  ) {
    const { voucher } = await vouchersService.get(db, ctx.firmId, voucherId);
    if (!isRecurringType(voucher.type))
      throw new AppError(
        "INVALID_INPUT",
        "Only sales, purchases, receipts, payments, expenses, journals and contra entries can repeat.",
        400,
      );
    let template: Record<string, unknown>;
    try {
      template = recurringTemplate(
        voucher as unknown as Parameters<typeof recurringTemplate>[0],
      );
    } catch (error) {
      throw new AppError("INVALID_INPUT", (error as Error).message, 400);
    }
    return recurringService.create(
      db,
      ctx,
      { ...input, voucherType: voucher.type, template },
      voucher.id,
    );
  },

  async update(
    db: Db,
    ctx: Ctx,
    id: string,
    version: number,
    input: RecurringScheduleUpdate,
  ) {
    return withFirmWrite(db, ctx.firmId, async (tx) => {
      const row = await scheduleRow(tx, ctx, id, true);
      if (row.version !== version) throw conflict("schedule");
      const type = row.voucherType as RecurringType;
      const plan = planOf(input);
      planCheck(plan);
      const template = input.template
        ? cleanTemplate(type, input.template, input.startDate)
        : (row.template as Record<string, unknown>);
      // A new first date or repeat starts counting again; otherwise only the next date moves.
      const restarted =
        input.startDate !== row.startDate ||
        input.frequency !== row.frequency ||
        input.interval !== row.interval;
      const generatedCount = restarted ? 0 : row.generatedCount;
      let nextDate = nextOccurrence(plan, generatedCount);
      if (input.nextDate !== undefined && input.nextDate !== row.nextDate) {
        if (input.nextDate && input.nextDate < input.startDate)
          throw new AppError(
            "INVALID_INPUT",
            "The next date can't be before the first date.",
            400,
          );
        nextDate = input.nextDate;
      }
      await tx
        .update(schedules)
        .set({
          name: input.name,
          template,
          frequency: input.frequency,
          interval: input.interval,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          maxCount: input.maxCount ?? null,
          generatedCount,
          nextDate,
          active: input.active,
          version: sql`${schedules.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(schedules.id, row.id));
      return oneSchedule(tx, ctx, id);
    });
  },

  async remove(db: Db, ctx: Ctx, id: string, version: number) {
    await withFirmWrite(db, ctx.firmId, async (tx) => {
      const row = await scheduleRow(tx, ctx, id, true);
      if (row.version !== version) throw conflict("schedule");
      // Drafts already made stay for review; they just lose the link.
      await tx.delete(schedules).where(eq(schedules.id, row.id));
    });
  },
};

// ---------------------------------------------------------------------------
// Pending entries: recurring drafts and entries waiting for approval
// ---------------------------------------------------------------------------

const event = (
  ctx: Ctx,
  action: EntryEvent["action"],
  note?: string,
): EntryEvent => ({
  action,
  at: new Date().toISOString(),
  userName: ctx.name,
  ...(note ? { note } : {}),
});

/** Who sees an entry: the type's create right, plus the approval rules. */
function canSee(ctx: Ctx, row: EntryRow) {
  if (!isRecurringType(row.voucherType)) return false;
  if (!canVoucher(ctx.role, row.voucherType, "create")) return false;
  const own = row.createdBy === ctx.id || row.submittedBy === ctx.id;
  if (roleFlag(ctx.role, "ownRecordsOnly") && !own) return false;
  if (row.status === "draft") return true;
  if (row.status === "submitted" || row.status === "rejected")
    return own || canApprove(ctx.role);
  return own || canApprove(ctx.role);
}

async function entryRow(
  db: Pick<Db, "select">,
  ctx: Ctx,
  id: string,
  lock = false,
) {
  const query = db
    .select()
    .from(entries)
    .where(and(eq(entries.firmId, ctx.firmId), eq(entries.id, id)));
  const [row] = lock ? await query.for("update") : await query;
  if (!row || !canSee(ctx, row)) throw notFound("entry");
  return row;
}

async function oneEntry(db: Pick<Db, "select">, ctx: Ctx, id: string) {
  const row = await entryRow(db, ctx, id);
  const [view] = await entryViews(db, ctx.firmId, [row]);
  if (!view) throw notFound("entry");
  return view;
}

function requireStatus(row: EntryRow, ...allowed: EntryRow["status"][]) {
  if (!allowed.includes(row.status))
    throw new AppError(
      "ENTRY_STATE",
      row.status === "posted"
        ? "This entry is already in the books."
        : row.status === "discarded"
          ? "This entry was discarded."
          : row.status === "submitted"
            ? "This entry is waiting for approval."
            : "This entry can't do that now.",
      409,
    );
}

function inputFields(type: RecurringType, input: Record<string, unknown>) {
  const parsed = parseEntry(type, input);
  return {
    input: parsed,
    date: parsed.date,
    partyId: entryPartyId(parsed),
    amount: entryAmount(type, parsed),
  };
}

/** Post the entry as a normal voucher (numbered now) and mark it posted. */
async function postEntry(
  tx: Tx,
  ctx: Ctx,
  row: EntryRow,
  input: Record<string, unknown> & { date: string },
  note: string,
  history: EntryEvent[],
) {
  const type = row.voucherType as RecurringType;
  requireRight(ctx.role, type, "create");
  const voucher = await POSTERS[type](
    tx as unknown as Db,
    { ...ctx, idem: undefined, approved: true, auditNote: note },
    input as never,
  );
  await tx
    .update(entries)
    .set({
      status: "posted",
      input,
      date: input.date,
      partyId: entryPartyId(input),
      amount: voucher.amount,
      voucherId: voucher.id,
      reviewedBy: ctx.id,
      reviewedByName: ctx.name,
      reviewedAt: new Date(),
      history,
      version: sql`${entries.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(entries.id, row.id));
  return voucher;
}

const history = (row: EntryRow) => (row.history as EntryEvent[]) ?? [];

export const entriesService = {
  async list(db: Db, ctx: Ctx): Promise<PendingEntryList> {
    const rows = await db
      .select()
      .from(entries)
      .where(
        and(
          eq(entries.firmId, ctx.firmId),
          inArray(entries.status, ["draft", "submitted", "rejected"]),
        ),
      )
      .orderBy(desc(entries.date), desc(entries.id))
      .limit(500);
    const visible = await entryViews(
      db,
      ctx.firmId,
      rows.filter((row) => canSee(ctx, row)),
    );
    const count = (status: PendingEntry["status"]) =>
      visible.filter((e) => e.status === status).length;
    return {
      entries: visible,
      counts: {
        drafts: count("draft"),
        submitted: count("submitted"),
        rejected: count("rejected"),
      },
      canApprove: canApprove(ctx.role),
    };
  },

  get: (db: Db, ctx: Ctx, id: string) => oneEntry(db, ctx, id),

  /** A new entry sent for approval instead of posting it. */
  async submit(
    db: Db,
    ctx: Ctx,
    type: RecurringType,
    input: Record<string, unknown>,
  ): Promise<PendingEntry> {
    requireRight(ctx.role, type, "create");
    const fields = inputFields(type, input);
    return withFirmWrite(db, ctx.firmId, async (tx) => {
      const { types } = await loadApprovalControls(tx, ctx.firmId);
      if (!needsApproval(type, types, ctx.role))
        throw new AppError(
          "APPROVAL_NOT_NEEDED",
          "This entry doesn't need approval. Save it directly.",
          409,
        );
      await assertOpenPeriod(tx, ctx.firmId, [fields.date]);
      const id = uuidv7();
      const now = new Date();
      await tx.insert(entries).values({
        id,
        firmId: ctx.firmId,
        voucherType: type,
        status: "submitted",
        source: "approval",
        ...fields,
        createdBy: ctx.id,
        createdByName: ctx.name,
        submittedBy: ctx.id,
        submittedByName: ctx.name,
        submittedAt: now,
        history: [event(ctx, "submitted")],
      });
      return oneEntry(tx, ctx, id);
    });
  },

  /** Change a draft (or an entry sent back) before saving it. */
  async update(
    db: Db,
    ctx: Ctx,
    id: string,
    version: number,
    input: Record<string, unknown>,
  ) {
    return withFirmWrite(db, ctx.firmId, async (tx) => {
      const row = await entryRow(tx, ctx, id, true);
      if (row.version !== version) throw conflict("entry");
      requireStatus(row, "draft", "rejected");
      const fields = inputFields(row.voucherType as RecurringType, input);
      await tx
        .update(entries)
        .set({
          ...fields,
          history: [...history(row), event(ctx, "edited")],
          version: sql`${entries.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(entries.id, row.id));
      return oneEntry(tx, ctx, id);
    });
  },

  /**
   * Save a draft (or an entry sent back): it posts, or, when this person's
   * entries of that type need approval, it is sent for approval.
   */
  async save(
    db: Db,
    ctx: Ctx,
    id: string,
    version: number,
    edited?: Record<string, unknown>,
  ): Promise<EntryActionResult> {
    return withFirmWrite(db, ctx.firmId, async (tx) => {
      const row = await entryRow(tx, ctx, id, true);
      if (row.version !== version) throw conflict("entry");
      requireStatus(row, "draft", "rejected");
      const type = row.voucherType as RecurringType;
      requireRight(ctx.role, type, "create");
      const fields = inputFields(
        type,
        edited ?? (row.input as Record<string, unknown>),
      );
      const { types } = await loadApprovalControls(tx, ctx.firmId);
      if (needsApproval(type as VoucherType, types, ctx.role)) {
        await assertOpenPeriod(tx, ctx.firmId, [fields.date]);
        await tx
          .update(entries)
          .set({
            ...fields,
            status: "submitted",
            submittedBy: ctx.id,
            submittedByName: ctx.name,
            submittedAt: new Date(),
            rejectReason: null,
            history: [...history(row), event(ctx, "submitted")],
            version: sql`${entries.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(entries.id, row.id));
        return { entry: await oneEntry(tx, ctx, id) };
      }
      const voucher = await postEntry(
        tx,
        ctx,
        row,
        fields.input,
        row.source === "recurring"
          ? "Made from a recurring schedule"
          : "Saved from a pending entry",
        [...history(row), event(ctx, "posted")],
      );
      return { entry: await oneEntry(tx, ctx, id), voucher };
    });
  },

  /** Approve an entry waiting for approval: it is numbered and posted now. */
  async approve(
    db: Db,
    ctx: Ctx,
    id: string,
    version: number,
    edited?: Record<string, unknown>,
  ): Promise<EntryActionResult> {
    if (!canApprove(ctx.role))
      throw new AppError(
        "FORBIDDEN",
        "Only the owner or a role that may approve entries can approve.",
        403,
      );
    return withFirmWrite(db, ctx.firmId, async (tx) => {
      const row = await entryRow(tx, ctx, id, true);
      if (row.version !== version) throw conflict("entry");
      requireStatus(row, "submitted");
      const type = row.voucherType as RecurringType;
      const fields = inputFields(
        type,
        edited ?? (row.input as Record<string, unknown>),
      );
      const sent = row.submittedAt
        ? ` on ${formatDate(row.submittedAt.toISOString().slice(0, 10))}`
        : "";
      const voucher = await postEntry(
        tx,
        ctx,
        row,
        fields.input,
        `Sent for approval by ${row.submittedByName ?? "a member"}${sent}; approved by ${ctx.name}`,
        [
          ...history(row),
          event(
            ctx,
            "approved",
            edited ? "Changed before approving" : undefined,
          ),
        ],
      );
      return { entry: await oneEntry(tx, ctx, id), voucher };
    });
  },

  /** Send an entry back to the person who sent it, with the reason. */
  async reject(db: Db, ctx: Ctx, id: string, version: number, reason: string) {
    if (!canApprove(ctx.role))
      throw new AppError(
        "FORBIDDEN",
        "Only the owner or a role that may approve entries can send entries back.",
        403,
      );
    return withFirmWrite(db, ctx.firmId, async (tx) => {
      const row = await entryRow(tx, ctx, id, true);
      if (row.version !== version) throw conflict("entry");
      requireStatus(row, "submitted");
      await tx
        .update(entries)
        .set({
          status: "rejected",
          rejectReason: reason,
          reviewedBy: ctx.id,
          reviewedByName: ctx.name,
          reviewedAt: new Date(),
          history: [...history(row), event(ctx, "rejected", reason)],
          version: sql`${entries.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(entries.id, row.id));
      return oneEntry(tx, ctx, id);
    });
  },

  /** Drop a draft, an entry sent back, or (its sender) one still waiting. */
  async discard(db: Db, ctx: Ctx, id: string, version: number) {
    return withFirmWrite(db, ctx.firmId, async (tx) => {
      const row = await entryRow(tx, ctx, id, true);
      if (row.version !== version) throw conflict("entry");
      if (row.status === "submitted" && row.submittedBy !== ctx.id)
        throw new AppError(
          "ENTRY_STATE",
          "Approve it or send it back instead.",
          409,
        );
      requireStatus(row, "draft", "rejected", "submitted");
      await tx
        .update(entries)
        .set({
          status: "discarded",
          history: [...history(row), event(ctx, "discarded")],
          version: sql`${entries.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(entries.id, row.id));
      return oneEntry(tx, ctx, id);
    });
  },

  /** Counts and skipped dates for the bell. */
  async notices(db: Db, ctx: Ctx) {
    const list = await entriesService.list(db, ctx);
    const skipped = (
      await db.select().from(schedules).where(eq(schedules.firmId, ctx.firmId))
    ).flatMap((row) =>
      row.lastSkippedOn && canSchedule(ctx, row)
        ? [{ scheduleId: row.id, name: row.name, date: row.lastSkippedOn }]
        : [],
    );
    const latest = list.entries.reduce(
      (max, e) =>
        [e.createdAt, e.submittedAt ?? "", e.reviewedAt ?? ""].reduce(
          (a, b) => (b > a ? b : a),
          max,
        ),
      "",
    );
    return {
      ...list.counts,
      // Approvers are told about entries waiting; senders about ones sent back.
      submitted: canApprove(ctx.role) ? list.counts.submitted : 0,
      rejected: list.entries.filter(
        (e) => e.status === "rejected" && e.submittedById === ctx.id,
      ).length,
      latest,
      skipped,
    };
  },
};
