import { z } from "zod";
import {
  Id,
  IsoDate,
  IsoDateTime,
  Paise,
  Percentage,
  Quantity,
} from "./common";
import { CompositionType, GstRegistration } from "./firms";
import {
  BankAccount,
  GstMode,
  InvoiceSettings,
  InvoiceTemplate,
} from "./settings";
import { ReturnAmounts, VoucherSnapshot, VoucherType } from "./vouchers";
import { LoanDirection, LoanStatus, LoanTerms } from "./loans";
import { ImportApplyResult, ImportKind } from "./imports";
import { ExtendedBackupData, ExtendedBackupRows } from "./backupExtensions";
import { OpeningStockLots } from "./items";
import { InventoryAdjustment } from "./inventory";
import { DeliverySnapshot, CommissionSnapshot } from "./associates";

export const FIRM_EXPORT_VERSION = 4;
export const MAX_FIRM_EXPORT_BYTES = 10 * 1024 * 1024;
export const MAX_FIRM_EXPORT_ROWS = 25_000;
export const RESTORE_UNAVAILABLE =
  "Replacement restore is not supported. Preview this export and confirm restoration into a new firm.";

const Text = z.string().max(20_000);
const Count = z.number().int().nonnegative().safe();
const Scope = z.enum(["gst", "nongst"]).nullable();
const stamps = {
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  version: Count,
};
const firm = { firmId: Id };
const row = { id: Id, ...firm };
const entry = { ...row, voucherId: Id, position: Count };

