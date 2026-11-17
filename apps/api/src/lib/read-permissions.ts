import { VoucherType } from "@repo/contracts";
import { can, canVoucher, roleFlag, type Role } from "@repo/core";
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@repo/backend/db/client";
import { notFound } from "@repo/backend/modules/masters/shared";
import { AppError } from "@repo/backend/lib/app-error";

// Report readers include viewers; this never grants permission to write.
export const canReadBooks = (role: Role) => can(role, "reports");

/** Built-in roles read as before (reports, or sales staff their sales types); custom roles per their matrix. */
export function canReadVoucher(role: Role, type: VoucherType) {
  return canVoucher(role, type, "view");
}

export function readableVoucherTypes(role: Role) {
  return VoucherType.options.filter((type) => canReadVoucher(role, type));
}

export function requireVoucherTypeRead(role: Role, type: VoucherType) {
  if (!canReadVoucher(role, type)) throw forbiddenRead();
}

export function forbiddenRead() {
  return new AppError(
    "FORBIDDEN",
    "Your role can't read these books. Ask the owner of the firm.",
    403,
  );
}

// Check firm and type before loading a detail, printout or queued PDF.
export async function requireVoucherRead(
  db: Db,
  firmId: string,
  role: Role,
  id: string,
  /** The caller; roles limited to their own records see only what they made. */
  userId?: string,
) {
  const [row] = await db
    .select({
      type: schema.vouchers.type,
      createdBy: schema.vouchers.createdBy,
    })
    .from(schema.vouchers)
    .where(and(eq(schema.vouchers.firmId, firmId), eq(schema.vouchers.id, id)));
  if (!row) throw notFound("entry");
  requireVoucherTypeRead(role, row.type);
  if (roleFlag(role, "ownRecordsOnly") && row.createdBy !== userId)
    throw forbiddenRead();
}

/**
 * For roles limited to their own records (doc 37, T57): the ids of entries this
 * user made. null means no limit.
 */
export async function ownVoucherIds(
  db: Pick<Db, "select">,
  firmId: string,
  role: Role,
  userId: string,
): Promise<Set<string> | null> {
  if (!roleFlag(role, "ownRecordsOnly")) return null;
  const rows = await db
    .select({ id: schema.vouchers.id })
    .from(schema.vouchers)
    .where(
      and(
        eq(schema.vouchers.firmId, firmId),
        eq(schema.vouchers.createdBy, userId),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

/** Keep only the caller's own entries when `own` is set (rows with `id` or `voucher.id`). */
export function onlyOwn<T extends { id?: string; voucher?: { id: string } }>(
  rows: T[],
  own: Set<string> | null,
): T[] {
  return own
    ? rows.filter((row) => own.has(row.voucher?.id ?? row.id ?? ""))
    : rows;
}

export const canReadParty = (role: Role, type: "customer" | "supplier") =>
  canReadBooks(role) || (can(role, "sales") && type === "customer");

// Legacy receipt selectors require numeric fields; masked values are not book balances.
export function ledgerForRead<
  T extends { openingBalance: number; balance: number },
>(role: Role, row: T): T {
  return canReadBooks(role) ? row : { ...row, openingBalance: 0, balance: 0 };
}
