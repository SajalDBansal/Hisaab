import {
  baseQty,
  calcInvoice,
  checkInvoiceNumbers,
  CUSTOM_ACCOUNT_GROUPS,
  isOrderType,
  bookScopeOf,
  stockLots,
  stockMovements,
  today,
  voucherPostings,
  type Item,
  type Voucher as CoreVoucher,
} from "@repo/core";
import { Voucher, type FirmExportData } from "@repo/contracts";
import { restoreIds, unsupported } from "./restore.remap";
import { loanSchedule } from "@repo/core/src/accounting/loanSchedule";
import {
  repaymentAmounts,
  repaymentReferenceMatches,
} from "../loans/loans.journals";
import { isDeepStrictEqual } from "node:util";
import {
  assertOrderQuantityHistory,
  fulfillmentStatus,
  orderLineBalances,
  orderTargets,
} from "@repo/core/src/accounting/orderFulfillment";
import {
  adjustedAllocations,
  loanInterestLines,
  reverseSettlementLines,
  settlementLines,
  sumPaise,
} from "@repo/core/src/accounting/settlements";
import {
  importedOpeningBillId,
  reconcileOpeningBills,
} from "@repo/core/src/accounting/openingImport";
import {
  prepareStockAdjustment,
  prepareStockReversal,
} from "@repo/core/src/accounting/inventoryAdjustments";

type AllocationRow = {
  billId: string | null;
  openingPartyId: string | null;
  openingBillId: string | null;
};
const allocationTarget = (row: AllocationRow) =>
  row.openingBillId
    ? importedOpeningBillId(row.openingBillId)
    : (row.billId ?? `opening:${row.openingPartyId}`);

function checked<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    return unsupported(
      error instanceof Error ? error.message : "Invalid books.",
    );
  }
}

const postingColumns = (row: {
  account: string;
  debit: number;
  credit: number;
}) => [row.account, row.debit, row.credit];
const sameJournal = (
  a: CoreVoucher["journalLines"],
  b: CoreVoucher["journalLines"],
) =>
  isDeepStrictEqual(
    (a ?? []).map(postingColumns),
    (b ?? []).map(postingColumns),
  );

function grouped<T extends { voucherId: string; position?: number }>(
  rows: T[],
) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.voucherId) ?? [];
    list.push(row);
    map.set(row.voucherId, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    if (
      list.some(
        (row, index) => row.position !== undefined && row.position !== index,
      )
    )
      unsupported("Entry line positions must be complete and consecutive.");
  }
  return map;
}

// The same core calculations used for posting verify the file; stored totals are never trusted alone.
export function restoreVouchers(data: FirmExportData): CoreVoucher[] {
  const lines = grouped(data.voucherLines),
    charges = grouped(data.voucherCharges);
  const journals = grouped(data.journalLines),
    allocations = grouped(data.allocations);
  const deltas = grouped(data.settlementAllocations);
  const settlements = new Map(
    data.settlementEntries.map((row) => [row.voucherId, row]),
  );
  const locked = new Set([
    ...data.settlementEntries.flatMap((row) => [
      row.voucherId,
      ...(row.sourceVoucherId ? [row.sourceVoucherId] : []),
    ]),
    ...data.settlementAllocations.flatMap((row) =>
      row.billId ? [row.billId] : [],
    ),
  ]);
  const own = new Map(
    data.orderSourceLines.map((row) => [
      `${row.sourceId}:${row.position}`,
      row,
    ]),
  );
  const incoming = new Map(
    data.orderFulfillmentLines.map((row) => [
      `${row.targetId}:${row.targetPosition}`,
      row,
    ]),
  );
  const managed = new Set([
    ...data.orderFulfillments.map((row) => row.sourceId),
    ...data.orderFulfillmentLines.map((row) => row.targetId),
  ]);
  const vouchers = data.vouchers.map((row) => {
    const header = Object.fromEntries(
      Object.entries(row).filter(([, value]) => value !== null),
    );
    const parsed = Voucher.safeParse({
      ...header,
      fulfillmentManaged: managed.has(row.id) || undefined,
      settlementKind: settlements.get(row.id)?.kind,
      settlementSourceVoucherId:
        settlements.get(row.id)?.sourceVoucherId ?? undefined,
      settlementLocked: locked.has(row.id) || undefined,
      settlementAllocations: deltas.get(row.id)?.map((allocation) => ({
        voucherId: allocationTarget(allocation),
        amount: allocation.amount,
      })),
      lines: lines.get(row.id)?.map((line) => ({
        ...Object.fromEntries(
          Object.entries(line).filter(([, value]) => value !== null),
        ),
        discountAmount: line.discountAmount || undefined,
        orderLineId: own.get(`${row.id}:${line.position}`)?.id,
        orderSourceLineId: incoming.get(`${row.id}:${line.position}`)
          ?.sourceLineId,
        stockFulfilledById:
          incoming.get(`${row.id}:${line.position}`)?.stockFulfilledById ??
          undefined,
        per:
          line.perUnit && line.perFactor
            ? { unit: line.perUnit, factor: line.perFactor }
            : undefined,
      })),
      charges: charges.get(row.id),
      journalLines: journals.get(row.id),
      allocations: allocations.get(row.id)?.map((allocation) => ({
        voucherId: allocationTarget(allocation),
        amount: allocation.amount,
      })),
      tds: row.tdsSection
        ? {
            section: row.tdsSection,
            rate: row.tdsRate ?? 0,
            amount: row.tdsAmount,
          }
        : undefined,
    });
    return parsed.success
      ? {
          ...parsed.data,
          settlementSourceVoucherId:
            settlements.get(row.id)?.sourceVoucherId ?? undefined,
        }
      : unsupported(`Entry ${row.number} is not supported by this version.`);
  });
  for (const voucher of vouchers)
    if (voucher.fulfillmentManaged && isOrderType(voucher.type))
      voucher.fulfillmentStatus = checked(() =>
        fulfillmentStatus(
          orderLineBalances(
            voucher,
            data.orderSourceLines,
            data.orderFulfillmentLines,
            vouchers,
          ),
        ),
      );
  return vouchers;
}

