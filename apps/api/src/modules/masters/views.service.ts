import {
  ageing,
  openBills,
  overdueSummary,
  vouchersByParty,
  partyBills,
  partyBalance,
  newestFirst,
  stockQty,
  inventoryValue,
  scopeBooks,
  type TaxScope,
  isLowStock,
  stockMovements,
  itemProfit,
  ledgerStatement,
  today,
  collectionBills,
  unallocatedMoney,
  type Role,
} from "@repo/core";
import type { Db } from "@repo/backend/db/client";
import {
  canReadBooks,
  canReadParty,
  canReadVoucher,
  forbiddenRead,
} from "../../lib/read-permissions";
import {
  loadReportBooks,
  loadReportSnapshot,
} from "@repo/backend/modules/reports/books";
import { partiesRepo } from "./parties.repo";
import { itemsRepo } from "./items.repo";
import { toPartyRow } from "./parties.service";
import { toItemRow } from "./items.service";
import {
  notFound,
  pageOf,
  pageStart,
} from "@repo/backend/modules/masters/shared";
import type { PartyListParams } from "@repo/contracts";

export async function listParties(
  db: Db,
  firmId: string,
  query: PartyListParams,
  role: Role,
) {
  if (query.type && !canReadParty(role, query.type)) throw forbiddenRead();
  const start = pageStart(query.cursor);
  const rows = await partiesRepo.list(db, firmId, {
    ...query,
    type: canReadBooks(role) ? query.type : "customer",
    offset: start,
  });
  const { vouchers } = await loadReportBooks(db, firmId);
  const parties = rows.map(toPartyRow);
  const byParty = vouchersByParty(parties, vouchers);
  return pageOf(
    parties.map((party) => ({
      ...party,
      ...overdueSummary(
        collectionBills(party, byParty.get(party.id) ?? [], today()),
      ),
    })),
    start,
    query.limit,
  );
}

export async function readParty(
  db: Db,
  firmId: string,
  id: string,
  role: Role,
) {
  const row = await partiesRepo.get(db, firmId, id);
  if (!row) throw notFound("party");
  if (!canReadParty(role, row.type)) throw forbiddenRead();
  const party = toPartyRow(row);
  const { vouchers } = await loadReportBooks(db, firmId);
  // The party screen's open bills feed payment TDS, which needs their GST-free value.
  const bills = partyBills(party, vouchers, today(), { taxable: true });
  const balance = partyBalance(party, vouchers);
  return {
    ...party,
    party,
    balance,
    ...overdueSummary(collectionBills(party, vouchers, today())),
    unallocated: unallocatedMoney(party, vouchers),
    bills,
    openBills: openBills(bills),
    ageing: ageing(bills),
    overLimitBy:
      party.creditLimit > 0 ? Math.max(balance - party.creditLimit, 0) : 0,
    transactions: newestFirst(
      vouchers.filter(
        (v) =>
          v.status !== "draft" &&
          canReadVoucher(role, v.type) &&
          (v.partyId === id ||
            v.journalLines?.some((l) => l.account === `party:${id}`)),
      ),
      // The latest few, without print copies; the tab pages through /vouchers/page.
    )
      .slice(0, PARTY_RECENT_ENTRIES)
      .map(({ snapshot: _print, ...voucher }) => voucher),
  };
}

const PARTY_RECENT_ENTRIES = 20;

export async function readItem(db: Db, firmId: string, id: string) {
  return db.transaction(
    async (db) => {
      const row = await itemsRepo.get(db, firmId, id);
      if (!row) throw notFound("item");
      const item = toItemRow(row);
      const { vouchers } = await loadReportBooks(db, firmId);
      const qty = stockQty(item, vouchers);
      return {
        ...item,
        item,
        qty,
        value: inventoryValue(item, vouchers),
        lowStock: isLowStock(item, qty),
        // The latest few; the full list pages through /items/:id/movements.
        movements: stockMovements(id, vouchers).reverse().slice(0, 20),
        profit: itemProfit(item, vouchers),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** Every stock movement of one item, newest first. */
export async function readItemMovements(db: Db, firmId: string, id: string) {
  const { vouchers } = await loadReportBooks(db, firmId);
  return stockMovements(id, vouchers).reverse();
}

export async function readLedgerStatement(
  db: Db,
  firmId: string,
  id: string,
  tax: TaxScope = "all",
) {
  const books = scopeBooks(await loadReportSnapshot(db, firmId), tax);
  const ledger = books.ledgers.find((row) => row.id === id);
  if (!ledger) throw notFound("account");
  return { ledger, ...ledgerStatement(ledger, books.vouchers, books.parties) };
}
