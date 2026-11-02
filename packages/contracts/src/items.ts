import { z } from "zod";
import {
  GstRate,
  Id,
  IsoDate,
  NonNegativePaise,
  PositivePaise,
  Quantity,
  requiredText,
} from "./common";

export const TaxType = z.enum(["taxable", "nil", "exempt", "nongst"]);
export const BookScope = z.enum(["gst", "nongst"]);
// Match the largest supported import while keeping previously imported lots readable.
export const MAX_OPENING_STOCK_LOTS = 500;
export const OpeningStockLot = z.object({
  id: z.string().min(1).max(160),
  qty: Quantity.positive(),
  unitCost: NonNegativePaise,
  bookScope: BookScope,
});
export const OpeningStockLots = z
  .array(OpeningStockLot)
  .max(
    MAX_OPENING_STOCK_LOTS,
    `An item supports up to ${MAX_OPENING_STOCK_LOTS} opening lots.`,
  )
  .refine(
    (lots) => new Set(lots.map((lot) => lot.id)).size === lots.length,
    "Opening lots must have unique IDs.",
  );
export const StockLot = z.object({
  id: z.string(),
  itemId: Id,
  number: z.string(),
  date: IsoDate,
  bookScope: BookScope,
  qty: z.number(),
  value: z.number().int(),
  unitCost: z.number(),
  minimumQty: z.number(),
});

const hsn = z
  .string()
  .regex(/^(\d{4}|\d{6}|\d{8})?$/, "HSN/SAC should be 4, 6 or 8 digits.");

/** What the item form sends. Whether HSN is required depends on the firm's GST mode, so the server checks that. */
export const ItemInput = z
  .object({
    name: requiredText("Enter the item name."),
    code: z.string().max(40),
    hsn,
    group: z.string().max(100),
    taxType: TaxType,
    gstRate: GstRate,
    unit: requiredText("Pick a unit.", 20),
    altUnit: z
      .object({
        name: requiredText("Name the second unit, e.g. Box.", 20),
        factor: Quantity.int("Use a whole number.").min(
          2,
          "How many in one? (2 or more)",
        ),
      })
      .optional(),
    purchasePrice: NonNegativePaise,
    salePrice: PositivePaise,
    mrp: NonNegativePaise,
    reorderLevel: Quantity.min(0, "Can't be negative."),
    openingStock: Quantity.min(0, "Can't be negative."),
    openingCost: NonNegativePaise.optional(),
    openingBookScope: BookScope.optional(),
    openingLots: OpeningStockLots.optional(),
    batch: z.object({ number: z.string().max(40), expiry: IsoDate }).optional(),
  })
  .superRefine((item, ctx) => {
    if (
      item.openingLots &&
      (Math.round(
        item.openingLots.reduce((sum, lot) => sum + lot.qty, 0) * 1000,
      ) !== Math.round(item.openingStock * 1000) ||
        new Set(item.openingLots.map((lot) => lot.id)).size !==
          item.openingLots.length)
    )
      ctx.addIssue({
        code: "custom",
        path: ["openingLots"],
        message:
          "Opening lots must have unique IDs and add up to opening stock.",
      });
    if (item.mrp > 0 && item.salePrice > item.mrp)
      ctx.addIssue({
        code: "custom",
        path: ["mrp"],
        message: "Sale price can't be more than MRP.",
      });
    if (item.taxType !== "taxable" && item.gstRate !== 0)
      ctx.addIssue({
        code: "custom",
        path: ["gstRate"],
        message: "Only taxable items have a GST rate.",
      });
    if (
      item.altUnit &&
      item.altUnit.name.toLowerCase() === item.unit.toLowerCase()
    )
      ctx.addIssue({
        code: "custom",
        path: ["altUnit"],
        message: "The second unit must be different.",
      });
  });

export const Item = ItemInput.safeExtend({ id: Id });

export const ItemListQuery = z.object({
  search: z.string().max(100).optional(),
  lowStock: z.stringbool().optional(),
});

export const Unit = z.object({
  name: z.string(),
  uqc: z.string(),
  enabled: z.boolean(),
  builtIn: z.boolean(),
});

export const NewUnitInput = z.object({
  name: requiredText("Enter the unit name.", 20),
  uqc: z.string().regex(/^[A-Z]{3}$/, "Pick the GST unit code, like KGS."),
});

export type ItemInput = z.infer<typeof ItemInput>;
export type Item = z.infer<typeof Item>;
export type Unit = z.infer<typeof Unit>;
export type NewUnitInput = z.infer<typeof NewUnitInput>;

/** An item as the screens get it. `stock` is worked out from the books, in the base unit. */
export const ItemRow = Item.safeExtend({
  value: z.number().int().optional(),
  version: z.number().int(),
  stock: z.number(),
  lowStock: z.boolean(),
});

export const ItemListParams = ItemListQuery.extend({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export const UnitRow = Unit.extend({
  /** Items using this unit as the main or second unit. */
  itemCount: z.number().int(),
});
export const UnitParams = z.object({ name: z.string().min(1).max(20) });
export const UnitUpdate = z.object({ enabled: z.boolean() });

export type ItemRow = z.infer<typeof ItemRow>;
export type UnitRow = z.infer<typeof UnitRow>;
