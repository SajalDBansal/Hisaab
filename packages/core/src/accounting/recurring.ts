/**
 * Recurring entries and approvals (doc 37, T03 and T06).
 *
 * A recurring schedule keeps a template of a voucher (everything but the date)
 * and when it comes due a **draft** is made for the owner to review; nothing
 * posts by itself. Occurrence n is worked out from the start date (never from
 * the previous one), so a monthly schedule started on the 31st lands on the
 * last day of shorter months and comes back to the 31st.
 *
 * Approvals: receipts, payments, contra, expenses and journals can each be set
 * to need approval. Then a member without the "approve entries" right sends the
 * entry for approval instead of posting it; the owner (or a role with that
 * right) approves it, and only then is it numbered and posted.
 */
import { addDays, formatDate } from "../dates";
import type { ISODate, Voucher, VoucherType } from "../types";
import { roleFlag } from "../roles";

export const RECURRING_TYPES = [
  "sale",
  "purchase",
  "receipt",
  "payment",
  "expense",
  "journal",
  "contra",
] as const satisfies readonly VoucherType[];
export type RecurringType = (typeof RECURRING_TYPES)[number];
export const isRecurringType = (type: string): type is RecurringType =>
  (RECURRING_TYPES as readonly string[]).includes(type);

export const RECURRING_FREQUENCIES = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

/** A schedule as the rules need it. */
export interface RecurringPlan {
  frequency: RecurringFrequency;
  /** Every `interval` days/weeks/months/quarters/years (1-99). */
  interval: number;
  startDate: ISODate;
  /** Last date an entry may fall on (inclusive). */
  endDate?: ISODate | null;
  /** How many entries in all (made or skipped). */
  maxCount?: number | null;
}

const MONTHS: Partial<Record<RecurringFrequency, number>> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

