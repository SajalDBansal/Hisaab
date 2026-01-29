/**
 * Which customers should get a WhatsApp payment reminder today.
 * Pure function: the server runs the same rules on a schedule later.
 */
import { addDays, daysBetween } from "../dates";
import type {
  ID,
  ISODate,
  Paise,
  Party,
  ReminderSettings,
  Voucher,
} from "../types";
import { openBills, collectionBills, type Bill } from "./bills";

export type ReminderReason = "before-due" | "due-today" | "overdue";

export interface ReminderDue {
  partyId: ID;
  partyName: string;
  phone: string;
  /** Total still to receive from this customer. */
  pending: Paise;
  /** Oldest bill's days past due (0 if none overdue). */
  overdueDays: number;
  reason: ReminderReason;
  /** The bill that triggered the reminder. */
  bill: Pick<Bill, "number" | "dueDate" | "pending">;
  lastSent?: ISODate;
}

/** Why one bill needs a reminder today, or null. */
function billReason(
  bill: Bill,
  s: ReminderSettings,
  todayIso: ISODate,
  lastSent?: ISODate,
): ReminderReason | null {
  const daysToDue = daysBetween(todayIso, bill.dueDate);
  if (daysToDue > 0)
    return s.daysBefore > 0 && daysToDue <= s.daysBefore ? "before-due" : null;
  if (daysToDue === 0) return s.onDueDate ? "due-today" : null;
  // Overdue: once if never reminded since it fell due, then every `repeatEvery` days
  if (!lastSent || lastSent < bill.dueDate) return "overdue";
  if (s.repeatEvery > 0 && daysBetween(lastSent, todayIso) >= s.repeatEvery)
    return "overdue";
  return null;
}

const URGENCY: Record<ReminderReason, number> = {
  overdue: 0,
  "due-today": 1,
  "before-due": 2,
};

export function dueReminders(
  parties: Party[],
  vouchers: Voucher[],
  settings: ReminderSettings,
  todayIso: ISODate,
  remindedOn: Record<ID, ISODate>,
): ReminderDue[] {
  if (!settings.enabled) return [];
  const out: ReminderDue[] = [];
  for (const party of parties) {
    if (party.type !== "customer") continue;
    const lastSent = remindedOn[party.id];
    if (lastSent === todayIso) continue; // already sent today
    const bills = openBills(collectionBills(party, vouchers, todayIso));
    const pending = bills.reduce((s, b) => s + b.pending, 0);
    if (pending <= 0 || pending < settings.minAmount) continue;
    // Sent recently before the due date? Don't send the "before" one again.
    const hits = bills
      .map((b) => ({ b, reason: billReason(b, settings, todayIso, lastSent) }))
      .filter(
        (h): h is { b: Bill; reason: ReminderReason } =>
          h.reason !== null &&
          !(
            h.reason === "before-due" &&
            lastSent &&
            lastSent >= addDays(h.b.dueDate, -settings.daysBefore)
          ),
      )
      .sort((x, y) => URGENCY[x.reason] - URGENCY[y.reason]);
    if (hits.length === 0) continue;
    const { b, reason } = hits[0];
    out.push({
      partyId: party.id,
      partyName: party.name,
      phone: party.phone,
      pending,
      overdueDays: Math.max(...bills.map((x) => x.overdueDays)),
      reason,
      bill: { number: b.number, dueDate: b.dueDate, pending: b.pending },
      lastSent,
    });
  }
  return out.sort(
    (x, y) =>
      URGENCY[x.reason] - URGENCY[y.reason] || y.overdueDays - x.overdueDays,
  );
}