function checkAccount(key: string) {
  if (/^(party|ledger|account):[0-9a-f-]{36}$/i.test(key)) return;
  if (
    [
      "sales",
      "purchase",
      "sales-return",
      "purchase-return",
      "round-off",
      "capital",
      "drawings",
      "stock",
    ].includes(key)
  )
    return;
  if (/^(input|output):(cgst|sgst|igst)$/.test(key)) return;
  if (/^(expense|income|asset|provision|tds):\S.*$/.test(key)) return;
  unsupported(`Unsupported account key: ${key.slice(0, 80)}.`);
}

function checkCounters(data: FirmExportData) {
  const counters = new Map(
    data.voucherCounters.map((row) => [
      `${row.type}:${row.series}:${row.financialYear}`,
      row.lastNumber,
    ]),
  );
  if (counters.size !== data.voucherCounters.length)
    unsupported("Duplicate invoice counters.");
  const numbers = new Set<string>();
  for (const voucher of data.vouchers) {
    const match = /^([^/]+)\/(\d{2}-\d{2})\/(\d+)$/.exec(voucher.number);
    if (
      !match ||
      Number(match[3]) < 1 ||
      !Number.isSafeInteger(Number(match[3]))
    )
      unsupported("An invoice number uses an unsupported format.");
    const last = counters.get(`${voucher.type}:${match[1]}:${match[2]}`);
    if (last === undefined || last < Number(match[3]))
      unsupported("Invoice counters do not cover every issued number.");
    const key = `${voucher.type}:${voucher.number}`;
    if (numbers.has(key)) unsupported("Duplicate invoice numbers.");
    numbers.add(key);
  }
}

function checkPostings(data: FirmExportData, vouchers: CoreVoucher[]) {
  const saved = grouped(data.postings);
  for (const voucher of vouchers) {
    if (voucher.date > today())
      unsupported("Future-dated entries cannot be restored.");
    if (voucher.lines?.length) {
      try {
        checkInvoiceNumbers(voucher.lines, voucher.charges);
      } catch (error) {
        unsupported(
          error instanceof Error ? error.message : "Invalid invoice values.",
        );
      }
    }
    if (voucher.amount < 0) unsupported("Entry amounts cannot be negative.");
    if (
      ["receipt", "payment", "expense", "contra"].includes(voucher.type) &&
      !voucher.ledgerId
    )
      unsupported("A money entry is missing its cash/bank account.");
    if (["receipt", "payment"].includes(voucher.type) && !voucher.partyId)
      unsupported("A receipt or payment is missing its party.");
    if (
      voucher.type === "contra" &&
      (!voucher.toLedgerId || voucher.toLedgerId === voucher.ledgerId)
    )
      unsupported("A contra entry needs two different cash/bank accounts.");
    const expected = voucherPostings(voucher);
    const rows = saved.get(voucher.id) ?? [];
    const columns = (row: {
      account: string;
      debit: number;
      credit: number;
    }) => [row.account, row.debit, row.credit];
    if (
      JSON.stringify(expected.map(columns)) !==
        JSON.stringify(rows.map(columns)) ||
      rows.some((row) => row.date !== voucher.date)
    )
      unsupported(`Stored postings do not match entry ${voucher.number}.`);
    let debit = 0,
      credit = 0;
    for (const row of expected) {
      checkAccount(row.account);
      if (row.debit < 0 || row.credit < 0 || (row.debit > 0 && row.credit > 0))
        unsupported("Invalid posting side.");
      debit += row.debit;
      credit += row.credit;
    }
    if (
      !Number.isSafeInteger(debit) ||
      !Number.isSafeInteger(credit) ||
      debit !== credit
    )
      unsupported(
        `Entry ${voucher.number} is unbalanced or exceeds safe limits.`,
      );
    if (
      ["sale", "purchase", "credit-note", "debit-note"].includes(voucher.type)
    ) {
      if (
        !voucher.partyId ||
        !voucher.lines?.length ||
        voucher.amount !==
          calcInvoice({
            lines: voucher.lines,
            charges: voucher.charges,
            interState: !!voucher.interState,
          }).grandTotal
      )
        unsupported(`Invoice totals do not match entry ${voucher.number}.`);
    }
    if (voucher.type === "journal") {
      // Cancelled journals retain their original lines/amount but have no live postings.
      const lines = voucher.journalLines ?? [];
      const dr = checked(() => sumPaise(lines.map((line) => line.debit)));
      const cr = checked(() => sumPaise(lines.map((line) => line.credit)));
      const quantityOnly =
        voucher.status === "posted" &&
        !!voucher.inventoryAdjustment?.quantity &&
        voucher.inventoryAdjustment.value === 0 &&
        voucher.amount === 0 &&
        lines.length === 0;
      if (
        !quantityOnly &&
        (lines.length < 2 || dr <= 0 || dr !== cr || voucher.amount !== dr)
      )
        unsupported("A journal has invalid lines or totals.");
    }
  }
}

