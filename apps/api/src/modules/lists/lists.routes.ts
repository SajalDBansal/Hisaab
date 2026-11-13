import {
  InvoicePage,
  InvoicePageParams,
  ItemPage,
  ItemPageParams,
  OrderPage,
  OrderPageParams,
  PartyPage,
  PartyPageParams,
  VoucherPage,
  VoucherPageParams,
} from "@repo/contracts";
import {
  canSeeCosts,
  collectionBills,
  gstModeOf,
  invoicePage,
  itemPage,
  orderPage,
  overdueSummary,
  partyPage,
  stockLotsFor,
  today,
  voucherPage,
  vouchersByParty,
} from "@repo/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Db } from "@repo/backend/db/client";
import { loadReportBooks } from "@repo/backend/modules/reports/books";
import { createListCache } from "../../lib/list-cache";
import {
  canReadBooks,
  canReadParty,
  forbiddenRead,
  readableVoucherTypes,
  requireVoucherTypeRead,
} from "../../lib/read-permissions";
import { itemsRepo } from "../masters/items.repo";
import { toItemRow } from "../masters/items.service";
import { partiesRepo } from "../masters/parties.repo";
import { toPartyRow } from "../masters/parties.service";
import { readBooks, vouchersService } from "../vouchers/vouchers.service";

const ALL = 1_000_000;

/** Lists show no printed details; the frozen print copy stays on the detail. */
const listed = <V extends { snapshot?: unknown }>(voucher: V) => {
  const { snapshot: _print, ...rest } = voucher;
  return rest;
};
const listedRow = <R extends { voucher: { snapshot?: unknown } }>(row: R) => ({
  ...row,
  voucher: listed(row.voucher),
});

/**
 * The list screens, a page at a time, with totals over every matching row.
 * The rows behind each list are cached per firm data version, so scrolling
 * to the next page never rebuilds the books.
 */
export async function listRoutes(app: FastifyInstance, options: { db: Db }) {
  const { db } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const cache = createListCache();
  // Rows depend on the firm, its data version and the list; filters don't.
  const rowsOf = <T>(
    req: FastifyRequest,
    list: string,
    compute: () => Promise<T>,
  ) => cache(`${req.firm.id}:${req.firmDataVersion ?? "?"}:${list}`, compute);

  typed.get(
    "/parties/page",
    {
      preHandler: app.inFirm(),
      schema: { querystring: PartyPageParams, response: { 200: PartyPage } },
    },
    async (req) => {
      const role = req.firm.role;
      if (req.query.type && !canReadParty(role, req.query.type))
        throw forbiddenRead();
      // Sales staff read customers only.
      const type = canReadBooks(role) ? req.query.type : "customer";
      const rows = await rowsOf(req, `parties:${type ?? "all"}`, async () => {
        const [records, { vouchers }] = await Promise.all([
          partiesRepo.list(db, req.firm.id, {
            type,
            sort: "name",
            limit: ALL,
            offset: 0,
          }),
          loadReportBooks(db, req.firm.id),
        ]);
        const parties = records.map(toPartyRow);
        const byParty = vouchersByParty(parties, vouchers);
        return parties.map((party) => ({
          ...party,
          ...overdueSummary(
            collectionBills(party, byParty.get(party.id) ?? [], today()),
          ),
        }));
      });
      return partyPage(rows, req.query, (r) => r);
    },
  );

  typed.get(
    "/items/page",
    {
      preHandler: app.inFirm(),
      schema: { querystring: ItemPageParams, response: { 200: ItemPage } },
    },
    async (req) => {
      const { books, records } = await rowsOf(req, "items", async () => {
        const [books, records] = await Promise.all([
          loadReportBooks(db, req.firm.id),
          itemsRepo.list(db, req.firm.id, { limit: ALL, offset: 0 }),
        ]);
        return {
          books: {
            items: books.items,
            lots: stockLotsFor(books.items, books.vouchers),
          },
          records: new Map(records.map((r) => [r.id, toItemRow(r)])),
        };
      });
      const page = itemPage(books.items, books.lots, req.query);
      // Stock is valued at purchase cost, which sales staff don't see.
      const costs = canSeeCosts(req.firm.role);
      return {
        ...page,
        items: page.items.flatMap((row) => {
          const record = records.get(row.item.id);
          return record
            ? [
                {
                  ...record,
                  stock: row.qty,
                  value: costs ? row.value : 0,
                  lowStock: row.lowStock,
                },
              ]
            : [];
        }),
        summary: { ...page.summary, value: costs ? page.summary.value : 0 },
      };
    },
  );

  typed.get(
    "/vouchers/invoices/page",
    {
      preHandler: app.inFirm(),
      schema: {
        querystring: InvoicePageParams,
        response: { 200: InvoicePage },
      },
    },
    async (req) => {
      requireVoucherTypeRead(req.firm.role, req.query.type);
      const rows = await rowsOf(req, `invoices:${req.query.type}`, () =>
        vouchersService.invoices(db, req.firm.id, req.query.type),
      );
      const page = invoicePage(rows, req.query);
      return { ...page, items: page.items.map(listedRow) };
    },
  );

  typed.get(
    "/vouchers/orders/page",
    {
      preHandler: app.inFirm(),
      schema: { querystring: OrderPageParams, response: { 200: OrderPage } },
    },
    async (req) => {
      requireVoucherTypeRead(req.firm.role, req.query.type);
      const rows = await rowsOf(req, `orders:${req.query.type}`, () =>
        vouchersService.orders(db, req.firm.id, req.query.type),
      );
      const page = orderPage(rows, req.query);
      return { ...page, items: page.items.map(listedRow) };
    },
  );

  typed.get(
    "/vouchers/page",
    {
      preHandler: app.inFirm(),
      schema: {
        querystring: VoucherPageParams,
        response: { 200: VoucherPage },
      },
    },
    async (req) => {
      const { books, apiVoucher } = await rowsOf(req, "vouchers", () =>
        readBooks(db, req.firm.id),
      );
      const page = voucherPage(books.vouchers, req.query, {
        readable: readableVoucherTypes(req.firm.role),
        defaultScope: gstModeOf(books.firm) === "off" ? "nongst" : "gst",
        parties: books.parties,
      });
      return {
        ...page,
        items: page.items.map((v) => listed(apiVoucher(v))),
      };
    },
  );
}
