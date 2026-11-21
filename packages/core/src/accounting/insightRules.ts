/**
 * Rules shared by the Phase 1 reports (`reporting/insights.ts`) and the Home
 * dashboard cards (doc 37, T26/T56/T63), so a card always shows the same figure
 * as the report it opens.
 */
import { addDays } from "../dates";
import type { ISODate, Paise, Party, Voucher, VoucherType } from "../types";
import { isPosted, partyBills, vouchersByParty, type Bill } from "./bills";
import { calcInvoice } from "./invoice";

/** Unpaid supplier bills older than this lose their input credit (CGST Act s.16(2), second proviso). */
export const ITC_REVERSE_DAYS = 180;
/** Bills this old are flagged so they can be paid in time. */
export const ITC_WARN_DAYS = 150;
/** A customer with no sale for this many days before the report's end is "Lost". */
export const LOST_CUSTOMER_DAYS = 90;

export interface ItcRiskBill {
  supplier: Party;
  voucher: Voucher;
  bill: Bill;
  /** GST on the whole bill. */
  tax: Paise;
  /** The GST share still unpaid: tax × pending ÷ bill amount. */
  atRisk: Paise;
  /** 180 days or older: the credit must be reversed now. */
  reverseNow: boolean;
  /** The date the bill reaches 180 days. */
  limit: ISODate;
}

/**
 * Supplier bills with GST still unpaid from day 150. Opening balances carry no
 * ITC. Biggest first is left to the caller; this keeps book order.
 */
export function itcAtRiskBills(
  parties: Party[],
  vouchers: Voucher[],
  asOf: ISODate,
  options: { partyId?: string; byParty?: Map<string, Voucher[]> } = {},
): ItcRiskBill[] {
  const byParty = options.byParty ?? vouchersByParty(parties, vouchers);
  const rows: ItcRiskBill[] = [];
  for (const supplier of parties) {
    if (supplier.type !== "supplier") continue;
    if (options.partyId && supplier.id !== options.partyId) continue;
    const own = byParty.get(supplier.id) ?? [];
    for (const bill of partyBills(supplier, own, asOf)) {
      if (bill.pending <= 0 || bill.ageDays < ITC_WARN_DAYS) continue;
      const voucher = own.find((v) => v.id === bill.id);
      if (!voucher) continue;
      const tax = calcInvoice({
        lines: voucher.lines ?? [],
        charges: voucher.charges,
        interState: !!voucher.interState,
      }).tax;
      if (tax <= 0) continue;
      rows.push({
        supplier,
        voucher,
        bill,
        tax,
        atRisk: Math.round((tax * bill.pending) / bill.amount),
        reverseNow: bill.ageDays >= ITC_REVERSE_DAYS,
        limit: addDays(bill.date, ITC_REVERSE_DAYS),
      });
    }
  }
  return rows;
}

export interface PartyRank {
  partyId: string;
  name: string;
  /** Bills in the period (returns are not counted as bills). */
  bills: number;
  /** Bill totals less returns, GST included. */
  value: Paise;
}

/** Customers (sales less credit notes) or suppliers (purchases less debit notes) ranked by net value in the period. */
export function rankParties(
  vouchers: Voucher[],
  side: "customer" | "supplier",
  from: ISODate,
  to: ISODate,
  nameOf: (v: Voucher) => string,
  partyId?: string,
): PartyRank[] {
  const [bill, back]: VoucherType[] =
    side === "customer" ? ["sale", "credit-note"] : ["purchase", "debit-note"];
  const byParty = new Map<string, PartyRank>();
  for (const v of vouchers) {
    if (v.type !== bill && v.type !== back) continue;
    if (!v.partyId || !isPosted(v) || v.date < from || v.date > to) continue;
    if (partyId && v.partyId !== partyId) continue;
    const row = byParty.get(v.partyId) ?? {
      partyId: v.partyId,
      name: nameOf(v),
      bills: 0,
      value: 0,
    };
    if (v.type === bill) row.bills += 1;
    row.value += (v.type === bill ? 1 : -1) * v.amount;
    byParty.set(v.partyId, row);
  }
  return [...byParty.values()].sort((a, b) => b.value - a.value);
}

/** Lost customers: no sale in the 90 days before `asOf` (and at least one sale before). */
export const isQuietCustomer = (lastSale: ISODate, asOf: ISODate) =>
  lastSale < addDays(asOf, -LOST_CUSTOMER_DAYS);
