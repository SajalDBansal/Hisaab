import * as demo from "@repo/core";
import * as c from "@repo/contracts";
import { z } from "zod";
import type { Client } from "./client";
import { matchVersion } from "./masterServices";

/** Recurring entries (doc 37, T03) and approvals (T06). */
export interface RecurringService {
  schedules(): Promise<c.RecurringSchedule[]>;
  schedule(id: string): Promise<c.RecurringSchedule>;
  createSchedule(input: c.RecurringScheduleInput): Promise<c.RecurringSchedule>;
  fromVoucher(
    voucherId: string,
    input: c.RecurringFromVoucherInput,
  ): Promise<c.RecurringSchedule>;
  updateSchedule(
    id: string,
    input: c.RecurringScheduleUpdate,
    version: number,
  ): Promise<c.RecurringSchedule>;
  removeSchedule(id: string, version: number): Promise<void>;
  entries(): Promise<c.PendingEntryList>;
  entry(id: string): Promise<c.PendingEntry>;
  /** Send a new entry for approval instead of posting it. */
  submit(
    type: c.ApprovalType,
    input: Record<string, unknown>,
  ): Promise<c.PendingEntry>;
  updateEntry(
    id: string,
    input: Record<string, unknown>,
    version: number,
  ): Promise<c.PendingEntry>;
  /** Post a draft, or send it for approval when this person's entries wait. */
  saveEntry(
    id: string,
    version: number,
    input?: Record<string, unknown>,
  ): Promise<c.EntryActionResult>;
  approve(
    id: string,
    version: number,
    input?: Record<string, unknown>,
  ): Promise<c.EntryActionResult>;
  reject(id: string, version: number, reason: string): Promise<c.PendingEntry>;
  discard(id: string, version: number): Promise<c.PendingEntry>;
  approvals(): Promise<c.ApprovalSettingsView>;
  saveApprovals(
    types: c.ApprovalType[],
    version: number,
  ): Promise<c.ApprovalSettingsView>;
}

export function recurringServices({ request }: Client): RecurringService {
  const versioned = (version: number) => matchVersion(version);
  return {
    schedules: () => request("/recurring", z.array(c.RecurringSchedule)),
    schedule: (id) => request(`/recurring/${id}`, c.RecurringSchedule),
    createSchedule: (input) =>
      request("/recurring", c.RecurringSchedule, { body: input }),
    fromVoucher: (voucherId, input) =>
      request(`/recurring/from-voucher/${voucherId}`, c.RecurringSchedule, {
        body: input,
      }),
    updateSchedule: (id, input, version) =>
      request(`/recurring/${id}`, c.RecurringSchedule, {
        method: "PUT",
        body: input,
        headers: versioned(version),
      }),
    removeSchedule: async (id, version) => {
      await request(`/recurring/${id}`, z.object({ ok: z.literal(true) }), {
        method: "DELETE",
        headers: versioned(version),
      });
    },
    entries: () => request("/entries", c.PendingEntryList),
    entry: (id) => request(`/entries/${id}`, c.PendingEntry),
    submit: (voucherType, input) =>
      request("/entries", c.PendingEntry, { body: { voucherType, input } }),
    updateEntry: (id, input, version) =>
      request(`/entries/${id}`, c.PendingEntry, {
        method: "PUT",
        body: { input },
        headers: versioned(version),
      }),
    saveEntry: (id, version, input) =>
      request(`/entries/${id}/save`, c.EntryActionResult, {
        body: input ? { input } : {},
        headers: versioned(version),
      }),
    approve: (id, version, input) =>
      request(`/entries/${id}/approve`, c.EntryActionResult, {
        body: input ? { input } : {},
        headers: versioned(version),
      }),
    reject: (id, version, reason) =>
      request(`/entries/${id}/reject`, c.PendingEntry, {
        body: { reason },
        headers: versioned(version),
      }),
    discard: (id, version) =>
      request(`/entries/${id}/discard`, c.PendingEntry, {
        body: {},
        headers: versioned(version),
      }),
    approvals: () => request("/settings/approvals", c.ApprovalSettingsView),
    saveApprovals: (types, version) =>
      request("/settings/approvals", c.ApprovalSettingsView, {
        method: "PUT",
        body: { types },
        headers: versioned(version),
      }),
  };
}

