import * as c from "@repo/contracts";
import { InventoryAdjustmentInput } from "@repo/contracts/src/inventory";
import { z } from "zod";
import type { Permission } from "@repo/core";

export const OperationInput = z
  .object({
    method: z.enum(["POST", "PUT"]),
    path: z.string().max(200),
    body: z.record(z.string(), z.unknown()),
    role: c.Role,
    expectedVersion: z.number().int().positive().optional(),
    legacy: z.boolean().optional(),
  })
  .strict();
export type OperationInput = z.infer<typeof OperationInput>;
export const OperationResult = z.discriminatedUnion("state", [
  z.object({ state: z.literal("committed"), response: z.unknown() }),
  z.object({
    state: z.literal("conflict"),
    code: z.string(),
    message: z.string(),
    current: z.unknown(),
    fields: z.record(z.string(), z.string()).optional(),
  }),
  z.object({ state: z.literal("cancelled") }),
  z.object({ state: z.literal("absent") }),
  z.object({ state: z.literal("unknown"), message: z.string() }),
]);
export type OperationResult = z.infer<typeof OperationResult>;
export const OperationParams = z.object({
  key: z
    .string()
    .min(8)
    .max(100)
    .regex(/^[a-zA-Z0-9:-]+$/),
});

const creates: Record<
  string,
  { schema: z.ZodType; permissions: Permission[] }
> = {
  "/inventory/adjustments": {
    schema: InventoryAdjustmentInput,
    permissions: ["accounts"],
  },
  "/sales": { schema: c.NewInvoiceInput, permissions: ["sales"] },
  "/sales/split": { schema: c.NewInvoiceInput, permissions: ["sales"] },
  "/purchases": { schema: c.NewInvoiceInput, permissions: ["purchase"] },
  "/receipts": { schema: c.NewMoneyInput, permissions: ["sales"] },
  "/payments": { schema: c.NewMoneyInput, permissions: ["purchase"] },
  "/expenses": { schema: c.NewExpenseInput, permissions: ["purchase"] },
  "/journals": { schema: c.NewJournalInput, permissions: ["accounts"] },
  "/contras": { schema: c.NewContraInput, permissions: ["payments"] },
  "/credit-notes": { schema: c.NewNoteInput, permissions: ["sales"] },
  "/debit-notes": { schema: c.NewNoteInput, permissions: ["purchase"] },
  "/orders/estimate": { schema: c.NewOrderInput, permissions: ["sales"] },
  "/orders/sales-order": { schema: c.NewOrderInput, permissions: ["sales"] },
  "/orders/purchase-order": {
    schema: c.NewOrderInput,
    permissions: ["purchase"],
  },
  "/orders/delivery-note": { schema: c.NewOrderInput, permissions: ["sales"] },
  "/accounts/masters": { schema: c.AccountInput, permissions: ["accounts"] },
  "/ledgers": { schema: c.LedgerInput, permissions: ["payments"] },
  "/parties": { schema: c.PartyInput, permissions: ["sales", "purchase"] },
  "/items": { schema: c.ItemInput, permissions: ["sales", "purchase"] },
};

export function operationDefinition(input: OperationInput) {
  if (input.method === "POST") return creates[input.path];
  if (!input.expectedVersion) return undefined;
  const match = /^\/(vouchers|parties|items|ledgers)\/([a-f0-9-]{36})$/.exec(
    input.path,
  );
  if (!match || !z.uuid().safeParse(match[2]).success) return undefined;
  return match[1] === "vouchers"
    ? {
        schema: c.NewInvoiceInput,
        permissions: ["sales", "purchase"] as Permission[],
      }
    : creates[`/${match[1]}`];
}
