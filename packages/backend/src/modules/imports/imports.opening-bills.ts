import type { OpeningBill } from "@repo/core/src/accounting/openingImport";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import { openingBills } from "../../db/schema/importOpening";

/** Read-only metadata, scoped by firm even when callers already checked party ids. */
export async function loadOpeningBills(
  db: Pick<Db, "select">,
  firmId: string,
  partyIds: string[],
): Promise<Map<string, OpeningBill[]>> {
  const grouped = new Map<string, OpeningBill[]>();
  if (!partyIds.length) return grouped;
  const rows = await db
    .select({
      id: openingBills.id,
      partyId: openingBills.partyId,
      number: openingBills.number,
      date: openingBills.date,
      dueDate: openingBills.dueDate,
      openingDate: openingBills.openingDate,
      amount: openingBills.amount,
      gstAmount: openingBills.gstAmount,
    })
    .from(openingBills)
    .where(
      and(
        eq(openingBills.firmId, firmId),
        inArray(openingBills.partyId, [...new Set(partyIds)]),
      ),
    )
    .orderBy(
      asc(openingBills.date),
      asc(openingBills.number),
      asc(openingBills.id),
    );
  for (const row of rows) {
    const bills = grouped.get(row.partyId) ?? [];
    bills.push(row);
    grouped.set(row.partyId, bills);
  }
  return grouped;
}
