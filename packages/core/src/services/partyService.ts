import {
  ageing,
  openBills,
  overdueSummary,
  partyBalance,
  partyBills,
  collectionBills,
  unallocatedMoney,
  type Ageing,
  type Bill,
} from "../accounting/bills";
import { newestFirst } from "../accounting/reports";
import {
  tradeRateHistory,
  tradeRates,
  type TradeRate,
  type TradeRateEntry,
} from "../accounting/tradeRates";
import { today } from "../dates";
import { createParty, updateParty, allocatePartyPayments } from "../mock/db";
import type { Party, PartyInput, PartyType, Paise, Voucher } from "../types";
import { clone, delay, getDb } from "./client";

export interface PartyListRow {
  party: Party;
  /** Positive = you'll get, negative = you'll give. */
  balance: Paise;
  overdueAmount: Paise;
  maxOverdueDays: number;
}

export interface PartyDetail extends PartyListRow {
  unallocated: Paise;
  bills: Bill[];
  openBills: Bill[];
  ageing: Ageing;
  /** Over the credit limit by this much (0 if within limit or no limit). */
  overLimitBy: Paise;
  transactions: Voucher[];
}

function listRow(party: Party, vouchers: Voucher[]): PartyListRow {
  const summary = overdueSummary(collectionBills(party, vouchers, today()));
  return {
    party,
    balance: partyBalance(party, vouchers),
    overdueAmount: summary.overdueAmount,
    maxOverdueDays: summary.maxOverdueDays,
  };
}

export const partyService = {
  async allocatePayments(id: string): Promise<{ allocated: number }> {
    await delay();
    return allocatePartyPayments(getDb(), id, today());
  },
  /** Real API: http.get<PartyListRow[]>(`/parties?type=${type ?? ""}`) */
  async list(type?: PartyType): Promise<PartyListRow[]> {
    await delay();
    const { parties, vouchers } = getDb();
    const rows = parties
      .filter((p) => !type || p.type === type)
      .map((p) => listRow(p, vouchers));
    return clone(
      rows.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)),
    );
  },

  /** Real API: http.get<PartyDetail>(`/parties/${id}`) */
  async get(id: string): Promise<PartyDetail> {
    await delay();
    const { parties, vouchers } = getDb();
    const party = parties.find((p) => p.id === id);
    if (!party) throw new Error("Party not found");
    const row = listRow(party, vouchers);
    const bills = partyBills(party, vouchers, today(), { taxable: true });
    const overLimitBy =
      party.creditLimit > 0 ? Math.max(row.balance - party.creditLimit, 0) : 0;
    const transactions = newestFirst(
      vouchers.filter(
        (v) =>
          v.status !== "draft" &&
          (v.partyId === id ||
            v.journalLines?.some((l) => l.account === `party:${id}`)),
      ),
    );
    return clone({
      ...row,
      unallocated: unallocatedMoney(party, vouchers),
      bills,
      openBills: openBills(bills),
      ageing: ageing(bills),
      overLimitBy,
      transactions,
    });
  },

  /** Real API: http.get(`/parties/${id}/items`): products and latest rates. */
  async items(id: string): Promise<{ rows: TradeRate[] }> {
    await delay();
    const db = getDb();
    const party = db.parties.find((p) => p.id === id);
    if (!party) throw new Error("Party not found");
    return clone({ rows: tradeRates(db, { type: party.type, partyId: id }) });
  },

  /** Real API: http.get(`/parties/${id}/items/${itemId}`): every rate, newest first. */
  async itemRates(id: string, itemId: string): Promise<TradeRateEntry[]> {
    await delay();
    const db = getDb();
    const party = db.parties.find((p) => p.id === id);
    if (!party) throw new Error("Party not found");
    return clone(tradeRateHistory(db, party, itemId));
  },

  /** Real API: http.post<Party>("/parties", input) */
  async create(input: PartyInput): Promise<Party> {
    await delay();
    return clone(createParty(getDb(), input, today()));
  },

  /** Real API: http.put<Party>(`/parties/${id}`, input) */
  async update(id: string, input: PartyInput): Promise<Party> {
    await delay();
    return clone(updateParty(getDb(), id, input));
  },
};
