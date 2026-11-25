/**
 * Phase 1 reports (doc 37, T25/T26/T49/T50/T51/T56). Every figure comes from
 * posted entries in the firm's books, through the same helpers as the other
 * reports; nothing is filed or sent anywhere.
 */
import {
  ITC_REVERSE_DAYS,
  ITC_WARN_DAYS,
  LOST_CUSTOMER_DAYS,
  isQuietCustomer,
  itcAtRiskBills,
  rankParties,
} from "../accounting/insightRules";
import { collectionBills, isPosted, partyBills } from "../accounting/bills";
import {
  DEFAULT_MSME_INTEREST_RATE,
  MSME_DUE_SOON_DAYS,
  msmeCovered,
  msmeInterest,
  msmePayBy,
} from "../accounting/msme";
import { MSME_LABELS } from "../businessProfile";
import { periodProfitAndLoss } from "../accounting/generalLedger";
import { calcInvoice } from "../accounting/invoice";
import { orderStatus } from "../accounting/orders";
import { baseQty } from "../accounting/stockInputs";
import { daysBetween, formatDate } from "../dates";
import type { Voucher, VoucherType } from "../types";
import { balanceSheetSections } from "./financial";
import {
  appendTotals,
  moneyColumn,
  numberColumn,
  reportRow,
  textColumn,
  voucherParty,
} from "./helpers";
import {
  REPORTS,
  type ReportBooks,
  type ReportRequest,
  type ReportRow,
  type ReportSection,
} from "./types";

export { ITC_REVERSE_DAYS, ITC_WARN_DAYS, LOST_CUSTOMER_DAYS };
/** Interest rate used when the report request gives none (per year). */
export const DEFAULT_INTEREST_RATE = 18;

const posted = (
  books: ReportBooks,
  types: VoucherType[],
  request: ReportRequest,
) =>
  books.vouchers.filter(
    (v) =>
      isPosted(v) &&
      types.includes(v.type) &&
      v.date >= request.from &&
      v.date <= request.to &&
      (!request.partyId || v.partyId === request.partyId),
  );

const totalsOf = (v: Voucher) =>
  calcInvoice({
    lines: v.lines ?? [],
    charges: v.charges,
    interState: !!v.interState,
  });

/** Returns count against their side: credit notes against sales, debit notes against purchases. */
const signOf = (v: Voucher) =>
  v.type === "credit-note" || v.type === "debit-note" ? -1 : 1;

const percent = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 1000) / 10 : 0;

// ---------------------------------------------------------------------------
// ITC at risk (T26)
// ---------------------------------------------------------------------------

/**
 * Purchase bills still unpaid after 150 days. Input credit on the unpaid share
 * must be reversed once a bill is 180 days old; it can be claimed again on payment.
 */
export function itcAtRiskSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const rows: ReportRow[] = itcAtRiskBills(
    books.parties,
    books.vouchers,
    request.to,
    { partyId: request.partyId },
  ).map(({ supplier, voucher, bill, tax, atRisk, reverseNow, limit }) =>
    reportRow(
      reverseNow ? "Reverse now" : "Due soon",
      voucher.number,
      voucher.supplierInvoiceNo ?? "",
      voucherParty(books, voucher)?.name ?? supplier.name,
      formatDate(bill.date),
      formatDate(limit),
      bill.ageDays,
      bill.amount,
      bill.pending,
      tax,
      atRisk,
    ),
  );
  rows.sort((a, b) => Number(b.cells[6]) - Number(a.cells[6]));
  return appendTotals({
    title: REPORTS["itc-at-risk"].title,
    columns: [
      textColumn("Stage"),
      textColumn("Bill"),
      textColumn("Supplier invoice"),
      textColumn("Supplier"),
      textColumn("Bill date"),
      textColumn("180 days on"),
      numberColumn("Days"),
      moneyColumn("Bill amount"),
      moneyColumn("Unpaid"),
      moneyColumn("GST on bill"),
      moneyColumn("ITC at risk"),
    ],
    rows,
  });
}

// ---------------------------------------------------------------------------
// Interest on overdue invoices (T49)
// ---------------------------------------------------------------------------

