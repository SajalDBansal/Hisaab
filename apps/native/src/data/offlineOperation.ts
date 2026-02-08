import * as c from "@repo/contracts";
import { InventoryAdjustmentInput } from "@repo/contracts/src/inventory";
import { can, type Permission } from "@repo/core";
import { z } from "zod";

export const OfflineScope = z.object({
  userId: z.string().min(1),
  firmId: z.string().min(1),
  role: c.Role,
});
export type OfflineScope = z.infer<typeof OfflineScope>;
export const OperationInput = z.object({
  method: z.enum(["POST", "PUT"]),
  path: z.string(),
  body: z.record(z.string(), z.unknown()),
  role: c.Role,
  expectedVersion: z.number().int().positive().optional(),
  legacy: z.boolean().optional(),
});
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
type Definition = {
  input: z.ZodType;
  output: z.ZodType;
  permissions: Permission[];
  label: string;
};
const invoice = (permission: Permission, label: string): Definition => ({
  input: c.NewInvoiceInput,
  output: c.Voucher,
  permissions: [permission],
  label,
});
const definitions: Record<string, Definition> = {
  "/inventory/adjustments": {
    input: InventoryAdjustmentInput,
    output: c.Voucher,
    permissions: ["accounts"],
    label: "Stock adjustment",
  },
  "/sales": invoice("sales", "Sale"),
  "/sales/split": {
    ...invoice("sales", "Sale"),
    output: z.array(c.Voucher).min(1),
  },
  "/purchases": invoice("purchase", "Purchase"),
  "/receipts": {
    input: c.NewMoneyInput,
    output: c.Voucher,
    permissions: ["sales"],
    label: "Receipt",
  },
  "/payments": {
    input: c.NewMoneyInput,
    output: c.Voucher,
    permissions: ["purchase"],
    label: "Payment",
  },
  "/expenses": {
    input: c.NewExpenseInput,
    output: c.Voucher,
    permissions: ["purchase"],
    label: "Expense",
  },
  "/journals": {
    input: c.NewJournalInput,
    output: c.Voucher,
    permissions: ["accounts"],
    label: "Journal",
  },
  "/contras": {
    input: c.NewContraInput,
    output: c.Voucher,
    permissions: ["payments"],
    label: "Contra",
  },
  "/credit-notes": {
    input: c.NewNoteInput,
    output: c.Voucher,
    permissions: ["sales"],
    label: "Credit note",
  },
  "/debit-notes": {
    input: c.NewNoteInput,
    output: c.Voucher,
    permissions: ["purchase"],
    label: "Debit note",
  },
  "/orders/estimate": {
    input: c.NewOrderInput,
    output: c.Voucher,
    permissions: ["sales"],
    label: "Estimate",
  },
  "/orders/sales-order": {
    input: c.NewOrderInput,
    output: c.Voucher,
    permissions: ["sales"],
    label: "Sales order",
  },
  "/orders/purchase-order": {
    input: c.NewOrderInput,
    output: c.Voucher,
    permissions: ["purchase"],
    label: "Purchase order",
  },
  "/orders/delivery-note": {
    input: c.NewOrderInput,
    output: c.Voucher,
    permissions: ["sales"],
    label: "Delivery note",
  },
  "/accounts/masters": {
    input: c.AccountInput,
    output: c.CustomAccount,
    permissions: ["accounts"],
    label: "Account",
  },
  "/ledgers": {
    input: c.LedgerInput,
    output: c.LedgerRow,
    permissions: ["payments"],
    label: "Cash/bank account",
  },
  "/parties": {
    input: c.PartyInput,
    output: c.PartyRow,
    permissions: ["sales", "purchase"],
    label: "Party",
  },
  "/items": {
    input: c.ItemInput,
    output: c.ItemRow,
    permissions: ["sales", "purchase"],
    label: "Item",
  },
};
export function offlineDefinition(
  method: string,
  path: string,
): Definition | undefined {
  if (method === "POST") return definitions[path];
  const match =
    method === "PUT" &&
    /^\/(vouchers|parties|items|ledgers)\/([a-f0-9-]{36})$/.exec(path);
  if (!match || !z.uuid().safeParse(match[2]).success) return undefined;
  return match[1] === "vouchers"
    ? {
        ...invoice("sales", "Invoice edit"),
        permissions: ["sales", "purchase"],
      }
    : definitions[`/${match[1]}`];
}
export function validateOperation(input: OperationInput) {
  const value = OperationInput.parse(input);
  const definition = offlineDefinition(value.method, value.path);
  if (!definition)
    throw new Error("This change requires an online connection.");
  if (!definition.permissions.some((permission) => can(value.role, permission)))
    throw new Error("Your current role cannot queue this operation.");
  if (value.method === "PUT" && value.expectedVersion === undefined)
    throw new Error("Reopen the original server version before editing.");
  return {
    ...value,
    body: definition.input.parse(value.body) as Record<string, unknown>,
  };
}
export function validatedResult(input: OperationInput, value: unknown) {
  const result = OperationResult.parse(value);
  if (result.state === "committed")
    return {
      ...result,
      response: offlineDefinition(input.method, input.path)!.output.parse(
        result.response,
      ),
    };
  return result;
}
export const offlineKey = (scope: OfflineScope, bucket: string) =>
  JSON.stringify([
    "offline-v1",
    scope.userId,
    scope.firmId,
    scope.role,
    bucket,
  ]);
export const immutable = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;
export const requestIdentity = (input: OperationInput) =>
  JSON.stringify([
    input.method,
    input.path,
    input.body,
    input.expectedVersion ?? null,
    input.role,
  ]);
export class PendingOperationError extends Error {
  readonly pending = true;
  constructor(
    readonly key: string,
    message = "Saved on this device, not posted. Open Offline books to sync or review the original request.",
  ) {
    super(message);
  }
}
export const networkFailure = (error: unknown) =>
  (error as { status?: number })?.status === 0;
