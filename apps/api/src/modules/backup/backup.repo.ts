import {
  and,
  count,
  eq,
  getTableColumns,
  getTableName,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  BackupRows,
  MAX_FIRM_EXPORT_BYTES,
  MAX_FIRM_EXPORT_ROWS,
} from "@repo/contracts";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";

type Reader = Pick<Db, "select" | "execute">;
type TableName = keyof typeof BackupRows;

// Only these business tables can enter a file; auth tables and sync cursors cannot.
export const backupTables = {
  firmProfile: schema.firmProfile,
  invoiceSettings: schema.invoiceSettings,
  reminderSettings: schema.reminderSettings,
  parties: schema.parties,
  items: schema.items,
  units: schema.units,
  ledgers: schema.ledgers,
  openingAccounts: schema.openingAccounts,
  accounts: schema.accounts,
  voucherCounters: schema.voucherCounters,
  vouchers: schema.vouchers,
  voucherLines: schema.voucherLines,
  voucherCharges: schema.voucherCharges,
  journalLines: schema.journalLines,
  allocations: schema.allocations,
  postings: schema.postings,
  stockMovements: schema.stockMovements,
  documents: schema.documents,
  remindersSent: schema.remindersSent,
  auditLog: schema.auditLog,
  bookControls: schema.bookControls,
  bookControlEvents: schema.bookControlEvents,
  loans: schema.loans,
  loanRepaymentReferences: schema.loanRepaymentReferences,
  loanEvents: schema.loanEvents,
  masterImportBatches: schema.masterImportBatches,
  settlementEntries: schema.settlementEntries,
  settlementAllocations: schema.settlementAllocations,
  creditApprovals: schema.creditApprovals,
  creditApprovalUses: schema.creditApprovalUses,
  orderSourceLines: schema.orderSourceLines,
  orderFulfillments: schema.orderFulfillments,
  orderFulfillmentLines: schema.orderFulfillmentLines,
  associates: schema.associates,
  associateFields: schema.associateFields,
  associateRules: schema.associateRules,
  deliveryAssignments: schema.deliveryAssignments,
  commissionAccruals: schema.commissionAccruals,
  associatePayouts: schema.associatePayouts,
  commissionPayoutAllocations: schema.commissionPayoutAllocations,
  associateJournals: schema.associateJournals,
  commissionEntries: schema.commissionEntries,
  associateEvents: schema.associateEvents,
  importedOpeningBalances: schema.importedOpeningBalances,
  openingBills: schema.openingBills,
} satisfies Record<TableName, unknown>;
const tables = backupTables;

const compositeOrder = {
  units: ["name"],
  openingAccounts: ["account"],
  remindersSent: ["partyId"],
  voucherCounters: ["type", "series", "financialYear"],
};

// Operational cursors/read markers are excluded intentionally, never discovered as exportable data.
const excludedTables = new Set([
  "change_log",
  "notice_reads",
  "operation_receipts",
]);
type ColumnInfo = { table_name: string; column_name: string };

export function assertExportSchema(columns: ColumnInfo[]) {
  const expected = new Map(
    Object.entries(tables).map(([name, table]) => {
      const fields: Record<string, AnyPgColumn> = getTableColumns(table);
      const included = Object.keys(BackupRows[name as TableName].shape).map(
        (key) => fields[key]?.name,
      );
      return [getTableName(table), new Set(included)] as const;
    }),
  );
  const actual = new Map<string, Set<string>>();
  for (const column of columns) {
    if (excludedTables.has(column.table_name)) continue;
    const fields = actual.get(column.table_name) ?? new Set<string>();
    fields.add(column.column_name);
    actual.set(column.table_name, fields);
  }
  const matches =
    actual.size === expected.size &&
    [...expected].every(([name, fields]) => {
      const found = actual.get(name);
      return (
        found?.size === fields.size &&
        [...fields].every((field) => field !== undefined && found.has(field))
      );
    });
  if (!matches)
    throw new AppError(
      "EXPORT_SCHEMA_CHANGED",
      "The database has fields not covered by this export version. Update the export format before downloading; no partial file was created.",
      409,
    );
}