function checkEntryLinks(vouchers: CoreVoucher[]) {
  const byId = new Map(vouchers.map((row) => [row.id, row]));
  const returned = new Map<string, number>();
  for (const entry of vouchers) {
    if (entry.sourceId) {
      const source = byId.get(entry.sourceId);
      if (
        !source ||
        !isOrderType(source.type) ||
        !orderTargets(source.type).includes(
          entry.type as ReturnType<typeof orderTargets>[number],
        ) ||
        (!entry.fulfillmentManaged &&
          entry.status === "posted" &&
          source.convertedToId !== entry.id) ||
        source.id === entry.id ||
        (entry.status === "posted" &&
          (source.partyId !== entry.partyId || source.date > entry.date)) ||
        (entry.status === "posted" && source.status !== "posted")
      )
        unsupported("An order conversion has a broken source link.");
    }
    if (
      entry.convertedToId &&
      byId.get(entry.convertedToId)?.sourceId !== entry.id
    )
      unsupported("An order conversion has a broken destination link.");
    if (!["credit-note", "debit-note"].includes(entry.type)) continue;
    const source = entry.againstId ? byId.get(entry.againstId) : undefined;
    if (
      !source ||
      source.type !== (entry.type === "credit-note" ? "sale" : "purchase") ||
      (entry.status === "posted" &&
        (source.partyId !== entry.partyId || source.date > entry.date))
    )
      unsupported("A return is missing its original matching bill.");
    // A cancelled legacy return can predate later lawful edits to the bill.
    if (entry.status !== "posted") continue;
    for (const [index, line] of (entry.lines ?? []).entries()) {
      const position = line.sourceLine ?? index;
      const original = source.lines?.[position];
      if (
        !original ||
        original.itemId !== line.itemId ||
        original.rate !== line.rate ||
        original.gstRate !== line.gstRate ||
        (original.discountPercent ?? 0) !== (line.discountPercent ?? 0) ||
        (line.discountAmount ?? 0) !==
          Math.round(
            ((original.discountAmount ?? 0) * line.qty) / original.qty,
          ) ||
        !isDeepStrictEqual(original.per, line.per) ||
        (line.stockLotId &&
          original.stockLotId &&
          line.stockLotId !== original.stockLotId)
      )
        unsupported("A return line does not match its original bill.");
      if (source.status !== "posted")
        unsupported("A posted return has an unposted bill.");
      const key = `${source.id}:${position}`;
      const qty =
        Math.round(((returned.get(key) ?? 0) + baseQty(line)) * 1000) / 1000;
      if (qty > baseQty(original))
        unsupported("Returns exceed the original billed quantity.");
      returned.set(key, qty);
    }
  }
}

