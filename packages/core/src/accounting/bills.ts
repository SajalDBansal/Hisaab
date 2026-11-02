/**
 * Bill-wise tracking: balances, outstanding bills, ageing and allocation.
 *
 * Sign convention for party balances:
 *   positive = they owe us ("You'll get"), negative = we owe them ("You'll give").
 */
import { addDays, daysBetween } from "../dates";
import type { Allocation, ISODate, Paise, Party, Voucher } from "../types";
import {
  billAllocations,
  settlementUnallocatedAdjustment,
  sumPaise,
} from "./settlements";
import { importedOpeningBills } from "./openingImport";
import { calcInvoice } from "./invoice";

/** Only posted vouchers affect balances. Drafts and cancelled vouchers are ignored. */
export function isPosted(v: Voucher): boolean {
  return v.status === "posted";
}

/** Signed effect of one voucher on a party's balance. */
export function partyEffect(v: Voucher, partyId: string): Paise {
  if (v.type === "journal") {
    // A journal can touch a party directly, e.g. writing off a small balance.
    return (v.journalLines ?? [])
      .filter((l) => l.account === `party:${partyId}`)
      .reduce((s, l) => s + l.debit - l.credit, 0);
  }
  if (v.partyId !== partyId) return 0;
  switch (v.type) {
    case "sale":
      return v.amount; // customer now owes more
    case "receipt":
      return -v.amount; // customer paid us
    case "purchase":
      return -v.amount; // we now owe the supplier more
    case "payment":
      return v.amount + (v.tds?.amount ?? 0); // we paid the supplier (TDS kept back still clears their bill)
    case "credit-note":
      return -v.amount; // goods came back, customer owes less
    case "debit-note":
      return v.amount; // goods sent back, we owe the supplier less
    default:
      return 0;
  }
}

export function partyBalance(
  party: Party,
  vouchers: Voucher[],
  asOf?: ISODate,
): Paise {
  const opening = asOf && party.openingDate > asOf ? 0 : party.openingBalance;
  return vouchers
    .filter((v) => isPosted(v) && (!asOf || v.date <= asOf))
    .reduce((bal, v) => bal + partyEffect(v, party.id), opening);
}

/** Id used for the opening balance when it is treated as a bill. */
export function openingBillId(partyId: string): string {
  return `opening:${partyId}`;
}

export interface Bill {
  /** Invoice id, `opening:<partyId>` or immutable `opening-bill:<id>`. */
  id: string;
  number: string;
  date: ISODate;
  dueDate: ISODate;
  amount: Paise;
  settled: Paise;
  pending: Paise;
  /** Days since the bill date. */
  ageDays: number;
  /** Days past the due date (0 if not yet due). */
  overdueDays: number;
  /** Bill value without GST; TDS is worked out on this share. Missing on opening balances. */
  taxable?: Paise;
}

/** Total allocated to each bill by all posted receipts and payments. */
function settledByBill(vouchers: Voucher[]): Map<string, Paise> {
  const map = new Map<string, Paise>();
  for (const v of vouchers) {
    if (!isPosted(v)) continue;
    for (const a of billAllocations(v))
      map.set(a.voucherId, (map.get(a.voucherId) ?? 0) + a.amount);
  }
  return map;
}

/**
 * All bills of a party with what is still pending, oldest first.
 * Customers: sale invoices. Suppliers: purchase bills. The opening balance counts as a bill too.
 */
export function partyBills(
  party: Party,
  vouchers: Voucher[],
  asOf: ISODate,
): Bill[] {
  const billType = party.type === "customer" ? "sale" : "purchase";
  const visible = vouchers.filter((v) => v.date <= asOf);
  const settled = settledByBill(visible);
  const bills: Bill[] = [];

  const openingAmount =
    party.openingBalance * (party.type === "customer" ? 1 : -1);
  if (party.openingBills?.length) {
    bills.push(
      ...importedOpeningBills(party, party.openingBills, visible, asOf),
    );
  } else if (openingAmount > 0 && party.openingDate <= asOf) {
    const id = openingBillId(party.id);
    bills.push(
      makeBill(
        id,
        "Opening balance",
        party.openingDate,
        addDays(party.openingDate, party.creditDays),
        openingAmount,
        settled.get(id) ?? 0,
        asOf,
      ),
    );
  }

  for (const v of visible) {
    if (v.partyId !== party.id || v.type !== billType || !isPosted(v)) continue;
    const due = v.dueDate ?? addDays(v.date, party.creditDays);
    const { tax } = calcInvoice({
      lines: v.lines ?? [],
      charges: v.charges,
      interState: !!v.interState,
    });
    bills.push({
      ...makeBill(
        v.id,
        v.number,
        v.date,
        due,
        v.amount,
        settled.get(v.id) ?? 0,
        asOf,
      ),
      taxable: v.amount - tax,
    });
  }
  return bills.sort((a, b) =>
    a.date === b.date
      ? a.number.localeCompare(b.number)
      : a.date.localeCompare(b.date),
  );
}

