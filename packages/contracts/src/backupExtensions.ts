import { z } from "zod";
import { Id, IsoDate, IsoDateTime, Paise, Quantity } from "./common";
import {
  AssociateInput,
  AssociateFieldInput,
  CommissionSnapshot,
  DeliverySnapshot,
  DeliveryStatus,
} from "./associates";
import { InvoiceLine } from "./vouchers";
import { OrderFulfillmentResult } from "./orderFulfillment";
import { SettlementKind } from "./settlements";

const Text = z.string().max(20_000);
const Count = z.number().int().nonnegative().safe();
const row = { id: Id, firmId: Id };
const stamps = {
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  version: Count,
};
const scope = z.enum(["gst", "nongst"]);

// Version four lists business columns explicitly; credentials and retry sessions stay out.
export const ExtendedBackupRows = {
  settlementEntries: z.strictObject({
    ...row,
    kind: SettlementKind,
    voucherId: Id,
    partyId: Id.nullable(),
    sourceVoucherId: Id.nullable(),
    sourceEntryId: Id.nullable(),
    loanId: Id.nullable(),
    interestAccountId: Id.nullable(),
    installmentNumber: Count.nullable(),
    date: IsoDate,
    bookScope: scope,
    amount: Paise,
    reason: Text,
    userId: Id,
    userName: Text,
    version: z.literal(1),
    createdAt: IsoDateTime,
    details: z.json(),
  }),
  settlementAllocations: z.strictObject({
    ...row,
    entryId: Id,
    voucherId: Id,
    billId: Id.nullable(),
    openingPartyId: Id.nullable(),
    openingBillId: Id.nullable(),
    amount: Paise,
  }),
  creditApprovals: z.strictObject({
    ...row,
    partyId: Id,
    partyVersion: Count,
    saleHash: Text,
    creditLimit: Paise,
    projectedBalance: Paise,
    reason: Text,
    userId: Id,
    userName: Text,
    createdAt: IsoDateTime,
    expiresAt: IsoDateTime,
  }),
  creditApprovalUses: z.strictObject({
    ...row,
    approvalId: Id,
    voucherId: Id,
    userId: Id,
    createdAt: IsoDateTime,
  }),
  orderSourceLines: z.strictObject({
    ...row,
    sourceId: Id,
    position: Count,
    line: InvoiceLine.strict(),
  }),
  orderFulfillments: z.strictObject({
    ...row,
    sourceId: Id,
    userId: Id,
    userName: Text,
    key: Text,
    requestHash: Text,
    response: OrderFulfillmentResult.strict(),
    createdAt: IsoDateTime,
  }),
  orderFulfillmentLines: z.strictObject({
    ...row,
    fulfillmentId: Id,
    sourceLineId: Id,
    targetId: Id,
    targetPosition: Count,
    qty: Quantity,
    stockFulfilledById: Id.nullable(),
  }),
  associates: z.strictObject({
    ...row,
    ...stamps,
    name: Text,
    active: z.boolean(),
    profile: AssociateInput,
    payableAccountId: Id.nullable(),
  }),
  associateFields: z.strictObject({
    ...row,
    ...stamps,
    definition: AssociateFieldInput,
  }),
  associateRules: z.strictObject({
    ...row,
    associateId: Id,
    version: Count,
    snapshot: CommissionSnapshot.strict(),
    createdAt: IsoDateTime,
  }),
  deliveryAssignments: z.strictObject({
    ...row,
    ...stamps,
    associateId: Id,
    voucherId: Id,
    voucherNumber: Text,
    date: IsoDate,
    snapshot: DeliverySnapshot.strict(),
    status: DeliveryStatus,
    statusDate: IsoDate,
    note: Text,
    active: z.boolean(),
  }),
  commissionAccruals: z.strictObject({
    ...row,
    associateId: Id,
    saleId: Id,
    saleVersion: Count,
    lineIndex: Count,
    bookScope: scope,
    date: IsoDate,
    quantity: Quantity,
    basis: Paise,
    earned: Paise,
    snapshot: CommissionSnapshot.strict(),
    active: z.boolean(),
    createdAt: IsoDateTime,
  }),
  associatePayouts: z.strictObject({
    ...row,
    ...stamps,
    associateId: Id,
    date: IsoDate,
    ledgerId: Id,
    reference: Text,
    amount: Paise,
    reversedOn: IsoDate.nullable(),
    reversalReason: Text.nullable(),
  }),
  commissionPayoutAllocations: z.strictObject({
    ...row,
    payoutId: Id,
    accrualId: Id,
    amount: Paise,
  }),
  associateJournals: z.strictObject({
    ...row,
    journalId: Id,
    sourceVoucherId: Id.nullable(),
    payoutId: Id.nullable(),
    purpose: Text,
  }),
  commissionEntries: z.strictObject({
    ...row,
    associateId: Id,
    accrualId: Id.nullable(),
    sourceVoucherId: Id.nullable(),
    payoutId: Id.nullable(),
    journalId: Id.nullable(),
    eventKey: Text,
    date: IsoDate,
    bookScope: scope,
    kind: z.enum(["earned", "adjustment", "payout", "payout-reversal"]),
    amount: Paise,
    description: Text,
    createdAt: IsoDateTime,
  }),
  associateEvents: z.strictObject({
    ...row,
    associateId: Id.nullable(),
    action: Text,
    reason: Text,
    userId: Id,
    userName: Text,
    before: z.json(),
    after: z.json(),
    at: IsoDateTime,
  }),
  importedOpeningBalances: z.strictObject({
    ...row,
    batchId: Id,
    targetKind: z.enum(["party", "ledger", "account"]),
    targetId: Id,
    date: IsoDate,
    amount: Paise,
    gstAmount: Paise,
    createdAt: IsoDateTime,
  }),
  openingBills: z.strictObject({
    ...row,
    batchId: Id,
    partyId: Id,
    number: Text,
    date: IsoDate,
    dueDate: IsoDate,
    openingDate: IsoDate,
    amount: Paise,
    gstAmount: Paise,
    createdAt: IsoDateTime,
  }),
};

