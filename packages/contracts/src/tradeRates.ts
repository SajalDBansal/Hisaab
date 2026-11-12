import { z } from "zod";
import { Id, IsoDate } from "./common";

// Products a party supplies or buys, and the rates. A rate is per base unit,
// after the line discount and before GST.

export const TradeRate = z.object({
  partyId: Id,
  partyName: z.string(),
  itemId: Id,
  itemName: z.string(),
  itemCode: z.string(),
  group: z.string(),
  unit: z.string(),
  rate: z.number(),
  typedRate: z.number(),
  previousRate: z.number().nullable(),
  gstRate: z.number(),
  lastDate: IsoDate,
  lastVoucherId: Id,
  lastNumber: z.string(),
  firstDate: IsoDate,
  bills: z.number().int(),
  qty: z.number(),
  value: z.number().int(),
  /** Suppliers only: stock on hand from this supplier's purchases. */
  stockQty: z.number().nullable(),
  stockValue: z.number().int().nullable(),
});

/** GET /parties/:id/items */
export const PartyItems = z.object({ rows: z.array(TradeRate) });

/** GET /parties/:id/items/:itemId: every bill and return, newest first. */
export const TradeRateEntry = z.object({
  voucherId: Id,
  number: z.string(),
  date: IsoDate,
  type: z.enum(["purchase", "sale", "debit-note", "credit-note"]),
  qty: z.number(),
  rate: z.number(),
  typedRate: z.number(),
  gstRate: z.number(),
});

/** GET /items/:id/parties. `suppliers` is null for roles that can't see costs. */
export const ItemParties = z.object({
  suppliers: z.array(TradeRate).nullable(),
  customers: z.array(TradeRate).nullable(),
  openingStock: z
    .object({ qty: z.number(), value: z.number().int() })
    .nullable(),
});

export const PartyItemParams = z.object({ id: Id, itemId: Id });

export type TradeRate = z.infer<typeof TradeRate>;
export type PartyItems = z.infer<typeof PartyItems>;
export type TradeRateEntry = z.infer<typeof TradeRateEntry>;
export type ItemParties = z.infer<typeof ItemParties>;
