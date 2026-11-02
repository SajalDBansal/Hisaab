import { can, today } from "@repo/core";
import type { Services } from "./services";
import type { OfflineBooks } from "./offlineBooks";
import { finalAccountsPeriod, REPORT_PERIODS } from "./reportPeriods";

// Cache real API answers through the same transport used by forms. No optimistic
// balances, synthetic voucher IDs or locally posted financial entries are produced.
export async function downloadOfflineBooks(
  books: OfflineBooks,
  services: Services,
) {
  await books.sync();
  await books.capture(async () => {
    await services.firmService.getCurrent();
    await services.settingsService.invoice();
    await services.unitService.list();
    const parties = await services.partyService.list();
    await services.partyService.list("customer");
    if (can(books.scope.role, "reports"))
      await services.partyService.list("supplier");
    for (const row of parties) await services.partyService.get(row.party.id);
    const items = await services.itemService.list();
    if (can(books.scope.role, "purchase") || can(books.scope.role, "reports"))
      for (const row of items) await services.itemService.get(row.item.id);
    await services.itemService.lots(today());
    await services.ledgerService.listCashAndBank();
    if (can(books.scope.role, "accounts") || can(books.scope.role, "reports")) {
      await services.accountService.list();
      await services.accountService.pickable();
      await services.inventoryService?.list();
    }
    const vouchers = await services.voucherService.list();
    await services.voucherService.list({ limit: 5 });
    for (const entry of vouchers) await services.voucherService.get(entry.id);
    for (const type of ["sale", "purchase"] as const) {
      if (!can(books.scope.role, type === "sale" ? "sales" : "purchase"))
        continue;
      await services.voucherService.listInvoices(type);
      for (const entry of vouchers.filter((voucher) => voucher.type === type))
        await services.voucherService.returnable(entry.id);
    }
    for (const type of [
      "estimate",
      "sales-order",
      "purchase-order",
      "delivery-note",
    ] as const) {
      if (
        can(books.scope.role, "reports") ||
        (type !== "purchase-order" && can(books.scope.role, "sales"))
      )
        await services.voucherService.listOrders(type);
    }
    if (can(books.scope.role, "reports"))
      for (const tax of ["all", "gst", "nongst"] as const) {
        await services.reportService.dashboard(tax);
        await services.reportService.stock(tax);
        await services.reportService.outstanding("customer", tax);
        await services.reportService.outstanding("supplier", tax);
        await services.accountService.chart(tax);
        await services.accountService.trialBalance(tax);
        await services.accountService.finalAccounts(tax);
        for (const { key: period } of REPORT_PERIODS) {
          const range = finalAccountsPeriod(period);
          await services.accountService.finalAccounts(
            tax,
            range.from,
            range.asOf,
          );
          await services.reportService.tradeSummary("sale", period, tax);
          await services.reportService.tradeSummary("purchase", period, tax);
          await services.reportService.expenses(period, tax);
        }
      }
  });
}