function checkOrderMetadata(data: FirmExportData, vouchers: CoreVoucher[]) {
  const byId = new Map(vouchers.map((row) => [row.id, row]));
  const sources = new Map(data.orderSourceLines.map((row) => [row.id, row]));
  const receipts = new Map(data.orderFulfillments.map((row) => [row.id, row]));
  const positions = new Set<string>(),
    targets = new Set<string>();
  const frozenLine = (line: NonNullable<CoreVoucher["lines"]>[number]) => [
    line.itemId,
    line.qty,
    line.rate,
    line.per ?? null,
    line.discountPercent ?? 0,
    line.discountAmount ?? 0,
    line.gstRate,
    line.taxType ?? null,
    line.bookScope ?? null,
    line.stockLotId ?? null,
    line.stockCost ?? null,
  ];
  for (const row of data.orderSourceLines) {
    const source = byId.get(row.sourceId),
      line = source?.lines?.[row.position];
    const position = `${row.sourceId}:${row.position}`;
    if (
      !source ||
      !isOrderType(source.type) ||
      !line ||
      positions.has(position) ||
      !isDeepStrictEqual(frozenLine(line), frozenLine(row.line))
    )
      unsupported(
        "An order source line no longer matches its frozen quantity or price.",
      );
    positions.add(position);
  }
  for (const row of data.orderFulfillmentLines) {
    const sourceLine = sources.get(row.sourceLineId),
      receipt = receipts.get(row.fulfillmentId);
    const source = sourceLine && byId.get(sourceLine.sourceId),
      target = byId.get(row.targetId);
    const line = target?.lines?.[row.targetPosition];
    const position = `${row.targetId}:${row.targetPosition}`;
    if (
      !sourceLine ||
      !source ||
      !receipt ||
      !target ||
      !line ||
      targets.has(position) ||
      receipt.sourceId !== source.id ||
      target.sourceId !== source.id ||
      row.qty <= 0 ||
      row.qty !== line.qty ||
      !receipt.response.vouchers.some((v) => v.id === target.id) ||
      !isDeepStrictEqual(
        [
          line.itemId,
          line.rate,
          line.per ?? null,
          line.discountPercent ?? 0,
          line.gstRate,
          line.taxType ?? null,
        ],
        [
          sourceLine.line.itemId,
          sourceLine.line.rate,
          sourceLine.line.per ?? null,
          sourceLine.line.discountPercent ?? 0,
          sourceLine.line.gstRate,
          sourceLine.line.taxType ?? null,
        ],
      ) ||
      line.bookScope !== target.bookScope ||
      target.bookScope !==
        (sourceLine.line.bookScope ??
          (source.taxMode === "off" || sourceLine.line.taxType === "nongst"
            ? "nongst"
            : "gst")) ||
      target.taxMode !== source.taxMode ||
      target.interState !== source.interState ||
      !isDeepStrictEqual(source.snapshot, target.snapshot) ||
      !isDeepStrictEqual(source.delivery, target.delivery) ||
      !isDeepStrictEqual(source.commission, target.commission)
    )
      unsupported(
        "An order fulfillment has changed its source line or frozen snapshot.",
      );
    if (source.type === "delivery-note") {
      if (
        row.stockFulfilledById !== source.id ||
        target.type !== "sale" ||
        line.stockLotId !== sourceLine.line.stockLotId ||
        (line.stockCost ?? 0) > (sourceLine.line.stockCost ?? 0)
      )
        unsupported("A billed delivery has invalid stock provenance.");
    } else if (row.stockFulfilledById)
      unsupported("Only an invoice of a delivery can suppress stock movement.");
    targets.add(position);
  }
  const keys = new Set<string>();
  for (const receipt of data.orderFulfillments) {
    const source = byId.get(receipt.sourceId);
    const key = `${receipt.userId}:${receipt.key}`;
    const uses = data.orderFulfillmentLines.filter(
      (row) => row.fulfillmentId === receipt.id,
    );
    const issued = receipt.response.vouchers;
    if (
      !source ||
      !isOrderType(source.type) ||
      keys.has(key) ||
      !uses.length ||
      receipt.response.id !== receipt.id ||
      receipt.response.sourceId !== source.id ||
      new Set(issued.map((v) => v.id)).size !== issued.length ||
      new Set(issued.map((v) => v.bookScope)).size !== issued.length ||
      issued.some(
        (v) =>
          v.type !== issued[0]?.type ||
          v.sourceId !== source.id ||
          !uses.some((u) => u.targetId === v.id),
      )
    )
      unsupported("An order fulfillment receipt has inconsistent targets.");
    keys.add(key);
    for (const saved of issued) {
      const current = byId.get(saved.id);
      if (
        !current ||
        current.type !== saved.type ||
        current.number !== saved.number ||
        current.date !== saved.date ||
        current.amount !== saved.amount ||
        !isDeepStrictEqual(
          current.lines?.map(frozenLine),
          saved.lines?.map(frozenLine),
        )
      )
        unsupported(
          "An order fulfillment receipt does not match its issued entries.",
        );
      if (
        (current.lines ?? []).some(
          (_, index) => !targets.has(`${current.id}:${index}`),
        )
      )
        unsupported("An order fulfillment is missing a line allocation.");
    }
  }
  for (const source of vouchers.filter(
    (v) => v.fulfillmentManaged && isOrderType(v.type),
  ))
    if (
      (source.lines ?? []).some(
        (_, index) => !positions.has(`${source.id}:${index}`),
      )
    )
      unsupported("An order is missing persisted source-line identities.");
  for (const row of data.orderSourceLines) {
    if (byId.get(row.sourceId)?.type !== "delivery-note") continue;
    const consumedCost = checked(() =>
      sumPaise(
        data.orderFulfillmentLines
          .filter((use) => use.sourceLineId === row.id)
          .map((use) => {
            const target = byId.get(use.targetId);
            return target?.status === "posted"
              ? (target.lines?.[use.targetPosition]?.stockCost ?? 0)
              : 0;
          }),
      ),
    );
    if (consumedCost > (row.line.stockCost ?? 0))
      unsupported("Billed delivery costs exceed their frozen stock value.");
  }
  checked(() =>
    assertOrderQuantityHistory(
      vouchers,
      data.orderSourceLines,
      data.orderFulfillmentLines,
    ),
  );
}

function checkOpeningBills(data: FirmExportData) {
  const seen = new Set<string>();
  for (const bill of data.openingBills) {
    const party = data.parties.find((row) => row.id === bill.partyId);
    const key = `${bill.partyId}:${bill.number.trim().toLowerCase()}`;
    if (
      !party ||
      bill.amount <= 0 ||
      bill.gstAmount < 0 ||
      bill.gstAmount > bill.amount ||
      bill.date > bill.openingDate ||
      bill.dueDate < bill.date ||
      bill.openingDate !== party.openingDate ||
      bill.openingDate > today() ||
      seen.has(key)
    )
      unsupported(
        "An opening bill has invalid dates, amounts or a duplicate number.",
      );
    seen.add(key);
  }
  const reconciliation = checked(() =>
    reconcileOpeningBills(
      data.parties.map((row) => ({
        ...row,
        openingGstBalance: row.openingGstBalance ?? undefined,
      })),
      data.openingBills.map((row, index) => ({ ...row, row: index + 1 })),
      data.firmProfile.gstRegistration !== "unregistered",
    ),
  );
  if (
    reconciliation.some(
      (row) => row.actual !== row.expected || row.actualGst !== row.expectedGst,
    )
  )
    unsupported(
      "Opening bills do not partition their party's signed opening balance.",
    );
}

