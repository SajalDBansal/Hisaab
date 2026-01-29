import { z } from "zod";
import { Id, IsoDateTime } from "./common";
import { VoucherType } from "./vouchers";

export const AuditAction = z.enum([
  "created",
  "edited",
  "cancelled",
  "converted",
  "reopened",
  "bank-date",
]);

export const AuditChange = z.object({
  field: z.string(),
  before: z.string(),
  after: z.string(),
});

/** One line of the edit history. The server only ever adds these. */
export const AuditEntry = z.object({
  id: Id,
  voucherId: Id,
  number: z.string(),
  voucherType: VoucherType,
  action: AuditAction,
  at: IsoDateTime,
  userId: Id,
  userName: z.string(),
  changes: z.array(AuditChange),
  note: z.string().optional(),
});

export type AuditEntry = z.infer<typeof AuditEntry>;
