import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NO_TRADE_FILTERS,
  filterTradeRates,
  rateChange,
  tradeGroups,
} from "../src/data/tradeFilters.ts";

const row = (over) => ({
  partyId: "p",
  partyName: "Sharma",
  itemId: "i",
  itemName: "Cement",
  itemCode: "C1",
  group: "Building",
  unit: "Bag",
  rate: 35000,
  typedRate: 35000,
  previousRate: null,
  gstRate: 28,
  lastDate: "2026-11-01",
  lastVoucherId: "v",
  lastNumber: "PI/1",
  firstDate: "2026-10-01",
  bills: 1,
  qty: 10,
  value: 350000,
  stockQty: 4,
  stockValue: 140000,
  ...over,
});
const rows = [
  row({}),
  row({
    itemId: "s",
    itemName: "Sand",
    itemCode: "S1",
    group: "Aggregates",
    rate: 100000,
    qty: 3,
    stockQty: 0,
    lastDate: "2026-06-01",
  }),
  row({
    itemId: "b",
    itemName: "Bricks",
    itemCode: "B9",
    group: "Building",
    rate: 800,
    qty: 5000,
    stockQty: 1200,
    lastDate: "2026-10-20",
  }),
];
const names = (list) => list.map((r) => r.itemName);
const on = (filters) =>
  names(
    filterTradeRates(
      rows,
      { ...NO_TRADE_FILTERS, ...filters },
      "party",
      "2026-11-12",
    ),
  );

test("newest first by default; search matches name, code and group", () => {
  assert.deepEqual(on({}), ["Cement", "Bricks", "Sand"]);
  assert.deepEqual(on({ search: "b9" }), ["Bricks"]);
  assert.deepEqual(on({ search: "aggreg" }), ["Sand"]);
});

test("period, group and in-stock filters combine", () => {
  assert.deepEqual(on({ period: "30" }), ["Cement", "Bricks"]);
  assert.deepEqual(on({ group: "Building", period: "90" }), [
    "Cement",
    "Bricks",
  ]);
  assert.deepEqual(on({ inStock: true }), ["Cement", "Bricks"]);
  assert.deepEqual(
    on({ period: "365", inStock: true, group: "Aggregates" }),
    [],
  );
});

test("sorts by name, rate either way and quantity", () => {
  assert.deepEqual(on({ sort: "name" }), ["Bricks", "Cement", "Sand"]);
  assert.deepEqual(on({ sort: "rate-low" }), ["Bricks", "Cement", "Sand"]);
  assert.deepEqual(on({ sort: "rate-high" }), ["Sand", "Cement", "Bricks"]);
  assert.deepEqual(on({ sort: "qty" }), ["Bricks", "Cement", "Sand"]);
});

test("item view searches party names; groups and rate changes", () => {
  const parties = [
    row({ partyName: "Sharma" }),
    row({ partyId: "g", partyName: "Gupta" }),
  ];
  assert.deepEqual(
    filterTradeRates(
      parties,
      { ...NO_TRADE_FILTERS, search: "gup" },
      "item",
      "2026-11-12",
    ).map((r) => r.partyName),
    ["Gupta"],
  );
  assert.deepEqual(tradeGroups(rows), ["Aggregates", "Building"]);
  assert.deepEqual(rateChange({ rate: 35250, previousRate: 34000 }), {
    up: true,
    text: "▲ 3.7%",
  });
  assert.deepEqual(rateChange({ rate: 33000, previousRate: 34000 }), {
    up: false,
    text: "▼ 2.9%",
  });
  assert.equal(rateChange({ rate: 34000, previousRate: 34000 }), null);
  assert.equal(rateChange({ rate: 34000, previousRate: null }), null);
});
