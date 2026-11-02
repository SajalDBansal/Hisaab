import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { Id, OpeningStockLots } from "@repo/contracts";
import { today } from "@repo/core";
import { sumOpeningAmounts } from "@repo/core/src/accounting/openingImport";
import type { ImportApplyResult } from "@repo/contracts/src/imports";
import { schema } from "@repo/backend/db/client";
import {
  importedOpeningBalances,
  openingBills,
} from "@repo/backend/db/schema/importOpening";
import { AppError } from "@repo/backend/lib/app-error";
import type { ImportTx } from "./imports.repo";
import type { CsvRead } from "./imports.csv";
import type {
  FinancialContext,
  PreparedFinancialImport,
} from "./imports.financial.validation";

export async function financialImportContext(
  tx: ImportTx,
  firmId: string,
  csv: CsvRead,
): Promise<FinancialContext> {
  const header = csv.records[0] ?? [];
  const ids = [
    ...new Set(
      csv.records
        .slice(1)
        .flatMap((r) =>
          ["targetId", "partyId", "itemId"].map(
            (key) => r[header.indexOf(key)] ?? "",
          ),
        )
        .filter((id) => Id.safeParse(id).success),
    ),
  ];
  const [profile] = await tx
    .select()
    .from(schema.firmProfile)
    .where(eq(schema.firmProfile.firmId, firmId))
    .for("share");
  if (!profile)
    throw new AppError("NOT_FOUND", "The firm profile was not found.", 404);
  const [control] = await tx
    .select()
    .from(schema.bookControls)
    .where(eq(schema.bookControls.firmId, firmId))
    .for("share");
  const activity = await tx
    .select({ id: schema.vouchers.id })
    .from(schema.vouchers)
    .where(
      and(
        eq(schema.vouchers.firmId, firmId),
        eq(schema.vouchers.status, "posted"),
      ),
    )
    .limit(1);
  const parties = await tx
    .select({
      id: schema.parties.id,
      type: schema.parties.type,
      openingBalance: schema.parties.openingBalance,
      openingGstBalance: schema.parties.openingGstBalance,
      openingDate: schema.parties.openingDate,
      version: schema.parties.version,
    })
    .from(schema.parties)
    .where(
      and(
        eq(schema.parties.firmId, firmId),
        inArray(schema.parties.id, ids),
        isNull(schema.parties.deletedAt),
      ),
    )
    .orderBy(asc(schema.parties.id))
    .for("share");
  const ledgers = await tx
    .select({
      id: schema.ledgers.id,
      openingBalance: schema.ledgers.openingBalance,
      openingGstBalance: schema.ledgers.openingGstBalance,
      version: schema.ledgers.version,
    })
    .from(schema.ledgers)
    .where(
      and(
        eq(schema.ledgers.firmId, firmId),
        inArray(schema.ledgers.id, ids),
        isNull(schema.ledgers.deletedAt),
      ),
    )
    .orderBy(asc(schema.ledgers.id))
    .for("share");
  const accounts = await tx
    .select({
      id: schema.accounts.id,
      openingBalance: schema.accounts.openingBalance,
      openingGstBalance: schema.accounts.openingGstBalance,
      version: schema.accounts.version,
    })
    .from(schema.accounts)
    .where(
      and(eq(schema.accounts.firmId, firmId), inArray(schema.accounts.id, ids)),
    )
    .orderBy(asc(schema.accounts.id))
    .for("share");
  const items = await tx
    .select({
      id: schema.items.id,
      openingStock: schema.items.openingStock,
      version: schema.items.version,
      openingLots: schema.items.openingLots,
      importedOpening: sql<boolean>`exists (
        select 1 from master_import_batches b
        where b.firm_id = ${firmId} and b.kind = 'opening-stock'
          and b.result->'stockLots' @> jsonb_build_array(jsonb_build_object('itemId', ${schema.items.id}::text))
      )`,
    })
    .from(schema.items)
    .where(
      and(
        eq(schema.items.firmId, firmId),
        inArray(schema.items.id, ids),
        isNull(schema.items.deletedAt),
      ),
    )
    .orderBy(asc(schema.items.id))
    .for("share");
  const initialized = await tx
    .select({
      targetKind: importedOpeningBalances.targetKind,
      targetId: importedOpeningBalances.targetId,
    })
    .from(importedOpeningBalances)
    .where(
      and(
        eq(importedOpeningBalances.firmId, firmId),
        inArray(importedOpeningBalances.targetId, ids),
      ),
    )
    .orderBy(asc(importedOpeningBalances.id));
  const billParties = await tx
    .selectDistinct({ partyId: openingBills.partyId })
    .from(openingBills)
    .where(
      and(eq(openingBills.firmId, firmId), inArray(openingBills.partyId, ids)),
    )
    .orderBy(asc(openingBills.partyId));
  return {
    fyStart: profile.fyStart,
    today: today(),
    defaultGst: profile.gstRegistration !== "unregistered",
    locked: !!control?.openingApprovedAt || !!control?.closedThrough,
    version: control?.version ?? 0,
    hasActivity: activity.length > 0,
    parties,
    ledgers,
    accounts,
    items,
    initialized,
    billParties: billParties.map((r) => r.partyId),
  };
}