export async function checkExportSchema(db: Reader) {
  const result = await db.execute<ColumnInfo>(sql`
    select c.table_name, c.column_name from information_schema.columns c
    where c.table_schema = 'public' and exists (
      select 1 from information_schema.columns f
      where f.table_schema = c.table_schema and f.table_name = c.table_name and f.column_name = 'firm_id'
    )`);
  assertExportSchema(result.rows);
}
const tooLarge = () =>
  new AppError(
    "EXPORT_TOO_LARGE",
    "These books exceed the download limit. Ask your administrator for a managed database backup; no partial file was created.",
    413,
  );

export async function requireBackupOwner(
  db: Pick<Db, "select">,
  firmId: string,
  userId: string,
) {
  const [member] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, firmId),
        eq(schema.member.userId, userId),
      ),
    );
  if (member?.role !== "owner")
    throw new AppError(
      "FORBIDDEN",
      "Only the firm owner can export or inspect its books.",
      403,
    );
}

async function organization(db: Pick<Db, "select">, firmId: string) {
  const [firm] = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      createdAt: schema.organization.createdAt,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, firmId));
  if (!firm)
    throw new AppError("NOT_FOUND", "The firm is no longer available.", 404);
  return firm;
}

// Every page is read on the same transaction, with stable ordering and hard limits.
async function tableRows(
  db: Reader,
  name: TableName,
  firmId: string,
  budget: { rows: number; bytes: number; deadline: number },
) {
  const table = tables[name];
  const columns: Record<string, AnyPgColumn> = getTableColumns(table);
  const selected = Object.fromEntries(
    Object.keys(BackupRows[name].shape).map((key) => {
      if (!columns[key])
        throw new Error(`Backup column missing: ${name}.${key}`);
      return [key, columns[key]];
    }),
  );
  const order =
    "id" in columns
      ? ["id"]
      : (compositeOrder[name as keyof typeof compositeOrder] ?? ["firmId"]);
  const result: unknown[] = [];
  for (let offset = 0; ; offset += 250) {
    if (Date.now() > budget.deadline)
      throw new AppError(
        "EXPORT_TIMEOUT",
        "The export took too long. No partial file was created.",
        503,
      );
    const orderColumns = order.map((key) => {
      const column = columns[key];
      if (!column)
        throw new Error(`Backup sort column missing: ${name}.${key}`);
      return column;
    });
    const page = await db
      .select(selected)
      .from(table)
      .where(eq(table.firmId, firmId))
      .orderBy(...orderColumns)
      .limit(250)
      .offset(offset);
    budget.rows += page.length;
    budget.bytes += Buffer.byteLength(JSON.stringify(page), "utf8");
    if (
      budget.rows > MAX_FIRM_EXPORT_ROWS ||
      budget.bytes > MAX_FIRM_EXPORT_BYTES
    )
      throw tooLarge();
    result.push(...page);
    if (page.length < 250) return result;
  }
}

export async function readFirmExport(db: Reader, firmId: string) {
  await db.execute(sql`set local statement_timeout = '10s'`);
  await checkExportSchema(db);
  const data: Record<string, unknown> = {
    organization: await organization(db, firmId),
  };
  const budget = { rows: 1, bytes: 0, deadline: Date.now() + 30_000 };
  for (const name of Object.keys(tables) as TableName[]) {
    const rows = await tableRows(db, name, firmId, budget);
    const single = [
      "firmProfile",
      "invoiceSettings",
      "reminderSettings",
      "bookControls",
    ].includes(name);
    data[name] = single ? (rows[0] ?? null) : rows;
  }
  return data;
}

export async function readBackupStatus(db: Pick<Db, "select">, firmId: string) {
  const counts = { parties: 0, items: 0, vouchers: 0, documents: 0 };
  for (const name of Object.keys(counts) as (keyof typeof counts)[]) {
    const table = tables[name];
    const [total] = await db
      .select({ value: count() })
      .from(table)
      .where(eq(table.firmId, firmId));
    counts[name] = total?.value ?? 0;
  }
  return { firmName: (await organization(db, firmId)).name, counts };
}