/** Simple interest on what is still due, from the due date to the report's end. */
export function interestSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const rate = request.interestRate ?? DEFAULT_INTEREST_RATE;
  const rows: ReportRow[] = [];
  for (const customer of books.parties) {
    if (customer.type !== "customer") continue;
    if (request.partyId && customer.id !== request.partyId) continue;
    for (const bill of partyBills(customer, books.vouchers, request.to)) {
      if (bill.pending <= 0 || bill.overdueDays <= 0) continue;
      const interest = Math.round(
        (bill.pending * rate * bill.overdueDays) / 36_500,
      );
      rows.push(
        reportRow(
          bill.number,
          customer.name,
          formatDate(bill.date),
          formatDate(bill.dueDate),
          bill.overdueDays,
          bill.pending,
          interest,
          bill.pending + interest,
        ),
      );
    }
  }
  rows.sort((a, b) => Number(b.cells[4]) - Number(a.cells[4]));
  return appendTotals({
    title: `${REPORTS["interest-calculator"].title} at ${rate}% a year`,
    columns: [
      textColumn("Invoice"),
      textColumn("Customer"),
      textColumn("Date"),
      textColumn("Due"),
      numberColumn("Days overdue"),
      moneyColumn("Balance due"),
      moneyColumn("Interest"),
      moneyColumn("With interest"),
    ],
    rows,
  });
}

// ---------------------------------------------------------------------------
// MSME payables (T30)
// ---------------------------------------------------------------------------

/**
 * Unpaid bills of micro and small suppliers with the date they must be paid
 * by (MSMED Act s.15) and, once late, s.16 interest at the chosen yearly rate
 * (compound, monthly rests). On-account payments are set against the oldest
 * bills first, as on the party screen.
 */
export function msmePayablesSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const asOf = request.to;
  const rate = request.interestRate ?? DEFAULT_MSME_INTEREST_RATE;
  const rows: ReportRow[] = [];
  for (const supplier of books.parties) {
    if (supplier.type !== "supplier" || !msmeCovered(supplier.msmeType))
      continue;
    if (request.partyId && supplier.id !== request.partyId) continue;
    for (const bill of collectionBills(supplier, books.vouchers, asOf)) {
      if (bill.pending <= 0) continue;
      const voucher = books.vouchers.find((v) => v.id === bill.id);
      const payBy = msmePayBy(bill.date, bill.dueDate);
      const late = daysBetween(payBy, asOf);
      const { interest } = msmeInterest(bill.pending, payBy, asOf, rate);
      rows.push(
        reportRow(
          late > 0
            ? "Overdue"
            : -late <= MSME_DUE_SOON_DAYS
              ? "Due soon"
              : "Not due",
          bill.number,
          voucher?.supplierInvoiceNo ?? "",
          (voucher && voucherParty(books, voucher)?.name) ?? supplier.name,
          MSME_LABELS[supplier.msmeType!],
          formatDate(bill.date),
          formatDate(payBy),
          Math.max(late, 0),
          bill.pending,
          interest,
          bill.pending + interest,
        ),
      );
    }
  }
  rows.sort(
    (a, b) =>
      Number(b.cells[7]) - Number(a.cells[7]) ||
      String(a.cells[1]).localeCompare(String(b.cells[1])),
  );
  return appendTotals({
    title: `${REPORTS["msme-payables"].title}, interest at ${rate}% a year`,
    columns: [
      textColumn("Status"),
      textColumn("Bill"),
      textColumn("Supplier invoice"),
      textColumn("Supplier"),
      textColumn("MSME"),
      textColumn("Bill date"),
      textColumn("Pay by"),
      numberColumn("Days overdue"),
      moneyColumn("Unpaid"),
      moneyColumn("Interest (s.16)"),
      moneyColumn("With interest"),
    ],
    rows,
  });
}

// ---------------------------------------------------------------------------
// Customers and suppliers (T56)
// ---------------------------------------------------------------------------

