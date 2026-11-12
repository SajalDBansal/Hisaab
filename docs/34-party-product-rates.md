# 34. Products and Rates per Party

Added 12 Nov 2026. This page answers three questions:

- What does each supplier sell us, at what rate, and how much of it is still in
  stock?
- What does each customer buy, and at what rate did we last sell it to them?
- Who supplies a given product, and who buys it?

## What the owner sees

| Where | What |
| --- | --- |
| Supplier page → **Products they supply, rates and stock** | Each product bought from them: latest rate, a ▲/▼ change against the bill before, GST %, quantity bought (less returns), stock still on hand from their purchases and the last bill date. A summary gives the product count, the total bought and the value of their stock on hand. |
| Customer page → **Products they buy and our rates** | Each product sold to them: latest rate we sold at, change, GST %, quantity sold (less returns) and the last bill date. |
| A row in either list | Rate history: latest, lowest, highest and quantity-weighted average rate. Below that, every bill and return, newest first; each opens its entry. |
| Product page → **Suppliers and customers** | Two tabs. **Suppliers** lists each supplier's latest rate and the stock left from them; opening stock, which has no supplier, is noted separately. **Customers** lists each buyer's latest rate. |

All lists can be filtered and sorted:

- **Search:** product, code or group on party pages; party name on the product page.
- **Sort:** Recent, Name, Rate (low to high or high to low), Quantity.
- **Last bought or sold:** any time, or the last 30 days, 90 days or year.
- **Group:** chips, on party pages.
- **In stock:** suppliers only.

## Definitions

- **Rate:** per base unit, after the line discount and before GST. When a bill
  uses the second unit (for example 2 Pallet × ₹3,200), the rate is converted to
  the base unit (₹320 per Bag). When a discount applies, the row also shows
  "billed at ₹…", the rate as typed.
- **Latest:** the newest posted bill by date, then by creation time. Sales split
  across stock lots are merged back into one bill. Returns don't set the rate,
  but they reduce the quantity.
- **Stock from a supplier:** what is left of that supplier's purchase lots after
  sales, which take stock oldest first (FIFO), and after returns. This is the
  same lot replay the books use, so the stock figures always add up to the
  product's total stock.

## Who can see what

A supplier's rates are purchase costs, so they follow the cost rule from doc 33
(R1): roles with `purchase` or `reports` permission see them. Sales staff get
`403` on a supplier's product list and its history. On the product page they get
`suppliers: null`, and the app hides the button and the tab. Customer rates
follow the normal party read rule, so sales staff can see them.

## Server and app

| Piece | Where |
| --- | --- |
| Calculation (shared with demo mode) | `packages/core/src/accounting/tradeRates.ts`: `tradeRates`, `tradeRateHistory`, `stockBySupplier`, `openingStockLeft` |
| Contract | `packages/contracts/src/tradeRates.ts` |
| Routes | `apps/api/src/modules/masters/tradeRates.routes.ts`: `GET /v1/parties/:id/items`, `GET /v1/parties/:id/items/:itemId`, `GET /v1/items/:id/parties`. Each reads one consistent snapshot. |
| App | `app/party/products/[id].tsx`, `app/party/rates/[id].tsx`, the section on `app/item/[id].tsx`, `src/lists/TradeRateList.tsx` and `src/data/tradeFilters.ts` |
| Offline | The routes sit under `/v1/parties` and `/v1/items`, so they are readable offline. **Download books** now includes each party's product list (suppliers only for roles that may see costs) and each product's suppliers and customers. Rate histories are cached once opened. |
| Live updates | Saving a bill refreshes these screens on other devices, like every other book read (doc 33 §3). |

## Tests

- `packages/core/tests/trade-rates.test.ts` covers:
  - two suppliers of one product, with a discount and FIFO stock left from each;
  - second-unit bills and purchase returns;
  - customers;
  - opening stock.
- `apps/api/tests/trade-rates.test.ts` covers the route shapes, sales staff being
  refused supplier rates, `suppliers: null` on the product page, and offline
  batch reads.
- `apps/native/checks/trade-filters.test.js` covers search, period, group,
  in-stock, the sorts and the rate-change marker.
- In a browser, on desktop and phone sizes with the demo books: 19/19 checks.
  They cover the buttons, lists, filters, history, both product-page tabs, no
  sideways scrolling and no page errors.
