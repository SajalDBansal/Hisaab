import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  BackupRows,
  type FirmExportData,
  type FirmExportFile,
} from "@repo/contracts";
import { schema, type Db } from "@repo/backend/db/client";
import { backupTables } from "./backup.repo";
import type { remapBooks } from "./restore.remap";

export type RestoreTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type TableName = keyof typeof backupTables;

// Names and columns come only from the versioned registry, never from uploaded object keys.
async function insertRows(
  tx: RestoreTx,
  name: TableName,
  rows: Record<string, unknown>[],
) {
  const table = backupTables[name];
  const columns: Record<string, AnyPgColumn> = getTableColumns(table);
  const values = rows.map((row) =>
    Object.fromEntries(
      Object.keys(BackupRows[name].shape).map((key) => {
        const value = row[key];
        const column = columns[key];
        return [
          key,
          value === null && column?.dataType === "json" && column.notNull
            ? sql`'null'::jsonb`
            : value !== null && column?.dataType === "date"
              ? new Date(value as string)
              : value,
        ];
      }),
    ),
  );
  for (let offset = 0; offset < values.length; offset += 250)
    await tx
      .insert(table)
      .values(
        values.slice(offset, offset + 250) as (typeof table.$inferInsert)[],
      );
}

const first: TableName[] = [
  "firmProfile",
  "parties",
  "items",
  "units",
  "ledgers",
  "accounts",
  "loans",
  "openingAccounts",
  "invoiceSettings",
  "reminderSettings",
  "voucherCounters",
  "masterImportBatches",
  "importedOpeningBalances",
  "openingBills",
  "associateFields",
  "associates",
  "associateRules",
];
const last: TableName[] = [
  "voucherLines",
  "voucherCharges",
  "journalLines",
  "allocations",
  "postings",
  "stockMovements",
  "documents",
  "remindersSent",
  "auditLog",
  "loanRepaymentReferences",
  "loanEvents",
  "settlementEntries",
  "settlementAllocations",
  "creditApprovals",
  "creditApprovalUses",
  "orderSourceLines",
  "orderFulfillments",
  "orderFulfillmentLines",
  "deliveryAssignments",
  "commissionAccruals",
  "associatePayouts",
  "commissionPayoutAllocations",
  "associateJournals",
  "commissionEntries",
  "associateEvents",
  "bookControlEvents",
  "bookControls",
];

async function insertSection(
  tx: RestoreTx,
  data: FirmExportData,
  name: TableName,
) {
  const value = data[name];
  if (value) await insertRows(tx, name, Array.isArray(value) ? value : [value]);
}

export const restoreRepo = {
  async insertBooks(
    tx: RestoreTx,
    mapped: ReturnType<typeof remapBooks>,
    userId: string,
  ) {
    const { data, firmId } = mapped;
    await tx.insert(schema.organization).values({
      id: firmId,
      name: data.organization.name,
      slug: `restored-${firmId}`,
      createdAt: new Date(data.organization.createdAt),
    });
    await tx
      .insert(schema.member)
      .values({ id: uuidv7(), organizationId: firmId, userId, role: "owner" });
    for (const name of first) await insertSection(tx, data, name);
    // Self-referencing conversion and return links need both endpoints inserted first.
    await insertRows(
      tx,
      "vouchers",
      data.vouchers.map((row) => ({
        ...row,
        againstId: null,
        sourceId: null,
        convertedToId: null,
      })),
    );
    for (const row of data.vouchers) {
      if (!row.againstId && !row.sourceId && !row.convertedToId) continue;
      await tx
        .update(schema.vouchers)
        .set({
          againstId: row.againstId,
          sourceId: row.sourceId,
          convertedToId: row.convertedToId,
          updatedAt: new Date(row.updatedAt),
        })
        .where(
          and(
            eq(schema.vouchers.firmId, firmId),
            eq(schema.vouchers.id, row.id),
          ),
        );
    }
    // Period locks and opening approval are restored last; no trigger is disabled.
    for (const name of last) await insertSection(tx, data, name);
  },

  async recordOrigin(
    tx: RestoreTx,
    mapped: ReturnType<typeof remapBooks>,
    file: FirmExportFile,
    previewId: string,
    userId: string,
    restoredAt: string,
  ) {
    const [user] = await tx
      .select({ name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    const id = uuidv7();
    await tx.insert(schema.bookControlEvents).values({
      id,
      firmId: mapped.firmId,
      action: "restore-origin",
      reason:
        "Owner-confirmed recovery into a new firm; attachment binaries not recovered.",
      userId,
      userName: user?.name ?? "Firm owner",
      at: new Date(restoredAt),
      before: {
        sourceFirmId: file.payload.sourceFirmId,
        sourceName: file.payload.data.organization.name,
        savedAt: file.payload.savedAt,
        digest: file.integrity.digest,
        version: file.payload.version,
      },
      after: {
        firmId: mapped.firmId,
        previewId,
        remindersEnabled: false,
        attachmentBinariesRecovered: false,
        recordIds: Object.fromEntries(mapped.ids.records),
        actorIds: Object.fromEntries(mapped.ids.actors),
        stockLotIds: Object.fromEntries(mapped.ids.lots),
        history:
          "Imported event bodies retain their original values and IDs as historical evidence, not operational references.",
      },
    });
    return id;
  },
};
