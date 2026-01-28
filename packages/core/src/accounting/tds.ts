/**
 * TDS (tax deducted at source) on payments.
 * Default rates are common ones; the user can change the rate on the payment screen.
 */
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