// ---------------------------------------------------------------------------
// Demo (no server): the same rules on the in-memory books.
// ---------------------------------------------------------------------------

type Schedule = c.RecurringSchedule;
type Entry = c.PendingEntry;

const state = {
  schedules: [] as Schedule[],
  entries: [] as Entry[],
  approvals: { types: [] as c.ApprovalType[], version: 0 },
};
let seq = 0;
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${++seq}`;
const now = () => new Date().toISOString();
const DEMO_USER = "You (owner)";

const POST: Record<c.RecurringType, (input: never) => Promise<demo.Voucher>> = {
  sale: demo.voucherService.createSale,
  purchase: demo.voucherService.createPurchase,
  receipt: demo.voucherService.createReceipt,
  payment: demo.voucherService.createPayment,
  expense: demo.voucherService.createExpense,
  journal: demo.voucherService.createJournal,
  contra: demo.voucherService.createContra,
};

function amountOf(type: string, input: Record<string, unknown>) {
  if (type === "sale" || type === "purchase") {
    try {
      return demo.calcInvoice({
        lines: (input.lines ?? []) as demo.InvoiceLine[],
        charges: (input.charges ?? []) as demo.ExtraCharge[],
        interState: false,
      }).totalBeforeRound;
    } catch {
      return 0;
    }
  }
  if (type === "journal")
    return ((input.lines ?? []) as { debit: number }[]).reduce(
      (s, l) => s + (l.debit || 0),
      0,
    );
  return typeof input.amount === "number" ? input.amount : 0;
}

async function partyName(input: Record<string, unknown>) {
  const id =
    (input.partyId as string | undefined) ??
    (input.gst as { partyId?: string } | undefined)?.partyId;
  if (!id) return undefined;
  const rows = await demo.partyService.list();
  return rows.find((row) => row.party.id === id)?.party.name;
}

function find<T extends { id: string; version: number }>(
  list: T[],
  id: string,
  version?: number,
) {
  const row = list.find((r) => r.id === id);
  if (!row) throw new Error("This entry is no longer here.");
  if (version !== undefined && row.version !== version)
    throw new Error("Someone changed this. Reload and try again.");
  return row;
}

/** What the worker does on the server: make the drafts that are due (no locked books in the demo). */
async function runDue() {
  const asOf = demo.today();
  for (const s of state.schedules) {
    if (!s.active || !s.nextDate || s.nextDate > asOf) continue;
    const runs = demo.dueRuns(s, s.generatedCount, asOf);
    for (const run of runs) {
      if (
        state.entries.some((e) => e.scheduleId === s.id && e.date === run.date)
      )
        continue;
      const input: Record<string, unknown> = { ...s.template, date: run.date };
      state.entries.push({
        id: newId("pe"),
        voucherType: s.voucherType,
        status: "draft",
        source: "recurring",
        date: run.date,
        partyId: (input.partyId as string | undefined) ?? null,
        partyName: s.partyName,
        amount: amountOf(s.voucherType, input),
        input,
        scheduleId: s.id,
        scheduleName: s.name,
        note: null,
        createdByName: "Recurring schedule",
        submittedById: null,
        submittedByName: null,
        submittedAt: null,
        reviewedByName: null,
        reviewedAt: null,
        rejectReason: null,
        voucherId: null,
        history: [
          {
            action: "made",
            at: now(),
            userName: "Recurring schedule",
            note: s.name,
          },
        ],
        createdAt: now(),
        version: 1,
      });
    }
    if (runs.length) {
      s.generatedCount = runs.at(-1)!.n + 1;
      s.nextDate = demo.nextOccurrence(s, s.generatedCount);
      s.version += 1;
    }
  }
}

/**
 * Turning approvals on in the demo (always the owner, whose own entries post
 * directly) adds one sample payment "sent by a staff member", so the approve
 * and send-back steps can be tried.
 */
async function sampleSubmission(type: c.ApprovalType) {
  if (type !== "payment") return;
  if (state.entries.some((e) => e.status === "submitted")) return;
  const supplier = (await demo.partyService.list("supplier"))[0]?.party;
  const cash = (await demo.ledgerService.listCashAndBank()).find(
    (row) => row.ledger.kind === "cash",
  )?.ledger;
  if (!supplier || !cash) return;
  const input = {
    partyId: supplier.id,
    date: demo.today(),
    amount: 125_000,
    mode: "cash",
    ledgerId: cash.id,
    reference: "Sample from the demo",
    allocations: [],
  };
  state.entries.push({
    id: newId("pe"),
    voucherType: "payment",
    status: "submitted",
    source: "approval",
    date: input.date,
    partyId: supplier.id,
    partyName: supplier.name,
    amount: input.amount,
    input,
    scheduleId: null,
    note: null,
    createdByName: "Ravi (demo staff)",
    submittedById: "demo-staff",
    submittedByName: "Ravi (demo staff)",
    submittedAt: now(),
    reviewedByName: null,
    reviewedAt: null,
    rejectReason: null,
    voucherId: null,
    history: [
      { action: "submitted", at: now(), userName: "Ravi (demo staff)" },
    ],
    createdAt: now(),
    version: 1,
  });
}

async function post(entry: Entry, input: Record<string, unknown>) {
  const voucher = await POST[entry.voucherType](input as never);
  entry.status = "posted";
  entry.input = input;
  entry.voucherId = voucher.id;
  entry.amount = voucher.amount;
  entry.reviewedByName = DEMO_USER;
  entry.reviewedAt = now();
  entry.version += 1;
  return voucher as unknown as c.Voucher;
}

async function scheduleOf(
  input: Omit<
    Schedule,
    | "id"
    | "partyName"
    | "amount"
    | "createdAt"
    | "version"
    | "createdByName"
    | "generatedCount"
    | "nextDate"
    | "lastSkippedOn"
    | "sourceVoucherId"
  > & {
    sourceVoucherId?: string | null;
  },
): Promise<Schedule> {
  const problem = demo.recurringProblem(input);
  if (problem) throw new Error(problem);
  const template = { ...input.template };
  delete template.date;
  return {
    ...input,
    template,
    id: newId("rs"),
    generatedCount: 0,
    nextDate: demo.nextOccurrence(input, 0),
    lastSkippedOn: null,
    partyName: await partyName(template),
    amount: amountOf(input.voucherType, template),
    sourceVoucherId: input.sourceVoucherId ?? null,
    createdByName: DEMO_USER,
    createdAt: now(),
    version: 1,
  };
}

const plan = (input: c.RecurringFromVoucherInput) => ({
  name: input.name,
  frequency: input.frequency,
  interval: input.interval ?? 1,
  startDate: input.startDate,
  endDate: input.endDate ?? null,
  maxCount: input.maxCount ?? null,
  active: input.active ?? true,
});

export const demoRecurringService: RecurringService = {
  async schedules() {
    await runDue();
    return structuredClone(state.schedules);
  },
  async schedule(id) {
    return structuredClone(find(state.schedules, id));
  },
  async createSchedule(input) {
    const row = await scheduleOf({
      ...plan(input),
      voucherType: input.voucherType,
      template: input.template,
    });
    state.schedules.unshift(row);
    await runDue();
    return structuredClone(row);
  },
  async fromVoucher(voucherId, input) {
    const { voucher } = await demo.voucherService.get(voucherId);
    const template = demo.recurringTemplate(voucher);
    const row = await scheduleOf({
      ...plan(input),
      voucherType: voucher.type as c.RecurringType,
      template,
      sourceVoucherId: voucher.id,
    });
    state.schedules.unshift(row);
    await runDue();
    return structuredClone(row);
  },
  async updateSchedule(id, input, version) {
    const row = find(state.schedules, id, version);
    const problem = demo.recurringProblem(plan(input));
    if (problem) throw new Error(problem);
    const restarted =
      input.startDate !== row.startDate ||
      input.frequency !== row.frequency ||
      input.interval !== row.interval;
    Object.assign(row, plan(input));
    if (input.template) row.template = input.template;
    if (restarted) row.generatedCount = 0;
    row.nextDate =
      input.nextDate !== undefined && input.nextDate !== row.nextDate
        ? input.nextDate
        : demo.nextOccurrence(row, row.generatedCount);
    row.version += 1;
    await runDue();
    return structuredClone(row);
  },
  async removeSchedule(id, version) {
    find(state.schedules, id, version);
    state.schedules = state.schedules.filter((s) => s.id !== id);
  },
  async entries() {
    await runDue();
    const open = state.entries.filter((e) =>
      ["draft", "submitted", "rejected"].includes(e.status),
    );
    const count = (status: Entry["status"]) =>
      open.filter((e) => e.status === status).length;
    return structuredClone({
      entries: [...open].sort((a, b) => b.date.localeCompare(a.date)),
      counts: {
        drafts: count("draft"),
        submitted: count("submitted"),
        rejected: count("rejected"),
      },
      canApprove: true,
    });
  },
  async entry(id) {
    return structuredClone(find(state.entries, id));
  },
  async submit() {
    throw new Error("Your own entries post directly: you can approve.");
  },
  async updateEntry(id, input, version) {
    const row = find(state.entries, id, version);
    if (row.status !== "draft" && row.status !== "rejected")
      throw new Error("This entry can't be changed now.");
    row.input = input;
    row.date = String(input.date);
    row.amount = amountOf(row.voucherType, input);
    row.history.push({ action: "edited", at: now(), userName: DEMO_USER });
    row.version += 1;
    return structuredClone(row);
  },
  async saveEntry(id, version, input) {
    const row = find(state.entries, id, version);
    if (row.status !== "draft" && row.status !== "rejected")
      throw new Error("This entry can't be saved now.");
    row.history.push({ action: "posted", at: now(), userName: DEMO_USER });
    const voucher = await post(row, input ?? row.input);
    return structuredClone({ entry: row, voucher });
  },
  async approve(id, version, input) {
    const row = find(state.entries, id, version);
    if (row.status !== "submitted")
      throw new Error("This entry isn't waiting for approval.");
    row.history.push({ action: "approved", at: now(), userName: DEMO_USER });
    const voucher = await post(row, input ?? row.input);
    return structuredClone({ entry: row, voucher });
  },
  async reject(id, version, reason) {
    const row = find(state.entries, id, version);
    if (row.status !== "submitted")
      throw new Error("This entry isn't waiting for approval.");
    row.status = "rejected";
    row.rejectReason = reason;
    row.reviewedByName = DEMO_USER;
    row.reviewedAt = now();
    row.history.push({
      action: "rejected",
      at: now(),
      userName: DEMO_USER,
      note: reason,
    });
    row.version += 1;
    return structuredClone(row);
  },
  async discard(id, version) {
    const row = find(state.entries, id, version);
    row.status = "discarded";
    row.history.push({ action: "discarded", at: now(), userName: DEMO_USER });
    row.version += 1;
    return structuredClone(row);
  },
  async approvals() {
    return { ...state.approvals, canApprove: true };
  },
  async saveApprovals(types, version) {
    if (version !== state.approvals.version)
      throw new Error("Someone changed approvals. Reload and try again.");
    const added = types.filter((t) => !state.approvals.types.includes(t));
    state.approvals = { types: [...new Set(types)], version: version + 1 };
    for (const type of added) await sampleSubmission(type);
    return { ...state.approvals, canApprove: true };
  },
};

/** Demo bell notices, worked out like the server's. */
export async function demoEntryNotices() {
  const list = await demoRecurringService.entries();
  return demo.entryNotices({
    ...list.counts,
    latest: list.entries.reduce(
      (max, e) => (e.createdAt > max ? e.createdAt : max),
      "",
    ),
    today: demo.today(),
  });
}