// Explicit columns prevent a later database migration from leaking auth or operational data.
export const BackupRows = {
  ...ExtendedBackupRows,
  firmProfile: z.strictObject({
    ...firm,
    ...stamps,
    city: Text,
    state: Text,
    stateCode: Text,
    gstin: Text,
    gstRegistration: GstRegistration,
    compositionType: CompositionType.nullable(),
    fyStart: IsoDate,
    address: Text.nullable(),
    phone: Text.nullable(),
    email: Text.nullable(),
    pan: Text.nullable(),
  }),
  invoiceSettings: z.strictObject({
    ...firm,
    ...stamps,
    template: InvoiceTemplate,
    terms: Text,
    showBankDetails: z.boolean(),
    bankLedgerId: Id.nullable(),
    bankAccount: BankAccount.strict().nullable(),
    prefixes: InvoiceSettings.shape.prefixes,
    billOfSupplyPrefix: Text,
  }),
  reminderSettings: z.strictObject({
    ...firm,
    ...stamps,
    enabled: z.boolean(),
    daysBefore: Count,
    onDueDate: z.boolean(),
    repeatEvery: Count,
    minAmount: Paise,
  }),
  parties: z.strictObject({
    ...row,
    ...stamps,
    name: Text,
    type: z.enum(["customer", "supplier"]),
    phone: Text,
    city: Text,
    stateCode: Text,
    gstin: Text.nullable(),
    creditDays: Count,
    creditLimit: Paise,
    openingBalance: Paise,
    openingGstBalance: Paise.nullable(),
    openingDate: IsoDate,
    deletedAt: IsoDateTime.nullable(),
  }),
  items: z.strictObject({
    ...row,
    ...stamps,
    name: Text,
    code: Text,
    hsn: Text,
    groupName: Text,
    taxType: z.enum(["taxable", "nil", "exempt", "nongst"]),
    gstRate: Count,
    unit: Text,
    altUnitName: Text.nullable(),
    altUnitFactor: Quantity.nullable(),
    purchasePrice: Paise,
    salePrice: Paise,
    mrp: Paise,
    reorderLevel: Quantity,
    openingStock: Quantity,
    openingCost: Paise.nullable(),
    openingBookScope: Scope,
    openingLots: OpeningStockLots.nullable(),
    batchNumber: Text.nullable(),
    batchExpiry: IsoDate.nullable(),
    deletedAt: IsoDateTime.nullable(),
  }),
  units: z.strictObject({
    ...firm,
    name: Text,
    uqc: Text,
    enabled: z.boolean(),
    builtIn: z.boolean(),
  }),
  ledgers: z.strictObject({
    ...row,
    ...stamps,
    name: Text,
    kind: z.enum(["cash", "bank"]),
    shortName: Text,
    openingBalance: Paise,
    openingGstBalance: Paise.nullable(),
    deletedAt: IsoDateTime.nullable(),
  }),
  openingAccounts: z.strictObject({
    ...firm,
    account: Text,
    amount: Paise,
    openingGstAmount: Paise.nullable(),
  }),
  accounts: z.strictObject({
    ...row,
    ...stamps,
    name: Text,
    group: Text,
    openingBalance: Paise,
    openingGstBalance: Paise.nullable(),
    contactName: Text,
    phone: Text,
    note: Text,
  }),
  voucherCounters: z.strictObject({
    ...firm,
    type: VoucherType,
    series: Text,
    financialYear: Text,
    lastNumber: Count,
  }),
  vouchers: z.strictObject({
    ...row,
    ...stamps,
    type: VoucherType,
    number: Text,
    date: IsoDate,
    status: z.enum(["draft", "posted", "cancelled"]),
    partyId: Id.nullable(),
    amount: Paise,
    narration: Text.nullable(),
    snapshot: VoucherSnapshot.strict().nullable(),
    interState: z.boolean().nullable(),
    dueDate: IsoDate.nullable(),
    supplierInvoiceNo: Text.nullable(),
    docType: z.enum(["tax-invoice", "bill-of-supply", "invoice"]).nullable(),
    taxMode: GstMode.nullable(),
    bookScope: Scope,
    againstId: Id.nullable(),
    noteReason: Text.nullable(),
    cancelReason: Text.nullable(),
    cancelledAt: IsoDateTime.nullable(),
    editedAt: IsoDateTime.nullable(),
    validUntil: IsoDate.nullable(),
    sourceId: Id.nullable(),
    convertedToId: Id.nullable(),
    mode: z.enum(["cash", "upi", "bank", "cheque", "card"]).nullable(),
    ledgerId: Id.nullable(),
    toLedgerId: Id.nullable(),
    reference: Text.nullable(),
    expenseHead: Text.nullable(),
    clearedOn: IsoDate.nullable(),
    bankClearings: z.record(Id, IsoDate).nullable(),
    tdsSection: Text.nullable(),
    tdsRate: Percentage.nullable(),
    tdsAmount: Paise,
    createdBy: Id.nullable(),
    inventoryAdjustment: InventoryAdjustment.nullable(),
    delivery: DeliverySnapshot.strict().nullable(),
    commission: CommissionSnapshot.strict().nullable(),
  }),
  voucherLines: z.strictObject({
    ...entry,
    itemId: Id,
    qty: Quantity,
    rate: Paise,
    perUnit: Text.nullable(),
    perFactor: Quantity.nullable(),
    discountPercent: Percentage.nullable(),
    discountAmount: Paise,
    gstRate: Count,
    taxType: z.enum(["taxable", "nil", "exempt", "nongst"]).nullable(),
    sourceLine: Count.nullable(),
    returnAmounts: ReturnAmounts.strict().nullable().default(null),
    stockLotId: Text.nullable(),
    stockCost: Paise.nullable(),
    bookScope: Scope,
    // Exports made before exact line maths existed omit this; those lines keep float totals.
    exactMath: z.boolean().default(false),
  }),
  voucherCharges: z.strictObject({
    ...entry,
    name: Text,
    amount: Paise,
    gstRate: Count,
  }),
  journalLines: z.strictObject({
    ...entry,
    account: Text,
    name: Text,
    debit: Paise,
    credit: Paise,
  }),
  allocations: z.strictObject({
    ...row,
    voucherId: Id,
    billId: Id.nullable(),
    openingPartyId: Id.nullable(),
    openingBillId: Id.nullable(),
    amount: Paise,
  }),
  postings: z.strictObject({
    ...entry,
    account: Text,
    ledgerName: Text,
    debit: Paise,
    credit: Paise,
    date: IsoDate,
  }),
  stockMovements: z.strictObject({
    ...row,
    voucherId: Id,
    itemId: Id,
    date: IsoDate,
    qty: Quantity,
  }),
  documents: z.strictObject({
    ...row,
    ...stamps,
    name: Text,
    kind: z.enum(["bill", "receipt", "certificate", "agreement", "other"]),
    sizeBytes: Count,
    s3Key: Text.nullable(),
    thumbnailKey: Text.nullable(),
    contentType: Text.nullable(),
    readyAt: IsoDateTime.nullable(),
    folder: Text,
    accountKey: Text.nullable(),
    partyId: Id.nullable(),
    voucherId: Id.nullable(),
    note: Text.nullable(),
    uploadedOn: IsoDate,
    deletedAt: IsoDateTime.nullable(),
  }),
  remindersSent: z.strictObject({ ...firm, partyId: Id, sentOn: IsoDate }),
  auditLog: z.strictObject({
    ...row,
    voucherId: Id,
    number: Text,
    voucherType: VoucherType,
    action: z.enum([
      "created",
      "edited",
      "cancelled",
      "converted",
      "reopened",
      "bank-date",
    ]),
    at: IsoDateTime,
    userId: Id,
    userName: Text,
    changes: z.array(
      z.strictObject({ field: Text, before: Text, after: Text }),
    ),
    note: Text.nullable(),
  }),
  bookControls: z.strictObject({
    ...firm,
    closedThrough: IsoDate.nullable(),
    openingApprovedAt: IsoDateTime.nullable(),
    openingApprovedBy: Text.nullable(),
    version: Count,
  }),
  bookControlEvents: z.strictObject({
    ...row,
    action: Text,
    reason: Text,
    userId: Id,
    userName: Text,
    at: IsoDateTime,
    // Historical control snapshots are retained verbatim, never executed or imported.
    before: z.json(),
    after: z.json(),
  }),
  loans: z.strictObject({
    ...row,
    ...stamps,
    accountId: Id,
    direction: LoanDirection,
    name: Text,
    counterparty: Text,
    agreementReference: Text,
    note: Text,
    terms: LoanTerms.strict(),
    maturityDate: IsoDate,
    status: LoanStatus,
  }),
  loanRepaymentReferences: z.strictObject({
    ...row,
    loanId: Id,
    voucherId: Id,
    voucherVersion: Count,
    voucherNumber: Text,
    voucherDate: IsoDate,
    installmentNumber: Count,
    principalConfirmed: z.literal(true),
    principal: Paise,
    interest: Paise,
    note: Text,
    createdAt: IsoDateTime,
    removedAt: IsoDateTime.nullable(),
  }),
  loanEvents: z.strictObject({
    ...row,
    loanId: Id,
    action: z.enum([
      "created",
      "updated",
      "reference-added",
      "reference-removed",
    ]),
    reason: Text,
    userId: Id,
    userName: Text,
    at: IsoDateTime,
    before: z.json(),
    after: z.json(),
  }),
  masterImportBatches: z.strictObject({
    ...row,
    userId: Id,
    requestKey: Id,
    fileHash: z.string().regex(/^[a-f0-9]{64}$/),
    kind: ImportKind,
    result: ImportApplyResult.strict(),
    appliedAt: IsoDateTime,
  }),
};

