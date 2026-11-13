import { z } from "zod";
import { Id } from "./common";

// The books on the phone (see @repo/core replica.ts). Rows travel in the
// shape the core functions read, so they are passed through as they are.

export const ReplicaKind = z.enum(["parties", "items", "vouchers"]);

const Tables = z.object({
  firm: z.unknown(),
  accounts: z.array(z.unknown()).optional(),
  ledgers: z.array(z.unknown()),
  openingAccounts: z.array(z.unknown()),
  invoiceSettings: z.unknown(),
  units: z.array(z.unknown()),
  reminders: z.unknown(),
});
const PerKind = <T extends z.ZodType>(value: T) =>
  z.object({ parties: value, items: value, vouchers: value });

export const ReplicaHead = z.object({
  seq: z.number().int(),
  tables: Tables,
  counts: PerKind(z.number().int()),
  checksum: PerKind(z.number().int()),
});

export const ReplicaRowsQuery = z.object({
  kind: ReplicaKind,
  after: Id.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});
export const ReplicaRows = z.object({
  rows: z.array(z.unknown()),
  next: Id.nullable(),
});

export const ReplicaChangesQuery = z.object({
  since: z.coerce.number().int().min(0),
});
export const ReplicaChanges = z.object({
  seq: z.number().int(),
  reset: z.boolean(),
  more: z.boolean(),
  tables: Tables,
  changes: PerKind(
    z.object({ upsert: z.array(z.unknown()), remove: z.array(Id) }),
  ),
});
