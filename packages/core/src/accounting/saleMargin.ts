/**
 * Profit margin on a sale being made (doc 37, T12). Each line's cost is the
 * stock it would take: the chosen batch, or oldest first (FIFO) from the
 * line's book, exactly as saving the sale would pick it. Margin is the line's
 * taxable value (after discount, before GST) less that cost. Charges such as
 * freight are not part of any item's margin.
 *
 * Only roles with the "see profit margin" right get this (never sales staff,
 * doc 33 R1); the caller checks the right.
 */
import type { InvoiceLine, Paise } from "../types";
import { calcLine } from "./invoice";
import { baseQty } from "./stockInputs";
import { allocateStock, type StockLot } from "./stockLots";

export interface MarginFigures {
  /** Taxable value of the line (or of the priced lines, for the total). */
  taxable: Paise;
  /** What the stock cost; null when it can't be worked out. */
  cost: Paise | null;
  /** Taxable value less cost; null when the cost is unknown. */
  margin: Paise | null;
  /** Margin as a percentage of the taxable value, two decimals. */
  marginPercent: number | null;
}

export interface SaleMarginLine extends MarginFigures {
  /** Why the cost is unknown, e.g. not enough stock on this date. */
  problem?: string;
}

export interface SaleMargin {
  /** One row per line entered, in the same order. */
  lines: SaleMarginLine[];
  /** Over the lines whose cost is known. */
  total: MarginFigures;
  /** Lines left out of the total because their cost is unknown. */
  missing: number;
}

const quantity = (n: number) => Math.round(n * 1000) / 1000;

/** Margin as a percentage of the taxable value (two decimals); none on a zero value. */
export function marginShare(margin: Paise, taxable: Paise): number | null {
  if (taxable <= 0) return null;
  return Math.round((margin * 10_000) / taxable) / 100;
}

const figures = (taxable: Paise, cost: Paise | null): MarginFigures => ({
  taxable,
  cost,
  margin: cost === null ? null : taxable - cost,
  marginPercent: cost === null ? null : marginShare(taxable - cost, taxable),
});

const message = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/**
 * Margin of each sale line against the stock `available` on the bill date.
 * Lines take stock one after another, as when the sale is saved, so two lines
 * of one item don't both use the oldest batch. A line that can't be priced
 * (no stock, wrong unit) is shown without a cost and left out of the total;
 * `prepare` applies the item master (pack size) and may throw.
 */
export function saleMargin(
  available: StockLot[],
  lines: InvoiceLine[],
  prepare: (line: InvoiceLine) => InvoiceLine = (line) => line,
): SaleMargin {
  const pool = available.map((lot) => ({ ...lot }));
  const rows = lines.map((entered): SaleMarginLine => {
    let line = entered;
    try {
      line = prepare(entered);
    } catch (err) {
      return {
        ...figures(
          calcLine({ ...entered, exactMath: true }, false).taxable,
          null,
        ),
        problem: message(err),
      };
    }
    // New and edited bills use exact maths (see billParts).
    const taxable = calcLine({ ...line, exactMath: true }, false).taxable;
    try {
      const parts = allocateStock(pool, [line]);
      let cost = 0;
      for (const part of parts) {
        // Take the same stock out of the pool, so later lines see what is left.
        const lot = pool.find((row) => row.id === part.stockLotId);
        if (lot) {
          lot.qty = quantity(lot.qty - baseQty(part));
          lot.value -= part.stockCost ?? 0;
        }
        cost += part.stockCost ?? 0;
      }
      return figures(taxable, cost);
    } catch (err) {
      return { ...figures(taxable, null), problem: message(err) };
    }
  });
  const priced = rows.filter((row) => row.cost !== null);
  const sum = (pick: (row: SaleMarginLine) => number) =>
    priced.reduce((total, row) => total + pick(row), 0);
  return {
    lines: rows,
    total: figures(
      sum((row) => row.taxable),
      priced.length ? sum((row) => row.cost ?? 0) : null,
    ),
    missing: rows.length - priced.length,
  };
}

/** Without the cost, for roles that see margins but not purchase rates. */
export function withoutCosts(result: SaleMargin): SaleMargin {
  return {
    ...result,
    lines: result.lines.map((line) => ({ ...line, cost: null })),
    total: { ...result.total, cost: null },
  };
}
