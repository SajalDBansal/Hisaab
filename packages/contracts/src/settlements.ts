import { z } from "zod";
import {
  Id,
  IsoDate,
  IsoDateTime,
  Paise,
  PositivePaise,
  pageOf,
} from "./common";
import { Allocation, NewInvoiceInput } from "./vouchers";
import { OrderFulfillmentInput } from "./orderFulfillment";

export const SettlementKind = z.enum([
  "advance-receipt",
  "advance-payment",
  "customer-refund",
  "supplier-refund",
  "receivable-writeoff",
  "payable-writeoff",
  "allocation-correction",
  "loan-interest-accrual",
  "loan-interest-payment",
  "reversal",
]);
const base = z.object({
  date: IsoDate,
  bookScope: z.enum(["gst", "nongst"]),
  reason: z.string().trim().min(3).max(500),
});
const party = base.extend({
  partyId: Id,
  partyVersion: z.number().int().positive(),
});
const money = party.extend({ amount: PositivePaise, ledgerId: Id });
const writeoff = party.extend({
  allocations: z.array(Allocation).min(1).max(200),
});
export const SettlementInput = z.discriminatedUnion("kind", [
  money.extend({ kind: z.literal("advance-receipt") }),
  money.extend({ kind: z.literal("advance-payment") }),
  money.extend({ kind: z.literal("customer-refund") }),
  money.extend({ kind: z.literal("supplier-refund") }),
  writeoff.extend({ kind: z.literal("receivable-writeoff") }),
  writeoff.extend({ kind: z.literal("payable-writeoff") }),
  party.extend({
    kind: z.literal("allocation-correction"),
    sourceVoucherId: Id,
    sourceVersion: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    allocations: z.array(Allocation).max(200),
  }),
]);
export const LoanInterestInput = base
  .extend({
    kind: z.enum(["loan-interest-accrual", "loan-interest-payment"]),
    loanId: Id,
    loanVersion: z.number().int().positive(),
    installmentNumber: z.number().int().min(1).max(600),
    interestAccountId: Id,
    amount: PositivePaise,
    ledgerId: Id.optional(),
    sourceEntryId: Id.optional(),
    confirmedNoDuplicate: z.literal(true),
  })
  .superRefine((value, ctx) => {
    if (
      value.kind === "loan-interest-payment" &&
      (!value.ledgerId || !value.sourceEntryId)
    )
      ctx.addIssue({
        code: "custom",
        message: "Select the accrual and cash/bank account.",
      });
  });
export const SettlementReverseInput = base.extend({
  version: z.number().int().positive(),
});
export const SettlementAllocation = z.object({
  voucherId: z.string().min(1),
  amount: Paise,
});
export const SettlementRecord = z.object({
  id: Id,
  firmId: Id,
  kind: SettlementKind,
  voucherId: Id,
  partyId: Id.nullable(),
  sourceVoucherId: Id.nullable(),
  sourceEntryId: Id.nullable(),
  loanId: Id.nullable(),
  interestAccountId: Id.nullable(),
  installmentNumber: z.number().int().nullable(),
  date: IsoDate,
  bookScope: z.enum(["gst", "nongst"]),
  amount: PositivePaise,
  reason: z.string(),
  userId: Id,
  userName: z.string(),
  createdAt: IsoDateTime,
  version: z.literal(1),
  details: z.unknown(),
});
export const SettlementPage = pageOf(SettlementRecord);
export const SettlementQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: Id.optional(),
  partyId: Id.optional(),
  loanId: Id.optional(),
});
export const SettlementContext = z.object({
  partyId: Id,
  partyVersion: z.number().int().positive(),
  balance: Paise,
  bills: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      date: IsoDate,
      pending: Paise,
    }),
  ),
  sources: z.array(
    z.object({
      id: Id,
      number: z.string(),
      date: IsoDate,
      version: z.number().int().positive(),
      amount: PositivePaise,
      revision: z.number().int().nonnegative(),
      allocations: z.array(Allocation),
    }),
  ),
});
export const SettlementContextQuery = z.object({
  partyId: Id,
  date: IsoDate,
  bookScope: z.enum(["gst", "nongst"]),
});
export const SettlementWriteHeaders = z.object({
  "idempotency-key": z.string().min(8).max(100),
});
export const CreditApprovalInput = z
  .object({
    sale: NewInvoiceInput,
    reason: z.string().trim().min(3).max(500),
    editVoucherId: Id.optional(),
    editVersion: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.editVoucherId === undefined) !==
      (value.editVersion === undefined)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "An edit approval requires both the sale ID and its reviewed version.",
      });
  });
export const CreditApproval = z.object({
  id: Id,
  partyId: Id,
  partyVersion: z.number().int().positive(),
  saleHash: z.string(),
  creditLimit: Paise,
  projectedBalance: Paise,
  reason: z.string(),
  userId: Id,
  userName: z.string(),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export const OrderCreditApprovalInput = z.object({
  sourceId: Id,
  fulfillment: OrderFulfillmentInput,
  reason: z.string().trim().min(3).max(500),
});
export type SettlementInput = z.infer<typeof SettlementInput>;
export type SettlementRecord = z.infer<typeof SettlementRecord>;
export type SettlementQuery = z.infer<typeof SettlementQuery>;
export type SettlementContext = z.infer<typeof SettlementContext>;
export type SettlementContextQuery = z.infer<typeof SettlementContextQuery>;
export type LoanInterestInput = z.infer<typeof LoanInterestInput>;
export type CreditApprovalInput = z.infer<typeof CreditApprovalInput>;
export type CreditApproval = z.infer<typeof CreditApproval>;
export type OrderCreditApprovalInput = z.infer<typeof OrderCreditApprovalInput>;
