import { z } from "zod";
import {
  Role,
  Voucher,
  CustomAccount,
  LedgerRow,
  RecoveryEpoch,
  type VoucherType,
} from "@repo/contracts";
import { can, type Permission } from "@repo/core";

export const FinancialAttachmentPath = z.enum([
  "/sales",
  "/sales/split",
  "/purchases",
  "/receipts",
  "/payments",
  "/expenses",
  "/journals",
  "/contras",
  "/credit-notes",
  "/debit-notes",
  "/orders/estimate",
  "/orders/sales-order",
  "/orders/purchase-order",
  "/orders/delivery-note",
  "/accounts/masters",
  "/ledgers",
  "/inventory/adjustments",
]);
export type FinancialAttachmentPath = z.infer<typeof FinancialAttachmentPath>;
export const AttachmentFileInfo = z.object({
  name: z.string(),
  contentType: z.string(),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
});
export const AttachmentAnswer = z.union([Voucher, CustomAccount, LedgerRow]);
export const AttachmentDraft = z.object({
  role: Role,
  path: FinancialAttachmentPath,
  body: z.record(z.string(), z.unknown()),
  createdAt: z.number().int().nonnegative(),
  ready: z.boolean(),
  receiptProtocol: z.enum(["operations-v1", "durable-retries-v1"]).optional(),
  recoveryEpoch: RecoveryEpoch.optional(),
  cancelled: z.boolean().optional(),
  firstAttemptAt: z.number().int().nonnegative().optional(),
  binding: z.literal("all-returned-vouchers"),
  expectedVouchers: z.union([z.literal(1), z.literal(2)]),
  files: z
    .array(z.object({ id: z.uuid(), file: AttachmentFileInfo }))
    .min(1)
    .max(10),
  response: z.array(AttachmentAnswer).min(1).optional(),
  links: z
    .array(
      z.object({
        sourceId: z.uuid(),
        id: z.uuid(),
        voucherId: z.uuid(),
        released: z.boolean(),
      }),
    )
    .default([]),
});
export type AttachmentDraft = z.infer<typeof AttachmentDraft>;
export type DraftActor = {
  userId: string;
  firmId: string;
  role: z.infer<typeof Role>;
};

const rights: Record<FinancialAttachmentPath, Permission> = {
  "/sales": "sales",
  "/sales/split": "sales",
  "/purchases": "purchase",
  "/receipts": "sales",
  "/payments": "purchase",
  "/expenses": "purchase",
  "/journals": "accounts",
  "/contras": "payments",
  "/credit-notes": "sales",
  "/debit-notes": "purchase",
  "/orders/estimate": "sales",
  "/orders/sales-order": "sales",
  "/orders/purchase-order": "purchase",
  "/orders/delivery-note": "sales",
  "/accounts/masters": "accounts",
  "/ledgers": "payments",
  "/inventory/adjustments": "accounts",
};
export const canRecoverAttachmentDraft = (
  role: DraftActor["role"],
  draft: AttachmentDraft,
) => role === draft.role && can(role, rights[draft.path]);

export const financialAttachmentTypes: Partial<
  Record<FinancialAttachmentPath, VoucherType>
> = {
  "/sales": "sale",
  "/sales/split": "sale",
  "/purchases": "purchase",
  "/receipts": "receipt",
  "/payments": "payment",
  "/expenses": "expense",
  "/journals": "journal",
  "/contras": "contra",
  "/credit-notes": "credit-note",
  "/debit-notes": "debit-note",
  "/orders/estimate": "estimate",
  "/orders/sales-order": "sales-order",
  "/orders/purchase-order": "purchase-order",
  "/orders/delivery-note": "delivery-note",
  "/inventory/adjustments": "journal",
};

// Older drafts used a seven-day cache. Keep their unknown saves blocked after expiry.
export const financialAttachmentReplayMs = 6 * 24 * 60 * 60 * 1000;
export function attachmentDraftProblem(
  draft: AttachmentDraft,
  now = Date.now(),
) {
  if (draft.cancelled)
    return "The original operation was cancelled. Its preserved copies can be discarded.";
  if (draft.response) return undefined;
  if (!draft.ready)
    return "Attachment preparation was interrupted. No financial request was sent. Discard this draft and select the files again.";
  if (
    !draft.receiptProtocol &&
    draft.firstAttemptAt !== undefined &&
    (now < draft.firstAttemptAt ||
      now - draft.firstAttemptAt >= financialAttachmentReplayMs)
  )
    return "The original save is too old to replay safely. Keep this draft until its original server answer can be reconciled.";
  return undefined;
}
