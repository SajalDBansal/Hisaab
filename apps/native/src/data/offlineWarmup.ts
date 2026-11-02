import { can, today } from "@repo/core";
import type { Services } from "./services";
import type { OfflineBooks } from "./offlineBooks";
import { finalAccountsPeriod, REPORT_PERIODS } from "./reportPeriods";

// Cache real API answers through the same transport used by screens. No balances,
// IDs or entries are made up on the device. Reads issued together are sent to the
// server in batches, so a download takes a handful of requests, not one per record.
export async function downloadOfflineBooks(
  books: OfflineBooks,
  services: Services,
) {
  const role = books.scope.role;
  await books.sync();
  await books.capture(async () => {
    // 1. Settings and every list; these give the ids for step 2.
    const [parties, items, vouchers] = await Promise.all([
      services.partyService.list(),
      services.itemService.list(),
      services.voucherService.list(),
      services.firmService.getCurrent(),
      services.settingsService.invoice(),
      services.unitService.list(),
      services.partyService.list("customer"),
      can(role, "reports") ? services.partyService.list("supplier") : null,
      services.itemService.lots(today()),
      services.ledgerService.listCashAndBank(),
      ...(can(role, "accounts") || can(role, "reports")
        ? [
            services.accountService.list(),
            services.accountService.pickable(),
            services.inventoryService?.list(),
          ]
        : []),
      services.voucherService.list({ limit: 5 }),
      ...(["sale", "purchase"] as const)
        .filter((type) => can(role, type === "sale" ? "sales" : "purchase"))
        .map((type) => services.voucherService.listInvoices(type)),
      ...(
        ["estimate", "sales-order", "purchase-order", "delivery-note"] as const
      )
        .filter(
          (type) =>
            can(role, "reports") ||
            (type !== "purchase-order" && can(role, "sales")),
        )
        .map((type) => services.voucherService.listOrders(type)),
    ]);

    // 2. Each record's detail and every report, all at once.
    const reads: Promise<unknown>[] = [
      ...parties.map((row) => services.partyService.get(row.party.id)),
      ...(can(role, "purchase") || can(role, "reports")
        ? items.map((row) => services.itemService.get(row.item.id))
        : []),
      ...vouchers.map((entry) => services.voucherService.get(entry.id)),
      ...vouchers
        .filter(
          (entry) =>
            (entry.type === "sale" && can(role, "sales")) ||
            (entry.type === "purchase" && can(role, "purchase")),
        )
        .map((entry) => services.voucherService.returnable(entry.id)),
    ];
    if (can(role, "reports"))
      for (const tax of ["all", "gst", "nongst"] as const) {
        reads.push(
          services.reportService.dashboard(tax),
          services.reportService.stock(tax),
          services.reportService.outstanding("customer", tax),
          services.reportService.outstanding("supplier", tax),
          services.accountService.chart(tax),
          services.accountService.trialBalance(tax),
          services.accountService.finalAccounts(tax),
        );
        for (const { key: period } of REPORT_PERIODS) {
          const range = finalAccountsPeriod(period);
          reads.push(
            services.accountService.finalAccounts(tax, range.from, range.asOf),
            services.reportService.tradeSummary("sale", period, tax),
            services.reportService.tradeSummary("purchase", period, tax),
            services.reportService.expenses(period, tax),
          );
        }
      }
    await Promise.all(reads);
  });
}
