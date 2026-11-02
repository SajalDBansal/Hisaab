/**
 * Figures for the Home dashboard and cash/bank balances.
 * Every number on screen comes from here — never hard-code totals in components.
 */
import {
  addDays,
  daysBetween,
  lastMonths,
  monthLabel,
  yearMonth,
} from "../dates";
import type {
  Firm,
  ISODate,
  Item,
  Ledger,
  Paise,
  Party,
  Voucher,
} from "../types";
import {
  compositionQuarter,
  gstModeOf,
  type CompositionQuarter,
} from "./gstMode";
import {
  isPosted,
  overdueSummary,
  partyBalance,
  collectionBills,
  vouchersByParty,
} from "./bills";
import { isLowStock, stockQty } from "./stock";
import { inventoryValue, vouchersByItem } from "./stockLots";
import { gstMonth } from "./gst";
import { calcInvoice } from "./invoice";

/** Newest first: by date, and for the same date the one entered last comes first. */
export function newestFirst(vouchers: Voucher[]): Voucher[] {
  return vouchers
    .map((v, index) => ({ v, index }))
    .sort((a, b) =>
      a.v.date === b.v.date
        ? b.index - a.index
        : b.v.date.localeCompare(a.v.date),
    )
    .map((x) => x.v);
}

/** Signed effect of a voucher on a cash or bank ledger (money in = positive). */
export function ledgerEffect(v: Voucher, ledgerId: string): Paise {
  if (!isPosted(v)) return 0;
  if (v.type === "journal") {
    // A journal can move money between accounts (e.g. cash deposited in bank).
    return (v.journalLines ?? [])
      .filter((l) => l.account === `ledger:${ledgerId}`)
      .reduce((s, l) => s + l.debit - l.credit, 0);
  }
  if (v.type === "contra") {
    if (v.toLedgerId === ledgerId) return v.amount; // money in
    if (v.ledgerId === ledgerId) return -v.amount; // money out
    return 0;
  }
  if (v.ledgerId !== ledgerId) return 0;
  if (v.type === "receipt") return v.amount;
  if (v.type === "payment" || v.type === "expense") return -v.amount;
  return 0;
}

export function ledgerBalance(
  ledger: Ledger,
  vouchers: Voucher[],
  asOf?: ISODate,
): Paise {
  return vouchers
    .filter((v) => !asOf || v.date <= asOf)
    .reduce(
      (bal, v) => bal + ledgerEffect(v, ledger.id),
      ledger.openingBalance,
    );
}

export interface StatementRow {
  voucher: Voucher;
  /** Who the money came from or went to (party name or expense head). */
  particulars: string;
  moneyIn: Paise;
  moneyOut: Paise;
  /** Balance after this row. */
  balance: Paise;
}

export interface LedgerStatement {
  opening: Paise;
  totalIn: Paise;
  totalOut: Paise;
  closing: Paise;
  /** Newest first. */
  rows: StatementRow[];
}

/**
 * Cash book / bank book: every movement in one cash or bank account with a running balance.
 * Pass `from` to start the statement on a date (earlier movements roll into the opening balance).
 */
export function ledgerStatement(
  ledger: Ledger,
  vouchers: Voucher[],
  parties: Party[],
  from?: ISODate,
): LedgerStatement {
  const opening = from
    ? ledgerBalance(ledger, vouchers, addDays(from, -1))
    : ledger.openingBalance;
  let balance = opening;
  let totalIn = 0;
  let totalOut = 0;
  const rows: StatementRow[] = [];
  const oldestFirst = [...newestFirst(vouchers)].reverse();
  for (const v of oldestFirst) {
    if (from && v.date < from) continue;
    const effect = ledgerEffect(v, ledger.id);
    if (effect === 0) continue;
    balance += effect;
    if (effect > 0) totalIn += effect;
    else totalOut -= effect;
    rows.push({
      voucher: v,
      particulars:
        parties.find((p) => p.id === v.partyId)?.name ??
        v.expenseHead ??
        v.narration ??
        "",
      moneyIn: Math.max(effect, 0),
      moneyOut: Math.max(-effect, 0),
      balance,
    });
  }
  return { opening, totalIn, totalOut, closing: balance, rows: rows.reverse() };
}

/** Output GST on sales minus input GST on purchases for one month ("2026-10"). */
export function gstForMonth(vouchers: Voucher[], month: string) {
  const working = gstMonth(vouchers, month);
  return {
    output: working.output.total,
    input: working.input.total,
    payable: working.payable.total,
  };
}

