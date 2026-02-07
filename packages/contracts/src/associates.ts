import { z } from "zod";
import {
  Id,
  IsoDate,
  IsoDateTime,
  Paise,
  NonNegativePaise,
  PositivePaise,
  Percentage,
  Quantity,
  requiredText,
  FirmHeaders,
  IdempotencyHeaders,
  IfMatchHeaders,
  PageQuery,
  pageOf,
} from "./common";
import { BookScope } from "./items";

export const AssociateRole = z.enum([
  "delivery",
  "referral",
  "commission-partner",
]);
export const AssociateFieldValue = z.union([
  z.string().max(1000),
  z.number().finite(),
  z.boolean(),
]);
export const AssociateFieldInput = z
  .object({
    name: requiredText("Name the field.", 80),
    kind: z.enum(["text", "decimal", "date", "checkbox", "choice"]),
    choices: z.array(requiredText("Enter a choice.", 100)).max(50).default([]),
    required: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.kind === "choice" &&
      (!v.choices.length || new Set(v.choices).size !== v.choices.length)
    )
      ctx.addIssue({
        code: "custom",
        path: ["choices"],
        message: "Provide distinct choices.",
      });
    if (v.kind !== "choice" && v.choices.length)
      ctx.addIssue({
        code: "custom",
        path: ["choices"],
        message: "Only choice fields have choices.",
      });
  });
export const AssociateField = AssociateFieldInput.safeExtend({
  id: Id,
  version: z.number().int().positive(),
});
export const DeliveryProfile = z
  .object({
    vehicle: z.string().max(100).default(""),
    area: z.string().max(200).default(""),
    contactPreference: z.enum(["phone", "message", "none"]).default("phone"),
    printPhone: z.boolean().default(false),
  })
  .strict();
export const CommissionRuleInput = z
  .object({
    payableAccountId: Id,
    rate: Percentage,
    effectiveFrom: IsoDate,
    itemIds: z.array(Id).max(500).default([]),
    groups: z
      .array(requiredText("Enter an item group.", 100))
      .max(100)
      .default([]),
    allowOverride: z.boolean().default(false),
  })
  .strict();
export const AssociateInput = z
  .object({
    name: requiredText("Enter a name.", 150),
    phone: z.string().trim().max(40).default(""),
    email: z.union([z.literal(""), z.email()]).default(""),
    address: z.string().max(500).default(""),
    notes: z.string().max(1000).default(""),
    active: z.boolean().default(true),
    roles: z
      .array(AssociateRole)
      .min(1)
      .max(3)
      .refine((v) => new Set(v).size === v.length, "Choose each role once."),
    partyIds: z.array(Id).max(20).default([]),
    delivery: DeliveryProfile.nullable().default(null),
    commission: CommissionRuleInput.nullable().default(null),
    fields: z.record(Id, AssociateFieldValue).default({}),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.roles.includes("commission-partner") !== !!v.commission)
      ctx.addIssue({
        code: "custom",
        path: ["commission"],
        message: "Commission partners need a commission rule.",
      });
    if (v.roles.includes("delivery") !== !!v.delivery)
      ctx.addIssue({
        code: "custom",
        path: ["delivery"],
        message: "Delivery associates need delivery details.",
      });
  });
