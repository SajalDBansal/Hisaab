/**
 * Estimates and orders have no financial postings; delivery notes also move stock.
 */
import type { OrderType, VoucherType } from "../types";

/** In the order they usually happen. */
export const ORDER_TYPES: OrderType[] = [
  "estimate",
  "sales-order",
  "delivery-note",
  "purchase-order",
];
export const isOrderType = (t: string): t is OrderType =>
  (ORDER_TYPES as string[]).includes(t);

/** What each document can be turned into. */
export const CONVERTS_TO: Record<
  OrderType,
  ("sale" | "purchase" | OrderType)[]
> = {
  estimate: ["sale", "sales-order"],
  "sales-order": ["sale", "delivery-note"],
  "delivery-note": ["sale"],
  "purchase-order": ["purchase"],
};

/** The voucher type a document is usually turned into first. */
export const MAIN_CONVERSION: Record<OrderType, VoucherType> = {
  estimate: "sale",
  "sales-order": "sale",
  "delivery-note": "sale",
  "purchase-order": "purchase",
};

export type OrderStatus =
  "open" | "partial" | "converted" | "expired" | "cancelled";

/** Open, converted, cancelled, or expired (estimates past their valid-until date). */
export function orderStatus(
  v: {
    status: string;
    convertedToId?: string;
    validUntil?: string;
    fulfillmentStatus?: "open" | "partial" | "converted";
  },
  todayIso: string,
): OrderStatus {
  if (v.status === "cancelled") return "cancelled";
  if (v.fulfillmentStatus === "converted") return "converted";
  if (v.fulfillmentStatus === "partial") return "partial";
  if (v.fulfillmentStatus === "open")
    return v.validUntil && v.validUntil < todayIso ? "expired" : "open";
  if (v.convertedToId) return "converted";
  if (v.validUntil && v.validUntil < todayIso) return "expired";
  return "open";
}