const rows = <T extends z.ZodType>(schema: T) =>
  z.array(schema).max(MAX_FIRM_EXPORT_ROWS);
export const FirmExportData = z.strictObject({
  ...ExtendedBackupData,
  organization: z.strictObject({ id: Id, name: Text, createdAt: IsoDateTime }),
  firmProfile: BackupRows.firmProfile,
  invoiceSettings: BackupRows.invoiceSettings,
  reminderSettings: BackupRows.reminderSettings,
  parties: rows(BackupRows.parties),
  items: rows(BackupRows.items),
  units: rows(BackupRows.units),
  ledgers: rows(BackupRows.ledgers),
  openingAccounts: rows(BackupRows.openingAccounts),
  accounts: rows(BackupRows.accounts),
  voucherCounters: rows(BackupRows.voucherCounters),
  vouchers: rows(BackupRows.vouchers),
  voucherLines: rows(BackupRows.voucherLines),
  voucherCharges: rows(BackupRows.voucherCharges),
  journalLines: rows(BackupRows.journalLines),
  allocations: rows(BackupRows.allocations),
  postings: rows(BackupRows.postings),
  stockMovements: rows(BackupRows.stockMovements),
  documents: rows(BackupRows.documents),
  remindersSent: rows(BackupRows.remindersSent),
  auditLog: rows(BackupRows.auditLog),
  bookControls: BackupRows.bookControls.nullable(),
  bookControlEvents: rows(BackupRows.bookControlEvents),
  loans: rows(BackupRows.loans),
  loanRepaymentReferences: rows(BackupRows.loanRepaymentReferences),
  loanEvents: rows(BackupRows.loanEvents),
  masterImportBatches: rows(BackupRows.masterImportBatches),
});
export type FirmExportData = z.infer<typeof FirmExportData>;

export const AttachmentManifest = z.strictObject({
  coverage: z.literal("metadata-only"),
  binariesIncluded: z.literal(false),
  offsiteRecoveryVerified: z.literal(false),
  objects: rows(
    z.strictObject({
      documentId: Id,
      state: z.enum(["ready", "pending", "deleted"]),
      originalKey: Text.nullable(),
      thumbnailKey: Text.nullable(),
      sizeBytes: Count,
      contentType: Text.nullable(),
      availability: z.literal("not-checked"),
    }),
  ),
});

export const FirmExportPayload = z.strictObject({
  app: z.literal("hisaab"),
  kind: z.literal("firm-books-export"),
  version: z.literal(FIRM_EXPORT_VERSION),
  savedAt: IsoDateTime,
  sourceFirmId: Id,
  data: FirmExportData,
  attachments: AttachmentManifest,
});
export type FirmExportPayload = z.infer<typeof FirmExportPayload>;

