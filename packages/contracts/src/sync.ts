import { z } from "zod";
import { Id, IsoDateTime } from "./common";
import { ItemInput } from "./items";
import { LedgerInput } from "./ledgers";
import { PartyInput } from "./parties";
import {
  CancelInput,
  NewContraInput,
  NewExpenseInput,
  NewInvoiceInput,
  NewJournalInput,
  NewMoneyInput,
  NewNoteInput,
  NewOrderInput,
} from "./vouchers";

export const SyncEntity = z.enum([
  "account",
  "party",
  "item",
  "ledger",
  "voucher",
  "document",
  "firm-profile",
  "invoice-settings",
  "reminder-settings",
]);

export const SyncAction = z.enum(["upsert", "deleted"]);

export const SyncPullQuery = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const SyncChange = z.object({
  seq: z.number().int(),
  entity: SyncEntity,
  id: Id,
  action: SyncAction,
  changedAt: IsoDateTime,
  record: z.unknown().nullable(),
});

export const SyncChanges = z.object({
  items: z.array(SyncChange),
  nextCursor: z.number().int(),
  hasMore: z.boolean(),
});

const MutationId = z.string().min(8).max(100);
const Version = z.number().int().min(1);

const CreateBase = z.object({
  operation: z.literal("create"),
  clientMutationId: MutationId,
});
const DraftCreateBase = CreateBase.extend({
  draftId: z.string().min(1).max(100),
});
const UpdateBase = z.object({
  operation: z.literal("update"),
  clientMutationId: MutationId,
  id: Id,
  baseVersion: Version,
});
const DeleteBase = z.object({
  operation: z.literal("delete"),
  clientMutationId: MutationId,
  id: Id,
  baseVersion: Version,
});
const CancelBase = z.object({
  operation: z.literal("cancel"),
  clientMutationId: MutationId,
  id: Id,
  baseVersion: Version,
});

export const SyncPushMutation = z.union([
  CreateBase.extend({ entity: z.literal("party"), data: PartyInput }),
  UpdateBase.extend({ entity: z.literal("party"), data: PartyInput }),
  DeleteBase.extend({ entity: z.literal("party") }),
  CreateBase.extend({ entity: z.literal("item"), data: ItemInput }),
  UpdateBase.extend({ entity: z.literal("item"), data: ItemInput }),
  DeleteBase.extend({ entity: z.literal("item") }),
  CreateBase.extend({ entity: z.literal("ledger"), data: LedgerInput }),
  UpdateBase.extend({ entity: z.literal("ledger"), data: LedgerInput }),
  DeleteBase.extend({ entity: z.literal("ledger") }),
  DraftCreateBase.extend({
    entity: z.literal("voucher"),
    voucherType: z.literal("sale"),
    data: NewInvoiceInput,
  }),
  DraftCreateBase.extend({
    entity: z.literal("voucher"),
    voucherType: z.literal("purchase"),
    data: NewInvoiceInput,
  }),
  DraftCreateBase.extend({
    entity: z.literal("voucher"),
    voucherType: z.literal("receipt"),
    data: NewMoneyInput,
  }),
  DraftCreateBase.extend({
    entity: z.literal("voucher"),
    voucherType: z.literal("payment"),
    data: NewMoneyInput,
  }),
  DraftCreateBase.extend({
    entity: z.literal("voucher"),
    voucherType: z.literal("expense"),
    data: NewExpenseInput,
  }),
  DraftCreateBase.extend({
    entity: z.literal("voucher"),
    voucherType: z.literal("journal"),
    data: NewJournalInput,
  }),
  DraftCreateBase.extend({
    entity: z.literal("voucher"),
    voucherType: z.literal("contra"),
    data: NewContraInput,
  }),
  DraftCreateBase.extend({
    entity: z.literal("voucher"),
    voucherType: z.enum([
      "estimate",
      "sales-order",
      "delivery-note",
      "purchase-order",
    ]),
    data: NewOrderInput,
  }),
  DraftCreateBase.extend({
    entity: z.literal("voucher"),
    voucherType: z.literal("credit-note"),
    data: NewNoteInput,
  }),
  DraftCreateBase.extend({
    entity: z.literal("voucher"),
    voucherType: z.literal("debit-note"),
    data: NewNoteInput,
  }),
  UpdateBase.extend({
    entity: z.literal("voucher"),
    data: NewInvoiceInput,
  }),
  CancelBase.extend({
    entity: z.literal("voucher"),
    data: CancelInput,
  }),
]);

export const SyncPushInput = z.object({
  mutations: z.array(SyncPushMutation).min(1).max(50),
});

export const SyncApplied = z.object({
  clientMutationId: MutationId,
  entity: z.enum(["party", "item", "ledger", "voucher"]),
  id: Id,
  operation: z.enum(["create", "update", "delete", "cancel"]),
  draftId: z.string().optional(),
  record: z.unknown().nullable(),
});

export const SyncConflict = z.object({
  clientMutationId: MutationId,
  entity: z.enum(["party", "item", "ledger", "voucher"]),
  id: Id.optional(),
  draftId: z.string().optional(),
  code: z.string(),
  message: z.string(),
  current: z.unknown().nullable(),
});

export const SyncPushResult = z.object({
  applied: z.array(SyncApplied),
  conflicts: z.array(SyncConflict),
});

export type SyncEntity = z.infer<typeof SyncEntity>;
export type SyncAction = z.infer<typeof SyncAction>;
export type SyncChange = z.infer<typeof SyncChange>;
export type SyncChanges = z.infer<typeof SyncChanges>;
export type SyncPushMutation = z.infer<typeof SyncPushMutation>;
export type SyncApplied = z.infer<typeof SyncApplied>;
export type SyncConflict = z.infer<typeof SyncConflict>;
export type SyncPushResult = z.infer<typeof SyncPushResult>;
