import type {
  InvoicePageQuery,
  ItemPageQuery,
  OrderPageQuery,
  OrderType,
  PartyPageQuery,
  AuditPageQuery,
  DocumentFilters,
  PartyType,
  TaxScope,
  VoucherPageQuery,
} from "@repo/core";
import { useServicePages } from "./scopedHooks";

// The list screens, read a page at a time as the user scrolls. Filters are
// part of the key: changing one starts again from the first page.

export const usePartyPages = (query: PartyPageQuery & { type?: PartyType }) =>
  useServicePages({
    queryKey: ["partyPages", query],
    queryFn: (services, cursor) =>
      services.partyService.page({ ...query, cursor }),
  });

export const useItemPages = (query: ItemPageQuery) =>
  useServicePages({
    queryKey: ["itemPages", query],
    queryFn: (services, cursor) =>
      services.itemService.page({ ...query, cursor }),
  });

export const useInvoicePages = (
  type: "sale" | "purchase",
  query: InvoicePageQuery,
) =>
  useServicePages({
    queryKey: ["invoicePages", type, query],
    queryFn: (services, cursor) =>
      services.voucherService.invoicePage(type, { ...query, cursor }),
  });

export const useOrderPages = (type: OrderType, query: OrderPageQuery) =>
  useServicePages({
    queryKey: ["orderPages", type, query],
    queryFn: (services, cursor) =>
      services.voucherService.orderPage(type, { ...query, cursor }),
  });

export const useVoucherPages = (query: VoucherPageQuery, enabled = true) =>
  useServicePages({
    queryKey: ["voucherPages", query],
    queryFn: (services, cursor) =>
      services.voucherService.page({ ...query, cursor }),
    enabled,
  });

/** A cash or bank book, a page of rows at a time; the totals come with each page. */
export const useLedgerStatementPages = (id: string, tax: TaxScope) =>
  useServicePages({
    queryKey: ["ledgerStatementPages", id, tax],
    queryFn: (services, cursor) =>
      services.ledgerService.statementPage(id, tax, { cursor }),
    enabled: !!id,
  });

/** Any account's statement, a page of rows at a time. */
export const useAccountStatementPages = (key: string, tax: TaxScope) =>
  useServicePages({
    queryKey: ["accountStatementPages", key, tax],
    queryFn: (services, cursor) =>
      services.accountService.statementPage(key, tax, { cursor }),
    enabled: !!key,
  });

/** The edit log, newest first, with a count per filter. */
export const useAuditPages = (query: AuditPageQuery) =>
  useServicePages({
    queryKey: ["auditPages", query],
    queryFn: (services, cursor) =>
      services.auditService.page({ ...query, cursor }),
  });

/** Documents matching the filters, newest first, a page at a time. */
export const useDocumentPages = (filters: DocumentFilters) =>
  useServicePages({
    queryKey: ["documentPages", filters],
    queryFn: (services, cursor) =>
      services.documentService.page(filters, { cursor }),
  });

/** An item's stock movements, newest first, a page at a time. */
export const useItemMovementPages = (id: string) =>
  useServicePages({
    queryKey: ["itemMovementPages", id],
    queryFn: (services, cursor) =>
      services.itemService.movementPage(id, { cursor }),
    enabled: !!id,
  });
