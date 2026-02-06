import { z } from "zod";
import { Id, IsoDate, IsoDateTime, Paise, Quantity } from "./common";

export const MAX_IMPORT_BYTES = 262_144;
export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_CELL_LENGTH = 500;
export const MAX_IMPORT_ERRORS = 250;
export const IMPORT_PREVIEW_SECONDS = 900;

export const MasterImportKind = z.enum(["customers", "suppliers", "items"]);
export type MasterImportKind = z.infer<typeof MasterImportKind>;
export const FinancialImportKind = z.enum([
  "opening-balances",
  "open-bills",
  "opening-stock",
]);
export type FinancialImportKind = z.infer<typeof FinancialImportKind>;
export const ImportKind = z.enum([
  ...MasterImportKind.options,
  ...FinancialImportKind.options,
]);
export type ImportKind = z.infer<typeof ImportKind>;
export const isFinancialImport = (
  kind: ImportKind,
): kind is FinancialImportKind =>
  FinancialImportKind.options.includes(kind as FinancialImportKind);
export const ImportKindQuery = z.object({ kind: ImportKind }).strict();

export const ImportBookTotals = z.object({
  scope: z.enum(["gst", "nongst", "all"]),
  debit: Paise.nonnegative(),
  credit: Paise.nonnegative(),
  net: Paise,
  capital: Paise,
  stockValue: Paise.nonnegative(),
  billAmount: Paise.nonnegative(),
});
export const ImportReconciliation = z
  .object({
    totals: z.array(ImportBookTotals).length(3),
    reconciled: z.boolean(),
    parties: z
      .array(
        z.object({
          partyId: Id,
          expected: Paise,
          actual: Paise,
          expectedGst: Paise,
          actualGst: Paise,
        }),
      )
      .max(MAX_IMPORT_ROWS),
  })
  .superRefine((value, ctx) => {
    const gst = value.totals.find((t) => t.scope === "gst");
    const nongst = value.totals.find((t) => t.scope === "nongst");
    const all = value.totals.find((t) => t.scope === "all");
    if (!gst || !nongst || !all) {
      ctx.addIssue({
        code: "custom",
        message: "Include each of the three books exactly once.",
        path: ["totals"],
      });
      return;
    }
    for (const field of [
      "debit",
      "credit",
      "net",
      "capital",
      "stockValue",
      "billAmount",
    ] as const)
      if (
        [gst[field], nongst[field], all[field]].every(Number.isSafeInteger) &&
        BigInt(gst[field]) + BigInt(nongst[field]) !== BigInt(all[field])
      )
        ctx.addIssue({
          code: "custom",
          message: "GST and non-GST must reconcile to mixed totals.",
          path: ["totals"],
        });
    if (
      value.totals.some(
        (t) => t.net !== t.debit - t.credit || t.capital !== -t.net,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Opening totals and capital must balance.",
        path: ["totals"],
      });
    if (
      value.reconciled &&
      value.parties.some(
        (p) =>
          p.expected !== p.actual ||
          p.expectedGst !== p.actualGst ||
          p.expected <= 0,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Opening bills must reconcile to their party opening.",
        path: ["parties"],
      });
  });
export type ImportReconciliation = z.infer<typeof ImportReconciliation>;

/** Immutable bill-wise allocation of a net opening, never an invoice or posting. */
export const ImportedOpeningBill = z
  .object({
    id: Id,
    partyId: Id,
    number: z.string().min(1).max(80),
    date: IsoDate,
    dueDate: IsoDate,
    openingDate: IsoDate,
    amount: Paise.positive(),
    gstAmount: Paise.nonnegative(),
  })
  .refine(
    (bill) =>
      bill.gstAmount <= bill.amount &&
      bill.date <= bill.openingDate &&
      bill.dueDate >= bill.date,
    "Opening bill amounts and dates must be consistent.",
  );
export type ImportedOpeningBill = z.infer<typeof ImportedOpeningBill>;

export const ImportPreviewInput = z
  .object({
    kind: ImportKind,
    text: z.string().min(1).max(MAX_IMPORT_BYTES),
  })
  .strict();