function checkAllocations(data: FirmExportData, vouchers: CoreVoucher[]) {
  const byId = new Map(vouchers.map((row) => [row.id, row]));
  const parties = new Map(data.parties.map((row) => [row.id, row]));
  const imported = new Map(data.openingBills.map((row) => [row.id, row]));
  const paid = new Map<string, number>(),
    seen = new Set<string>();
  const history = new Map<
    string,
    { limit: number; deltas: Map<string, number> }
  >();
  for (const row of [...data.allocations, ...data.settlementAllocations]) {
    const source = byId.get(row.voucherId),
      party = source?.partyId ? parties.get(source.partyId) : undefined;
    const signed = "entryId" in row;
    const target = allocationTarget(row),
      key = `${row.voucherId}:${target}`;
    if (
      !source ||
      !party ||
      (signed && seen.has(key)) ||
      !row.amount ||
      [row.billId, row.openingPartyId, row.openingBillId].filter(Boolean)
        .length !== 1 ||
      (!signed &&
        (row.amount < 0 ||
          !["receipt", "payment", "credit-note", "debit-note"].includes(
            source.type,
          )))
    )
      unsupported("A settlement has an invalid source or target.");
    seen.add(key);
    const customer = party.type === "customer";
    if (
      !signed &&
      ![
        customer ? "receipt" : "payment",
        customer ? "credit-note" : "debit-note",
      ].includes(source.type)
    )
      unsupported("A settlement belongs to a different party type.");
    const bill = row.billId ? byId.get(row.billId) : undefined;
    const opening = row.openingBillId
      ? imported.get(row.openingBillId)
      : undefined;
    if (row.billId && !bill) unsupported("A settlement bill is missing.");
    if (row.openingBillId && !opening)
      unsupported("An opening settlement bill is missing.");
    if (
      source.status === "posted" &&
      row.billId &&
      (!bill ||
        bill.partyId !== party.id ||
        bill.type !== (customer ? "sale" : "purchase") ||
        (source.status === "posted" && bill.status !== "posted") ||
        bill.date > source.date)
    )
      unsupported(
        "A settlement belongs to a different party or bill type/date.",
      );
    if (
      source.status === "posted" &&
      row.openingBillId &&
      (!opening ||
        opening.partyId !== party.id ||
        opening.openingDate > source.date)
    )
      unsupported("An opening settlement belongs to another party or date.");
    if (
      source.status === "posted" &&
      row.openingPartyId &&
      (row.openingPartyId !== party.id ||
        party.openingDate > source.date ||
        data.openingBills.some((b) => b.partyId === party.id))
    )
      unsupported(
        "A settlement cannot use a replaced or unrelated synthetic opening.",
      );
    if (signed) {
      const entry = data.settlementEntries.find((e) => e.id === row.entryId);
      if (
        !entry ||
        entry.voucherId !== source.id ||
        entry.partyId !== party.id ||
        ![
          "allocation-correction",
          "receivable-writeoff",
          "payable-writeoff",
          "reversal",
        ].includes(entry.kind) ||
        (bill && bookScopeOf(bill) !== entry.bookScope)
      )
        unsupported(
          "A signed settlement has an invalid journal, kind or book.",
        );
      const total = opening?.amount ?? Math.abs(party.openingBalance);
      const gst =
        opening?.gstAmount ??
        Math.abs(
          party.openingGstBalance ??
            (data.firmProfile.gstRegistration === "unregistered"
              ? 0
              : party.openingBalance),
        );
      if (!bill && (entry.bookScope === "gst" ? gst : total - gst) !== total)
        unsupported("A signed settlement crosses opening books.");
    } else {
      const total = checked(() =>
        sumPaise([paid.get(source.id) ?? 0, row.amount]),
      );
      if (total > source.amount + (source.tds?.amount ?? 0))
        unsupported("A settlement exceeds its payment amount.");
      paid.set(source.id, total);
    }
    if (source.status !== "posted") continue;
    const limit =
      bill?.amount ??
      opening?.amount ??
      party.openingBalance * (customer ? 1 : -1);
    const state = history.get(target) ?? {
      limit,
      deltas: new Map<string, number>(),
    };
    state.deltas.set(
      source.date,
      checked(() => sumPaise([state.deltas.get(source.date) ?? 0, row.amount])),
    );
    history.set(target, state);
  }
  // Deltas on the same date are atomic business-day effects, not export row order.
  for (const { limit, deltas } of history.values()) {
    let total = 0;
    for (const [, amount] of [...deltas].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      total = checked(() => sumPaise([total, amount]));
      if (total < 0 || total > limit)
        unsupported("Settlements exceed the bill or opening balance.");
    }
  }
}

