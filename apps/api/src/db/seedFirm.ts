import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  captureVoucherSnapshot,
  stockMovements,
  voucherPostings,
  type MockDb,
  type Voucher,
} from "@repo/core";
import type { Db } from "@repo/backend/db/client";
import { schema } from "@repo/backend/db/client";

// Mock ids are short words like "c1" or "firm_skt". The database wants UUIDs,
// so each old id gets a fresh UUID v7 and every reference is translated.
function idMapper() {
  const map = new Map<string, string>();
  const newId = (oldId: string) => {
    let id = map.get(oldId);
    if (!id) {
      id = uuidv7();
      map.set(oldId, id);
    }
    return id;
  };
  const optional = (oldId?: string) => (oldId ? newId(oldId) : null);
  // Account keys such as "party:c1" or "ledger:hdfc" carry an id after the colon
  const accountKey = (key: string) => {
    const [kind, id] = key.split(":");
    return (kind === "party" || kind === "ledger") && id
      ? `${kind}:${newId(id)}`
      : key;
  };
  return { newId, optional, accountKey };
}

const at = (iso?: string) => (iso ? new Date(iso) : null);

/** Inserts one mock firm (all its books) under the given owner. Returns the new firm id. */
export async function insertFirm(db: Db, source: MockDb, ownerId: string) {
  const ids = idMapper();
  const firmId = ids.newId(source.firm.id);
  const f = source.firm;

  await db.transaction(async (tx) => {
    const { organization, member, firmProfile } = schema;
    await tx.insert(organization).values({
      id: firmId,
      name: f.name,
      slug: `${f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${firmId.slice(-6)}`,
    });
    await tx
      .insert(member)
      .values({ organizationId: firmId, userId: ownerId, role: "owner" });
    await tx.insert(firmProfile).values({
      firmId,
      city: f.city,
      state: f.state,
      stateCode: f.stateCode,
      gstin: f.gstin,
      gstRegistration: f.gstRegistration,
      compositionType: f.compositionType ?? null,
      fyStart: f.fyStart,
      address: f.address,
      phone: f.phone,
      email: f.email,
      pan: f.pan,
    });

    const s = source.invoiceSettings;
    await tx.insert(schema.invoiceSettings).values({
      firmId,
      template: s.template,
      terms: s.terms,
      showBankDetails: s.showBankDetails,
      bankLedgerId: ids.optional(s.bankLedgerId),
      bankAccount: s.bankAccount ?? null,
      prefixes: s.prefixes,
      billOfSupplyPrefix: s.billOfSupplyPrefix,
    });
    await tx
      .insert(schema.reminderSettings)
      .values({ firmId, ...source.reminders });

    if (source.units.length)
      await tx
        .insert(schema.units)
        .values(source.units.map((u) => ({ firmId, ...u })));

    if (source.ledgers.length)
      await tx.insert(schema.ledgers).values(
        source.ledgers.map((l) => ({
          id: ids.newId(l.id),
          firmId,
          name: l.name,
          kind: l.kind,
          shortName: l.shortName,
          openingBalance: l.openingBalance,
        })),
      );

    if (source.parties.length)
      await tx.insert(schema.parties).values(
        source.parties.map((p) => ({
          id: ids.newId(p.id),
          firmId,
          name: p.name,
          type: p.type,
          phone: p.phone,
          city: p.city,
          stateCode: p.stateCode,
          gstin: p.gstin || null,
          creditDays: p.creditDays,
          creditLimit: p.creditLimit,
          openingBalance: p.openingBalance,
          openingDate: p.openingDate,
        })),
      );

    if (source.items.length)
      await tx.insert(schema.items).values(
        source.items.map((i) => ({
          id: ids.newId(i.id),
          firmId,
          name: i.name,
          code: i.code,
          hsn: i.hsn,
          groupName: i.group,
          taxType: i.taxType,
          gstRate: i.gstRate,
          unit: i.unit,
          altUnitName: i.altUnit?.name ?? null,
          altUnitFactor: i.altUnit?.factor ?? null,
          purchasePrice: i.purchasePrice,
          salePrice: i.salePrice,
          mrp: i.mrp,
          reorderLevel: i.reorderLevel,
          openingStock: i.openingStock,
          openingCost: i.openingCost ?? i.purchasePrice,
          openingBookScope:
            i.openingBookScope ??
            (i.taxType === "nongst" || f.gstRegistration === "unregistered"
              ? "nongst"
              : "gst"),
          batchNumber: i.batch?.number ?? null,
          batchExpiry: i.batch?.expiry ?? null,
        })),
      );

    if (source.openingAccounts.length)
      await tx.insert(schema.openingAccounts).values(
        source.openingAccounts.map((o) => ({
          firmId,
          account: ids.accountKey(o.account),
          amount: o.amount,
        })),
      );

    await insertVouchers(tx, source, firmId, ownerId, ids);
    await insertSmallTables(tx, source, firmId, ownerId, ids);
  });
  return firmId;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Ids = ReturnType<typeof idMapper>;

// Large inserts go in slices so one statement never passes the 65,535-parameter limit
async function insertInChunks<T>(
  rows: T[],
  insert: (slice: T[]) => Promise<unknown>,
) {
  for (let i = 0; i < rows.length; i += 400)
    await insert(rows.slice(i, i + 400));
}

/** Preserve document snapshots while translating imported master ids. */
function remapSnapshot(voucher: Voucher, source: MockDb, ids: Ids) {
  const snapshot =
    voucher.snapshot ??
    captureVoucherSnapshot(source, voucher.partyId, voucher.lines, "legacy");
  return {
    ...snapshot,
    firm: { ...snapshot.firm, id: ids.newId(snapshot.firm.id) },
    party: snapshot.party
      ? { ...snapshot.party, id: ids.newId(snapshot.party.id) }
      : undefined,
    items: snapshot.items.map((item) => ({ ...item, id: ids.newId(item.id) })),
    settings: {
      ...snapshot.settings,
      bankLedgerId: ids.optional(snapshot.settings.bankLedgerId) ?? "",
    },
  };
}

async function insertVouchers(
  tx: Tx,
  source: MockDb,
  firmId: string,
  ownerId: string,
  ids: Ids,
) {
  const nameOf = new Map<string, string>([
    ...source.parties.map((p) => [p.id, p.name] as const),
    ...source.ledgers.map((l) => [l.id, l.name] as const),
  ]);

  // Vouchers point at each other (returns, conversions), so insert them first without
  // those links, then fill the links in.
  const rows = source.vouchers.map((v) => ({
    id: ids.newId(v.id),
    firmId,
    type: v.type,
    number: v.number,
    date: v.date,
    status: v.status,
    partyId: ids.optional(v.partyId),
    amount: v.amount,
    narration: v.narration ?? null,
    snapshot: remapSnapshot(v, source, ids),
    interState: v.interState ?? null,
    dueDate: v.dueDate ?? null,
    supplierInvoiceNo: v.supplierInvoiceNo ?? null,
    docType: v.docType ?? null,
    taxMode: v.taxMode ?? null,
    bookScope: v.bookScope ?? null,
    noteReason: v.noteReason ?? null,
    cancelReason: v.cancelReason ?? null,
    cancelledAt: at(v.cancelledAt),
    editedAt: at(v.editedAt),
    validUntil: v.validUntil ?? null,
    mode: v.mode ?? null,
    ledgerId: ids.optional(v.ledgerId),
    toLedgerId: ids.optional(v.toLedgerId),
    reference: v.reference ?? null,
    expenseHead: v.expenseHead ?? null,
    clearedOn: v.clearedOn ?? null,
    tdsSection: v.tds?.section ?? null,
    tdsRate: v.tds?.rate ?? null,
    tdsAmount: v.tds?.amount ?? 0,
    createdBy: ownerId,
    createdAt: at(v.createdAt) ?? new Date(),
  }));
  await insertInChunks(rows, (slice) =>
    tx.insert(schema.vouchers).values(slice),
  );

  for (const v of source.vouchers) {
    if (!v.againstId && !v.sourceId && !v.convertedToId) continue;
    await tx
      .update(schema.vouchers)
      .set({
        againstId: ids.optional(v.againstId),
        sourceId: ids.optional(v.sourceId),
        convertedToId: ids.optional(v.convertedToId),
      })
      .where(eqId(ids.newId(v.id)));
  }

  const lines = source.vouchers.flatMap((v) =>
    (v.lines ?? []).map((l, position) => ({
      id: uuidv7(),
      firmId,
      voucherId: ids.newId(v.id),
      position,
      itemId: ids.newId(l.itemId),
      qty: l.qty,
      rate: l.rate,
      perUnit: l.per?.unit ?? null,
      perFactor: l.per?.factor ?? null,
      discountPercent: l.discountPercent ?? null,
      discountAmount: l.discountAmount ?? 0,
      gstRate: l.gstRate,
      taxType: l.taxType ?? null,
      sourceLine: l.sourceLine ?? null,
      stockLotId: l.stockLotId?.startsWith("opening:")
        ? `opening:${ids.newId(l.itemId)}`
        : l.stockLotId
          ? ids.newId(l.stockLotId)
          : null,
      stockCost: l.stockCost ?? null,
      bookScope: l.bookScope ?? null,
    })),
  );
  await insertInChunks(lines, (slice) =>
    tx.insert(schema.voucherLines).values(slice),
  );

  const charges = source.vouchers.flatMap((v) =>
    (v.charges ?? []).map((c, position) => ({
      id: uuidv7(),
      firmId,
      voucherId: ids.newId(v.id),
      position,
      name: c.name,
      amount: c.amount,
      gstRate: c.gstRate,
    })),
  );
  await insertInChunks(charges, (slice) =>
    tx.insert(schema.voucherCharges).values(slice),
  );

  const journal = source.vouchers.flatMap((v) =>
    (v.journalLines ?? []).map((j, position) => ({
      id: uuidv7(),
      firmId,
      voucherId: ids.newId(v.id),
      position,
      account: ids.accountKey(j.account),
      name: j.name,
      debit: j.debit,
      credit: j.credit,
    })),
  );
  await insertInChunks(journal, (slice) =>
    tx.insert(schema.journalLines).values(slice),
  );

  const allocations = source.vouchers.flatMap((v) =>
    (v.allocations ?? []).map((a) => ({
      id: uuidv7(),
      firmId,
      voucherId: ids.newId(v.id),
      // "opening:<partyId>" means the payment settled the party's opening balance
      billId: a.voucherId.startsWith("opening:")
        ? null
        : ids.newId(a.voucherId),
      openingPartyId: a.voucherId.startsWith("opening:")
        ? ids.newId(a.voucherId.slice("opening:".length))
        : null,
      amount: a.amount,
    })),
  );
  await insertInChunks(allocations, (slice) =>
    tx.insert(schema.allocations).values(slice),
  );

  // Postings: computed by the same @repo/core code the app uses today. Drafts and orders post nothing.
  const postings = source.vouchers.flatMap((v) => {
    const named = voucherPostings(v, {
      party: v.partyId ? nameOf.get(v.partyId) : undefined,
      ledger: v.ledgerId ? nameOf.get(v.ledgerId) : undefined,
      toLedger: v.toLedgerId ? nameOf.get(v.toLedgerId) : undefined,
    });
    return named.map((p, position) => ({
      id: uuidv7(),
      firmId,
      voucherId: ids.newId(v.id),
      position,
      account: ids.accountKey(p.account),
      ledgerName: p.ledger,
      debit: p.debit,
      credit: p.credit,
      date: v.date,
    }));
  });
  await insertInChunks(postings, (slice) =>
    tx.insert(schema.postings).values(slice),
  );

  const movements = source.items.flatMap((item) =>
    stockMovements(item.id, source.vouchers).map((m) => ({
      id: uuidv7(),
      firmId,
      voucherId: ids.newId(m.voucherId),
      itemId: ids.newId(item.id),
      date: m.date,
      qty: m.qty,
    })),
  );
  await insertInChunks(movements, (slice) =>
    tx.insert(schema.stockMovements).values(slice),
  );

  // Next bill numbers: "sale:26-27" uses the sale prefix, "sale-bos:26-27" the bill-of-supply one
  const counters = Object.entries(source.counters).map(([key, lastNumber]) => {
    const [typeAndSeries = "", financialYear = ""] = key.split(":");
    const isBos = typeAndSeries.endsWith("-bos");
    const type = (
      isBos ? typeAndSeries.slice(0, -4) : typeAndSeries
    ) as Voucher["type"];
    const series = isBos
      ? source.invoiceSettings.billOfSupplyPrefix
      : source.invoiceSettings.prefixes[type];
    return { firmId, type, series, financialYear, lastNumber };
  });
  if (counters.length) await tx.insert(schema.voucherCounters).values(counters);
}

const eqId = (id: string) => eq(schema.vouchers.id, id);

async function insertSmallTables(
  tx: Tx,
  source: MockDb,
  firmId: string,
  ownerId: string,
  ids: Ids,
) {
  if (source.documents.length)
    await tx.insert(schema.documents).values(
      source.documents.map((d) => ({
        id: ids.newId(d.id),
        firmId,
        name: d.name,
        kind: d.kind,
        sizeBytes: d.sizeKb * 1024,
        partyId: ids.optional(d.partyId),
        voucherId: ids.optional(d.voucherId),
        note: d.note ?? null,
        uploadedOn: d.uploadedOn,
      })),
    );

  const log = source.auditLog.map((e) => ({
    id: ids.newId(e.id),
    firmId,
    voucherId: ids.newId(e.voucherId),
    number: e.number,
    voucherType: e.voucherType,
    action: e.action,
    at: new Date(e.at),
    userId: ownerId,
    userName: e.userName,
    changes: e.changes,
    note: e.note ?? null,
  }));
  if (log.length) await tx.insert(schema.auditLog).values(log);

  const reminded = Object.entries(source.remindedOn).map(
    ([partyId, sentOn]) => ({
      firmId,
      partyId: ids.newId(partyId),
      sentOn,
    }),
  );
  if (reminded.length) await tx.insert(schema.remindersSent).values(reminded);

  const reads = source.readNotices.map((noticeKey) => ({
    firmId,
    userId: ownerId,
    noticeKey,
  }));
  if (reads.length) await tx.insert(schema.noticeReads).values(reads);
}