export const AssociateRecord = AssociateInput.safeExtend({
  id: Id,
  version: z.number().int().positive(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export const AssociateUpdate = AssociateInput.safeExtend({
  reason: requiredText("Say why the profile changed.", 500),
});
export const DeliverySelection = z
  .object({ associateId: Id, reference: z.string().max(100).default("") })
  .strict();
export const DeliverySnapshot = DeliverySelection.extend({
  name: z.string(),
  vehicle: z.string(),
  phone: z.string().optional(),
  printPhone: z.boolean(),
  profileVersion: z.number().int().positive(),
});
export const CommissionSelection = z
  .object({ associateId: Id, rate: Percentage.optional() })
  .strict();
export const CommissionSnapshot = z.object({
  associateId: Id,
  name: z.string(),
  ruleVersion: z.number().int().positive(),
  payableAccountId: Id,
  rate: Percentage,
  effectiveFrom: IsoDate,
  itemIds: z.array(Id),
  groups: z.array(z.string()),
});
export const InvoiceAssociatesInput = z.object({
  delivery: DeliverySelection.nullable().optional(),
  commission: CommissionSelection.nullable().optional(),
});
export const DeliveryStatus = z.enum([
  "assigned",
  "dispatched",
  "delivered",
  "failed",
  "returned",
]);
export const DeliveryUpdate = z
  .object({
    status: DeliveryStatus,
    date: IsoDate,
    note: z.string().max(500).default(""),
  })
  .strict();
export const DeliveryAssignment = z.object({
  id: Id,
  associateId: Id,
  voucherId: Id,
  voucherNumber: z.string(),
  date: IsoDate,
  snapshot: DeliverySnapshot,
  status: DeliveryStatus,
  statusDate: IsoDate,
  note: z.string(),
  active: z.boolean(),
  version: z.number().int().positive(),
});
export const CommissionAccrual = z.object({
  id: Id,
  associateId: Id,
  saleId: Id,
  saleVersion: z.number().int().positive(),
  lineIndex: z.number().int().nonnegative(),
  bookScope: BookScope,
  date: IsoDate,
  quantity: Quantity.positive(),
  basis: NonNegativePaise,
  earned: NonNegativePaise,
  snapshot: CommissionSnapshot,
  active: z.boolean(),
  balance: Paise,
});
export const CommissionEntry = z.object({
  id: Id,
  associateId: Id,
  accrualId: Id.nullable(),
  sourceVoucherId: Id.nullable(),
  payoutId: Id.nullable(),
  journalId: Id.nullable(),
  date: IsoDate,
  bookScope: BookScope,
  kind: z.enum(["earned", "adjustment", "payout", "payout-reversal"]),
  amount: Paise,
  description: z.string(),
});
export const AssociateStatementQuery = z
  .object({
    from: IsoDate.optional(),
    to: IsoDate.optional(),
    scope: z.enum(["all", "gst", "nongst"]).default("all"),
    unpaidOnly: z.enum(["true", "false"]).default("false"),
  })
  .refine(
    (v) => !v.from || !v.to || v.from <= v.to,
    "Start date must precede end date.",
  );
export const AssociateStatement = z.object({
  opening: Paise,
  earned: Paise,
  adjusted: Paise,
  paid: Paise,
  closing: Paise,
  ledgerBalance: Paise,
  difference: Paise,
  rows: z.array(CommissionEntry),
  accruals: z.array(CommissionAccrual),
});
export const AssociatePayoutInput = z
  .object({
    date: IsoDate,
    ledgerId: Id,
    reference: z.string().max(100).default(""),
    allocations: z
      .array(z.object({ accrualId: Id, amount: PositivePaise }).strict())
      .min(1)
      .max(500),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.allocations.map((a) => a.accrualId)).size ===
      v.allocations.length,
    "Choose each commission entry once.",
  );
export const AssociatePayout = z.object({
  id: Id,
  associateId: Id,
  date: IsoDate,
  ledgerId: Id,
  reference: z.string(),
  amount: PositivePaise,
  version: z.number().int().positive(),
  reversedOn: IsoDate.nullable(),
  reversalReason: z.string().nullable(),
});
export const AssociatePayoutReversal = z
  .object({
    date: IsoDate,
    reason: requiredText("Say why this payout is reversed.", 500),
  })
  .strict();
export const AssociateDetail = z.object({
  associate: AssociateRecord,
  deliveries: z.array(DeliveryAssignment),
  payouts: z.array(AssociatePayout),
});
export const AssociatePageQuery = PageQuery.extend({
  q: z.string().max(150).optional(),
  role: AssociateRole.optional(),
  active: z.enum(["true", "false"]).optional(),
});
export const AssociatePage = pageOf(AssociateRecord);
export const AssociateOption = z.object({
  id: Id,
  name: z.string(),
  roles: z.array(AssociateRole),
  vehicle: z.string(),
});
export const AssociateWriteHeaders = FirmHeaders.extend(
  IdempotencyHeaders.shape,
);
export const AssociateEditHeaders = AssociateWriteHeaders.extend(
  IfMatchHeaders.shape,
);
export type AssociateInput = z.infer<typeof AssociateInput>;
export type AssociateRecord = z.infer<typeof AssociateRecord>;
export type AssociateUpdate = z.infer<typeof AssociateUpdate>;
export type AssociateField = z.infer<typeof AssociateField>;
export type AssociateFieldInput = z.infer<typeof AssociateFieldInput>;
export type CommissionSnapshot = z.infer<typeof CommissionSnapshot>;
export type DeliverySnapshot = z.infer<typeof DeliverySnapshot>;
export type InvoiceAssociatesInput = z.infer<typeof InvoiceAssociatesInput>;
export type DeliveryAssignment = z.infer<typeof DeliveryAssignment>;
export type DeliveryUpdate = z.infer<typeof DeliveryUpdate>;
export type AssociateStatement = z.infer<typeof AssociateStatement>;
export type AssociateStatementQuery = z.infer<typeof AssociateStatementQuery>;
export type AssociatePayoutInput = z.infer<typeof AssociatePayoutInput>;
export type AssociatePayout = z.infer<typeof AssociatePayout>;
export type AssociatePayoutReversal = z.infer<typeof AssociatePayoutReversal>;
export type AssociateDetail = z.infer<typeof AssociateDetail>;