function lastDay(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The date of occurrence `n` (0 = the start date). */
export function occurrenceDate(plan: RecurringPlan, n: number): ISODate {
  const step = n * plan.interval;
  if (plan.frequency === "daily") return addDays(plan.startDate, step);
  if (plan.frequency === "weekly") return addDays(plan.startDate, step * 7);
  const [y, m, d] = plan.startDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const months = m - 1 + step * MONTHS[plan.frequency]!;
  const year = y + Math.floor(months / 12);
  const month = ((months % 12) + 12) % 12;
  const day = Math.min(d, lastDay(year, month));
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The next date after `count` occurrences, or null when the schedule has ended. */
export function nextOccurrence(
  plan: RecurringPlan,
  count: number,
): ISODate | null {
  if (
    plan.maxCount !== null &&
    plan.maxCount !== undefined &&
    count >= plan.maxCount
  )
    return null;
  const date = occurrenceDate(plan, count);
  return plan.endDate && date > plan.endDate ? null : date;
}

/** What to do with one due occurrence. */
export interface RecurringRun {
  n: number;
  date: ISODate;
  /** "skip" when the books are closed for that date: no draft, and the owner is told. */
  action: "draft" | "skip";
}

/**
 * The occurrences due on or before `asOf`, starting after `count` done, at most
 * `max` per run (a long-stopped schedule catches up over a few runs).
 */
export function dueRuns(
  plan: RecurringPlan,
  count: number,
  asOf: ISODate,
  closedThrough?: ISODate | null,
  max = 31,
): RecurringRun[] {
  const out: RecurringRun[] = [];
  for (let n = count; out.length < max; n++) {
    const date = nextOccurrence(plan, n);
    if (!date || date > asOf) break;
    out.push({
      n,
      date,
      action: closedThrough && date <= closedThrough ? "skip" : "draft",
    });
  }
  return out;
}

/** A schedule's problem in plain words, or null. */
export function recurringProblem(plan: RecurringPlan): string | null {
  if (
    !Number.isInteger(plan.interval) ||
    plan.interval < 1 ||
    plan.interval > 99
  )
    return "Repeat every 1 to 99 periods.";
  if (plan.endDate && plan.endDate < plan.startDate)
    return "The end date is before the first date.";
  if (
    plan.maxCount !== null &&
    plan.maxCount !== undefined &&
    (plan.maxCount < 1 || plan.maxCount > 1000)
  )
    return "Make between 1 and 1000 entries.";
  return null;
}

const UNIT: Record<RecurringFrequency, [string, string]> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
  quarterly: ["quarter", "quarters"],
  yearly: ["year", "years"],
};

/** "Every month", "Every 2 weeks", with the end when there is one. */
export function describeRecurring(plan: RecurringPlan): string {
  const [one, many] = UNIT[plan.frequency];
  const every =
    plan.interval === 1 ? `Every ${one}` : `Every ${plan.interval} ${many}`;
  if (plan.endDate) return `${every} until ${formatDate(plan.endDate)}`;
  if (plan.maxCount) return `${every}, ${plan.maxCount} times`;
  return every;
}

/** Fields that never carry over from a voucher into a recurring template. */
export type RecurringTemplate = Record<string, unknown>;

const strip = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as RecurringTemplate;

/**
 * The voucher as the input it was made from, without its date: what a
 * recurring schedule repeats. Bills settled, money received with the bill and
 * order links are not repeated (each new entry stands on its own).
 */
export function recurringTemplate(v: Voucher): RecurringTemplate {
  if (!isRecurringType(v.type))
    throw new Error(
      "Only sales, purchases, receipts, payments, expenses, journals and contra entries can repeat.",
    );
  if (v.status !== "posted")
    throw new Error("Only a saved, not cancelled, entry can repeat.");
  switch (v.type) {
    case "sale":
    case "purchase":
      return strip({
        bookScope: v.type === "purchase" ? v.bookScope : undefined,
        partyId: v.partyId,
        lines: (v.lines ?? []).map((l) =>
          strip({
            itemId: l.itemId,
            qty: l.qty,
            rate: l.rate,
            per: l.per,
            discountPercent: l.discountPercent,
            discountAmount: l.discountAmount,
            gstRate: l.gstRate,
          }),
        ),
        charges: (v.charges ?? []).map((c) =>
          strip({
            name: c.name,
            amount: c.amount,
            gstRate: c.gstRate,
            headId: (c as { headId?: string }).headId,
          }),
        ),
        billDiscount: v.billDiscount
          ? v.billDiscount.percent
            ? { percent: v.billDiscount.percent }
            : { amount: v.billDiscount.amount }
          : undefined,
        narration: v.narration,
        customFields: v.customFields,
      });
    case "receipt":
    case "payment":
      return strip({
        bookScope: v.bookScope,
        partyId: v.partyId,
        // Money that moved; any TDS kept back is repeated as it was.
        amount: v.amount,
        mode: v.mode,
        ledgerId: v.ledgerId,
        reference: v.reference,
        allocations: [],
        tds: v.tds,
        narration: v.narration,
      });
    case "expense": {
      const charge = v.charges?.[0];
      return strip({
        bookScope: v.bookScope,
        expenseHead: v.expenseHead,
        amount: v.amount,
        mode: v.mode,
        ledgerId: v.ledgerId,
        narration: v.narration,
        gst:
          v.partyId && charge?.gstRate
            ? {
                partyId: v.partyId,
                rate: charge.gstRate,
                taxable: charge.amount,
              }
            : undefined,
      });
    }
    case "journal":
      return strip({
        bookScope: v.bookScope,
        lines: (v.journalLines ?? []).map((l) => ({
          account: l.account,
          name: l.name,
          debit: l.debit,
          credit: l.credit,
        })),
        narration: v.narration,
      });
    case "contra":
      return strip({
        bookScope: v.bookScope,
        fromLedgerId: v.ledgerId,
        toLedgerId: v.toLedgerId,
        amount: v.amount,
        reference: v.reference,
        narration: v.narration,
      });
  }
}

// ---------------------------------------------------------------------------
// Approvals (T06)
// ---------------------------------------------------------------------------

/** The only types that can wait for approval; sales and purchases never do. */
export const APPROVAL_TYPES = [
  "receipt",
  "payment",
  "contra",
  "expense",
  "journal",
] as const satisfies readonly VoucherType[];
export type ApprovalType = (typeof APPROVAL_TYPES)[number];
export const isApprovalType = (type: string): type is ApprovalType =>
  (APPROVAL_TYPES as readonly string[]).includes(type);

/** May this role approve entries (and post approval types directly)? */
export const canApprove = (role: string | null | undefined) =>
  !!roleFlag(role, "approveEntries");

/** Does this role's new entry of this type wait for approval in this firm? */
export function needsApproval(
  type: VoucherType,
  approvalTypes: readonly string[],
  role: string | null | undefined,
): boolean {
  return (
    isApprovalType(type) && approvalTypes.includes(type) && !canApprove(role)
  );
}

/** Status of an entry that is not (yet) a posted voucher. */
export type PendingEntryStatus =
  "draft" | "submitted" | "rejected" | "posted" | "discarded";

/** The bell's notices about entries to review, for one person. */
export function entryNotices(input: {
  drafts: number;
  submitted: number;
  rejected: number;
  /** Newest change among them, so a read notice comes back when something new arrives. */
  latest: string;
  skipped?: { scheduleId: string; name: string; date: ISODate }[];
  today: ISODate;
}) {
  const out: {
    id: string;
    kind: "entries";
    title: string;
    body: string;
    date: ISODate;
    tone: "give" | "warn" | "ink";
    link: { screen: "entries" };
  }[] = [];
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  if (input.drafts)
    out.push({
      id: `entries:drafts:${input.drafts}:${input.latest}`,
      kind: "entries",
      title: `${plural(input.drafts, "recurring entry", "recurring entries")} to review`,
      body: "Drafts made from your schedules. Check and save them to post.",
      date: input.today,
      tone: "ink",
      link: { screen: "entries" },
    });
  if (input.submitted)
    out.push({
      id: `entries:submitted:${input.submitted}:${input.latest}`,
      kind: "entries",
      title: `${plural(input.submitted, "entry waits", "entries wait")} for approval`,
      body: "Approve to post, or send back with a reason.",
      date: input.today,
      tone: "warn",
      link: { screen: "entries" },
    });
  if (input.rejected)
    out.push({
      id: `entries:rejected:${input.rejected}:${input.latest}`,
      kind: "entries",
      title: `${plural(input.rejected, "entry was", "entries were")} sent back`,
      body: "Fix and send again, or discard.",
      date: input.today,
      tone: "give",
      link: { screen: "entries" },
    });
  for (const skip of input.skipped ?? [])
    out.push({
      id: `entries:skipped:${skip.scheduleId}:${skip.date}`,
      kind: "entries",
      title: `${skip.name}: ${formatDate(skip.date)} skipped`,
      body: "The books are closed for that date, so no draft was made.",
      date: input.today,
      tone: "warn",
      link: { screen: "entries" },
    });
  return out;
}