export async function insertFinancialImport(
  tx: ImportTx,
  firmId: string,
  userId: string,
  batchId: string,
  prepared: PreparedFinancialImport,
  context: FinancialContext,
) {
  const createdIds: string[] = [];
  for (const row of prepared.money) {
    const id = uuidv7();
    createdIds.push(id);
    const table =
      row.targetKind === "party"
        ? schema.parties
        : row.targetKind === "ledger"
          ? schema.ledgers
          : schema.accounts;
    await tx
      .update(table)
      .set({
        openingBalance: row.amount,
        openingGstBalance: row.gstAmount,
        ...(row.targetKind === "party" ? { openingDate: row.date } : {}),
        version: sql`${table.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(table.firmId, firmId), eq(table.id, row.targetId)));
    const { row: _row, ...value } = row;
    await tx
      .insert(importedOpeningBalances)
      .values({ ...value, id, firmId, batchId });
  }
  if (prepared.bills.length) {
    const rows = prepared.bills.map(({ row: _row, ...b }) => ({
      ...b,
      id: uuidv7(),
      firmId,
      batchId,
    }));
    await tx.insert(openingBills).values(rows);
    createdIds.push(...rows.map((r) => r.id));
    // Trigger the existing party sync path for hydrated opening-bill metadata.
    await tx
      .update(schema.parties)
      .set({
        version: sql`${schema.parties.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.parties.firmId, firmId),
          inArray(schema.parties.id, [...new Set(rows.map((r) => r.partyId))]),
        ),
      );
  }
  const stockLots: NonNullable<ImportApplyResult["stockLots"]> =
    prepared.stock.map((r) => ({
      id: uuidv7(),
      itemId: r.itemId,
      lotNumber: r.lotNumber,
      date: r.date,
      qty: r.quantity,
      unitCost: r.unitCost,
      bookScope: r.bookScope,
    }));
  for (const itemId of new Set(stockLots.map((r) => r.itemId))) {
    const rows = stockLots.filter((r) => r.itemId === itemId);
    const lots = OpeningStockLots.parse(
      rows.map(({ id, qty, unitCost, bookScope }) => ({
        id,
        qty,
        unitCost,
        bookScope,
      })),
    );
    const first = lots[0];
    if (!first)
      throw new Error("An opening stock import needs at least one lot.");
    const qty =
      rows.reduce((sum, r) => sum + Math.round(r.qty * 1000), 0) / 1000;
    const value = sumOpeningAmounts(
      rows.map((r) => Math.round(r.qty * r.unitCost)),
    );
    const cost = Math.round(value / qty);
    await tx
      .update(schema.items)
      .set({
        openingLots: lots,
        openingStock: qty,
        openingCost: cost,
        openingBookScope: first.bookScope,
        version: sql`${schema.items.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.items.firmId, firmId), eq(schema.items.id, itemId)));
  }
  createdIds.push(...stockLots.map((r) => r.id));
  await tx
    .insert(schema.bookControls)
    .values({ firmId, version: context.version + 1 })
    .onConflictDoUpdate({
      target: schema.bookControls.firmId,
      set: { version: context.version + 1 },
    });
  const [actor] = await tx
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  await tx.insert(schema.bookControlEvents).values({
    id: uuidv7(),
    firmId,
    action: "import-openings",
    reason: "Confirmed validated CSV opening import",
    userId,
    userName: actor?.name ?? "Owner",
    before: { version: context.version },
    after: { batchId, version: context.version + 1, createdIds },
  });
  return { createdIds, ...(stockLots.length ? { stockLots } : {}) };
}
