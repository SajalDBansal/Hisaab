/** Stock levels (doc 37, T37) and expiring items (T38), from the same lots as the stock summary. */
import { formatDate } from "../dates";
import { stockVouchersAsOf, tracksStock } from "../accounting/stock";
import { expiringLots, stockLotsFor } from "../accounting/stockLots";
import {
  appendTotals,
  moneyColumn,
  numberColumn,
  reportRow,
  textColumn,
} from "./helpers";
import type { ReportBooks, ReportRequest, ReportSection } from "./types";

/** Expiring items report: lots expiring within this many days unless the request says. */
export const DEFAULT_EXPIRY_DAYS = 30;

const qty3 = (n: number) => Math.round(n * 1000) / 1000;

/** Goods with a minimum or maximum level: low first, then over, then within range. */
export function stockLevelsSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const goods = books.items.filter(
    (i) => tracksStock(i) && (i.reorderLevel > 0 || (i.maxStock ?? 0) > 0),
  );
  const lots = stockLotsFor(
    goods,
    stockVouchersAsOf(books.vouchers, request.to),
  );
  const rank = { Low: 0, Over: 1, "In range": 2 } as const;
  const rows = goods
    .map((item, index) => {
      const qty = qty3(lots[index].reduce((sum, lot) => sum + lot.qty, 0));
      const max = item.maxStock ?? 0;
      const status: keyof typeof rank =
        qty < item.reorderLevel
          ? "Low"
          : max && qty > max
            ? "Over"
            : "In range";
      // Order up to the maximum when there is one, else back to the minimum.
      const toOrder =
        status === "Low" ? qty3((max || item.reorderLevel) - qty) : 0;
      const excess = status === "Over" ? qty3(qty - max) : 0;
      return { item, qty, max, status, toOrder, excess };
    })
    .filter((r) => request.includeZeroBalances || r.status !== "In range")
    .sort(
      (a, b) =>
        rank[a.status] - rank[b.status] ||
        a.item.name.localeCompare(b.item.name),
    );
  return {
    title: "Stock levels",
    columns: [
      textColumn("Item"),
      textColumn("Group"),
      numberColumn("In stock"),
      textColumn("Unit"),
      numberColumn("Minimum"),
      numberColumn("Maximum"),
      textColumn("Status"),
      numberColumn("To order"),
      numberColumn("Excess"),
    ],
    rows: rows.map((r) =>
      reportRow(
        r.item.name,
        r.item.group,
        r.qty,
        r.item.unit,
        r.item.reorderLevel,
        r.max || "",
        r.status,
        r.toOrder || "",
        r.excess || "",
      ),
    ),
  };
}

/** Stock still in hand that has expired or expires within the window, soonest first. */
export function expiringItemsSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const days = request.expiryDays ?? DEFAULT_EXPIRY_DAYS;
  const rows = expiringLots(books.items, books.vouchers, request.to, days);
  return appendTotals({
    title: `Expired and expiring within ${days} days`,
    columns: [
      textColumn("Expiry"),
      textColumn("Status"),
      textColumn("Item"),
      textColumn("Batch"),
      textColumn("Bought on"),
      numberColumn("Quantity"),
      textColumn("Unit"),
      moneyColumn("Value"),
    ],
    rows: rows.map((r) =>
      reportRow(
        formatDate(r.expiryDate),
        r.daysLeft < 0
          ? `Expired ${-r.daysLeft} days ago`
          : r.daysLeft === 0
            ? "Expires today"
            : `In ${r.daysLeft} days`,
        r.itemName,
        r.batchNumber ?? "",
        r.source,
        r.qty,
        r.unit,
        r.value,
      ),
    ),
  });
}
