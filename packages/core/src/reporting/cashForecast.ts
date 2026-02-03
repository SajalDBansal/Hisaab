import { acc } from "../accounting/accounts";
import { collectionBills } from "../accounting/bills";
import { scopeBooks } from "../accounting/bookScope";
import { accountBalances, type Books } from "../accounting/generalLedger";
import { addDays, daysBetween, today } from "../dates";
import type { BookScope, Firm, ISODate, TaxScope } from "../types";

export interface ExpectedCashFlow {
  id: string;
  label: string;
  date: ISODate;
  direction: "in" | "out";
  amount: number;
  bookScope: BookScope;
}

export interface CashForecastRequest {
  asOf: ISODate;
  to: ISODate;
  tax: TaxScope;
  includeOverdue: boolean;
  manualFlows: ExpectedCashFlow[];
}

export interface CashForecastTotals {
  opening: number;
  billInflows: number;
  billOutflows: number;
  manualInflows: number;
  manualOutflows: number;
  inflows: number;
  outflows: number;
  net: number;
  closing: number;
}

export interface ForecastBill {
  id: string;
  number: string;
  partyId: string;
  partyName: string;
  bookScope: BookScope;
  dueDate: ISODate;
  expectedDate: ISODate;
  direction: "in" | "out";
  amount: number;
  overdue: boolean;
}

export interface CashForecast {
  asOf: ISODate;
  from: ISODate;
  to: ISODate;
  tax: TaxScope;
  includeOverdue: boolean;
  opening: {
    cash: number;
    bank: number;
    total: number;
    ledgers: {
      id: string;
      name: string;
      kind: "cash" | "bank";
      balance: number;
    }[];
  };
  totals: CashForecastTotals;
  days: (CashForecastTotals & { date: ISODate })[];
  minimumBalance: number;
  firstShortfallDate: ISODate | null;
  bills: ForecastBill[];
  manualFlows: ExpectedCashFlow[];
  excluded: {
    overdueInflows: number;
    overdueOutflows: number;
    laterInflows: number;
    laterOutflows: number;
  };
  reconciliation: (CashForecastTotals & { tax: TaxScope })[];
  assumptions: string[];
}

export class CashForecastInputError extends Error {}

function dateValid(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0100-01-01") return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function money(value: number): number {
  if (!Number.isSafeInteger(value))
    throw new CashForecastInputError(
      "Forecast amounts must be safe whole paise.",
    );
  return value;
}

const sum = (values: number[]) =>
  values.reduce((total, value) => money(total + money(value)), 0);

function totals(opening = 0): CashForecastTotals {
  return {
    opening,
    billInflows: 0,
    billOutflows: 0,
    manualInflows: 0,
    manualOutflows: 0,
    inflows: 0,
    outflows: 0,
    net: 0,
    closing: opening,
  };
}

function finish(row: CashForecastTotals) {
  row.inflows = sum([row.billInflows, row.manualInflows]);
  row.outflows = sum([row.billOutflows, row.manualOutflows]);
  row.net = money(row.inflows - row.outflows);
  row.closing = money(row.opening + row.net);
  return row;
}

