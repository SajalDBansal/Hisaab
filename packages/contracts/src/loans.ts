import { z } from "zod";
import { loanSchedule } from "@repo/core/src/accounting/loanSchedule";
import {
  Id,
  IsoDate,
  IsoDateTime,
  NonNegativePaise,
  Paise,
  PositivePaise,
  pageOf,
} from "./common";

export const LoanDirection = z.enum(["borrowed", "lent"]);
export const LoanStatus = z.enum(["active", "closed"]);
export const LoanTerms = z
  .object({
    principal: PositivePaise,
    annualRateBps: z.number().int().min(0).max(10000),
    installments: z.number().int().min(1).max(600),
    startDate: IsoDate,
    firstDueDate: IsoDate,
    scheduleModel: z.enum([
      "fixed-principal-monthly-v1",
      "fixed-principal-v2",
      "emi-v1",
    ]),
    interestBasis: z.enum(["monthly", "actual-365", "actual-360"]).optional(),
    rateChanges: z
      .array(
        z.object({
          effectiveDate: IsoDate,
          annualRateBps: z.number().int().min(0).max(10000),
        }),
      )
      .max(600)
      .optional(),
  })
  .superRefine((terms, ctx) => {
    try {
      loanSchedule(terms);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid schedule.",
        path: ["firstDueDate"],
      });
    }
  });
export const LoanInput = z.object({
  name: z.string().trim().min(1).max(150),
  counterparty: z.string().trim().min(1).max(150),
  agreementReference: z.string().trim().max(150),
  note: z.string().trim().max(1000),
  accountId: Id,
  direction: LoanDirection,
  terms: LoanTerms,
});
export const LoanUpdate = LoanInput.extend({
  status: LoanStatus,
  reason: z.string().trim().min(3).max(500),
});
export const LoanRecord = LoanInput.extend({
  id: Id,
  version: z.number().int().positive(),
  status: LoanStatus,
  maturityDate: IsoDate,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export const LoanInstallment = z.object({
  number: z.number().int().positive(),
  dueDate: IsoDate,
  openingPrincipal: NonNegativePaise,
  principal: PositivePaise,
  interest: NonNegativePaise,
  total: PositivePaise,
  closingPrincipal: NonNegativePaise,
  periodStart: IsoDate.optional(),
  days: z.number().int().positive().optional(),
  annualRateBps: z.number().int().min(0).max(10000).optional(),
  rateSegments: z
    .array(
      z.object({
        from: IsoDate,
        to: IsoDate,
        annualRateBps: z.number().int().min(0).max(10000),
      }),
    )
    .optional(),
});
export const LoanSchedule = z.object({
  installments: z.array(LoanInstallment),
  maturityDate: IsoDate,
  totalPrincipal: PositivePaise,
  totalInterest: NonNegativePaise,
  totalRepayment: PositivePaise,
});
export const LoanReferenceAllocation = z.strictObject({
  principal: PositivePaise,
  settledInterest: NonNegativePaise,
  confirmed: z.literal(
    true,
    "Confirm the reviewed principal and settled-interest split.",
  ),
});
const LoanReferenceFields = z.object({
  voucherId: Id,
  voucherVersion: z.number().int().positive(),
  installmentNumber: z.number().int().min(1).max(600),
  principalConfirmed: z.literal(
    true,
    "Confirm the principal amount in this repayment reference.",
  ),
  note: z.string().trim().max(500),
});
export const LoanReferenceInput = LoanReferenceFields.extend({
  allocation: LoanReferenceAllocation.optional(),
}).strict();
export const LoanReferenceRemoval = z.object({
  reason: z.string().trim().min(3).max(500),
});
export const LoanReference = LoanReferenceFields.extend({
  id: Id,
  voucherNumber: z.string(),
  voucherDate: IsoDate,
  principal: PositivePaise,
  interest: NonNegativePaise,
  sourceValues: z
    .object({
      accountReduction: PositivePaise,
      separatelyPostedInterest: NonNegativePaise,
      settledInterest: NonNegativePaise,
    })
    .optional(),
  createdAt: IsoDateTime,
  removedAt: IsoDateTime.nullable(),
  state: z.enum(["valid", "changed", "cancelled", "missing", "removed"]),
});
export const LoanSummary = z.object({
  loan: LoanRecord,
  accountName: z.string(),
  // Signed Dr-positive balance of the whole linked account, including its opening balance.
  postedBalance: Paise,
});
export const LoanDetail = LoanSummary.extend({
  schedule: LoanSchedule,
  references: z.array(LoanReference),
  referencedPrincipal: NonNegativePaise,
  referencedInterest: NonNegativePaise,
});
export const LoanJournalCandidate = z.object({
  id: Id,
  version: z.number().int().positive(),
  number: z.string(),
  date: IsoDate,
  accountReduction: PositivePaise,
  separatelyPostedInterest: NonNegativePaise,
});
export const LoanEvent = z.object({
  id: Id,
  action: z.enum([
    "created",
    "updated",
    "reference-added",
    "reference-removed",
  ]),
  reason: z.string(),
  userId: Id,
  userName: z.string(),
  at: IsoDateTime,
  before: z.unknown(),
  after: z.unknown(),
});
export const LoanPageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: Id.optional(),
});
export const LoanPage = pageOf(LoanSummary);
export const LoanHistoryPage = pageOf(LoanEvent);
export const LoanCandidatePage = pageOf(LoanJournalCandidate);
export const LoanWriteHeaders = z.object({
  "idempotency-key": z.string().min(8).max(100),
});
export const LoanEditHeaders = LoanWriteHeaders.extend({
  "if-match": z
    .string()
    .regex(/^[1-9]\d*$/)
    .refine((v) => Number.isSafeInteger(Number(v)), "Invalid version."),
});
export const LoanReferenceParams = z.object({ id: Id, referenceId: Id });

export type LoanInput = z.infer<typeof LoanInput>;
export type LoanUpdate = z.infer<typeof LoanUpdate>;
export type LoanRecord = z.infer<typeof LoanRecord>;
export type LoanDetail = z.infer<typeof LoanDetail>;
export type LoanSummary = z.infer<typeof LoanSummary>;
export type LoanReferenceInput = z.infer<typeof LoanReferenceInput>;
export type LoanReferenceAllocation = z.infer<typeof LoanReferenceAllocation>;
export type LoanReference = z.infer<typeof LoanReference>;
export type LoanJournalCandidate = z.infer<typeof LoanJournalCandidate>;
export type LoanEvent = z.infer<typeof LoanEvent>;