/** New, regular and lost customers, with what each bought in the period. */
export function customerTrackingSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const sales = books.vouchers.filter(
    (v) => isPosted(v) && v.type === "sale" && v.date <= request.to,
  );
  const rows: ReportRow[] = [];
  for (const customer of books.parties) {
    if (customer.type !== "customer") continue;
    if (request.partyId && customer.id !== request.partyId) continue;
    const own = sales.filter((v) => v.partyId === customer.id);
    if (!own.length) continue;
    const dates = own.map((v) => v.date).sort();
    const first = dates[0];
    const last = dates[dates.length - 1];
    const inPeriod = own.filter((v) => v.date >= request.from);
    const returns = books.vouchers.filter(
      (v) =>
        isPosted(v) &&
        v.type === "credit-note" &&
        v.partyId === customer.id &&
        v.date >= request.from &&
        v.date <= request.to,
    );
    const status =
      first >= request.from
        ? "New"
        : isQuietCustomer(last, request.to)
          ? "Lost"
          : "Regular";
    rows.push(
      reportRow(
        customer.name,
        status,
        formatDate(first),
        formatDate(last),
        daysBetween(last, request.to),
        inPeriod.length,
        inPeriod.reduce((s, v) => s + v.amount, 0) -
          returns.reduce((s, v) => s + v.amount, 0),
      ),
    );
  }
  const order = { New: 0, Regular: 1, Lost: 2 } as Record<string, number>;
  rows.sort(
    (a, b) =>
      order[String(a.cells[1])] - order[String(b.cells[1])] ||
      Number(b.cells[6]) - Number(a.cells[6]),
  );
  return appendTotals({
    title: REPORTS["customer-tracking"].title,
    columns: [
      textColumn("Customer"),
      textColumn("Status"),
      textColumn("Customer since"),
      textColumn("Last sale"),
      numberColumn("Days since"),
      numberColumn("Invoices"),
      moneyColumn("Net sales"),
    ],
    rows,
  });
}

/** Parties ranked by net value in the period (returns taken off), with their share. */
export function topPartiesSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const customers = request.report === "top-customers";
  const ranked = rankParties(
    books.vouchers,
    customers ? "customer" : "supplier",
    request.from,
    request.to,
    (v) => voucherParty(books, v)?.name ?? "",
    request.partyId,
  );
  const total = ranked.reduce((s, r) => s + r.value, 0);
  return appendTotals({
    title: REPORTS[request.report].title,
    columns: [
      numberColumn("Rank"),
      textColumn(customers ? "Customer" : "Supplier"),
      numberColumn("Bills"),
      moneyColumn(customers ? "Net sales" : "Net purchases"),
      numberColumn("Share %"),
    ],
    rows: ranked.map((r, i) =>
      reportRow(i + 1, r.name, r.bills, r.value, percent(r.value, total)),
    ),
  });
}

// ---------------------------------------------------------------------------
// Sales and purchases by party and by item (T50)
// ---------------------------------------------------------------------------

export function tradeByPartySection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const sales = request.report === "sales-by-party";
  const types: VoucherType[] = sales
    ? ["sale", "credit-note"]
    : ["purchase", "debit-note"];
  const byParty = new Map<
    string,
    {
      name: string;
      gstin: string;
      bills: number;
      taxable: number;
      tax: number;
      total: number;
    }
  >();
  for (const v of posted(books, types, request)) {
    const key = v.partyId ?? "";
    const party = voucherParty(books, v);
    const t = totalsOf(v);
    const sign = signOf(v);
    const row = byParty.get(key) ?? {
      name: party?.name ?? "",
      gstin: party?.gstin ?? "",
      bills: 0,
      taxable: 0,
      tax: 0,
      total: 0,
    };
    if (sign > 0) row.bills += 1;
    row.taxable += sign * t.taxable;
    row.tax += sign * t.tax;
    row.total += sign * v.amount;
    byParty.set(key, row);
  }
  return appendTotals({
    title: REPORTS[request.report].title,
    columns: [
      textColumn(sales ? "Customer" : "Supplier"),
      textColumn("GSTIN"),
      numberColumn("Bills"),
      moneyColumn("Taxable value"),
      moneyColumn("GST"),
      moneyColumn("Bill total"),
    ],
    rows: [...byParty.values()]
      .sort((a, b) => b.total - a.total)
      .map((r) =>
        reportRow(r.name, r.gstin, r.bills, r.taxable, r.tax, r.total),
      ),
  });
}

