import { z } from "zod";
import { Id, IsoDate, Paise, PositivePaise, Quantity, requiredText } from "./common";

export const InventoryAdjustment = z.object({
  kind: z.enum(["count", "damage", "landed-cost", "reversal"]),
  itemId: Id,
  lotId: z.string().min(1).max(160),
  quantity: Quantity,
  value: Paise,
  reason: requiredText("Enter a reason.", 300),
  reversesId: Id.optional(),
});

export const InventoryAdjustmentInput = z.object({
  kind: z.enum(["count", "damage", "landed-cost"]),
  itemId: Id,
  lotId: z.string().min(1).max(160),
  date: IsoDate,
  expectedQty: Quantity.min(0),
  expectedValue: Paise.nonnegative(),
  quantity: Quantity.min(0).optional(),
  amount: PositivePaise.optional(),
  offsetAccount: z.string().max(200).optional(),
  reason: requiredText("Enter a reason.", 300),
}).superRefine((input, ctx) => {
  const field = input.kind === "landed-cost" ? "amount" : "quantity";
  if (input[field] === undefined) ctx.addIssue({ code: "custom", path: [field], message: "Enter the adjustment amount or quantity." });
  if (input.kind === "landed-cost" && !input.offsetAccount) ctx.addIssue({ code: "custom", path: ["offsetAccount"], message: "Select the cost source account." });
});
export type InventoryAdjustmentInput = z.infer<typeof InventoryAdjustmentInput>;
export const InventoryReversalInput = z.object({ date: IsoDate, reason: requiredText("Enter a reason.", 300) });