export const FirmExportFile = z.strictObject({
  payload: FirmExportPayload,
  integrity: z.strictObject({
    algorithm: z.literal("sha256"),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});
export type FirmExportFile = z.infer<typeof FirmExportFile>;

// Older files are checked against their exact original schema before a lossless upgrade.
const LegacyDataV3 = FirmExportData.omit({
  settlementEntries: true,
  settlementAllocations: true,
  creditApprovals: true,
  creditApprovalUses: true,
  orderSourceLines: true,
  orderFulfillments: true,
  orderFulfillmentLines: true,
  associates: true,
  associateFields: true,
  associateRules: true,
  deliveryAssignments: true,
  commissionAccruals: true,
  associatePayouts: true,
  commissionPayoutAllocations: true,
  associateJournals: true,
  commissionEntries: true,
  associateEvents: true,
  importedOpeningBalances: true,
  openingBills: true,
}).extend({
  items: rows(BackupRows.items.omit({ openingLots: true })),
  vouchers: rows(
    BackupRows.vouchers.omit({
      inventoryAdjustment: true,
      delivery: true,
      commission: true,
    }),
  ),
  allocations: rows(BackupRows.allocations.omit({ openingBillId: true })),
});
export const LegacyFirmExportFileV3 = FirmExportFile.extend({
  payload: FirmExportPayload.extend({
    version: z.literal(3),
    data: LegacyDataV3,
  }),
});
export const LegacyFirmExportFileV2 = FirmExportFile.extend({
  payload: FirmExportPayload.extend({
    version: z.literal(2),
    data: LegacyDataV3.omit({
      loans: true,
      loanRepaymentReferences: true,
      loanEvents: true,
      masterImportBatches: true,
    }).extend({
      parties: rows(BackupRows.parties.omit({ openingGstBalance: true })),
      ledgers: rows(BackupRows.ledgers.omit({ openingGstBalance: true })),
      accounts: rows(BackupRows.accounts.omit({ openingGstBalance: true })),
      openingAccounts: rows(
        BackupRows.openingAccounts.omit({ openingGstAmount: true }),
      ),
    }),
  }),
});

export const BackupCounts = z.strictObject({
  parties: Count,
  items: Count,
  vouchers: Count,
  documents: Count,
});
export const BackupStatusView = z.strictObject({
  firmName: Text,
  counts: BackupCounts,
  coverage: z.literal("books-and-attachment-metadata"),
  restoreAvailable: z.literal(true),
  automaticBackupAvailable: z.literal(false),
  maxExportBytes: Count,
  maxExportRows: Count,
});
export const BackupExportResponse = z.strictObject({
  fileName: z.string().regex(/^Hisaab_[A-Za-z0-9_]+_\d{4}-\d{2}-\d{2}\.json$/),
  text: z.string().max(MAX_FIRM_EXPORT_BYTES),
});
export const BackupInspectInput = z.strictObject({
  text: z.string().min(1).max(MAX_FIRM_EXPORT_BYTES),
});
export const BackupInspection = z.strictObject({
  firmName: Text,
  savedAt: IsoDateTime,
  counts: BackupCounts,
  version: z.literal(FIRM_EXPORT_VERSION),
  sourceFirmId: Id,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  restoreAvailable: z.literal(true),
  attachments: z.literal("metadata-only"),
  warnings: z.array(z.string()),
});
export type BackupInspection = z.infer<typeof BackupInspection>;

export const BackupRestorePreviewInput = BackupInspectInput.extend({
  name: z.string().trim().min(1).max(200),
});
export const BackupRestorePreview = BackupInspection.extend({
  previewId: Id,
  newFirmName: z.string(),
  expiresAt: IsoDateTime,
  missingAttachments: Count,
});
export const BackupRestoreInput = BackupInspectInput.extend({
  previewId: Id,
  confirmNewFirm: z.literal(true),
  acknowledgeMissingAttachments: z.literal(true),
});
export const BackupRestoreResult = z.strictObject({
  firmId: Id,
  firmName: z.string(),
  sourceFirmId: Id,
  savedAt: IsoDateTime,
  restoredAt: IsoDateTime,
  counts: BackupCounts,
  missingAttachments: Count,
  remindersEnabled: z.literal(false),
  originEventId: Id,
});
export const BackupRecoveryStatus = z.strictObject({
  sourceFirmId: Id.nullable(),
  restoredAt: IsoDateTime.nullable(),
  missingAttachments: Count,
});
export type BackupRestorePreviewInput = z.infer<
  typeof BackupRestorePreviewInput
>;
export type BackupRestorePreview = z.infer<typeof BackupRestorePreview>;
export type BackupRestoreInput = z.infer<typeof BackupRestoreInput>;
export type BackupRestoreResult = z.infer<typeof BackupRestoreResult>;
export type BackupRecoveryStatus = z.infer<typeof BackupRecoveryStatus>;
