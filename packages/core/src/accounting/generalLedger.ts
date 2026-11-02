/**
 * General ledger: adds up every posting by account to give the
 * trial balance, chart of accounts with balances, profit & loss and balance sheet.
 *
 * Sign convention inside this file: a balance is (debits − credits).
 * Positive = Dr balance, negative = Cr balance.
 */
import type { ISODate, Item, Ledger, Paise, Party, Voucher } from "../types";
import {
  acc,
  describeAccount,
  GROUPS,
  type GroupInfo,
  type GroupName,
  type CustomAccount,
} from "./accounts";
import { isPosted } from "./bills";
import { voucherPostings, type Posting } from "./postings";
import { stockValue, stockVouchersAsOf } from "./stock";
import { inventoryValue } from "./stockLots";
import { addDays } from "../dates";

/** Opening balance of an account not covered by parties, cash/bank or stock (e.g. furniture). */
export interface OpeningAccount {
  account: string;
  /** Positive = Dr, negative = Cr. */
  amount: Paise;
  openingGstAmount?: Paise;
}

/** Everything the general ledger needs. */
export interface Books {
  accounts?: CustomAccount[];
  parties: Party[];
  ledgers: Ledger[];
  items: Item[];
  vouchers: Voucher[];
  openingAccounts: OpeningAccount[];
}

const names = (books: Books) => ({
  parties: books.parties,
  ledgers: books.ledgers,
  accounts: books.accounts,
});

// ---------------------------------------------------------------------------
// Opening balances
// ---------------------------------------------------------------------------

/** Opening inventory uses its frozen unit cost. */
export function openingStockValue(items: Item[]): Paise {
  return items.reduce((s, i) => s + stockValue(i, i.openingStock), 0);
}

/** Value of stock in hand now (or on a date) at historical lot cost. */
export function closingStockValue(
  items: Item[],
  vouchers: Voucher[],
  asOf?: ISODate,
): Paise {
  const upTo = asOf ? stockVouchersAsOf(vouchers, asOf) : vouchers;
  return items.reduce((s, i) => s + inventoryValue(i, upTo), 0);
}

/**
 * Opening balances as Dr/Cr rows. Capital is the balancing figure,
 * so the opening trial balance always agrees.
 */
export function openingPostings(books: Books, asOf?: ISODate): Posting[] {
  const rows: Posting[] = [];
  const add = (account: string, amount: Paise) => {
    if (!amount) return;
    const name = describeAccount(account, names(books)).name;
    rows.push({
      account,
      ledger: name,
      debit: Math.max(amount, 0),
      credit: Math.max(-amount, 0),
    });
  };
  for (const l of books.ledgers) add(acc.ledger(l.id), l.openingBalance);
  for (const a of books.accounts ?? [])
    add(acc.account(a.id), a.openingBalance);
  for (const p of books.parties)
    if (!asOf || p.openingDate <= asOf) add(acc.party(p.id), p.openingBalance);
  add(acc.stock, openingStockValue(books.items));
  for (const o of books.openingAccounts) add(o.account, o.amount);
  const net = rows.reduce((s, r) => s + r.debit - r.credit, 0);
  add(acc.capital, -net);
  return rows;
}

export interface PartyOpeningMovement {
  account: string;
  date: ISODate;
  partyId: string;
  counterAccount: string;
  debit: Paise;
  credit: Paise;
}

/** Party openings and their capital counterparts take effect on the opening date. */
export function partyOpeningMovements(books: Books): PartyOpeningMovement[] {
  return books.parties.flatMap((party) => {
    if (!party.openingBalance) return [];
    const account = acc.party(party.id);
    const movement = {
      date: party.openingDate,
      partyId: party.id,
      debit: Math.max(party.openingBalance, 0),
      credit: Math.max(-party.openingBalance, 0),
    };
    return [
      { ...movement, account, counterAccount: acc.capital },
      {
        ...movement,
        account: acc.capital,
        counterAccount: account,
        debit: movement.credit,
        credit: movement.debit,
      },
    ];
  });
}

