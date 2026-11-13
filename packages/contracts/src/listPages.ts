import { z } from "zod";
import { Id, ListPageQuery, Paise, listPage } from "./common";
import { AuditEntry } from "./audit";
import { ItemRow } from "./items";
import { PartyListRow } from "./masterViews";
import { PartyType } from "./parties";
import { TaxScope } from "./reports";
import {
  InvoiceRow,
  InvoiceStatus,
  OrderRow,
  OrderStatus,
  OrderType,
  Voucher,
} from "./vouchers";

// The list screens, a page at a time. Each answer has one page, the number of
// matching rows and totals over all of them, so the app never needs every row.

const search = z.string().trim().max(100).optional();

/** GET /parties/page */
export const PartyPageParams = ListPageQuery.extend({
  type: PartyType.optional(),
  search,
  overdue: z.stringbool().optional(),
  withBalance: z.stringbool().optional(),
  sort: z.enum(["balance", "name"]).optional(),
});
export const PartyPage = listPage(
  PartyListRow,
  z.object({ receivable: Paise, payable: Paise }),
);

/** GET /items/page */
export const ItemPageParams = ListPageQuery.extend({
  search,
  group: z.string().max(100).optional(),
  low: z.stringbool().optional(),
  scope: TaxScope.optional(),
});
export const ItemPage = listPage(
  ItemRow,
  z.object({
    count: z.number().int(),
    /** Stock value at cost; 0 for roles that can't see costs. */
    value: z.number().int(),
    lowCount: z.number().int(),
    groups: z.array(z.string()),
  }),
);

/** GET /vouchers/invoices/page */
export const InvoicePageParams = ListPageQuery.extend({
  type: z.enum(["sale", "purchase"]),
  month: z
    .string()
    .regex(/^(all|\d{4}-\d{2})$/)
    .optional(),
  status: InvoiceStatus.optional(),
  search,
  scope: TaxScope.optional(),
});
export const InvoicePage = listPage(
  InvoiceRow,
  z.object({
    amount: z.number().int(),
    settled: z.number().int(),
    due: z.number().int(),
    counts: z.partialRecord(InvoiceStatus, z.number().int()),
    inPeriod: z.number().int(),
  }),
);

/** GET /vouchers/orders/page */
export const OrderPageParams = ListPageQuery.extend({
  type: OrderType,
  status: OrderStatus.optional(),
  search,
});
export const OrderPage = listPage(
  OrderRow,
  z.object({
    openValue: z.number().int(),
    counts: z.partialRecord(OrderStatus, z.number().int()),
    all: z.number().int(),
  }),
);

/** GET /vouchers/page: day book, journals, banking and a party's entries. */
export const VoucherPageParams = ListPageQuery.extend({
  types: z.string().max(300).optional(),
  scope: TaxScope.optional(),
  partyId: Id.optional(),
  direction: z.enum(["in", "out"]).optional(),
  search,
});
export const VoucherPage = listPage(
  Voucher,
  z.object({ amount: z.number().int() }),
);

/** GET /audit-log/page */
export const AuditPageParams = ListPageQuery.extend({
  filter: z.enum(["all", "edited", "cancelled"]).optional(),
});
export const AuditPage = listPage(
  AuditEntry,
  z.object({
    all: z.number().int(),
    changes: z.number().int(),
    cancelled: z.number().int(),
  }),
);

export type PartyPageParams = z.infer<typeof PartyPageParams>;
export type PartyPage = z.infer<typeof PartyPage>;
export type ItemPageParams = z.infer<typeof ItemPageParams>;
export type ItemPage = z.infer<typeof ItemPage>;
export type InvoicePageParams = z.infer<typeof InvoicePageParams>;
export type InvoicePage = z.infer<typeof InvoicePage>;
export type OrderPageParams = z.infer<typeof OrderPageParams>;
export type OrderPage = z.infer<typeof OrderPage>;
export type VoucherPageParams = z.infer<typeof VoucherPageParams>;
export type VoucherPage = z.infer<typeof VoucherPage>;