function checkSettlements(data: FirmExportData, vouchers: CoreVoucher[]) {
  const byId = new Map(vouchers.map((row) => [row.id, row]));
  const entries = new Map(data.settlementEntries.map((row) => [row.id, row]));
  const used = new Set<string>(),
    reversed = new Set<string>();
  const corrections = new Map<
    string,
    NonNullable<CoreVoucher["allocations"]>
  >();
  const deltaOf = (entryId: string) =>
    data.settlementAllocations
      .filter((row) => row.entryId === entryId)
      .map((row) => ({ voucherId: allocationTarget(row), amount: row.amount }));
  const ordered = [...data.settlementEntries].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
  for (const entry of ordered) {
    const voucher = byId.get(entry.voucherId);
    if (
      !voucher ||
      used.has(entry.voucherId) ||
      voucher.type !== "journal" ||
      voucher.status !== "posted" ||
      voucher.inventoryAdjustment ||
      voucher.date !== entry.date ||
      voucher.amount !== entry.amount ||
      entry.amount <= 0 ||
      bookScopeOf(voucher) !== entry.bookScope ||
      (voucher.partyId ?? null) !== entry.partyId
    )
      unsupported("A settlement entry does not match its posted journal.");
    used.add(entry.voucherId);
    const deltas = deltaOf(entry.id);
    let expected: CoreVoucher["journalLines"];
    if (entry.kind === "reversal") {
      const source = entry.sourceEntryId
        ? entries.get(entry.sourceEntryId)
        : undefined;
      const original = source && byId.get(source.voucherId);
      if (
        !source ||
        !original ||
        source.kind === "reversal" ||
        source.kind === "allocation-correction" ||
        reversed.has(source.id) ||
        source.date > entry.date ||
        source.bookScope !== entry.bookScope ||
        source.partyId !== entry.partyId ||
        source.loanId !== entry.loanId ||
        source.interestAccountId !== entry.interestAccountId ||
        source.installmentNumber !== entry.installmentNumber ||
        source.amount !== entry.amount ||
        entry.sourceVoucherId !== source.voucherId
      )
        unsupported("A settlement reversal does not match its original entry.");
      if (
        ordered.some(
          (row) =>
            row.sourceEntryId === source.id &&
            row.kind !== "reversal" &&
            !reversed.has(row.id),
        )
      )
        unsupported("A settlement reversal still has dependent payments.");
      if ((corrections.get(source.voucherId) ?? []).length)
        unsupported("Release an advance's allocations before its reversal.");
      const originalDeltas = deltaOf(source.id).map((row) => ({
        ...row,
        amount: -row.amount,
      }));
      const sorted = (rows: typeof deltas) =>
        [...rows].sort((a, b) => a.voucherId.localeCompare(b.voucherId));
      if (!isDeepStrictEqual(sorted(deltas), sorted(originalDeltas)))
        unsupported(
          "A settlement reversal must reverse its original allocations.",
        );
      expected = reverseSettlementLines(original.journalLines ?? []);
      reversed.add(source.id);
    } else if (
      entry.kind === "loan-interest-accrual" ||
      entry.kind === "loan-interest-payment"
    ) {
      const loan = data.loans.find((row) => row.id === entry.loanId);
      const account = data.accounts.find(
        (row) => row.id === entry.interestAccountId,
      );
      const period =
        loan &&
        loanSchedule(loan.terms).installments.find(
          (row) => row.number === entry.installmentNumber,
        );
      if (
        !loan ||
        !account ||
        !period ||
        entry.partyId ||
        deltas.length ||
        entry.date < period.dueDate ||
        account.id === loan.accountId ||
        account.group !==
          (loan.direction === "lent"
            ? "Other Current Assets"
            : "Other Current Liabilities")
      )
        unsupported(
          "A loan-interest settlement has invalid account or period details.",
        );
      const bank = data.ledgers.find(
        (row) => `ledger:${row.id}` === voucher.journalLines?.[1]?.account,
      );
      if (entry.kind === "loan-interest-payment") {
        const accrual = entry.sourceEntryId
          ? entries.get(entry.sourceEntryId)
          : undefined;
        if (
          !accrual ||
          accrual.kind !== "loan-interest-accrual" ||
          reversed.has(accrual.id) ||
          accrual.loanId !== loan.id ||
          accrual.interestAccountId !== account.id ||
          accrual.installmentNumber !== entry.installmentNumber ||
          accrual.bookScope !== entry.bookScope ||
          accrual.date > entry.date
        )
          unsupported("An interest payment has no matching accrual.");
        const paid = checked(() =>
          sumPaise(
            ordered
              .filter(
                (row) =>
                  used.has(row.voucherId) &&
                  row.kind === "loan-interest-payment" &&
                  row.sourceEntryId === accrual.id &&
                  !reversed.has(row.id),
              )
              .map((row) => row.amount),
          ),
        );
        if (paid > accrual.amount)
          unsupported("Interest payments exceed their accrual.");
      } else if (
        ordered.some(
          (row) =>
            row.id !== entry.id &&
            used.has(row.voucherId) &&
            row.kind === "loan-interest-accrual" &&
            row.loanId === loan.id &&
            row.installmentNumber === entry.installmentNumber &&
            !reversed.has(row.id),
        )
      )
        unsupported(
          "An installment has duplicate unreversed interest accruals.",
        );
      expected = checked(() =>
        loanInterestLines(
          loan.direction,
          entry.kind === "loan-interest-accrual" ? "accrual" : "payment",
          entry.amount,
          account,
          bank,
        ),
      );
    } else {
      const party = data.parties.find((row) => row.id === entry.partyId);
      if (
        !party ||
        entry.loanId ||
        entry.interestAccountId ||
        entry.installmentNumber ||
        entry.sourceEntryId
      )
        unsupported("A party settlement has invalid party or loan details.");
      const bank = data.ledgers.find(
        (row) => `ledger:${row.id}` === voucher.journalLines?.[1]?.account,
      );
      expected = checked(() =>
        settlementLines(
          entry.kind as Parameters<typeof settlementLines>[0],
          party,
          entry.amount,
          bank,
        ),
      );
      if (entry.kind === "allocation-correction") {
        const source = entry.sourceVoucherId
          ? byId.get(entry.sourceVoucherId)
          : undefined;
        const advance = data.settlementEntries.find(
          (row) => row.voucherId === source?.id,
        );
        if (
          !source ||
          source.partyId !== party.id ||
          source.status !== "posted" ||
          source.date > entry.date ||
          source.tds?.amount ||
          bookScopeOf(source) !== entry.bookScope ||
          (advance && reversed.has(advance.id)) ||
          (source.type !==
            (party.type === "customer" ? "receipt" : "payment") &&
            advance?.kind !==
              (party.type === "customer"
                ? "advance-receipt"
                : "advance-payment"))
        )
          unsupported(
            "An allocation correction has an invalid funding source.",
          );
        const before = corrections.get(source.id) ?? source.allocations ?? [];
        const after = checked(() => adjustedAllocations(before, deltas));
        const total = checked(() => sumPaise(after.map((row) => row.amount)));
        if (
          !deltas.length ||
          total > source.amount ||
          entry.amount !==
            Math.max(
              total,
              checked(() => sumPaise(before.map((row) => row.amount))),
            )
        )
          unsupported("An allocation correction exceeds its source amount.");
        corrections.set(source.id, after);
      } else if (entry.kind.endsWith("writeoff")) {
        if (
          entry.sourceVoucherId ||
          deltas.some((row) => row.amount <= 0) ||
          checked(() => sumPaise(deltas.map((row) => row.amount))) !==
            entry.amount
        )
          unsupported("A write-off does not match its allocations.");
      } else if (deltas.length || entry.sourceVoucherId)
        unsupported(
          "An advance or refund cannot directly change bill allocations.",
        );
    }
    if (!sameJournal(voucher.journalLines, expected))
      unsupported(
        "A settlement journal does not match its business operation.",
      );
  }
}

