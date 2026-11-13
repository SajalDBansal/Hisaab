import { pageRows } from "@repo/core";
import {
  DocumentListParams,
  DocumentFilters,
  DocumentUpdate,
  DownloadTicket,
  IdParams,
  StoredDocument,
  UploadRequest,
  UploadTicket,
  ListPageQuery,
  listPage,
} from "@repo/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@repo/backend/db/client";
import type { FileStorage } from "../../lib/storage";
import { documentsService } from "./documents.service";
import { documentsRepo } from "./documents.repo";
import { DocumentLimits, type DocumentOptions } from "./documents.quota";
import { idemOf } from "@repo/backend/modules/vouchers/idempotency";

export async function documentRoutes(
  app: FastifyInstance,
  options: { db: Db; storage: FileStorage } & DocumentOptions,
) {
  const { db, storage } = options;
  const limits = DocumentLimits.parse(options.limits ?? {});
  const uploadOptions = (req: FastifyRequest) => ({
    limits,
    request: {
      userId: req.user.id,
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
    },
  });
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const write = app.inFirm([
    "sales",
    "purchase",
    "payments",
    "accounts",
    "settings",
  ]);

  typed.get(
    "/documents",
    {
      preHandler: app.inFirm(),
      schema: {
        querystring: DocumentListParams,
        response: { 200: z.array(StoredDocument) },
      },
    },
    async (req) =>
      documentsService.list(db, req.firm.id, req.firm.role, {
        kinds: req.query.kind ? [req.query.kind] : undefined,
      }),
  );

  typed.post(
    "/documents/search",
    {
      preHandler: app.inFirm(),
      config: { readOnly: true },
      schema: {
        body: DocumentFilters,
        response: { 200: z.array(StoredDocument) },
      },
    },
    async (req) =>
      documentsService.list(db, req.firm.id, req.firm.role, req.body),
  );

  /** The documents screen, a page at a time (filters in the body, page in the query). */
  typed.post(
    "/documents/search/page",
    {
      preHandler: app.inFirm(),
      config: { readOnly: true },
      schema: {
        body: DocumentFilters,
        querystring: ListPageQuery,
        response: { 200: listPage(StoredDocument, z.null()) },
      },
    },
    async (req) => ({
      ...pageRows(
        await documentsService.list(db, req.firm.id, req.firm.role, req.body),
        req.query,
      ),
      summary: null,
    }),
  );

  typed.get(
    "/documents/folders",
    {
      preHandler: app.inFirm(),
      schema: { response: { 200: z.array(z.string()) } },
    },
    async (req) => documentsRepo.folders(db, req.firm.id, req.firm.role),
  );

  typed.post(
    "/documents/:id/confirm",
    {
      preHandler: write,
      schema: { params: IdParams, response: { 200: StoredDocument } },
    },
    async (req) =>
      documentsService.confirm(
        db,
        storage,
        req.firm.id,
        req.params.id,
        req.firm.role,
        { limits },
      ),
  );

  typed.get(
    "/documents/:id/upload-url",
    {
      preHandler: write,
      schema: { params: IdParams, response: { 200: UploadTicket } },
    },
    async (req, reply) => {
      reply.header("cache-control", "private, no-store");
      return documentsService.renew(
        db,
        storage,
        req.firm.id,
        req.params.id,
        req.firm.role,
        { limits },
      );
    },
  );

  typed.patch(
    "/documents/:id",
    {
      preHandler: write,
      schema: {
        params: IdParams,
        body: DocumentUpdate,
        response: { 200: StoredDocument },
      },
    },
    async (req) =>
      documentsService.update(
        db,
        req.firm.id,
        req.params.id,
        req.firm.role,
        req.body,
      ),
  );

  typed.post(
    "/documents/upload-url",
    {
      preHandler: write,
      schema: { body: UploadRequest, response: { 201: UploadTicket } },
    },
    async (req, reply) =>
      reply
        .code(201)
        .header("cache-control", "private, no-store")
        .send(
          await documentsService.uploadTicket(
            db,
            storage,
            req.firm.id,
            req.body,
            req.firm.role,
            uploadOptions(req),
          ),
        ),
  );

  typed.post(
    "/documents",
    {
      preHandler: write,
      schema: { body: UploadRequest, response: { 201: UploadTicket } },
    },
    async (req, reply) =>
      reply
        .code(201)
        .header("cache-control", "private, no-store")
        .send(
          await documentsService.uploadTicket(
            db,
            storage,
            req.firm.id,
            req.body,
            req.firm.role,
            uploadOptions(req),
          ),
        ),
  );

  typed.get(
    "/documents/:id/download-url",
    {
      preHandler: app.inFirm(),
      schema: { params: IdParams, response: { 200: DownloadTicket } },
    },
    async (req, reply) => {
      reply.header("cache-control", "private, no-store");
      return documentsService.downloadTicket(
        db,
        storage,
        req.firm.id,
        req.params.id,
        req.firm.role,
      );
    },
  );

  typed.get(
    "/documents/:id/thumbnail-url",
    {
      preHandler: app.inFirm(),
      schema: { params: IdParams, response: { 200: DownloadTicket } },
    },
    async (req, reply) => {
      reply.header("cache-control", "private, no-store");
      return documentsService.downloadTicket(
        db,
        storage,
        req.firm.id,
        req.params.id,
        req.firm.role,
        true,
      );
    },
  );

  typed.delete(
    "/documents/:id",
    {
      preHandler: write,
      schema: {
        params: IdParams,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      await documentsService.remove(
        db,
        storage,
        req.firm.id,
        req.params.id,
        req.firm.role,
      );
      return { ok: true as const };
    },
  );
}