/**
 * Goods value of posted bills less their returns, by month, without GST or
 * charges: the same figure as the Sales / Purchase accounts (Doc 01, "Net sales").
 */
function netGoodsByMonth(vouchers: Voucher[]) {
  const months = new Map<string, { sale: Paise; purchase: Paise }>();
  const SIGNS = {
    sale: ["sale", 1],
    "credit-note": ["sale", -1],
    purchase: ["purchase", 1],
    "debit-note": ["purchase", -1],
  } as const;
  for (const v of vouchers) {
    const sign = SIGNS[v.type as keyof typeof SIGNS];
    if (!sign || !isPosted(v)) continue;
    const { itemsTaxable } = calcInvoice({
      lines: v.lines ?? [],
      interState: !!v.interState,
    });
    const month = yearMonth(v.date);
    const row = months.get(month) ?? { sale: 0, purchase: 0 };
    row[sign[0]] += sign[1] * itemsTaxable;
    months.set(month, row);
  }
  return (month: string, side: "sale" | "purchase") =>
    months.get(month)?.[side] ?? 0;
}

export interface DashboardData {
  toCollect: Paise;
  customersWithBalance: number;
  overdueCustomers: number;
  toPay: Paise;
  suppliersWithBalance: number;
  cash: Paise;
  banks: { ledger: Ledger; balance: Paise }[];
  bankTotal: Paise;
  /** Bills issued today, as billed (GST included). */
  todaySales: { amount: Paise; count: number };
  /** Net sales: goods value without GST, after sales returns. */
  monthSales: Paise;
  lastMonthSales: Paise;
  /** Regular GST firms: last month's output − input. Null for composition and no-GST firms. */
  gst: { month: string; output: Paise; input: Paise; payable: Paise } | null;
  /** Composition firms: this quarter's tax so far (CMP-08). */
  composition: CompositionQuarter | null;
  /** Net purchases this month, after returns (shown instead of GST for firms without GST). */
  monthPurchases: Paise;
  lowStockCount: number;
  stockValue: Paise;
  salesVsPurchases: {
    month: string;
    label: string;
    sales: Paise;
    purchases: Paise;
  }[];
  /** Cash + bank at each month end (or today for the current month). */
  cashTrend: { month: string; label: string; balance: Paise }[];
  topOverdue: {
    party: Party;
    balance: Paise;
    overdueAmount: Paise;
    maxOverdueDays: number;
  }[];
  recent: Voucher[];
  upcoming: {
    title: string;
    detail: string;
    date: ISODate;
    daysLeft: number;
    amount?: Paise;
  }[];
}

