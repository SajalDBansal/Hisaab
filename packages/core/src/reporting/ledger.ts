import { acc, describeAccount } from "../accounting/accounts";
import { accountBalances, openingPostings } from "../accounting/generalLedger";
import { formatDate } from "../dates";
import type { ISODate, Voucher } from "../types";
import {
  moneyColumn,
  namedPostings,
  narrationCells,
  reportRow,
  reportVouchers,
  textColumn,
  withNarration,
  appendTotals,
} from "./helpers";
import {
  ENTRY_LABELS,
  REPORTS,
  ReportInputError,
  type ReportBooks,
  type ReportRequest,
  type ReportSection,
} from "./types";

interface Movement {
  voucher: Voucher;
  debit: number;
  credit: number;
}
interface OpeningAdjustment {
  date: ISODate;
  partyId: string;
  counterAccount: string;
  debit: number;
  credit: number;
}
interface LedgerRows {
  key: string;
  opening: number;
  movements: Movement[];
  openingAdjustments: OpeningAdjustment[];
}

/** Index postings once so exporting all ledgers does not rescan every voucher per account. */
export function ledgerIndex(books: ReportBooks, request: ReportRequest) {
  const index = new Map<string, LedgerRows>();
  const account = (key: string) => {
    if (!index.has(key))
      index.set(key, {
        key,
        opening: 0,
        movements: [],
        openingAdjustments: [],
      });
    return index.get(key)!;
  };
  books.parties.forEach((p) => account(acc.party(p.id)));
  books.ledgers.forEach((l) => account(acc.ledger(l.id)));
  books.accounts?.forEach((a) => account(acc.account(a.id)));
  for (const p of openingPostings(books, request.from))
    account(p.account).opening += p.debit - p.credit;
  // Later party openings are dated balance adjustments, not synthetic vouchers.
  for (const party of books.parties) {
    if (
      !party.openingBalance ||
      party.openingDate <= request.from ||
      party.openingDate > request.to
    )
      continue;
    const key = acc.party(party.id);
    const adjustment = {
      date: party.openingDate,
      partyId: party.id,
      debit: Math.max(party.openingBalance, 0),
      credit: Math.max(-party.openingBalance, 0),
    };
    account(key).openingAdjustments.push({
      ...adjustment,
      counterAccount: acc.capital,
    });
    account(acc.capital).openingAdjustments.push({
      ...adjustment,
      counterAccount: key,
      debit: adjustment.credit,
      credit: adjustment.debit,
    });
  }
  const all = reportVouchers(books, {
    ...request,
    // Backdated entries before the displayed financial year still belong in opening balances.
    from: "0001-01-01",
    partyId: undefined,
  });
  for (const voucher of all) {
    const grouped = new Map<string, Movement>();
    for (const p of namedPostings(books, voucher)) {
      const row = grouped.get(p.account) ?? { voucher, debit: 0, credit: 0 };
      row.debit += p.debit;
      row.credit += p.credit;
      grouped.set(p.account, row);
    }
    for (const [key, row] of grouped) {
      if (voucher.date < request.from)
        account(key).opening += row.debit - row.credit;
      else account(key).movements.push(row);
    }
  }
  return [...index.values()].sort((a, b) => {
    const left = describeAccount(a.key, books);
    const right = describeAccount(b.key, books);
    return (
      left.group.localeCompare(right.group) ||
      left.name.localeCompare(right.name)
    );
  });
}

export function trialBalanceSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const rows = ledgerIndex(books, request)
    .filter(
      (a) =>
        request.report !== "tax-ledgers" ||
        describeAccount(a.key, books).group === "Duties & Taxes",
    )
    .flatMap((a) => {
      const movements = [...a.movements, ...a.openingAdjustments];
      const debit = movements.reduce((s, m) => s + m.debit, 0);
      const credit = movements.reduce((s, m) => s + m.credit, 0);
      const closing = a.opening + debit - credit;
      if (!request.includeZeroBalances && !a.opening && !debit && !credit)
        return [];
      const info = describeAccount(a.key, books);
      return [
        reportRow(
          info.name,
          info.group,
          a.opening,
          debit,
          credit,
          Math.max(closing, 0),
          Math.max(-closing, 0),
        ),
      ];
    });
  return appendTotals({
    title: REPORTS[request.report].title,
    columns: [
      textColumn("Account"),
      textColumn("Group"),
      moneyColumn("Opening (Dr + / Cr -)"),
      moneyColumn("Period debit"),
      moneyColumn("Period credit"),
      moneyColumn("Closing debit"),
      moneyColumn("Closing credit"),
    ],
    rows,
  });
}

