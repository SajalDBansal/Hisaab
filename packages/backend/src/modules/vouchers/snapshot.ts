import type { MockDb, Voucher, VoucherType } from "@repo/core";
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "../../db/client";
import { listAccounts } from "../accounts/accountMasters";
import { hydrateOrderFulfillment } from "../order-fulfillment/orderFulfillment.repo";
import { hydrateSettlementVouchers } from "../settlements/settlements.shared";
import { loadOpeningBills } from "../imports/imports.opening-bills";
import { importedOpeningBillId } from "@repo/core/src/accounting/openingImport";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Reader = Db | Tx;

const {
  organization,
  firmProfile,
  invoiceSettings,
  ledgers,
  parties,
  items,
  vouchers,
  voucherLines,
  voucherCharges,
  journalLines,
  allocations,
  voucherCounters,
} = schema;

/** The person making the change, for the edit log. */
export interface Actor {
  id: string;
  name: string;
}

/** Which rows the operation needs. Everything else stays in the database. */
export interface Scope {
  vouchers?: string[];
  parties?: string[];
  items?: string[];
}

export interface Snapshot {
  /** The same shape the app's mock database has, so @repo/core can do the work. */
  books: MockDb;
  /** Version of each voucher as loaded (for If-Match and for bumping). */
  versions: Map<string, number>;
  /** Each voucher as loaded, to find out afterwards which ones changed. */
  before: Map<string, string>;
  /** Parties, items and ledgers that were deleted: old bills may use them, new ones may not. */
  deleted: Set<string>;
  /** Counters as loaded, to find out which ones moved. */
  counters: Record<string, number>;
}

const undef = <T>(value: T | null | undefined): T | undefined =>
  value ?? undefined;
const iso = (d: Date | null) => (d ? d.toISOString() : undefined);

/** Counter row → the key the core uses: "sale:26-27" or "sale-bos:26-27". */
function counterKey(
  type: VoucherType,
  series: string,
  financialYear: string,
  prefixes: Record<string, string>,
  bosPrefix: string,
): string | null {
  if (type === "sale" && series === bosPrefix)
    return `${type}-bos:${financialYear}`;
  if (series === `N${prefixes[type]}`) return `${type}-nongst:${financialYear}`;
  if (series === prefixes[type]) return `${type}:${financialYear}`;
  return null;
}

