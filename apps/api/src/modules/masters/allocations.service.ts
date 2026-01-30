import { allocatePartyPayments, can, today, type Role } from "@repo/core";
import { sql } from "drizzle-orm";
import type { Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { loadBooks, type Actor } from "@repo/backend/modules/vouchers/snapshot";
import { saveChanges } from "@repo/backend/modules/vouchers/persist";
import { notFound } from "@repo/backend/modules/masters/shared";

/** Allocation changes share the voucher lock, audit log and sync/version updates. */
export async function allocatePayments(
  db: Db,
  firmId: string,
  partyId: string,
  actor: Actor,
  role: Role,
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${firmId}, 0))`,
    );
    const snap = await loadBooks(tx, firmId, actor, { parties: [partyId] });
    const party = snap.books.parties.find((p) => p.id === partyId);
    if (!party || snap.deleted.has(partyId)) throw notFound("party");
    if (!can(role, party.type === "customer" ? "sales" : "purchase"))
      throw new AppError(
        "FORBIDDEN",
        "Your role can't allocate these payments.",
        403,
      );
    const result = allocatePartyPayments(snap.books, partyId, today());
    await saveChanges(tx, firmId, actor, snap);
    return result;
  });
}