export function tradeByItemSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const sales = request.report === "sales-by-item";
  const types: VoucherType[] = sales
    ? ["sale", "credit-note"]
    : ["purchase", "debit-note"];
  const byItem = new Map<
    string,
    {
      name: string;
      hsn: string;
      unit: string;
      qty: number;
      taxable: number;
      tax: number;
    }
  >();
  for (const v of posted(books, types, request)) {
    const t = totalsOf(v);
    const sign = signOf(v);
    (v.lines ?? []).forEach((line, i) => {
      // Variants (doc 37, T35) can share their parent's row.
      const parent = request.groupByParent
        ? books.items.find(
            (x) =>
              x.id === books.items.find((c) => c.id === line.itemId)?.parentId,
          )
        : undefined;
      const key = parent?.id ?? line.itemId;
      const item =
        parent ??
        v.snapshot?.items.find((x) => x.id === line.itemId) ??
        books.items.find((x) => x.id === line.itemId);
      const row = byItem.get(key) ?? {
        name: item?.name ?? "",
        hsn: item?.hsn ?? "",
        unit: item?.unit ?? "",
        qty: 0,
        taxable: 0,
        tax: 0,
      };
      row.qty = Math.round((row.qty + sign * baseQty(line)) * 1000) / 1000;
      row.taxable += sign * (t.lines[i]?.taxable ?? 0);
      row.tax += sign * (t.lines[i]?.tax ?? 0);
      byItem.set(key, row);
    });
  }
  return appendTotals({
    title: REPORTS[request.report].title,
    columns: [
      textColumn("Item"),
      textColumn("HSN/SAC"),
      textColumn("Unit"),
      numberColumn("Quantity"),
      moneyColumn("Taxable value"),
      moneyColumn("GST"),
      moneyColumn("Value with GST"),
    ],
    rows: [...byItem.values()]
      .sort((a, b) => b.taxable - a.taxable)
      .map((r) =>
        reportRow(
          r.name,
          r.hsn,
          r.unit,
          r.qty,
          r.taxable,
          r.tax,
          r.taxable + r.tax,
        ),
      ),
  });
}

/** Expenses grouped by the supplier on them (paid expenses can carry one since H08). */
export function expensesByPartySection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const byParty = new Map<
    string,
    { name: string; count: number; amount: number }
  >();
  for (const v of posted(books, ["expense"], request)) {
    const key = v.partyId ?? "";
    const row = byParty.get(key) ?? {
      name: voucherParty(books, v)?.name ?? "No supplier",
      count: 0,
      amount: 0,
    };
    row.count += 1;
    row.amount += v.amount;
    byParty.set(key, row);
  }
  return appendTotals({
    title: REPORTS["expenses-by-party"].title,
    columns: [
      textColumn("Supplier"),
      numberColumn("Entries"),
      moneyColumn("Amount"),
    ],
    rows: [...byParty.values()]
      .sort((a, b) => b.amount - a.amount)
      .map((r) => reportRow(r.name, r.count, r.amount)),
  });
}

// ---------------------------------------------------------------------------
// Orders: estimates, sales orders, delivery notes, purchase orders (T50)
// ---------------------------------------------------------------------------

const ORDER_REPORT_TYPE: Record<string, VoucherType> = {
  "estimates-register": "estimate",
  "proformas-register": "proforma",
  "sales-orders-register": "sales-order",
  "delivery-notes-register": "delivery-note",
  "purchase-orders-register": "purchase-order",
};
const ORDER_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  partial: "Partly converted",
  converted: "Converted",
  expired: "Expired",
  cancelled: "Cancelled",
};

/** Orders aren't accounting entries, so they have their own registers with their status. */
export function orderRegisterSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const type = ORDER_REPORT_TYPE[request.report];
  const rows = books.vouchers
    .filter(
      (v) =>
        v.type === type &&
        v.status !== "draft" &&
        v.date >= request.from &&
        v.date <= request.to &&
        (!request.partyId || v.partyId === request.partyId),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.number.localeCompare(b.number),
    )
    .map((v) =>
      reportRow(
        formatDate(v.date),
        v.number,
        voucherParty(books, v)?.name ?? "",
        ORDER_STATUS_LABEL[orderStatus(v, request.to)] ?? "",
        v.validUntil ? formatDate(v.validUntil) : "",
        v.status === "cancelled" ? 0 : v.amount,
      ),
    );
  return appendTotals({
    title: REPORTS[request.report].title,
    columns: [
      textColumn("Date"),
      textColumn("Number"),
      textColumn("Party"),
      textColumn("Status"),
      textColumn("Valid until"),
      moneyColumn("Amount"),
    ],
    rows,
  });
}