/** Voucher rows with their lines, charges, journal lines and allocations, as core vouchers. */
export async function hydrateVouchers(
  db: Pick<Db, "select">,
  voucherRows: (typeof vouchers.$inferSelect)[],
): Promise<Voucher[]> {
  const ids = voucherRows.map((v) => v.id);
  if (!ids.length) return [];
  // This reader may be a single transaction connection, not a connection pool.
  const lineRows = await db
    .select()
    .from(voucherLines)
    .where(inArray(voucherLines.voucherId, ids));
  const chargeRows = await db
    .select()
    .from(voucherCharges)
    .where(inArray(voucherCharges.voucherId, ids));
  const journalRows = await db
    .select()
    .from(journalLines)
    .where(inArray(journalLines.voucherId, ids));
  const allocRows = await db
    .select()
    .from(allocations)
    .where(inArray(allocations.voucherId, ids));

  const by = <T extends { voucherId: string; position?: number }>(
    rows: T[],
  ) => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const list = map.get(row.voucherId) ?? [];
      list.push(row);
      map.set(row.voucherId, list);
    }
    for (const list of map.values())
      list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    return map;
  };
  const linesOf = by(lineRows);
  const chargesOf = by(chargeRows);
  const journalOf = by(journalRows);
  const allocOf = by(allocRows);

  const loaded = voucherRows.map((r): Voucher => {
    const lines = linesOf.get(r.id);
    const charges = chargesOf.get(r.id);
    const journal = journalOf.get(r.id);
    const alloc = allocOf.get(r.id);
    return {
      id: r.id,
      type: r.type,
      number: r.number,
      date: r.date,
      status: r.status,
      partyId: undef(r.partyId),
      amount: r.amount,
      narration: undef(r.narration),
      snapshot: undef(r.snapshot),
      inventoryAdjustment: undef(r.inventoryAdjustment),
      delivery: undef(r.delivery),
      commission: undef(r.commission),
      interState: undef(r.interState),
      dueDate: undef(r.dueDate),
      supplierInvoiceNo: undef(r.supplierInvoiceNo),
      docType: undef(r.docType),
      taxMode: undef(r.taxMode),
      bookScope: undef(r.bookScope),
      againstId: undef(r.againstId),
      noteReason: undef(r.noteReason),
      cancelReason: undef(r.cancelReason),
      cancelledAt: iso(r.cancelledAt),
      editedAt: iso(r.editedAt),
      validUntil: undef(r.validUntil),
      sourceId: undef(r.sourceId),
      convertedToId: undef(r.convertedToId),
      mode: undef(r.mode),
      ledgerId: undef(r.ledgerId),
      toLedgerId: undef(r.toLedgerId),
      reference: undef(r.reference),
      expenseHead: undef(r.expenseHead),
      clearedOn: undef(r.clearedOn),
      bankClearings: undef(r.bankClearings),
      tds: r.tdsSection
        ? {
            section: r.tdsSection,
            rate: r.tdsRate ?? 0,
            amount: r.tdsAmount,
          }
        : undefined,
      lines: lines?.map((l) => ({
        itemId: l.itemId,
        qty: l.qty ?? 0,
        rate: l.rate,
        per:
          l.perUnit && l.perFactor
            ? { unit: l.perUnit, factor: l.perFactor }
            : undefined,
        discountPercent: undef(l.discountPercent),
        discountAmount: l.discountAmount || undefined,
        gstRate: l.gstRate as 0 | 5 | 18 | 40,
        taxType: undef(l.taxType),
        sourceLine: undef(l.sourceLine),
        returnAmounts: undef(l.returnAmounts),
        stockLotId: undef(l.stockLotId),
        stockCost: undef(l.stockCost),
        bookScope: undef(l.bookScope),
      })),
      charges: charges?.map((c) => ({
        name: c.name,
        amount: c.amount,
        gstRate: c.gstRate as 0 | 5 | 18 | 40,
      })),
      journalLines: journal?.map((j) => ({
        account: j.account,
        name: j.name,
        debit: j.debit,
        credit: j.credit,
      })),
      allocations: alloc?.map((a) => ({
        voucherId: a.openingBillId
          ? importedOpeningBillId(a.openingBillId)
          : (a.billId ?? `opening:${a.openingPartyId}`),
        amount: a.amount,
      })),
      createdAt: r.createdAt.toISOString(),
    };
  });
  const firmId = voucherRows[0]?.firmId;
  if (!firmId) return loaded;
  return hydrateSettlementVouchers(
    db,
    firmId,
    await hydrateOrderFulfillment(db, firmId, loaded),
  );
}