function restoreItem(item: FirmExportData["items"][number]): Item {
  return {
    ...item,
    group: item.groupName,
    gstRate: item.gstRate as Item["gstRate"],
    openingStock: item.deletedAt ? 0 : item.openingStock,
    openingLots: item.deletedAt ? undefined : (item.openingLots ?? undefined),
    openingCost: item.openingCost ?? undefined,
    openingBookScope: item.openingBookScope ?? undefined,
  };
}

function checkInventory(data: FirmExportData, vouchers: CoreVoucher[]) {
  const items = data.items.map(restoreItem);
  const books = {
    items,
    vouchers: [] as CoreVoucher[],
    parties: [],
    openingAccounts: [],
    accounts: data.accounts.map((row) => ({
      ...row,
      openingGstBalance: row.openingGstBalance ?? undefined,
      group: row.group as (typeof CUSTOM_ACCOUNT_GROUPS)[number],
      contactName: row.contactName ?? undefined,
      phone: row.phone ?? undefined,
      note: row.note ?? undefined,
    })),
    ledgers: data.ledgers.map((row) => ({
      ...row,
      openingGstBalance: row.openingGstBalance ?? undefined,
    })),
  };
  for (const item of data.items)
    if (
      item.openingLots &&
      (Math.round(
        item.openingLots.reduce((sum, lot) => sum + lot.qty, 0) * 1000,
      ) !== Math.round(item.openingStock * 1000) ||
        item.openingLots.some(
          (lot) =>
            lot.qty <= 0 ||
            lot.unitCost < 0 ||
            !Number.isSafeInteger(Math.round(lot.qty * lot.unitCost)),
        ))
    )
      unsupported(
        "Opening lots do not match the item's opening quantity/value.",
      );
  // Validate against entries known when the adjustment was written; later backdating is not a second reversal.
  for (const voucher of [...vouchers].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )) {
    const movement = voucher.inventoryAdjustment;
    if (movement) {
      if (
        voucher.type !== "journal" ||
        voucher.status !== "posted" ||
        voucher.lines?.length
      )
        unsupported("An inventory adjustment must be a posted stock journal.");
      if (
        (movement.kind === "damage" && movement.quantity >= 0) ||
        (movement.kind === "landed-cost" &&
          (movement.quantity !== 0 || movement.value <= 0))
      )
        unsupported(
          "An inventory adjustment has an invalid quantity or value direction.",
        );
      const item = items.find((row) => row.id === movement.itemId);
      const lot =
        item &&
        stockLots(item, books.vouchers, voucher.date).find(
          (row) => row.id === movement.lotId,
        );
      if (!item || !lot || bookScopeOf(voucher) !== lot.bookScope)
        unsupported(
          "An inventory adjustment references a missing lot or the wrong book.",
        );
      const original = movement.reversesId
        ? books.vouchers.find((row) => row.id === movement.reversesId)
        : undefined;
      const prepared = checked(() => {
        if (movement.kind === "reversal") {
          if (!original)
            return unsupported(
              "An inventory reversal has no preceding adjustment.",
            );
          return prepareStockReversal(
            books,
            original,
            voucher.date,
            movement.reason,
          );
        }
        if (movement.reversesId)
          return unsupported(
            "Only a reversal can reference another adjustment.",
          );
        return prepareStockAdjustment(books, {
          kind: movement.kind,
          itemId: item.id,
          lotId: lot.id,
          date: voucher.date,
          expectedQty: lot.qty,
          expectedValue: lot.value,
          quantity:
            movement.kind === "count"
              ? Math.round((lot.qty + movement.quantity) * 1000) / 1000
              : -movement.quantity,
          amount: movement.value,
          offsetAccount: voucher.journalLines?.[1]?.account,
          reason: movement.reason,
        });
      });
      // JSON/PostgreSQL normalize -0 to 0, including the frozen value of free stock.
      const values = (row: typeof movement) => [
        row.kind,
        row.itemId,
        row.lotId,
        row.quantity + 0,
        row.value + 0,
        row.reason,
        row.reversesId,
      ];
      if (
        !isDeepStrictEqual(values(prepared.movement), values(movement)) ||
        !sameJournal(prepared.journal.lines, voucher.journalLines)
      )
        unsupported(
          "An inventory journal does not match its frozen adjustment.",
        );
    }
    books.vouchers.push(voucher);
  }
}

