import * as c from "@repo/contracts";
import type { InventoryAdjustmentInput } from "@repo/contracts/src/inventory";
import { z } from "zod";
import { type Client, queryString } from "./client";
import { matchVersion } from "./masterServices";
import type { Services } from "./services";
import { pendingWriteHeaders } from "./pendingWrites";
import type { FinancialAttachmentPath } from "./attachmentDraftModel";

export function voucherServices({ request, pages }: Client) {
  const create = (path: string, input: object) =>
    request(path, c.Voucher, {
      body: input,
      headers: pendingWriteHeaders(input, path),
    });
  return {
    list: (filters = {}) =>
      pages(
        "/vouchers",
        c.Voucher,
        {
          type: filters.type,
          types: filters.types?.join(","),
          partyId: filters.partyId,
        },
        filters.limit,
      ),
    get: (id) => request(`/vouchers/${id}`, c.VoucherDetail),
    listInvoices: (type) =>
      request(
        `/vouchers/invoices${queryString({ type })}`,
        z.array(c.InvoiceRow),
      ),
    listOrders: (type) =>
      request(`/vouchers/orders${queryString({ type })}`, z.array(c.OrderRow)),
    nextNumber: (type, series, date) =>
      request(
        `/vouchers/next-number${queryString({ type, series, date })}`,
        c.NextNumber,
      ),
    returnable: (id) => request(`/vouchers/${id}/returnable`, c.ReturnableBill),
    createSale: (input) => create("/sales", input),
    createSales: (input) =>
      request("/sales/split", z.array(c.Voucher), {
        body: input,
        headers: pendingWriteHeaders(input, "/sales/split"),
      }),
    createPurchase: (input) => create("/purchases", input),
    createReceipt: (input) => create("/receipts", input),
    createPayment: (input) => create("/payments", input),
    createExpense: (input) => create("/expenses", input),
    createJournal: (input) => create("/journals", input),
    createContra: (input) => create("/contras", input),
    createCreditNote: (input) => create("/credit-notes", input),
    createDebitNote: (input) => create("/debit-notes", input),
    createOrder: (type, input) => create(`/orders/${type}`, input),
    updateInvoice: (id, input, version?: number) =>
      request(`/vouchers/${id}`, c.Voucher, {
        method: "PUT",
        body: input,
        headers: matchVersion(version),
      }),
    cancel: (id, reason, version?: number) =>
      request(`/vouchers/${id}/cancel`, c.Voucher, {
        body: { reason },
        headers: matchVersion(version),
      }),
  } satisfies Services["voucherService"];
}

/** Replays only a durable, already-selected operation; callers supply its original body/key. */
export function sendAttachmentDraft(
  services: Services | Services["voucherService"],
  path: FinancialAttachmentPath,
  body: object,
) {
  const service =
    "voucherService" in services ? services.voucherService : services;
  if (
    path === "/accounts/masters" ||
    path === "/ledgers" ||
    path === "/inventory/adjustments"
  ) {
    if (!("voucherService" in services))
      throw new Error("The original account or inventory service is required.");
    if (path === "/accounts/masters")
      return services.accountService.create(body as c.AccountInput);
    if (path === "/ledgers")
      return services.ledgerService.create(body as c.LedgerInput);
    if (!services.inventoryService)
      throw new Error("Inventory is unavailable in this session.");
    return services.inventoryService.create(body as InventoryAdjustmentInput);
  }
  switch (path) {
    case "/sales":
      return service.createSale(body as c.NewInvoiceInput);
    case "/sales/split":
      return service.createSales(body as c.NewInvoiceInput);
    case "/purchases":
      return service.createPurchase(body as c.NewInvoiceInput);
    case "/receipts":
      return service.createReceipt(body as c.NewMoneyInput);
    case "/payments":
      return service.createPayment(body as c.NewMoneyInput);
    case "/expenses":
      return service.createExpense(body as c.NewExpenseInput);
    case "/journals":
      return service.createJournal(body as c.NewJournalInput);
    case "/contras":
      return service.createContra(body as c.NewContraInput);
    case "/credit-notes":
      return service.createCreditNote(body as c.NewNoteInput);
    case "/debit-notes":
      return service.createDebitNote(body as c.NewNoteInput);
    case "/orders/estimate":
      return service.createOrder("estimate", body as c.NewOrderInput);
    case "/orders/sales-order":
      return service.createOrder("sales-order", body as c.NewOrderInput);
    case "/orders/purchase-order":
      return service.createOrder("purchase-order", body as c.NewOrderInput);
    case "/orders/delivery-note":
      return service.createOrder("delivery-note", body as c.NewOrderInput);
  }
}