/** Reads what a voucher operation needs into a core `Db`. Call inside the firm's transaction. */
export async function loadBooks(
  db: Reader,
  firmId: string,
  actor: Actor,
  scope: Scope = {},
): Promise<Snapshot> {
  const [firmRow] = await db
    .select({
      name: organization.name,
      profile: firmProfile,
    })
    .from(organization)
    .innerJoin(firmProfile, eq(firmProfile.firmId, organization.id))
    .where(eq(organization.id, firmId));
  if (!firmRow) throw new Error("Firm not found");
  const p = firmRow.profile;

  const [settings] = await db
    .select()
    .from(invoiceSettings)
    .where(eq(invoiceSettings.firmId, firmId));
  if (!settings) throw new Error("Invoice settings missing");
  const prefixes = settings.prefixes as Record<string, string>;

  const ledgerRows = await db
    .select()
    .from(ledgers)
    .where(eq(ledgers.firmId, firmId));
  const unitRows = await db
    .select()
    .from(schema.units)
    .where(eq(schema.units.firmId, firmId));

  // --- vouchers: the ones asked for, plus what points at them (settlements, returns, conversions)
  const wanted = scope.vouchers ?? [];
  const wantedParties = scope.parties ?? [];
  // Lot validation needs purchases and consumers across parties, not only this bill's customer.
  const voucherRows =
    wanted.length || wantedParties.length || scope.items?.length
      ? await db
          .select()
          .from(vouchers)
          .where(eq(vouchers.firmId, firmId))
          .orderBy(
            asc(vouchers.date),
            asc(vouchers.createdAt),
            asc(vouchers.id),
          )
      : [];

  const loaded = await hydrateVouchers(db, voucherRows);

  // --- parties and items: asked for, plus the ones on the loaded vouchers
  const partyIds = new Set(wantedParties);
  const itemIds = new Set(scope.items ?? []);
  for (const v of loaded) {
    if (v.inventoryAdjustment) itemIds.add(v.inventoryAdjustment.itemId);
    if (v.partyId) partyIds.add(v.partyId);
    for (const l of v.lines ?? []) itemIds.add(l.itemId);
  }
  const partyRows = partyIds.size
    ? await db
        .select()
        .from(parties)
        .where(
          and(eq(parties.firmId, firmId), inArray(parties.id, [...partyIds])),
        )
    : [];
  const itemRows = itemIds.size
    ? await db
        .select()
        .from(items)
        .where(and(eq(items.firmId, firmId), inArray(items.id, [...itemIds])))
    : [];
  const partyOpeningBills = await loadOpeningBills(
    db,
    firmId,
    partyRows.filter((r) => !r.deletedAt).map((r) => r.id),
  );

  const counterRows = await db
    .select()
    .from(voucherCounters)
    .where(eq(voucherCounters.firmId, firmId));
  const counters: Record<string, number> = {};
  for (const c of counterRows) {
    const key = counterKey(
      c.type,
      c.series,
      c.financialYear,
      prefixes,
      settings.billOfSupplyPrefix,
    );
    if (key) counters[key] = c.lastNumber;
  }

  const deleted = new Set<string>();
  for (const r of [...partyRows, ...itemRows, ...ledgerRows])
    if (r.deletedAt) deleted.add(r.id);

  const books: MockDb = {
    accounts: await listAccounts(db, firmId),
    firm: {
      id: firmId,
      name: firmRow.name,
      city: p.city,
      state: p.state,
      stateCode: p.stateCode,
      gstin: p.gstin,
      gstRegistration: p.gstRegistration,
      compositionType: undef(p.compositionType),
      fyStart: p.fyStart,
      address: undef(p.address),
      phone: undef(p.phone),
      email: undef(p.email),
      pan: undef(p.pan),
    },
    parties: partyRows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      phone: r.phone,
      city: r.city,
      stateCode: r.stateCode,
      gstin: undef(r.gstin),
      creditDays: r.creditDays,
      creditLimit: r.creditLimit,
      openingBalance: r.openingBalance,
      openingGstBalance: undef(r.openingGstBalance),
      openingDate: r.openingDate,
      openingBills: partyOpeningBills.get(r.id),
    })),
    items: itemRows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      hsn: r.hsn,
      group: r.groupName,
      taxType: r.taxType,
      gstRate: r.gstRate as 0 | 5 | 18 | 40,
      unit: r.unit,
      altUnit:
        r.altUnitName && r.altUnitFactor
          ? { name: r.altUnitName, factor: r.altUnitFactor }
          : undefined,
      purchasePrice: r.purchasePrice,
      salePrice: r.salePrice,
      mrp: r.mrp,
      reorderLevel: r.reorderLevel ?? 0,
      openingStock: r.openingStock ?? 0,
      openingCost: undef(r.openingCost),
      openingBookScope: undef(r.openingBookScope),
      openingLots: undef(r.openingLots),
      batch:
        r.batchNumber && r.batchExpiry
          ? { number: r.batchNumber, expiry: r.batchExpiry }
          : undefined,
    })),
    ledgers: ledgerRows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      shortName: r.shortName,
      openingBalance: r.openingBalance,
      openingGstBalance: undef(r.openingGstBalance),
    })),
    vouchers: loaded,
    openingAccounts: [],
    counters: { ...counters },
    invoiceSettings: {
      template: settings.template,
      terms: settings.terms,
      showBankDetails: settings.showBankDetails,
      bankLedgerId: settings.bankLedgerId ?? "",
      bankAccount: undef(
        settings.bankAccount as MockDb["invoiceSettings"]["bankAccount"],
      ),
      prefixes: prefixes as MockDb["invoiceSettings"]["prefixes"],
      billOfSupplyPrefix: settings.billOfSupplyPrefix,
    },
    team: [
      {
        id: actor.id,
        name: actor.name,
        phone: "",
        role: "owner",
        active: true,
      },
    ],
    currentUserId: actor.id,
    documents: [],
    units: unitRows.map(({ name, uqc, enabled, builtIn }) => ({
      name,
      uqc,
      enabled,
      builtIn,
    })),
    reminders: {
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

  return {
    books,
    versions: new Map(voucherRows.map((r) => [r.id, r.version])),
    before: new Map(loaded.map((v) => [v.id, JSON.stringify(v)])),
    deleted,
    counters,
  };
}