/** Planning only: this function never changes bills, allocations or accounting entries. */
export function buildCashForecast(
  source: Books & { firm: Firm },
  request: CashForecastRequest,
  businessDate = today(),
): CashForecast {
  if (
    !dateValid(request.asOf) ||
    !dateValid(request.to) ||
    !dateValid(businessDate) ||
    request.asOf < source.firm.fyStart ||
    request.asOf > businessDate ||
    request.to <= request.asOf ||
    daysBetween(request.asOf, request.to) > 366
  )
    throw new CashForecastInputError(
      "Choose an as-of date within the books through today and a forecast end 1 to 366 days later.",
    );
  if (
    !["all", "gst", "nongst"].includes(request.tax) ||
    typeof request.includeOverdue !== "boolean" ||
    !Array.isArray(request.manualFlows) ||
    request.manualFlows.length > 100
  )
    throw new CashForecastInputError(
      "Choose a book category, overdue policy and at most 100 expected flows.",
    );
  const ids = new Set<string>();
  for (const flow of request.manualFlows) {
    if (
      typeof flow.id !== "string" ||
      !flow.id.trim() ||
      flow.id.length > 100 ||
      ids.has(flow.id) ||
      typeof flow.label !== "string" ||
      !flow.label.trim() ||
      flow.label.length > 120 ||
      !dateValid(flow.date) ||
      flow.date <= request.asOf ||
      flow.date > request.to ||
      !["in", "out"].includes(flow.direction) ||
      !["gst", "nongst"].includes(flow.bookScope) ||
      money(flow.amount) <= 0
    )
      throw new CashForecastInputError(
        "Each expected flow needs a unique id, description, positive whole-paise amount, book category and date within the forecast.",
      );
    ids.add(flow.id);
  }

  // A future opening must not offset an older invoice in collectionBills.
  const books = {
    ...source,
    parties: source.parties.map((party) => ({
      ...party,
      ...(party.openingDate <= request.asOf
        ? {}
        : { openingBalance: 0, openingGstBalance: 0 }),
    })),
  };
  const from = addDays(request.asOf, 1);
  const partitions = (["gst", "nongst"] as const).map((tax) => {
    const scoped = scopeBooks(books, tax);
    const balances = new Map(
      accountBalances(scoped, request.asOf).map((row) => [
        row.key,
        money(row.balance),
      ]),
    );
    const ledgers = scoped.ledgers.map((ledger) => ({
      id: ledger.id,
      name: ledger.name,
      kind: ledger.kind,
      balance: balances.get(acc.ledger(ledger.id)) ?? 0,
    }));
    const opening = sum(ledgers.map((ledger) => ledger.balance));
    const bills: ForecastBill[] = [];
    const excluded = {
      overdueInflows: 0,
      overdueOutflows: 0,
      laterInflows: 0,
      laterOutflows: 0,
    };
    for (const party of scoped.parties) {
      for (const bill of collectionBills(
        party,
        scoped.vouchers,
        request.asOf,
      )) {
        if (!dateValid(bill.dueDate))
          throw new CashForecastInputError(
            "An outstanding bill has an invalid due date.",
          );
        const amount = money(bill.pending);
        if (amount <= 0) continue;
        const direction = party.type === "customer" ? "in" : "out";
        const overdue = bill.dueDate <= request.asOf;
        if ((overdue && !request.includeOverdue) || bill.dueDate > request.to) {
          const key = overdue
            ? direction === "in"
              ? "overdueInflows"
              : "overdueOutflows"
            : direction === "in"
              ? "laterInflows"
              : "laterOutflows";
          excluded[key] = sum([excluded[key], amount]);
          continue;
        }
        bills.push({
          id: bill.id,
          number: bill.number,
          partyId: party.id,
          partyName: party.name,
          bookScope: tax,
          dueDate: bill.dueDate,
          expectedDate: overdue ? from : bill.dueDate,
          direction,
          amount,
          overdue,
        });
      }
    }
    const manualFlows = request.manualFlows
      .filter((flow) => flow.bookScope === tax)
      .map((flow) => ({ ...flow }));
    const result = totals(opening);
    for (const bill of bills) {
      const key = bill.direction === "in" ? "billInflows" : "billOutflows";
      result[key] = sum([result[key], bill.amount]);
    }
    for (const flow of manualFlows) {
      const key = flow.direction === "in" ? "manualInflows" : "manualOutflows";
      result[key] = sum([result[key], flow.amount]);
    }
    return {
      tax,
      ledgers,
      bills,
      manualFlows,
      excluded,
      totals: finish(result),
    };
  });
  const selected = partitions.filter(
    (part) => request.tax === "all" || part.tax === request.tax,
  );
  const combine = (parts: typeof partitions): CashForecastTotals => {
    const combined = totals();
    for (const key of Object.keys(combined) as (keyof CashForecastTotals)[])
      combined[key] = sum(parts.map((part) => part.totals[key]));
    return combined;
  };
  const ledgers = books.ledgers.map((ledger, index) => ({
    id: ledger.id,
    name: ledger.name,
    kind: ledger.kind,
    balance: sum(selected.map((part) => part.ledgers[index].balance)),
  }));
  const cash = sum(
    ledgers
      .filter((ledger) => ledger.kind === "cash")
      .map((ledger) => ledger.balance),
  );
  const bank = sum(
    ledgers
      .filter((ledger) => ledger.kind === "bank")
      .map((ledger) => ledger.balance),
  );
  const bills = selected
    .flatMap((part) => part.bills)
    .sort(
      (a, b) =>
        a.expectedDate.localeCompare(b.expectedDate) ||
        a.id.localeCompare(b.id),
    );
  const manualFlows = selected
    .flatMap((part) => part.manualFlows)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const dayMap = new Map<string, CashForecastTotals & { date: string }>();
  const count = daysBetween(request.asOf, request.to);
  for (let offset = 1; offset <= count; offset++) {
    const date = addDays(request.asOf, offset);
    dayMap.set(date, { date, ...totals() });
  }
  for (const bill of bills) {
    const day = dayMap.get(bill.expectedDate)!;
    const key = bill.direction === "in" ? "billInflows" : "billOutflows";
    day[key] = sum([day[key], bill.amount]);
  }
  for (const flow of manualFlows) {
    const day = dayMap.get(flow.date)!;
    const key = flow.direction === "in" ? "manualInflows" : "manualOutflows";
    day[key] = sum([day[key], flow.amount]);
  }
  let closing = sum([cash, bank]);
  let minimumBalance = closing;
  let firstShortfallDate: string | null = closing < 0 ? request.asOf : null;
  for (const day of dayMap.values()) {
    day.opening = closing;
    closing = finish(day).closing;
    minimumBalance = Math.min(minimumBalance, closing);
    if (closing < 0) firstShortfallDate ??= day.date;
  }
  const excluded = {
    overdueInflows: 0,
    overdueOutflows: 0,
    laterInflows: 0,
    laterOutflows: 0,
  };
  for (const key of Object.keys(excluded) as (keyof typeof excluded)[])
    excluded[key] = sum(selected.map((part) => part.excluded[key]));
  return {
    asOf: request.asOf,
    from,
    to: request.to,
    tax: request.tax,
    includeOverdue: request.includeOverdue,
    opening: { cash, bank, total: sum([cash, bank]), ledgers },
    totals: combine(selected),
    days: [...dayMap.values()],
    minimumBalance,
    firstShortfallDate,
    bills,
    manualFlows,
    excluded,
    reconciliation: [
      ...partitions.map((part) => ({ tax: part.tax, ...part.totals })),
      { tax: "all", ...combine(partitions) },
    ],
    assumptions: [
      "Management estimate, not a statutory cash-flow statement or guaranteed collections. No accounting entries are posted.",
      "Opening cash and bank are book balances at the end of the as-of date, not cleared or available bank funds.",
      "Outstanding sales and purchase bills use recorded due dates, or party credit days when no due date is recorded. Later postings are excluded.",
      request.includeOverdue
        ? "Bills due on or before the as-of date are assumed to settle on the first forecast day."
        : "Bills due on or before the as-of date are excluded from projected flows.",
      "Settlements, returns and on-account credits reduce bill exposure within each book category. Mixed equals GST plus non-GST; credits are not transferred between books.",
      "Manual flows are additional assumptions. Do not repeat outstanding bills or cash/bank transfers. Unbilled income, expenses, taxes, loans and refunds are included only when entered manually.",
      "Explicit opening allocations follow their GST/non-GST split; unsplit legacy openings follow the firm's default book. Book-category cash balances partition the same money accounts.",
    ],
  };
}
