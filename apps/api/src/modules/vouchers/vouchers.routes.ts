import {
  BankDateInput,
  CancelInput,
  IdParams,
  InvoiceListQuery,
  InvoiceRow,
  NewContraInput,
  NewExpenseInput,
  NewInvoiceInput,
  NewJournalInput,
  NewMoneyInput,
  NewNoteInput,
  NewOrderInput,
  NextNumber,
  NextNumberQuery,
  OrderListQuery,
  OrderRow,
  OrderParams,
  PrintableVoucher,
  PrintableVoucherQuery,
  ReturnableBill,
  Voucher,
  VoucherDetail,
  VoucherListParams,
  VoucherType as VoucherTypeSchema,
  pageOf as pageSchema,
} from "@repo/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import {
  PdfResponse,
  requestVoucherPdf,
} from "@repo/backend/modules/server-pdf/server-pdf.service";
import type { PdfStorage } from "@repo/backend/modules/server-pdf/storage";
import {
  readableVoucherTypes,
  requireVoucherRead,
  requireVoucherTypeRead,
} from "../../lib/read-permissions";
import { dateIdCursor, expectedVersion, pageByDateId } from "@repo/backend/modules/masters/shared";
import { idemOf } from "@repo/backend/modules/vouchers/idempotency";
import { requireRight, vouchersService, type Ctx } from "./vouchers.service";

const ctxOf = (req: FastifyRequest): Ctx => ({
  id: req.user.id,
  name: req.user.name,
  firmId: req.firm.id,
  role: req.firm.role,
});

/**
 * Creates may carry `Idempotency-Key`: sending the same create again (a retry after a lost
 * reply) gives back the first answer and saves nothing twice.
 */
const createCtx = (req: FastifyRequest): Ctx => ({
  ...ctxOf(req),
  idem: idemOf(
    typeof req.headers["idempotency-key"] === "string"
      ? req.headers["idempotency-key"]
      : undefined,
    {
      firmId: req.firm.id,
      route: req.routeOptions.url ?? req.url,
      body: req.body,
    },
  ),
});

/**
 * The money path: members read only the entry types their role permits;
 * writing needs the right for that kind of entry (sales, purchase, cash and bank, journals).
 * The server works out every total itself: the app sends items and rates, never an amount.
 */
