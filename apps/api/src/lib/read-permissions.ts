import { VoucherType } from "@repo/contracts";
import { can, type Role } from "@repo/core";
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@repo/backend/db/client";
import { notFound } from "@repo/backend/modules/masters/shared";
import { AppError } from "@repo/backend/lib/app-error";

const salesTypes: readonly VoucherType[] = [
  "sale",
  "receipt",
  "credit-note",
  "estimate",
  "sales-order",
  "delivery-note",
];

// Report readers include viewers; this never grants permission to write.
export const canReadBooks = (role: Role) => can(role, "reports");

export function canReadVoucher(role: Role, type: VoucherType) {
  return (
    canReadBooks(role) || (can(role, "sales") && salesTypes.includes(type))
  );
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
) {
  const [row] = await db
    .select({ type: schema.vouchers.type })
    .from(schema.vouchers)
    .where(and(eq(schema.vouchers.firmId, firmId), eq(schema.vouchers.id, id)));
  if (!row) throw notFound("entry");
  requireVoucherTypeRead(role, row.type);
}

export const canReadParty = (role: Role, type: "customer" | "supplier") =>
  canReadBooks(role) || (can(role, "sales") && type === "customer");

// Legacy receipt selectors require numeric fields; masked values are not book balances.
export function ledgerForRead<
  T extends { openingBalance: number; balance: number },
>(role: Role, row: T): T {
  return canReadBooks(role) ? row : { ...row, openingBalance: 0, balance: 0 };
}
