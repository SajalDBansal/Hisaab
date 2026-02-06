import { z } from "zod";
import {
  Id,
  IdempotencyHeaders,
  IsoDate,
  IsoDateTime,
  Quantity,
} from "./common";
import { BookScope } from "./items";
import { InvoiceLine, OrderType, Voucher } from "./vouchers";

export const FulfillmentTarget = z.enum([
  "sale",
  "purchase",
  "sales-order",
  "delivery-note",
]);
export const OrderFulfillmentInput = z.strictObject({
  version: z.number().int().positive(),
  target: FulfillmentTarget,
  date: IsoDate,
  lines: z
    .array(
      z.strictObject({
        sourceLineId: Id,
        qty: Quantity.positive(),
        stockLotId: z.string().min(1).max(160).optional(),
      }),
    )
    .min(1)
    .max(500)
    .refine(
      (lines) =>
        new Set(lines.map((line) => line.sourceLineId)).size === lines.length,
      "Select each order line only once.",
    ),
  narration: z.string().trim().max(1000).optional(),
  supplierInvoiceNo: z.string().trim().max(100).optional(),
  creditOverrideId: Id.optional(),
});
export const OrderFulfillmentHeaders = IdempotencyHeaders;
export const OrderFulfillmentLine = z.object({
  id: Id,
  position: z.number().int().nonnegative(),
  itemName: z.string(),
  unit: z.string(),
  line: InvoiceLine,
  consumedQty: Quantity.nonnegative(),
  returnedQty: Quantity.nonnegative(),
  remainingQty: Quantity.nonnegative(),
});
export const OrderFulfillmentLot = z.object({
  id: z.string(),
  itemId: Id,
  number: z.string(),
  date: IsoDate,
  bookScope: BookScope,
  qty: Quantity,
});
export const OrderFulfillmentHistory = z.object({
  id: Id,
  date: IsoDate,
  createdAt: IsoDateTime,
  target: FulfillmentTarget,
  userName: z.string(),
  vouchers: z.array(
    z.object({
      id: Id,
      number: z.string(),
      status: z.enum(["posted", "draft", "cancelled"]),
      bookScope: BookScope.optional(),
      amount: z.number().int(),
    }),
  ),
});
export const OrderFulfillmentDetail = z.object({
  source: z.object({
    id: Id,
    version: z.number().int().positive(),
    number: z.string(),
    type: OrderType,
    date: IsoDate,
    partyName: z.string(),
    status: z.enum(["open", "partial", "converted", "expired", "cancelled"]),
  }),
  targets: z.array(FulfillmentTarget),
  lines: z.array(OrderFulfillmentLine),
  lots: z.array(OrderFulfillmentLot),
  history: z.array(OrderFulfillmentHistory),
  blockedReason: z.string().nullable(),
});
export const OrderFulfillmentResult = z.object({
  id: Id,
  sourceId: Id,
  version: z.number().int().positive(),
  vouchers: z.array(Voucher).min(1),
});

export type OrderFulfillmentInput = z.infer<typeof OrderFulfillmentInput>;
export type OrderFulfillmentDetail = z.infer<typeof OrderFulfillmentDetail>;
export type OrderFulfillmentResult = z.infer<typeof OrderFulfillmentResult>;
