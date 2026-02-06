import type {
  InventoryAdjustment,
  ISODate,
  Item,
  NewJournalInput,
  Voucher,
} from "../types";
import type { Books } from "./generalLedger";
import { acc, describeAccount, groupInfo } from "./accounts";
import { stockLots } from "./stockLots";

export interface StockAdjustmentInput {
  kind: "count" | "damage" | "landed-cost";
  itemId: string;
  lotId: string;
  date: ISODate;
  expectedQty: number;
  expectedValue: number;
  quantity?: number;
  amount?: number;
  offsetAccount?: string;
  reason: string;
}

const quantity = (value: number) => Math.round(value * 1000) / 1000;
const movesStock = (voucher: Voucher) =>
  !!voucher.inventoryAdjustment ||
  ["sale", "purchase", "credit-note", "debit-note", "delivery-note"].includes(
    voucher.type,
  );

/** A later stock count/cost must not silently rewrite already frozen sale costs. */
function assertLatest(books: Books, item: Item, date: string) {
  if (
    books.vouchers.some(
      (v) =>
        v.status === "posted" &&
        movesStock(v) &&
        v.date > date &&
        (v.inventoryAdjustment?.itemId === item.id ||
          v.lines?.some((line) => line.itemId === item.id)),
    )
  )
    throw new Error(
      "Use a date on or after the latest stock movement for this item.",
    );
}

function costSource(books: Books, key: string) {
  const info = describeAccount(key, books);
  const validLedger = books.ledgers.some(
    (ledger) => acc.ledger(ledger.id) === key,
  );
  const validExpense =
    key.startsWith("expense:") ||
    books.accounts?.some(
      (account) =>
        acc.account(account.id) === key &&
        groupInfo(account.group).nature === "expense",
    );
  if (!validLedger && !validExpense)
    throw new Error(
      "Choose cash, bank or an expense account for the landed cost.",
    );
  return info;
}

/** Periodic stock accounting reclassifies purchase cost; closing stock is valued separately. */
export function prepareStockAdjustment(
  books: Books,
  input: StockAdjustmentInput,
): {
  journal: NewJournalInput;
  movement: InventoryAdjustment;
} {
  const item = books.items.find((row) => row.id === input.itemId);
  if (!item) throw new Error("Item not found.");
  assertLatest(books, item, input.date);
  const lot = stockLots(item, books.vouchers, input.date).find(
    (row) => row.id === input.lotId,
  );
  if (!lot) throw new Error("Stock lot not found.");
  if (
    quantity(input.expectedQty) !== lot.qty ||
    input.expectedValue !== lot.value
  )
    throw new Error(
      "Stock changed. Refresh the lot before saving this adjustment.",
    );
  if (lot.qty < 0 || lot.value < 0)
    throw new Error("Resolve negative stock before adjusting this lot.");
  const difference =
    input.kind === "landed-cost"
      ? 0
      : input.kind === "count"
        ? quantity((input.quantity ?? 0) - lot.qty)
        : -quantity(input.quantity ?? 0);
  if (lot.qty + difference < 0)
    throw new Error("The adjustment exceeds the available stock.");
  if (input.kind === "landed-cost" && lot.qty <= 0)
    throw new Error("Only stock still on hand can receive landed cost.");
  const value =
    input.kind === "landed-cost"
      ? (input.amount ?? 0)
      : difference === -lot.qty
        ? -lot.value
        : Math.round(difference * lot.unitCost);
  if (!Number.isSafeInteger(value) || (!value && !difference))
    throw new Error("The adjustment must change the stock quantity or value.");
  if (!Number.isSafeInteger(lot.value + value) || lot.value + value < 0)
    throw new Error("The resulting stock value exceeds the supported amount.");
  const offset =
    input.kind === "landed-cost"
      ? costSource(books, input.offsetAccount ?? "")
      : {
          key:
            difference < 0
              ? acc.expense("Stock Loss")
              : acc.income("Stock Surplus"),
          name: difference < 0 ? "Stock Loss" : "Stock Surplus",
        };
  const movement: InventoryAdjustment = {
    kind: input.kind,
    itemId: item.id,
    lotId: lot.id,
    quantity: difference,
    value,
    reason: input.reason,
  };
  return {
    movement,
    journal: {
      date: input.date,
      bookScope: lot.bookScope,
      narration: `${input.kind}: ${item.name}. ${input.reason}`,
      lines:
        value === 0
          ? []
          : [
              {
                account: acc.purchase,
                name: "Purchase cost adjustment",
                debit: Math.max(value, 0),
                credit: Math.max(-value, 0),
              },
              {
                account: offset.key,
                name: offset.name,
                debit: Math.max(-value, 0),
                credit: Math.max(value, 0),
              },
            ],
    },
  };
}

/** Reverse the original frozen value, rejecting consumed value or duplicate reversals. */
export function prepareStockReversal(
  books: Books,
  original: Voucher,
  date: ISODate,
  reason: string,
) {
  const movement = original.inventoryAdjustment;
  if (!movement || movement.kind === "reversal" || original.status !== "posted")
    throw new Error("Choose a posted inventory adjustment.");
  if (
    books.vouchers.some(
      (v) =>
        v.status === "posted" &&
        v.inventoryAdjustment?.reversesId === original.id,
    )
  )
    throw new Error("This adjustment is already reversed.");
  if (date < original.date)
    throw new Error("A reversal cannot precede its adjustment.");
  const item = books.items.find((row) => row.id === movement.itemId);
  if (!item) throw new Error("Item not found.");
  assertLatest(books, item, date);
  const originalIndex = books.vouchers.findIndex((v) => v.id === original.id);
  const later = books.vouchers.some(
    (v, index) =>
      v.status === "posted" &&
      movesStock(v) &&
      v.id !== original.id &&
      (v.date > original.date ||
        (v.date === original.date &&
          (v.createdAt > original.createdAt ||
            (v.createdAt === original.createdAt && index > originalIndex)))) &&
      (v.inventoryAdjustment?.lotId === movement.lotId ||
        v.lines?.some(
          (line) =>
            line.itemId === item.id &&
            (!line.stockLotId || line.stockLotId === movement.lotId),
        )),
  );
  if (later)
    throw new Error("Reverse later movements using this stock lot first.");
  return {
    movement: {
      ...movement,
      kind: "reversal" as const,
      quantity: -movement.quantity,
      value: -movement.value,
      reason,
      reversesId: original.id,
    },
    journal: {
      date,
      bookScope: original.bookScope,
      narration: `Reverse ${original.number}: ${reason}`,
      lines: (original.journalLines ?? []).map((line) => ({
        ...line,
        debit: line.credit,
        credit: line.debit,
      })),
    },
  };
}