export type ImportPreviewInput = z.infer<typeof ImportPreviewInput>;

export const ImportApplyInput = ImportPreviewInput.extend({
  previewToken: z.string().min(1).max(2048),
  confirmed: z.literal(true),
}).strict();
export type ImportApplyInput = z.infer<typeof ImportApplyInput>;

export const ImportRequestHeaders = z.object({
  "idempotency-key": z.uuid(),
});

export const ImportRowError = z.object({
  // Record number, including the header. Quoted newlines do not increment it.
  row: z.number().int().min(1),
  field: z.string().max(80),
  code: z.enum(["csv", "header", "limit", "invalid", "duplicate"]),
  message: z.string().max(500),
});
export type ImportRowError = z.infer<typeof ImportRowError>;

export const ImportPreviewRow = z.object({
  row: z.number().int().min(2),
  values: z.record(z.string(), z.string().max(MAX_IMPORT_CELL_LENGTH)),
});

export const ImportPreview = z
  .object({
    kind: ImportKind,
    rowCount: z.number().int().min(0).max(MAX_IMPORT_ROWS),
    validRows: z.number().int().min(0).max(MAX_IMPORT_ROWS),
    rows: z.array(ImportPreviewRow).max(MAX_IMPORT_ROWS),
    errors: z.array(ImportRowError).max(MAX_IMPORT_ERRORS),
    errorsTruncated: z.boolean(),
    canApply: z.boolean(),
    previewToken: z.string().max(2048).nullable(),
    expiresAt: IsoDateTime.nullable(),
    errorsCsv: z.string(),
    reconciliation: ImportReconciliation.optional(),
  })
  .superRefine((value, ctx) => {
    if (isFinancialImport(value.kind) && !value.reconciliation)
      ctx.addIssue({
        code: "custom",
        message: "Financial previews require reconciliation.",
        path: ["reconciliation"],
      });
  });
export type ImportPreview = z.infer<typeof ImportPreview>;

export const ImportTemplate = z.object({
  fileName: z
    .string()
    .regex(
      /^hisaab-(customers|suppliers|items|opening-balances|open-bills|opening-stock)-template\.csv$/,
    ),
  text: z.string().max(MAX_IMPORT_BYTES),
});
export type ImportTemplate = z.infer<typeof ImportTemplate>;

export const ImportApplyResult = z
  .object({
    batchId: Id,
    kind: ImportKind,
    createdCount: z.number().int().min(1).max(MAX_IMPORT_ROWS),
    createdIds: z.array(Id).min(1).max(MAX_IMPORT_ROWS),
    appliedAt: IsoDateTime,
    reconciliation: ImportReconciliation.optional(),
    stockLots: z
      .array(
        z.object({
          id: Id,
          itemId: Id,
          lotNumber: z.string().min(1).max(80),
          date: IsoDate,
          qty: Quantity.positive(),
          unitCost: Paise.nonnegative(),
          bookScope: z.enum(["gst", "nongst"]),
        }),
      )
      .max(MAX_IMPORT_ROWS)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.createdCount !== value.createdIds.length)
      ctx.addIssue({
        code: "custom",
        message: "The import count must match its saved records.",
        path: ["createdCount"],
      });
    if (isFinancialImport(value.kind) && !value.reconciliation?.reconciled)
      ctx.addIssue({
        code: "custom",
        message: "Financial receipts require reconciled totals.",
        path: ["reconciliation"],
      });
    if (
      value.kind === "opening-stock" &&
      value.stockLots?.length !== value.createdCount
    )
      ctx.addIssue({
        code: "custom",
        message: "The stock receipt must retain every imported lot.",
        path: ["stockLots"],
      });
  });
export type ImportApplyResult = z.infer<typeof ImportApplyResult>;

// A conflict returns the new row errors without committing any rows.
export const ImportApplyResponse = z.discriminatedUnion("status", [
  z.object({ status: z.literal("applied"), result: ImportApplyResult }),
  z.object({ status: z.literal("invalid"), preview: ImportPreview }),
]);
export type ImportApplyResponse = z.infer<typeof ImportApplyResponse>;