export async function voucherRoutes(
  app: FastifyInstance,
  options: { db: Db; pdfStorage?: PdfStorage },
) {
  const { db, pdfStorage } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const reply201 = { 201: Voucher };
  const readEntry = async (req: FastifyRequest) =>
    requireVoucherRead(
      db,
      req.firm.id,
      req.firm.role,
      IdParams.parse(req.params).id,
    );
  typed.post(
    "/sales/split",
    {
      preHandler: app.inFirm("sales"),
      schema: { body: NewInvoiceInput, response: { 201: z.array(Voucher) } },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(await vouchersService.sales(db, createCtx(req), req.body)),
  );

  typed.get(
    "/vouchers",
    {
      preHandler: app.inFirm(),
      schema: {
        querystring: VoucherListParams,
        response: { 200: pageSchema(Voucher) },
      },
    },
    async (req) => {
      const requestedTypes = req.query.types
        ? (req.query.types
            .split(",")
            .map((type) => type.trim())
            .filter(
              (type) => VoucherTypeSchema.safeParse(type).success,
            ) as z.infer<typeof VoucherTypeSchema>[])
        : undefined;
      if (req.query.type) requireVoucherTypeRead(req.firm.role, req.query.type);
      const types = readableVoucherTypes(req.firm.role).filter(
        (type) => !requestedTypes?.length || requestedTypes.includes(type),
      );
      if (!types.length) return pageByDateId([], req.query.limit);
      const rows = await vouchersService.list(db, req.firm.id, {
        ...req.query,
        types,
        cursor: dateIdCursor(req.query.cursor),
      });
      return pageByDateId(rows, req.query.limit);
    },
  );

  typed.get(
    "/vouchers/invoices",
    {
      preHandler: app.inFirm(),
      schema: {
        querystring: InvoiceListQuery,
        response: { 200: z.array(InvoiceRow) },
      },
    },
    async (req) => {
      requireVoucherTypeRead(req.firm.role, req.query.type);
      return vouchersService.invoices(db, req.firm.id, req.query.type);
    },
  );

  typed.get(
    "/vouchers/orders",
    {
      preHandler: app.inFirm(),
      schema: {
        querystring: OrderListQuery,
        response: { 200: z.array(OrderRow) },
      },
    },
    async (req) => {
      requireVoucherTypeRead(req.firm.role, req.query.type);
      return vouchersService.orders(db, req.firm.id, req.query.type);
    },
  );

  typed.get(
    "/vouchers/next-number",
    {
      preHandler: app.inFirm(),
      schema: {
        querystring: NextNumberQuery,
        response: { 200: NextNumber },
      },
    },
    async (req) => {
      requireVoucherTypeRead(req.firm.role, req.query.type);
      return vouchersService.nextNumber(
        db,
        req.firm.id,
        req.query.type,
        req.query.date,
        req.query.series,
      );
    },
  );

  typed.get(
    "/vouchers/:id",
    {
      preHandler: [...app.inFirm(), readEntry],
      schema: { params: IdParams, response: { 200: VoucherDetail } },
    },
    async (req) => vouchersService.get(db, req.firm.id, req.params.id),
  );

  typed.get(
    "/vouchers/:id/returnable",
    {
      preHandler: [...app.inFirm(), readEntry],
      schema: { params: IdParams, response: { 200: ReturnableBill } },
    },
    async (req) => vouchersService.returnable(db, req.firm.id, req.params.id),
  );

  typed.get(
    "/vouchers/:id/print",
    {
      preHandler: [...app.inFirm(), readEntry],
      schema: {
        params: IdParams,
        querystring: PrintableVoucherQuery,
        response: { 200: PrintableVoucher },
      },
    },
    async (req) =>
      vouchersService.print(db, req.firm.id, req.params.id, req.query.template),
  );

  typed.route({
    method: ["GET", "POST"],
    url: "/vouchers/:id/pdf",
    preHandler: [...app.inFirm(), readEntry],
    schema: {
      params: IdParams,
      querystring: PrintableVoucherQuery,
      response: { 200: PdfResponse, 202: PdfResponse },
    },
    handler: async (req, reply) => {
      reply.header("Cache-Control", "private, no-store");
      if (!pdfStorage)
        throw new AppError(
          "STORAGE_UNAVAILABLE",
          "PDF storage is not configured.",
          503,
        );
      const result = await requestVoucherPdf(
        { db, jobs: app.jobs, storage: pdfStorage },
        {
          firmId: req.firm.id,
          voucherId: req.params.id,
          template: req.query.template,
        },
        { retryFailed: req.method === "POST" },
      );
      return reply.code(result.status === "ready" ? 200 : 202).send(result);
    },
  });

  // --- create ---------------------------------------------------------------

  typed.post(
    "/sales",
    {
      preHandler: app.inFirm("sales"),
      schema: { body: NewInvoiceInput, response: reply201 },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(await vouchersService.sale(db, createCtx(req), req.body)),
  );

  typed.post(
    "/purchases",
    {
      preHandler: app.inFirm("purchase"),
      schema: { body: NewInvoiceInput, response: reply201 },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(await vouchersService.purchase(db, createCtx(req), req.body)),
  );

  typed.post(
    "/receipts",
    {
      preHandler: app.inFirm("sales"),
      schema: { body: NewMoneyInput, response: reply201 },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(await vouchersService.receipt(db, createCtx(req), req.body)),
  );

  typed.post(
    "/payments",
    {
      preHandler: app.inFirm("purchase"),
      schema: { body: NewMoneyInput, response: reply201 },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(await vouchersService.payment(db, createCtx(req), req.body)),
  );

  typed.post(
    "/expenses",
    {
      preHandler: app.inFirm("purchase"),
      schema: { body: NewExpenseInput, response: reply201 },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(await vouchersService.expense(db, createCtx(req), req.body)),
  );

  typed.post(
    "/journals",
    {
      preHandler: app.inFirm("accounts"),
      schema: { body: NewJournalInput, response: reply201 },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(await vouchersService.journal(db, createCtx(req), req.body)),
  );

  typed.post(
    "/contras",
    {
      preHandler: app.inFirm("payments"),
      schema: { body: NewContraInput, response: reply201 },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(await vouchersService.contra(db, createCtx(req), req.body)),
  );

  typed.post(
    "/orders/:type",
    {
      preHandler: app.inFirm(["sales", "purchase"]),
      schema: { params: OrderParams, body: NewOrderInput, response: reply201 },
    },
    async (req, reply) => {
      requireRight(req.firm.role, req.params.type);
      return reply
        .code(201)
        .send(
          await vouchersService.order(
            db,
            createCtx(req),
            req.params.type,
            req.body,
          ),
        );
    },
  );

  typed.post(
    "/credit-notes",
    {
      preHandler: app.inFirm("sales"),
      schema: { body: NewNoteInput, response: reply201 },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(
          await vouchersService.note(
            db,
            createCtx(req),
            "credit-note",
            req.body,
          ),
        ),
  );

  typed.post(
    "/debit-notes",
    {
      preHandler: app.inFirm("purchase"),
      schema: { body: NewNoteInput, response: reply201 },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(
          await vouchersService.note(
            db,
            createCtx(req),
            "debit-note",
            req.body,
          ),
        ),
  );

  // --- change ---------------------------------------------------------------

  typed.put(
    "/vouchers/:id",
    {
      preHandler: app.inFirm(["sales", "purchase"]),
      schema: {
        params: IdParams,
        body: NewInvoiceInput,
        response: { 200: Voucher },
      },
    },
    async (req) =>
      vouchersService.edit(
        db,
        ctxOf(req),
        req.params.id,
        expectedVersion(req.headers["if-match"]),
        req.body,
      ),
  );

  typed.post(
    "/vouchers/:id/cancel",
    {
      preHandler: app.inFirm(),
      schema: {
        params: IdParams,
        body: CancelInput,
        response: { 200: Voucher },
      },
    },
    async (req) =>
      vouchersService.cancel(
        db,
        ctxOf(req),
        req.params.id,
        expectedVersion(req.headers["if-match"]),
        req.body.reason,
      ),
  );

  typed.route({
    method: ["PUT", "PATCH"],
    url: "/vouchers/:id/bank-date",
    preHandler: app.inFirm("payments"),
    schema: {
      params: IdParams,
      body: BankDateInput,
      response: { 200: Voucher },
    },
    handler: async (req) =>
      vouchersService.bankDate(
        db,
        ctxOf(req),
        req.params.id,
        req.body.clearedOn,
        req.body.ledgerId,
      ),
  });
}