/** Every posting of every posted voucher, with its voucher. */
function allPostings(books: Books, asOf?: ISODate) {
  const out: { voucher: Voucher; posting: Posting }[] = [];
  for (const v of books.vouchers) {
    if (!isPosted(v) || (asOf && v.date > asOf)) continue;
    const party = books.parties.find((p) => p.id === v.partyId)?.name;
    const ledger = books.ledgers.find((l) => l.id === v.ledgerId)?.name;
    for (const posting of voucherPostings(v, { party, ledger }))
      out.push({ voucher: v, posting });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Balances and trial balance
// ---------------------------------------------------------------------------

export interface AccountBalance {
  key: string;
  name: string;
  group: GroupName;
  /** Dr positive, Cr negative. */
  balance: Paise;
}

/** Closing balance of every account that has any entry. */
export function accountBalances(
  books: Books,
  asOf?: ISODate,
): AccountBalance[] {
  const totals = new Map<string, Paise>();
  for (const a of books.accounts ?? []) totals.set(acc.account(a.id), 0);
  for (const p of books.parties) totals.set(acc.party(p.id), 0);
  for (const l of books.ledgers) totals.set(acc.ledger(l.id), 0);
  const bump = (p: Posting) =>
    totals.set(p.account, (totals.get(p.account) ?? 0) + p.debit - p.credit);
  openingPostings(books, asOf).forEach(bump);
  allPostings(books, asOf).forEach((x) => bump(x.posting));
  return [...totals.entries()].map(([key, balance]) => ({
    ...describeAccount(key, names(books)),
    balance,
  }));
}

export interface TrialBalance {
  rows: {
    key: string;
    name: string;
    group: GroupName;
    debit: Paise;
    credit: Paise;
  }[];
  totalDebit: Paise;
  totalCredit: Paise;
}

/** Each account's closing balance in the Dr or Cr column. The two totals must agree. */
export function trialBalance(books: Books, asOf?: ISODate): TrialBalance {
  const order = (g: GroupName) => GROUPS.findIndex((x) => x.name === g);
  const rows = accountBalances(books, asOf)
    .filter((a) => a.balance !== 0)
    .sort(
      (a, b) => order(a.group) - order(b.group) || a.name.localeCompare(b.name),
    )
    .map((a) => ({
      key: a.key,
      name: a.name,
      group: a.group,
      debit: Math.max(a.balance, 0),
      credit: Math.max(-a.balance, 0),
    }));
  return {
    rows,
    totalDebit: rows.reduce((s, r) => s + r.debit, 0),
    totalCredit: rows.reduce((s, r) => s + r.credit, 0),
  };
}

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------

export interface ChartGroup {
  group: GroupInfo;
  /** Dr positive, Cr negative. */
  balance: Paise;
  accounts: AccountBalance[];
}

/** All groups (even empty ones) with their accounts and balances, in chart order. */
export function chartOfAccounts(books: Books): ChartGroup[] {
  const balances = accountBalances(books);
  return GROUPS.map((group) => {
    const accounts = balances
      .filter((a) => a.group === group.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      group,
      balance: accounts.reduce((s, a) => s + a.balance, 0),
      accounts,
    };
  });
}

// ---------------------------------------------------------------------------
// Final accounts
// ---------------------------------------------------------------------------

export interface StatementLine {
  key?: string;
  name: string;
  amount: Paise;
}

export interface ProfitAndLoss {
  sales: Paise;
  openingStock: Paise;
  purchases: Paise;
  directExpenses: StatementLine[];
  closingStock: Paise;
  /** Sales − cost of goods sold. */
  grossProfit: Paise;
  indirectIncomes: StatementLine[];
  indirectExpenses: StatementLine[];
  netProfit: Paise;
}

export interface BalanceSheetSide {
  sections: { title: string; lines: StatementLine[]; total: Paise }[];
  total: Paise;
}

export interface FinalAccounts {
  profitAndLoss: ProfitAndLoss;
  balanceSheet: {
    liabilities: BalanceSheetSide;
    assets: BalanceSheetSide;
    balanced: boolean;
  };
}

export function finalAccounts(
  books: Books,
  asOf?: ISODate,
  from?: ISODate,
): FinalAccounts {
  const balances = accountBalances(books, asOf);
  const inGroup = (g: GroupName) =>
    balances.filter((a) => a.group === g && a.balance !== 0);
  const sum = (rows: AccountBalance[]) =>
    rows.reduce((s, a) => s + a.balance, 0);
  const lines = (rows: AccountBalance[], sign: 1 | -1) =>
    rows
      .map((a) => ({ key: a.key, name: a.name, amount: a.balance * sign }))
      .sort((a, b) => b.amount - a.amount);

  // ---- Profit & loss (incomes are Cr, so flip their sign) ----
  const sales = -sum(inGroup("Sales Accounts"));
  const openingStock = sum(inGroup("Stock-in-hand"));
  const purchases = sum(inGroup("Purchase Accounts"));
  const direct = inGroup("Direct Expenses");
  const closingStock = closingStockValue(books.items, books.vouchers, asOf);
  const grossProfit =
    sales + closingStock - openingStock - purchases - sum(direct);
  const indirectIncomes = inGroup("Indirect Incomes");
  const indirectExpenses = inGroup("Indirect Expenses");
  const netProfit = grossProfit - sum(indirectIncomes) - sum(indirectExpenses);

  // ---- Balance sheet ----
  // Capital = capital account + this year's profit − drawings.
  const capitalRows = inGroup("Capital Account");
  const capitalLines: StatementLine[] = [
    ...lines(capitalRows, -1),
    {
      name: netProfit >= 0 ? "Add: net profit" : "Less: net loss",
      amount: netProfit,
    },
  ];
  const liabilities: BalanceSheetSide["sections"] = [
    {
      title: "Capital",
      lines: capitalLines,
      total: capitalLines.reduce((s, l) => s + l.amount, 0),
    },
  ];
  const assets: BalanceSheetSide["sections"] = [];

  // Every other balance-sheet group goes on the side its balance is on.
  const bsGroups = GROUPS.filter(
    (g) =>
      (g.nature === "asset" || g.nature === "liability") &&
      g.name !== "Capital Account" &&
      g.name !== "Stock-in-hand",
  );
  for (const g of bsGroups) {
    const rows = inGroup(g.name);
    const debit = rows.filter((a) => a.balance > 0);
    const credit = rows.filter((a) => a.balance < 0);
    if (debit.length)
      assets.push({ title: g.name, lines: lines(debit, 1), total: sum(debit) });
    if (credit.length)
      liabilities.push({
        title: g.name,
        lines: lines(credit, -1),
        total: -sum(credit),
      });
  }
  assets.push({
    title: "Closing stock",
    lines: [
      {
        key: acc.stock,
        name: "Stock at historical lot cost",
        amount: closingStock,
      },
    ],
    total: closingStock,
  });

  const totalL = liabilities.reduce((s, x) => s + x.total, 0);
  const totalA = assets.reduce((s, x) => s + x.total, 0);

  return {
    profitAndLoss:
      from && asOf
        ? periodProfitAndLoss(books, from, asOf)
        : {
            sales,
            openingStock,
            purchases,
            directExpenses: lines(direct, 1),
            closingStock,
            grossProfit,
            indirectIncomes: lines(indirectIncomes, -1),
            indirectExpenses: lines(indirectExpenses, 1),
            netProfit,
          },
    balanceSheet: {
      liabilities: { sections: liabilities, total: totalL },
      assets: { sections: assets, total: totalA },
      balanced: totalL === totalA,
    },
  };
}

/** Income and expenses belong to the period; balance-sheet earnings remain cumulative. */
export function periodProfitAndLoss(
  books: Books,
  from: ISODate,
  to: ISODate,
): ProfitAndLoss {
  const before = addDays(from, -1);
  const opening = new Map(
    accountBalances(books, before).map((a) => [a.key, a.balance]),
  );
  const movement = accountBalances(books, to).map((a) => ({
    ...a,
    balance: a.balance - (opening.get(a.key) ?? 0),
  }));
  const inGroup = (group: GroupName) =>
    movement.filter((a) => a.group === group && a.balance !== 0);
  const sum = (group: GroupName) =>
    inGroup(group).reduce((n, a) => n + a.balance, 0);
  const lines = (group: GroupName, sign = 1) =>
    inGroup(group).map((a) => ({
      key: a.key,
      name: a.name,
      amount: a.balance * sign,
    }));
  const openingStock = closingStockValue(books.items, books.vouchers, before);
  const closingStock = closingStockValue(books.items, books.vouchers, to);
  const sales = -sum("Sales Accounts");
  const purchases = sum("Purchase Accounts");
  const grossProfit =
    sales + closingStock - openingStock - purchases - sum("Direct Expenses");
  return {
    sales,
    openingStock,
    purchases,
    closingStock,
    grossProfit,
    directExpenses: lines("Direct Expenses"),
    indirectIncomes: lines("Indirect Incomes", -1),
    indirectExpenses: lines("Indirect Expenses"),
    netProfit: grossProfit - sum("Indirect Incomes") - sum("Indirect Expenses"),
  };
}

// ---------------------------------------------------------------------------
// Statement of one account
// ---------------------------------------------------------------------------

export type AccountStatementRow = {
  date: ISODate;
  debit: Paise;
  credit: Paise;
  /** Running balance after this row (Dr positive). */
  balance: Paise;
} & (
  | { kind: "voucher"; voucher: Voucher }
  | {
      kind: "opening";
      voucher: null;
      partyId: string;
      counterAccount: string;
      counterName: string;
    }
);

export interface AccountStatement {
  key: string;
  name: string;
  group: GroupName;
  /** Undated opening balances; dated party openings appear in rows and totals. */
  opening: Paise;
  totalDebit: Paise;
  totalCredit: Paise;
  closing: Paise;
  /** Newest first. Openings take effect before vouchers on the same date. */
  rows: AccountStatementRow[];
}

function statementOrder(a: AccountStatementRow, b: AccountStatementRow) {
  const dateOrder = a.date.localeCompare(b.date);
  if (dateOrder) return dateOrder;
  if (a.kind === "opening")
    return b.kind === "opening" ? a.partyId.localeCompare(b.partyId) : -1;
  if (b.kind === "opening") return 1;
  return (
    a.voucher.createdAt.localeCompare(b.voucher.createdAt) ||
    a.voucher.id.localeCompare(b.voucher.id)
  );
}

export function accountStatement(books: Books, key: string): AccountStatement {
  const info = describeAccount(key, names(books));
  const opening = openingPostings({ ...books, parties: [] })
    .filter((p) => p.account === key)
    .reduce((s, p) => s + p.debit - p.credit, 0);
  let balance = opening;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows: AccountStatementRow[] = partyOpeningMovements(books)
    .filter((movement) => movement.account === key)
    .map((movement) => ({
      kind: "opening",
      voucher: null,
      date: movement.date,
      partyId: movement.partyId,
      counterAccount: movement.counterAccount,
      counterName: describeAccount(movement.counterAccount, names(books)).name,
      debit: movement.debit,
      credit: movement.credit,
      balance: 0,
    }));
  for (const v of books.vouchers) {
    if (!isPosted(v)) continue;
    const party = books.parties.find((p) => p.id === v.partyId)?.name;
    const ledger = books.ledgers.find((l) => l.id === v.ledgerId)?.name;
    const mine = voucherPostings(v, { party, ledger }).filter(
      (p) => p.account === key,
    );
    if (mine.length === 0) continue;
    const debit = mine.reduce((s, p) => s + p.debit, 0);
    const credit = mine.reduce((s, p) => s + p.credit, 0);
    rows.push({
      kind: "voucher",
      voucher: v,
      date: v.date,
      debit,
      credit,
      balance: 0,
    });
  }
  for (const row of rows.sort(statementOrder)) {
    balance += row.debit - row.credit;
    totalDebit += row.debit;
    totalCredit += row.credit;
    row.balance = balance;
  }
  return {
    ...info,
    opening,
    totalDebit,
    totalCredit,
    closing: balance,
    rows: rows.reverse(),
  };
}
