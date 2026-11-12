import {
  isLowStock,
  itemProfit,
  stockMovements,
  stockQty,
  type StockMovement,
} from "../accounting/stock";
import { createItem, updateItem } from "../mock/db";
import type { Item, ItemInput, Paise } from "../types";
import { clone, delay, getDb } from "./client";
import { inventoryValue, stockLots } from "../accounting/stockLots";
import {
  openingStockLeft,
  tradeRates,
  type TradeRate,
} from "../accounting/tradeRates";

/** Who supplies and who buys one product. Suppliers are null for roles that can't see costs. */
export interface ItemParties {
  suppliers: TradeRate[] | null;
  customers: TradeRate[] | null;
  /** Opening stock still on hand: it has no supplier. */
  openingStock: { qty: number; value: number } | null;
}

export interface ItemListRow {
  item: Item;
  qty: number;
  value: Paise;
  lowStock: boolean;
}

export interface ItemDetail extends ItemListRow {
  /** Newest first. */
  movements: StockMovement[];
  profit: { soldQty: number; salesValue: Paise; cost: Paise; profit: Paise };
}

export const itemService = {
  async lots(date?: string) {
    await delay();
    const db = getDb();
    return clone(db.items.flatMap((i) => stockLots(i, db.vouchers, date)));
  },
  /** Real API: http.get<ItemListRow[]>("/items") */
  async list(): Promise<ItemListRow[]> {
    await delay();
    const { items, vouchers } = getDb();
    return clone(
      items.map((item) => {
        const qty = stockQty(item, vouchers);
        return {
          item,
          qty,
          value: inventoryValue(item, vouchers),
          lowStock: isLowStock(item, qty),
        };
      }),
    );
  },

  /** Real API: http.get<ItemDetail>(`/items/${id}`) */
  async get(id: string): Promise<ItemDetail> {
    await delay();
    const { items, vouchers } = getDb();
    const item = items.find((i) => i.id === id);
    if (!item) throw new Error("Item not found");
    const qty = stockQty(item, vouchers);
    return clone({
      item,
      qty,
      value: inventoryValue(item, vouchers),
      lowStock: isLowStock(item, qty),
      movements: stockMovements(id, vouchers).reverse(),
      profit: itemProfit(item, vouchers),
    });
  },

  /** Real API: http.get<ItemParties>(`/items/${id}/parties`) */
  async parties(id: string): Promise<ItemParties> {
    await delay();
    const db = getDb();
    return clone({
      suppliers: tradeRates(db, { type: "supplier", itemId: id }),
      customers: tradeRates(db, { type: "customer", itemId: id }),
      openingStock: openingStockLeft(db, id),
    });
  },

  /** Real API: http.post<Item>("/items", input) */
  async create(input: ItemInput): Promise<Item> {
    await delay();
    return clone(createItem(getDb(), input));
  },

  /** Real API: http.put<Item>(`/items/${id}`, input) */
  async update(id: string, input: ItemInput): Promise<Item> {
    await delay();
    return clone(updateItem(getDb(), id, input));
  },
};