function makeBill(
  id: string,
  number: string,
  date: ISODate,
  due: ISODate,
  amount: Paise,
  settled: Paise,
  asOf: ISODate,
): Bill {
  return {
    id,
    number,
    date,
    dueDate: due,
    amount,
    settled,
    pending: Math.max(amount - settled, 0),
    ageDays: Math.max(daysBetween(date, asOf), 0),
    overdueDays: Math.max(daysBetween(due, asOf), 0),
  };
}

/** Bills that still have money pending. */
export function openBills(bills: Bill[]): Bill[] {
  return bills.filter((b) => b.pending > 0);
}

/** Split a payment across open bills, oldest first. Leftover money is returned as `unallocated`. */
export function autoAllocate(
  amount: Paise,
  bills: Bill[],
): { allocations: Allocation[]; unallocated: Paise } {
  let left = amount;
  const allocations: Allocation[] = [];
  for (const bill of openBills(bills)) {
    if (left <= 0) break;
    const take = Math.min(left, bill.pending);
    allocations.push({ voucherId: bill.id, amount: take });
    left -= take;
  }
  return { allocations, unallocated: left };
}

export interface Ageing {
  "0-30": Paise;
  "31-60": Paise;
  "61-90": Paise;
  "90+": Paise;
}

/** Pending amounts grouped by bill age (days since bill date). */
export function ageing(bills: Bill[]): Ageing {
  const result: Ageing = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const b of openBills(bills)) {
    if (b.ageDays <= 30) result["0-30"] += b.pending;
    else if (b.ageDays <= 60) result["31-60"] += b.pending;
    else if (b.ageDays <= 90) result["61-90"] += b.pending;
    else result["90+"] += b.pending;
  }
  return result;
}

/** Summary used on lists and the dashboard. */
export function overdueSummary(bills: Bill[]) {
  const overdue = openBills(bills).filter((b) => b.overdueDays > 0);
  return {
    overdueAmount: overdue.reduce((s, b) => s + b.pending, 0),
    overdueCount: overdue.length,
    maxOverdueDays: overdue.reduce((m, b) => Math.max(m, b.overdueDays), 0),
  };
}

/** Net collection exposure after on-account credits, without changing saved bill allocations. */
export function collectionBills(
  party: Party,
  vouchers: Voucher[],
  asOf: ISODate,
): Bill[] {
  const bills = partyBills(party, vouchers, asOf);
  const direction = party.type === "customer" ? 1 : -1;
  const balance = Math.max(direction * partyBalance(party, vouchers, asOf), 0);
  let credit = Math.max(bills.reduce((s, b) => s + b.pending, 0) - balance, 0);
  return bills.map((b) => {
    const offset = Math.min(credit, b.pending);
    credit -= offset;
    return { ...b, pending: b.pending - offset, settled: b.settled + offset };
  });
}

/** Money received/paid but not yet assigned to an invoice. */
export function unallocatedMoney(party: Party, vouchers: Voucher[]): Paise {
  const type = party.type === "customer" ? "receipt" : "payment";
  const ordinary = vouchers
    .filter((v) => isPosted(v) && v.type === type && v.partyId === party.id)
    .reduce(
      (sum, v) =>
        sum +
        Math.max(
          v.amount +
            (v.tds?.amount ?? 0) -
            (v.allocations ?? []).reduce((s, a) => s + a.amount, 0),
          0,
        ),
      0,
    );
  return Math.max(
    sumPaise([ordinary, settlementUnallocatedAdjustment(party.id, vouchers)]),
    0,
  );
}

export type InvoiceStatus =
  "draft" | "cancelled" | "paid" | "partial" | "overdue" | "unpaid";

/** Payment status of a sale or purchase invoice, for list badges and filters. */
export function invoiceStatus(
  v: Voucher,
  settled: Paise,
  asOf: ISODate,
): InvoiceStatus {
  if (v.status === "draft") return "draft";
  if (v.status === "cancelled") return "cancelled";
  if (settled >= v.amount) return "paid";
  if (v.dueDate && v.dueDate < asOf) return "overdue";
  return settled > 0 ? "partial" : "unpaid";
}

/** How much of each invoice has been settled by posted receipts/payments. */
export function settledAmounts(vouchers: Voucher[]): Map<string, Paise> {
  return settledByBill(vouchers);
}