export function computeDashboard(data: {
  parties: Party[];
  items: Item[];
  ledgers: Ledger[];
  vouchers: Voucher[];
  asOf: ISODate;
  /** The firm, for its GST mode (left out = regular). */
  firm?: Pick<Firm, "gstRegistration" | "compositionType">;
}): DashboardData {
  const { parties, items, ledgers, vouchers, asOf } = data;
  const mode = data.firm ? gstModeOf(data.firm) : "regular";
  const thisMonth = yearMonth(asOf);
  const months = lastMonths(asOf, 6);
  const lastMonth = months[months.length - 2];

  // Parties
  let toCollect = 0;
  let toPay = 0;
  let customersWithBalance = 0;
  let suppliersWithBalance = 0;
  const overdueRows: DashboardData["topOverdue"] = [];
  const byParty = vouchersByParty(parties, vouchers);
  for (const party of parties) {
    const own = byParty.get(party.id) ?? [];
    const balance = partyBalance(party, own, asOf);
    if (balance > 0) {
      toCollect += balance;
      customersWithBalance += party.type === "customer" ? 1 : 0;
    }
    if (balance < 0) {
      toPay += -balance;
      suppliersWithBalance += party.type === "supplier" ? 1 : 0;
    }
    if (party.type === "customer" && balance > 0) {
      const summary = overdueSummary(collectionBills(party, own, asOf));
      if (summary.overdueAmount > 0)
        overdueRows.push({ party, balance, ...summary });
    }
  }
  overdueRows.sort((a, b) => b.overdueAmount - a.overdueAmount);

  // Cash and bank
  const cashLedgers = ledgers.filter((l) => l.kind === "cash");
  const bankLedgers = ledgers.filter((l) => l.kind === "bank");
  const cash = cashLedgers.reduce((s, l) => s + ledgerBalance(l, vouchers), 0);
  const banks = bankLedgers.map((ledger) => ({
    ledger,
    balance: ledgerBalance(ledger, vouchers),
  }));
  const bankTotal = banks.reduce((s, b) => s + b.balance, 0);

  // Sales
  const todaySalesList = vouchers.filter(
    (v) => isPosted(v) && v.type === "sale" && v.date === asOf,
  );
  const netGoods = netGoodsByMonth(vouchers);
  const monthSales = netGoods(thisMonth, "sale");
  const lastMonthSales = netGoods(lastMonth, "sale");

  // Stock
  let lowStockCount = 0;
  let totalStockValue = 0;
  const byItem = vouchersByItem(vouchers);
  for (const item of items) {
    const own = byItem.get(item.id) ?? [];
    const qty = stockQty(item, own);
    if (isLowStock(item, qty)) lowStockCount++;
    totalStockValue += inventoryValue(item, own);
  }

  // Charts
  const salesVsPurchases = months.map((m) => ({
    month: m,
    label: monthLabel(m),
    sales: netGoods(m, "sale"),
    purchases: netGoods(m, "purchase"),
  }));
  const cashTrend = months.map((m) => {
    const monthEnd =
      m === thisMonth
        ? asOf
        : addDays(`${months[months.indexOf(m) + 1]}-01`, -1);
    const balance = ledgers.reduce(
      (s, l) => s + ledgerBalance(l, vouchers, monthEnd),
      0,
    );
    return { month: m, label: monthLabel(m), balance };
  });

  // Recent vouchers (newest first)
  const recent = newestFirst(
    vouchers.filter((v) => v.status !== "draft"),
  ).slice(0, 5);

  // Upcoming: GST returns for last month, and supplier bills due in the next 7 days
  const gstLast = gstForMonth(vouchers, lastMonth);
  const gstr1Due = `${thisMonth}-11`;
  const gstr3bDue = `${thisMonth}-20`;
  const upcoming: DashboardData["upcoming"] = [];
  const daysTo = (d: ISODate) => daysBetween(asOf, d);
  const composition =
    mode === "composition"
      ? compositionQuarter(vouchers, asOf, data.firm?.compositionType)
      : null;
  if (mode === "composition") {
    // CMP-08 for the quarter that just ended, due on the 18th
    const lastQuarter = compositionQuarter(
      vouchers,
      addDays(`${composition!.months[0]}-01`, -1),
      data.firm?.compositionType,
    );
    if (daysTo(lastQuarter.due) >= 0 && daysTo(lastQuarter.due) <= 31)
      upcoming.push({
        title: `CMP-08 for ${lastQuarter.label}`,
        detail: "Composition tax",
        date: lastQuarter.due,
        daysLeft: daysTo(lastQuarter.due),
        amount: lastQuarter.tax,
      });
  }
  if (mode === "regular" && daysTo(gstr1Due) >= 0)
    upcoming.push({
      title: `GSTR-1 for ${monthLabel(lastMonth)}`,
      detail: "Outward supplies",
      date: gstr1Due,
      daysLeft: daysTo(gstr1Due),
    });
  if (mode === "regular" && daysTo(gstr3bDue) >= 0)
    upcoming.push({
      title: `GSTR-3B for ${monthLabel(lastMonth)}`,
      detail: "Tax payable",
      date: gstr3bDue,
      daysLeft: daysTo(gstr3bDue),
      amount: gstLast.payable,
    });
  for (const party of parties.filter((p) => p.type === "supplier")) {
    for (const bill of collectionBills(
      party,
      byParty.get(party.id) ?? [],
      asOf,
    )) {
      const left = daysTo(bill.dueDate);
      if (bill.pending > 0 && left >= 0 && left <= 7)
        upcoming.push({
          title: `Pay ${party.name}`,
          detail: bill.number,
          date: bill.dueDate,
          daysLeft: left,
          amount: bill.pending,
        });
    }
  }
  upcoming.sort((a, b) => a.daysLeft - b.daysLeft);

  return {
    toCollect,
    customersWithBalance,
    overdueCustomers: overdueRows.length,
    toPay,
    suppliersWithBalance,
    cash,
    banks,
    bankTotal,
    todaySales: {
      amount: todaySalesList.reduce((s, v) => s + v.amount, 0),
      count: todaySalesList.length,
    },
    monthSales,
    lastMonthSales,
    gst: mode === "regular" ? { month: lastMonth, ...gstLast } : null,
    composition,
    monthPurchases: netGoods(thisMonth, "purchase"),
    lowStockCount,
    stockValue: totalStockValue,
    salesVsPurchases,
    cashTrend,
    topOverdue: overdueRows.slice(0, 5),
    recent,
    upcoming,
  };
}
