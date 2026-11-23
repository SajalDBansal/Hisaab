/**
 * Delivery challans (doc 37, T04).
 *
 * CGST Rule 55 lets goods move on a delivery challan instead of a tax invoice
 * when the invoice comes later or there is no supply. The purpose is printed on
 * the challan.
 *
 * Stock: a firm setting decides whether a new challan moves stock (default yes,
 * as Hisaab always did). Each challan stores what it did when issued
 * (`challanStock`), so changing the setting later never re-books old challans:
 * the switch is one-way in time, it only applies to challans issued after it.
 * A challan that moved stock keeps it until it is cancelled (stock comes back);
 * the invoice made from it then takes no stock again. A paperwork-only challan
 * never moves stock, and the invoice made from it takes the stock instead.
 */
import type { Voucher } from "../types";

export const CHALLAN_TYPES = [
  "supply",
  "approval",
  "job-work",
  "branch-transfer",
  "other",
] as const;
export type ChallanType = (typeof CHALLAN_TYPES)[number];

export const CHALLAN_TYPE_LABELS: Record<ChallanType, string> = {
  supply: "Supply (invoice to follow)",
  approval: "Sale on approval",
  "job-work": "Job work",
  "branch-transfer": "Branch / own use transfer",
  other: "Other (not a supply)",
};

/** New challans move stock unless the firm switched it off. */
export const DEFAULT_CHALLAN_STOCK = true;

/** The firm's setting for new challans. */
export function firmChallanStock(db: {
  salesControls?: { challanStock?: boolean };
}): boolean {
  return db.salesControls?.challanStock ?? DEFAULT_CHALLAN_STOCK;
}

/** Whether this challan moved stock when issued; older challans (no flag) did. */
export function challanMovesStock(
  v: Pick<Voucher, "type" | "challanStock">,
): boolean {
  return v.type === "delivery-note" && v.challanStock !== false;
}

/**
 * Stock goes out on a stock-moving challan until it is billed the old way
 * (legacy conversion hands the stock to the invoice); order-fulfilment bills
 * leave it on the challan.
 */
export function challanHoldsStock(
  v: Pick<
    Voucher,
    "type" | "challanStock" | "convertedToId" | "fulfillmentManaged"
  >,
): boolean {
  return challanMovesStock(v) && (!v.convertedToId || !!v.fulfillmentManaged);
}