// ---------------------------------------------------------------------------
// GST workings (T25 and the tax summary)
// ---------------------------------------------------------------------------

/** GSTR-2 style view of purchases: what registered suppliers billed, returns, and the rest. */
export function gstr2Sections(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection[] {
  const bySupplier = new Map<
    string,
    {
      gstin: string;
      name: string;
      bills: number;
      taxable: number;
      igst: number;
      cgst: number;
      sgst: number;
    }
  >();
  const notes: ReportRow[] = [];
  const unregistered: ReportRow[] = [];
  for (const v of posted(
    books,
    ["purchase", "debit-note", "expense"],
    request,
  )) {
    const party = voucherParty(books, v);
    const t = totalsOf(v);
    if (v.type !== "debit-note" && t.tax === 0) {
      if (v.type === "purchase")
        unregistered.push(
          reportRow(
            formatDate(v.date),
            v.number,
            party?.name ?? "",
            party?.gstin ? "No GST on bill" : "Unregistered",
            t.taxable,
          ),
        );
      continue;
    }
    if (v.type === "debit-note") {
      notes.push(
        reportRow(
          formatDate(v.date),
          v.number,
          party?.gstin ?? "",
          party?.name ?? "",
          -t.taxable,
          -t.igst,
          -t.cgst,
          -t.sgst,
        ),
      );
      continue;
    }
    const gstin = party?.gstin ?? "";
    const row = bySupplier.get(gstin || v.partyId || "") ?? {
      gstin,
      name: party?.name ?? "",
      bills: 0,
      taxable: 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
    };
    row.bills += 1;
    row.taxable += t.taxable;
    row.igst += t.igst;
    row.cgst += t.cgst;
    row.sgst += t.sgst;
    bySupplier.set(gstin || v.partyId || "", row);
  }
  const money = ["Taxable value", "IGST", "CGST", "SGST"].map(moneyColumn);
  return [
    appendTotals({
      title: "Purchases from registered suppliers (B2B, with expense GST)",
      columns: [
        textColumn("GSTIN"),
        textColumn("Supplier"),
        numberColumn("Bills"),
        ...money,
      ],
      rows: [...bySupplier.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((r) =>
          reportRow(
            r.gstin,
            r.name,
            r.bills,
            r.taxable,
            r.igst,
            r.cgst,
            r.sgst,
          ),
        ),
    }),
    appendTotals({
      title: "Debit notes (purchase returns)",
      columns: [
        textColumn("Date"),
        textColumn("Note"),
        textColumn("GSTIN"),
        textColumn("Supplier"),
        ...money,
      ],
      rows: notes,
    }),
    appendTotals({
      title: "Purchases without GST",
      columns: [
        textColumn("Date"),
        textColumn("Bill"),
        textColumn("Supplier"),
        textColumn("Why"),
        moneyColumn("Value"),
      ],
      rows: unregistered,
    }),
  ];
}

/** Output and input GST by rate for the period, with returns netted off. */
export function taxSummarySection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const byRate = new Map<
    number,
    { outTaxable: number; outTax: number; inTaxable: number; inTax: number }
  >();
  const add = (v: Voucher, side: "out" | "in") => {
    const sign = signOf(v);
    for (const r of totalsOf(v).byRate) {
      const row = byRate.get(r.rate) ?? {
        outTaxable: 0,
        outTax: 0,
        inTaxable: 0,
        inTax: 0,
      };
      const tax = r.cgst + r.sgst + r.igst;
      if (side === "out") {
        row.outTaxable += sign * r.taxable;
        row.outTax += sign * tax;
      } else {
        row.inTaxable += sign * r.taxable;
        row.inTax += sign * tax;
      }
      byRate.set(r.rate, row);
    }
  };
  for (const v of posted(books, ["sale", "credit-note"], request))
    add(v, "out");
  for (const v of posted(books, ["purchase", "debit-note", "expense"], request))
    add(v, "in");
  return appendTotals({
    title: REPORTS["tax-summary"].title,
    columns: [
      textColumn("GST rate"),
      moneyColumn("Sales taxable"),
      moneyColumn("Output GST"),
      moneyColumn("Purchases taxable"),
      moneyColumn("Input GST"),
      moneyColumn("Output less input"),
    ],
    rows: [...byRate.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rate, r]) =>
        reportRow(
          `${rate}%`,
          r.outTaxable,
          r.outTax,
          r.inTaxable,
          r.inTax,
          r.outTax - r.inTax,
        ),
      ),
  });
}