function chronologicalMovements(account: LedgerRows) {
  const movements = [...account.movements, ...account.openingAdjustments];
  return movements.sort((a, b) => {
    const dateA = "voucher" in a ? a.voucher.date : a.date;
    const dateB = "voucher" in b ? b.voucher.date : b.date;
    const dateOrder = dateA.localeCompare(dateB);
    if (dateOrder) return dateOrder;
    if ("voucher" in a && "voucher" in b)
      return (
        a.voucher.createdAt.localeCompare(b.voucher.createdAt) ||
        a.voucher.id.localeCompare(b.voucher.id)
      );
    // An opening is effective before that day's voucher activity.
    if ("voucher" in a) return 1;
    if ("voucher" in b) return -1;
    return a.partyId.localeCompare(b.partyId);
  });
}

function ledgerSection(
  books: ReportBooks,
  account: LedgerRows,
  request: ReportRequest,
): ReportSection {
  const info = describeAccount(account.key, books);
  let balance = account.opening;
  const movements = chronologicalMovements(account);
  const rows = movements.map((movement) => {
    const { debit, credit } = movement;
    balance += debit - credit;
    if (!("voucher" in movement)) {
      const cells = [
        formatDate(movement.date),
        "",
        "Opening adjustment",
        describeAccount(movement.counterAccount, books).name,
        debit,
        credit,
        balance,
      ];
      if (request.includeNarration)
        cells.push(
          "Party opening balance effective on this date; not a voucher.",
        );
      return reportRow(...cells);
    }
    const { voucher } = movement;
    return reportRow(
      ...narrationCells(
        [
          formatDate(voucher.date),
          voucher.number,
          ENTRY_LABELS[voucher.type],
          namedPostings(books, voucher)
            .filter((p) => p.account !== account.key)
            .map((p) => p.ledger)
            .join("; "),
          debit,
          credit,
          balance,
        ],
        voucher,
        request,
      ),
    );
  });
  const pad = (cells: (string | number)[]) =>
    request.includeNarration ? [...cells, ""] : cells;
  rows.unshift(
    reportRow(...pad(["Opening balance", "", "", "", "", "", account.opening])),
  );
  rows.push({
    total: true,
    cells: pad([
      "Closing balance",
      "",
      "",
      "",
      movements.reduce((s, m) => s + m.debit, 0),
      movements.reduce((s, m) => s + m.credit, 0),
      balance,
    ]),
  });
  return {
    title: `${info.name} (${info.group})`,
    columns: withNarration(
      [
        textColumn("Date"),
        textColumn("Voucher"),
        textColumn("Type"),
        textColumn("Particulars"),
        moneyColumn("Debit"),
        moneyColumn("Credit"),
        moneyColumn("Balance (Dr + / Cr -)"),
      ],
      request,
    ),
    rows,
  };
}

export function ledgerSections(
  books: ReportBooks,
  request: ReportRequest,
  sourceBooks: ReportBooks = books,
) {
  const kind = REPORTS[request.report].accounts;
  let accounts = ledgerIndex(books, request);
  if (kind === "cash" || kind === "bank") {
    const allowed = new Set(
      books.ledgers.filter((l) => l.kind === kind).map((l) => acc.ledger(l.id)),
    );
    accounts = accounts.filter((a) => allowed.has(a.key));
  }
  if (request.accountKey) {
    accounts = accounts.filter((a) => a.key === request.accountKey);
    // A valid account can have no movements in the selected book category or period.
    if (
      !accounts.length &&
      kind === "all" &&
      accountBalances(sourceBooks).some((a) => a.key === request.accountKey)
    ) {
      accounts = [
        {
          key: request.accountKey,
          opening: 0,
          movements: [],
          openingAdjustments: [],
        },
      ];
    }
    if (!accounts.length)
      throw new ReportInputError(
        "Choose an account belonging to this firm and report.",
      );
  }
  return accounts
    .filter(
      (a) =>
        request.accountKey ||
        request.includeZeroBalances ||
        a.opening ||
        a.movements.length ||
        a.openingAdjustments.length,
    )
    .map((a) => ledgerSection(books, a, request));
}
