/**
 * TDS (tax deducted at source) on payments.
 * Default rates are common ones; the user can change the rate on the payment screen.
 */
import { mulDivRound } from "../money";
import type { Paise } from "../types";

export interface TdsSection {
  section: string;
  label: string;
  /** Default rate in percent. */
  rate: number;
}

export const TDS_SECTIONS: TdsSection[] = [
  { section: "194C", label: "Contractors", rate: 2 },
  { section: "194J", label: "Professional fees", rate: 10 },
  { section: "194I", label: "Rent of building", rate: 10 },
  { section: "194H", label: "Commission", rate: 2 },
  { section: "194Q", label: "Purchase of goods", rate: 0.1 },
];

/** TDS on the bill value being settled, rounded to the nearest rupee (as TDS is deposited in whole rupees). */
export function calcTds(settledAmount: Paise, ratePercent: number): Paise {
  return Math.round((settledAmount * ratePercent) / 100 / 100) * 100;
}

/**
 * Amount TDS is worked out on: GST shown separately on a bill is left out
 * (CBDT Circular 23/2017). Money not allocated to a bill, or allocated to an
 * opening balance, has no separate GST, so it counts in full.
 */
export function tdsBase(
  settledAmount: Paise,
  allocations: { amount: Paise; bill: { amount: Paise; taxable?: Paise } }[],
): Paise {
  let base = settledAmount;
  for (const { amount, bill } of allocations)
    if (bill.taxable !== undefined && bill.amount > 0)
      base -= amount - mulDivRound(amount, bill.taxable, bill.amount);
  return Math.max(base, 0);
}
