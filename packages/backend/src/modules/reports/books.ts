import { AsyncLocalStorage } from "node:async_hooks";
import type { MockDb } from "@repo/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import { schema, type Db } from "../../db/client";
import { hydrateVouchers } from "../vouchers/snapshot";
import { listAccounts } from "../accounts/accountMasters";
import { loadOpeningBills } from "../imports/imports.opening-bills";

const {
  organization,
  firmProfile,
  invoiceSettings,
  reminderSettings,
  units,
  ledgers,
  parties,
  items,
  vouchers,
  openingAccounts,
} = schema;

const undef = <T>(value: T | null | undefined): T | undefined =>
  value ?? undefined;

/** Read every table at one committed point in time, even while vouchers are being saved. */
export function loadReportSnapshot(
  db: Db,
  firmId: string,
  options: { includeDeleted?: boolean } = {},
) {
  return db.transaction((tx) => loadReportBooks(tx, firmId, options), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

/** Books already read during one batch of reads, by firm and deletion scope. */
const sharedBooks = new AsyncLocalStorage<Map<string, Promise<MockDb>>>();

/**
 * Runs `work` so every report-books read inside it shares one load per firm.
 * Used by batched reads: their answers then come from one consistent book.
 * Callers must treat the books as read-only, as every report reader already does.
 */
export function withSharedReportBooks<T>(work: () => Promise<T>): Promise<T> {
  return sharedBooks.run(new Map(), work);
}

/** Reads a firm's full book into the same shape used by the shared core logic. */
export async function loadReportBooks(
  db: Pick<Db, "select">,
  firmId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<MockDb> {
  const shared = sharedBooks.getStore();
  if (!shared) return readReportBooks(db, firmId, options);
  const key = `${firmId}:${options.includeDeleted ? "all" : "live"}`;
  let books = shared.get(key);
  if (!books) {
    books = readReportBooks(db, firmId, options);
    shared.set(key, books);
    // A failed read is not reused by later reads in the batch.
    books.catch(() => shared.delete(key));
  }
  return books;
}

async function readReportBooks(
  db: Pick<Db, "select">,
  firmId: string,
  options: { includeDeleted?: boolean },
): Promise<MockDb> {
  // A transaction owns one PostgreSQL connection; query it sequentially.
  const [firmRow] = await db
    .select({ name: organization.name, profile: firmProfile })
    .from(organization)
    .innerJoin(firmProfile, eq(firmProfile.firmId, organization.id))
    .where(eq(organization.id, firmId));
  const [settings] = await db
    .select()
    .from(invoiceSettings)
    .where(eq(invoiceSettings.firmId, firmId));
  const [reminders] = await db
    .select()
    .from(reminderSettings)
    .where(eq(reminderSettings.firmId, firmId));
  const partyRows = await db
    .select()
    .from(parties)
    .where(
      and(
        eq(parties.firmId, firmId),
        options.includeDeleted ? undefined : isNull(parties.deletedAt),
      ),
    );
  const itemRows = await db
    .select()
    .from(items)
    .where(
      and(
        eq(items.firmId, firmId),
        options.includeDeleted ? undefined : isNull(items.deletedAt),
      ),
    );
  const ledgerRows = await db
    .select()
    .from(ledgers)
    .where(
      and(
        eq(ledgers.firmId, firmId),
        options.includeDeleted ? undefined : isNull(ledgers.deletedAt),
      ),
    );

  if (!firmRow) throw new Error("Firm not found");
  if (!settings) throw new Error("Invoice settings missing");

  const voucherRows = await db
    .select()
    .from(vouchers)
    .where(eq(vouchers.firmId, firmId))
    .orderBy(asc(vouchers.date), asc(vouchers.createdAt), asc(vouchers.id));
  const openingRows = await db
    .select()
    .from(openingAccounts)
    .where(eq(openingAccounts.firmId, firmId));
  const unitRows = await db
    .select()
    .from(units)
    .where(eq(units.firmId, firmId));
  const loadedVouchers = await hydrateVouchers(db, voucherRows, firmId);
  const partyOpeningBills = await loadOpeningBills(
    db,
    firmId,
    partyRows.filter((r) => !r.deletedAt).map((r) => r.id),
  );
  const profile = firmRow.profile;

  return {
    accounts: await listAccounts(db, firmId),
    firm: {
      id: firmId,
      name: firmRow.name,
      city: profile.city,
      state: profile.state,
      stateCode: profile.stateCode,
      gstin: profile.gstin,
      gstRegistration: profile.gstRegistration,
      compositionType: undef(profile.compositionType),
      fyStart: profile.fyStart,
      address: undef(profile.address),
      phone: undef(profile.phone),
      email: undef(profile.email),
      pan: undef(profile.pan),
    },
    parties: partyRows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      phone: row.phone,
      city: row.city,
      stateCode: row.stateCode,
      gstin: undef(row.gstin),
      creditDays: row.creditDays,
      creditLimit: row.creditLimit,
      // Archived names resolve old vouchers but must not recreate removed openings.
      openingBalance: row.deletedAt ? 0 : row.openingBalance,
      openingGstBalance: row.deletedAt ? 0 : undef(row.openingGstBalance),
      openingDate: row.openingDate,
      openingBills: partyOpeningBills.get(row.id),
    })),
    items: itemRows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      hsn: row.hsn,
      group: row.groupName,
      taxType: row.taxType,
      gstRate: row.gstRate as 0 | 5 | 18 | 40,
      unit: row.unit,
      altUnit:
        row.altUnitName && row.altUnitFactor
          ? { name: row.altUnitName, factor: row.altUnitFactor }
          : undefined,
      purchasePrice: row.purchasePrice,
      salePrice: row.salePrice,
      mrp: row.mrp,
      reorderLevel: row.reorderLevel,
      openingStock: row.deletedAt ? 0 : row.openingStock,
      openingCost: undef(row.openingCost),
      openingBookScope: undef(row.openingBookScope),
      openingLots: row.deletedAt ? undefined : undef(row.openingLots),
      batch:
        row.batchNumber && row.batchExpiry
          ? { number: row.batchNumber, expiry: row.batchExpiry }
          : undefined,
    })),
    ledgers: ledgerRows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      shortName: row.shortName,
      openingBalance: row.deletedAt ? 0 : row.openingBalance,
      openingGstBalance: row.deletedAt ? 0 : undef(row.openingGstBalance),
    })),
    vouchers: loadedVouchers,
    openingAccounts: openingRows.map((row) => ({
      account: row.account,
      amount: row.amount,
      openingGstAmount: undef(row.openingGstAmount),
    })),
    counters: {},
    invoiceSettings: {
      template: settings.template,
      terms: settings.terms,
      showBankDetails: settings.showBankDetails,
      bankLedgerId: settings.bankLedgerId ?? "",
      bankAccount: undef(
        settings.bankAccount as MockDb["invoiceSettings"]["bankAccount"],
      ),
      prefixes: settings.prefixes as MockDb["invoiceSettings"]["prefixes"],
      billOfSupplyPrefix: settings.billOfSupplyPrefix,
    },
    team: [],
    currentUserId: "",
    documents: [],
    units: unitRows.map((row) => ({
      name: row.name,
      uqc: row.uqc,
      enabled: row.enabled,
      builtIn: row.builtIn,
    })),
    reminders: reminders
      ? {
          enabled: reminders.enabled,
          daysBefore: reminders.daysBefore,
          onDueDate: reminders.onDueDate,
          repeatEvery: reminders.repeatEvery,
          minAmount: reminders.minAmount,
        }
      : {
          enabled: false,
          daysBefore: 3,
          onDueDate: true,
          repeatEvery: 7,
          minAmount: 0,
        },
    remindedOn: {},
    readNotices: [],
    auditLog: [],
  };
}
