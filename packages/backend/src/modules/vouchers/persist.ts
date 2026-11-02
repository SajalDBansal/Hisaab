import {
  checkVoucherDate,
  postingTotals,
  stockMovements,
  voucherPostings,
  today,
  type Voucher,
} from "@repo/core";
import { and, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { schema, type Db } from "../../db/client";
import { AppError } from "../../lib/app-error";
import type { Actor, Snapshot } from "./snapshot";
import { assertOpenPeriod } from "../../lib/book-period";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const at = (iso?: string) => (iso ? new Date(iso) : null);

/** The core makes ids like "v_k3j2"; the database wants UUIDs. Real UUIDs pass through. */
function idMapper() {
  const map = new Map<string, string>();
  const uuid = (id: string) => {
    if (UUID.test(id)) return id;
    let mapped = map.get(id);
    if (!mapped) {
      mapped = uuidv7();
      map.set(id, mapped);
    }
    return mapped;
  };
  const optional = (id?: string) => (id ? uuid(id) : null);
  // Imported opening bills have their own immutable FK, never a fabricated voucher.
  const bill = (id: string) =>
    id.startsWith("opening-bill:")
      ? {
          billId: null,
          openingPartyId: null,
          openingBillId: id.slice("opening-bill:".length),
        }
      : id.startsWith("opening:")
        ? {
            billId: null,
            openingPartyId: id.slice("opening:".length),
            openingBillId: null,
          }
        : { billId: uuid(id), openingPartyId: null, openingBillId: null };
  return { uuid, optional, bill };
}

/** Every column of the vouchers row that can change after the voucher was created. */
function headerColumns(v: Voucher, ids: ReturnType<typeof idMapper>) {
  return {
    status: v.status,
    partyId: ids.optional(v.partyId),
    amount: v.amount,
    narration: v.narration ?? null,
    snapshot: v.snapshot ?? null,
    delivery: v.delivery ?? null,
    commission: v.commission ?? null,
    inventoryAdjustment: v.inventoryAdjustment
      ? {
          ...v.inventoryAdjustment,
          reversesId: v.inventoryAdjustment.reversesId
            ? ids.uuid(v.inventoryAdjustment.reversesId)
            : undefined,
        }
      : null,
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
    bankClearings: v.bankClearings ?? null,
    tdsSection: v.tds?.section ?? null,
    tdsRate: v.tds?.rate ?? null,
    tdsAmount: v.tds?.amount ?? 0,
    againstId: ids.optional(v.againstId),
    sourceId: ids.optional(v.sourceId),
    convertedToId: ids.optional(v.convertedToId),
  };
}

export interface Saved {
  /** Version of every voucher the operation inserted or changed, by the id the core used. */
  versions: Map<string, number>;
  /** The id the database gave to each voucher the core made, by the id the core used. */
  idOf: (coreId: string) => string;
}

/**
 * Writes what the core changed: new vouchers with their lines, postings and stock,
 * changed vouchers (rebuilt the same way), counters and the edit log.
 * The books balance is checked here too, so a bug can never save an entry that doesn't.
 */
export async function saveChanges(
  tx: Tx,
  firmId: string,
  actor: Actor,
  snap: Snapshot,
): Promise<Saved> {
  const ids = idMapper();
  const { books } = snap;
  const nameOf = new Map<string, string>([
    ...books.parties.map((p) => [p.id, p.name] as const),
    ...books.ledgers.map((l) => [l.id, l.name] as const),
  ]);
  const created = books.vouchers.filter((v) => !snap.before.has(v.id));
  const changed = books.vouchers.filter((v) => {
    const was = snap.before.get(v.id);
    return was !== undefined && was !== JSON.stringify(v);
  });
  const versions = new Map<string, number>();
  // Validate new posting dates here so HTTP writes and offline replay share the rule.
  const dateChanges = changed.filter((v) => {
    const stored = snap.before.get(v.id);
    if (!stored) return true;
    const previous = JSON.parse(stored) as Voucher;
    return previous.date !== v.date;
  });
  for (const voucher of [...created, ...dateChanges]) {
    const problem = checkVoucherDate(voucher.date, today(), books.firm.fyStart);
    if (problem)
      throw new AppError("INVALID_DATE", problem, 400, { date: problem });
  }
  await assertOpenPeriod(
    tx,
    firmId,
    [...created, ...changed].flatMap((v) => {
      const previous = snap.before.get(v.id);
      return previous
        ? [v.date, (JSON.parse(previous) as Voucher).date]
        : [v.date];
    }),
  );
  const partyChanges = changed.flatMap((v) => {
    const stored = snap.before.get(v.id);
    if (!stored || v.type === "journal") return [];
    const previous = JSON.parse(stored) as Voucher;
    return previous.partyId !== v.partyId
      ? [{ voucher: v, previousPartyId: ids.optional(previous.partyId) }]
      : [];
  });
  if (partyChanges.length) {
    // Match the upload writer's lock before any write takes the sync cursor lock.
    // Otherwise a concurrent reservation can copy the old party after this update.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`documents:${firmId}`}, 0))`,
    );
    for (const { voucher: v, previousPartyId } of partyChanges) {
      const { documents } = schema;
      await tx
        .update(documents)
        .set({
          partyId: ids.optional(v.partyId),
          version: sql`${documents.version} + 1`,
          // Relinking must not renew a pending upload's quota reservation.
          updatedAt: sql`case when ${documents.readyAt} is null then ${documents.updatedAt} else now() end`,
        })
        .where(
          and(
            eq(documents.firmId, firmId),
            eq(documents.voucherId, ids.uuid(v.id)),
            isNull(documents.deletedAt),
            // Only the copied link follows the voucher; explicit links stay put.
            previousPartyId
              ? eq(documents.partyId, previousPartyId)
              : isNull(documents.partyId),
          ),
        );
    }
  }
  // Lot identities must also remain unique across API processes and restarts.
  const newLots = new Map(
    created
      .filter((v) => v.type === "purchase")
      .flatMap((v) =>
        (v.lines ?? []).flatMap((l) =>
          l.stockLotId ? [[l.stockLotId, uuidv7()] as const] : [],
        ),
      ),
  );
  for (const v of [...created, ...changed])
    for (const line of v.lines ?? []) {
      const mapped = line.stockLotId ? newLots.get(line.stockLotId) : undefined;
      if (mapped) line.stockLotId = mapped;
    }

  // 1. New vouchers (they only point at vouchers that already exist)
  for (const v of created) {
    await tx.insert(schema.vouchers).values({
      id: ids.uuid(v.id),
      firmId,
      type: v.type,
      number: v.number,
      date: v.date,
      ...headerColumns(v, ids),
      createdBy: actor.id,
      createdAt: at(v.createdAt) ?? new Date(),
    });
    versions.set(v.id, 1);
    await insertAllocations(tx, firmId, v, ids);
  }

  // 2. Changed vouchers: new header values, version + 1
  for (const v of changed) {
    await tx
      .update(schema.vouchers)
      .set({
        ...headerColumns(v, ids),
        // Bills may move within their financial year; the number never changes.
        date: v.date,
        version: sql`${schema.vouchers.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(schema.vouchers.id, ids.uuid(v.id)));
    versions.set(v.id, (snap.versions.get(v.id) ?? 0) + 1);
    // Lines, postings and stock are rebuilt below
    const id = ids.uuid(v.id);
    for (const table of [
      schema.voucherLines,
      schema.voucherCharges,
      schema.journalLines,
      schema.postings,
      schema.stockMovements,
      schema.allocations,
    ])
      await tx.delete(table).where(eq(table.voucherId, id));
    await insertAllocations(tx, firmId, v, ids);
  }

  // 3. Children of new and changed vouchers
  const activeCounts = books.vouchers.filter(
    (v) =>
      v.status === "posted" &&
      v.inventoryAdjustment &&
      v.inventoryAdjustment.kind !== "reversal" &&
      !books.vouchers.some(
        (r) =>
          r.status === "posted" && r.inventoryAdjustment?.reversesId === v.id,
      ),
  );
  for (const v of [...created, ...changed]) {
    if (
      v.status === "posted" &&
      [
        "sale",
        "purchase",
        "credit-note",
        "debit-note",
        "delivery-note",
      ].includes(v.type) &&
      v.lines?.some((line) =>
        activeCounts.some(
          (count) =>
            count.inventoryAdjustment?.itemId === line.itemId &&
            v.date < count.date,
        ),
      )
    )
      throw new AppError(
        "STOCK_HISTORY_FROZEN",
        "Reverse the later inventory correction before posting an earlier stock movement.",
        409,
      );
    const voucherId = ids.uuid(v.id);
    if (v.lines?.length)
      await tx.insert(schema.voucherLines).values(
        v.lines.map((l, position) => ({
          id: uuidv7(),
          firmId,
          voucherId,
          position,
          itemId: l.itemId,
          qty: l.qty,
          rate: l.rate,
          perUnit: l.per?.unit ?? null,
          perFactor: l.per?.factor ?? null,
          discountPercent: l.discountPercent ?? null,
          discountAmount: l.discountAmount ?? 0,
          gstRate: l.gstRate,
          taxType: l.taxType ?? null,
          sourceLine: l.sourceLine ?? null,
          returnAmounts: l.returnAmounts ?? null,
          stockLotId: l.stockLotId ?? null,
          stockCost: l.stockCost ?? null,
          bookScope: l.bookScope ?? null,
          exactMath: l.exactMath ?? false,
        })),
      );
    if (v.charges?.length)
      await tx.insert(schema.voucherCharges).values(
        v.charges.map((c, position) => ({
          id: uuidv7(),
          firmId,
          voucherId,
          position,
          name: c.name,
          amount: c.amount,
          gstRate: c.gstRate,
        })),
      );
    if (v.journalLines?.length)
      await tx.insert(schema.journalLines).values(
        v.journalLines.map((j, position) => ({
          id: uuidv7(),
          firmId,
          voucherId,
          position,
          account: j.account,
          name: j.name,
          debit: j.debit,
          credit: j.credit,
        })),
      );

    const rows = voucherPostings(v, {
      party: v.partyId ? nameOf.get(v.partyId) : undefined,
      ledger: v.ledgerId ? nameOf.get(v.ledgerId) : undefined,
      toLedger: v.toLedgerId ? nameOf.get(v.toLedgerId) : undefined,
    });
    if (!postingTotals(rows).balanced)
      throw new AppError(
        "UNBALANCED",
        "This entry doesn't balance (debits and credits differ), so it was not saved.",
        500,
      );
    if (rows.length)
      await tx.insert(schema.postings).values(
        rows.map((p, position) => ({
          id: uuidv7(),
          firmId,
          voucherId,
          position,
          account: p.account,
          ledgerName: p.ledger,
          debit: p.debit,
          credit: p.credit,
          date: v.date,
        })),
      );

    const moves = [
      ...new Set([
        ...(v.lines ?? []).map((l) => l.itemId),
        ...(v.inventoryAdjustment ? [v.inventoryAdjustment.itemId] : []),
      ]),
    ].flatMap((itemId) =>
      stockMovements(itemId, [v]).map((m) => ({
        id: uuidv7(),
        firmId,
        voucherId,
        itemId,
        date: m.date,
        qty: m.qty,
      })),
    );
    if (moves.length) await tx.insert(schema.stockMovements).values(moves);
  }

  // 4. Numbers used
  for (const [key, last] of Object.entries(books.counters)) {
    if (snap.counters[key] === last) continue;
    const [typeAndSeries = "", financialYear = ""] = key.split(":");
    const isBos = typeAndSeries.endsWith("-bos");
    const isNonGst = typeAndSeries.endsWith("-nongst");
    const type = (
      isNonGst
        ? typeAndSeries.slice(0, -7)
        : isBos
          ? typeAndSeries.slice(0, -4)
          : typeAndSeries
    ) as Voucher["type"];
    const series = isNonGst
      ? `N${books.invoiceSettings.prefixes[type]}`
      : isBos
        ? books.invoiceSettings.billOfSupplyPrefix
        : books.invoiceSettings.prefixes[type];
    await tx
      .insert(schema.voucherCounters)
      .values({ firmId, type, series, financialYear, lastNumber: last })
      .onConflictDoUpdate({
        target: [
          schema.voucherCounters.firmId,
          schema.voucherCounters.type,
          schema.voucherCounters.series,
          schema.voucherCounters.financialYear,
        ],
        set: { lastNumber: last },
      });
  }

  // 5. Edit log
  if (books.auditLog.length)
    await tx.insert(schema.auditLog).values(
      books.auditLog.map((e) => ({
        id: uuidv7(),
        firmId,
        voucherId: ids.uuid(e.voucherId),
        number: e.number,
        voucherType: e.voucherType,
        action: e.action,
        at: new Date(e.at),
        userId: actor.id,
        userName: actor.name,
        changes: e.changes,
        note: e.note ?? null,
      })),
    );

  return { versions, idOf: ids.uuid };
}

async function insertAllocations(
  tx: Tx,
  firmId: string,
  v: Voucher,
  ids: ReturnType<typeof idMapper>,
) {
  if (!v.allocations?.length) return;
  await tx.insert(schema.allocations).values(
    v.allocations.map((a) => ({
      id: uuidv7(),
      firmId,
      voucherId: ids.uuid(v.id),
      ...ids.bill(a.voucherId),
      amount: a.amount,
    })),
  );
}