function checkStock(data: FirmExportData, vouchers: CoreVoucher[]) {
  const key = (r: {
    voucherId: string;
    itemId: string;
    date: string;
    qty: number;
  }) => JSON.stringify([r.voucherId, r.itemId, r.date, r.qty]);
  const expected: string[] = [];
  const byItem = new Map<string, CoreVoucher[]>();
  for (const voucher of vouchers)
    for (const itemId of new Set([
      ...(voucher.lines?.map((line) => line.itemId) ?? []),
      ...(voucher.inventoryAdjustment
        ? [voucher.inventoryAdjustment.itemId]
        : []),
    ])) {
      const entries = byItem.get(itemId) ?? [];
      entries.push(voucher);
      byItem.set(itemId, entries);
    }
  for (const item of data.items) {
    const core = restoreItem(item);
    const entries = byItem.get(item.id) ?? [];
    for (const move of stockMovements(item.id, entries))
      expected.push(key({ ...move, itemId: item.id }));
    for (const lot of checked(() => stockLots(core, entries)))
      if (
        lot.minimumQty < 0 ||
        !Number.isSafeInteger(lot.value) ||
        lot.value < 0
      )
        unsupported("Stock lots have a deficit or an invalid valuation.");
  }
  if (
    JSON.stringify(expected.sort()) !==
    JSON.stringify(data.stockMovements.map(key).sort())
  )
    unsupported("Stored stock movements do not match the entries.");
}

function checkLoans(data: FirmExportData, vouchers: CoreVoucher[]) {
  const accounts = new Map(data.accounts.map((row) => [row.id, row]));
  const loans = new Map(data.loans.map((row) => [row.id, row]));
  const loanAccounts = new Set<string>();
  for (const loan of data.loans) {
    const group = accounts.get(loan.accountId)?.group;
    const permitted =
      loan.direction === "lent"
        ? ["Loans & Advances (Asset)"]
        : ["Secured Loans", "Unsecured Loans"];
    if (
      !group ||
      !permitted.includes(group) ||
      loanAccounts.has(loan.accountId)
    )
      unsupported("Each loan needs a distinct account in its matching group.");
    loanAccounts.add(loan.accountId);
    if (
      loan.maturityDate !== loanSchedule(loan.terms).maturityDate ||
      loan.version < 1
    )
      unsupported("Loan terms and maturity do not match.");
  }
  const used = new Set<string>();
  for (const row of data.loanRepaymentReferences) {
    const loan = loans.get(row.loanId);
    const voucher = vouchers.find((v) => v.id === row.voucherId);
    if (
      !loan ||
      !voucher ||
      row.installmentNumber < 1 ||
      row.installmentNumber > loan.terms.installments ||
      row.principal <= 0 ||
      row.interest < 0 ||
      row.voucherVersion < 1
    )
      unsupported("A loan repayment reference has invalid terms or amounts.");
    if (row.removedAt) continue;
    if (used.has(row.voucherId))
      unsupported("A repayment journal is linked more than once.");
    used.add(row.voucherId);
    // Changed or cancelled references remain historical; unchanged references must match their journal.
    if (voucher.status === "posted" && voucher.version === row.voucherVersion) {
      const ledgers = data.ledgers.map((l) => ({
        ...l,
        openingGstBalance: l.openingGstBalance ?? undefined,
      }));
      const amounts = repaymentAmounts(loan, voucher, ledgers);
      if (
        !repaymentReferenceMatches(amounts, row) ||
        row.voucherDate !== voucher.date ||
        row.voucherNumber !== voucher.number
      )
        unsupported("A repayment reference does not match its posted journal.");
    }
  }
}

export function checkRestoreBooks(data: FirmExportData) {
  const ids = restoreIds(data);
  const openings = [
    ...[...data.parties, ...data.ledgers, ...data.accounts].map((r) => ({
      total: r.openingBalance,
      gst: r.openingGstBalance,
    })),
    ...data.openingAccounts.map((r) => ({
      total: r.amount,
      gst: r.openingGstAmount,
    })),
  ];
  for (const { total, gst } of openings)
    if (gst !== null && (gst < Math.min(0, total) || gst > Math.max(0, total)))
      unsupported("An opening GST allocation exceeds its signed total.");
  for (const row of data.vouchers) {
    if (
      row.tdsAmount &&
      (row.type !== "payment" || !row.tdsSection || row.tdsRate === null)
    )
      unsupported("A tax deduction is missing its payment details.");
  }
  for (const line of data.voucherLines) {
    ids.lot(line.stockLotId, line.itemId);
    if ((line.perUnit === null) !== (line.perFactor === null))
      unsupported("A line has an incomplete alternate unit.");
  }
  for (const row of data.accounts)
    if (!(CUSTOM_ACCOUNT_GROUPS as readonly string[]).includes(row.group))
      unsupported("A custom account group is unsupported.");
  for (const row of [
    ...data.openingAccounts,
    ...data.journalLines,
    ...data.postings,
  ])
    checkAccount(row.account);
  checkCounters(data);
  const vouchers = restoreVouchers(data);
  checkLoans(data, vouchers);
  checkPostings(data, vouchers);
  checkEntryLinks(vouchers);
  checkOrderMetadata(data, vouchers);
  checkOpeningBills(data);
  checkSettlements(data, vouchers);
  checkAllocations(data, vouchers);
  checkInventory(data, vouchers);
  checkStock(data, vouchers);
}