// ---------------------------------------------------------------------------
// T-format final accounts (T51)
// ---------------------------------------------------------------------------

/** Lay two lists side by side: [left label, left amount, right label, right amount]. */
function sideBySide(
  left: [string, number][],
  right: [string, number][],
): ReportRow[] {
  const rows: ReportRow[] = [];
  for (let i = 0; i < Math.max(left.length, right.length); i++)
    rows.push(
      reportRow(
        left[i]?.[0] ?? "",
        left[i]?.[1] ?? "",
        right[i]?.[0] ?? "",
        right[i]?.[1] ?? "",
      ),
    );
  return rows;
}

/** Trading and profit & loss account in the two-sided (Dr / Cr) layout. */
export function tFormatProfitLossSections(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection[] {
  const pl = periodProfitAndLoss(books, request.from, request.to);
  const lines = (rows: { name: string; amount: number }[]) =>
    rows.map((r) => [r.name, r.amount] as [string, number]);
  const gross = pl.grossProfit;
  const tradingDr: [string, number][] = [
    ["Opening stock", pl.openingStock],
    ["Purchases (after returns)", pl.purchases],
    ...lines(pl.directExpenses),
    ...(gross >= 0
      ? ([["Gross profit c/d", gross]] as [string, number][])
      : []),
  ];
  const tradingCr: [string, number][] = [
    ["Sales (after returns)", pl.sales],
    ["Closing stock", pl.closingStock],
    ...(gross < 0 ? ([["Gross loss c/d", -gross]] as [string, number][]) : []),
  ];
  const net = pl.netProfit;
  const plDr: [string, number][] = [
    ...(gross < 0 ? ([["Gross loss b/d", -gross]] as [string, number][]) : []),
    ...lines(pl.indirectExpenses),
    ...(net >= 0 ? ([["Net profit", net]] as [string, number][]) : []),
  ];
  const plCr: [string, number][] = [
    ...(gross >= 0
      ? ([["Gross profit b/d", gross]] as [string, number][])
      : []),
    ...lines(pl.indirectIncomes),
    ...(net < 0 ? ([["Net loss", -net]] as [string, number][]) : []),
  ];
  const total = (side: [string, number][]) =>
    side.reduce((s, [, a]) => s + a, 0);
  const columns = [
    textColumn("Dr  Particulars"),
    moneyColumn("Amount"),
    textColumn("Cr  Particulars"),
    moneyColumn("Amount"),
  ];
  return [
    {
      title: "Trading account",
      columns,
      rows: [
        ...sideBySide(tradingDr, tradingCr),
        {
          ...reportRow("Total", total(tradingDr), "Total", total(tradingCr)),
          total: true,
        },
      ],
    },
    {
      title: "Profit and loss account",
      columns,
      rows: [
        ...sideBySide(plDr, plCr),
        {
          ...reportRow("Total", total(plDr), "Total", total(plCr)),
          total: true,
        },
      ],
    },
  ];
}

/** Balance sheet with capital and liabilities on the left, assets on the right. */
export function tFormatBalanceSheetSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const [liabilities, assets] = balanceSheetSections(books, request).sections;
  const side = (s: ReportSection) =>
    s.rows
      .filter((r) => !r.total)
      .map(
        (r) =>
          [`${r.cells[1] || r.cells[0]}`, Number(r.cells[2])] as [
            string,
            number,
          ],
      );
  const totalOf = (s: ReportSection) =>
    Number(s.rows.find((r) => r.total)?.cells[2] ?? 0);
  return {
    title: REPORTS["balance-sheet-t"].title,
    columns: [
      textColumn("Capital and liabilities"),
      moneyColumn("Amount"),
      textColumn("Assets"),
      moneyColumn("Amount"),
    ],
    rows: [
      ...sideBySide(side(liabilities), side(assets)),
      {
        ...reportRow("Total", totalOf(liabilities), "Total", totalOf(assets)),
        total: true,
      },
    ],
  };
}