export const ExtendedBackupData = {
  settlementEntries: z.array(ExtendedBackupRows.settlementEntries).max(25_000),
  settlementAllocations: z
    .array(ExtendedBackupRows.settlementAllocations)
    .max(25_000),
  creditApprovals: z.array(ExtendedBackupRows.creditApprovals).max(25_000),
  creditApprovalUses: z
    .array(ExtendedBackupRows.creditApprovalUses)
    .max(25_000),
  orderSourceLines: z.array(ExtendedBackupRows.orderSourceLines).max(25_000),
  orderFulfillments: z.array(ExtendedBackupRows.orderFulfillments).max(25_000),
  orderFulfillmentLines: z
    .array(ExtendedBackupRows.orderFulfillmentLines)
    .max(25_000),
  associates: z.array(ExtendedBackupRows.associates).max(25_000),
  associateFields: z.array(ExtendedBackupRows.associateFields).max(25_000),
  associateRules: z.array(ExtendedBackupRows.associateRules).max(25_000),
  deliveryAssignments: z
    .array(ExtendedBackupRows.deliveryAssignments)
    .max(25_000),
  commissionAccruals: z
    .array(ExtendedBackupRows.commissionAccruals)
    .max(25_000),
  associatePayouts: z.array(ExtendedBackupRows.associatePayouts).max(25_000),
  commissionPayoutAllocations: z
    .array(ExtendedBackupRows.commissionPayoutAllocations)
    .max(25_000),
  associateJournals: z.array(ExtendedBackupRows.associateJournals).max(25_000),
  commissionEntries: z.array(ExtendedBackupRows.commissionEntries).max(25_000),
  associateEvents: z.array(ExtendedBackupRows.associateEvents).max(25_000),
  importedOpeningBalances: z
    .array(ExtendedBackupRows.importedOpeningBalances)
    .max(25_000),
  openingBills: z.array(ExtendedBackupRows.openingBills).max(25_000),
};
