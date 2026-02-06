import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  ImportApplyInput,
  ImportApplyResponse,
  ImportKindQuery,
  ImportPreview,
  ImportPreviewInput,
  ImportRequestHeaders,
  ImportTemplate,
  MAX_IMPORT_BYTES,
  isFinancialImport,
} from "@repo/contracts/src/imports";
import type { Db } from "@repo/backend/db/client";
import type { CsvParser } from "./imports.csv";
import { requireImportRole } from "./imports.repo";
import { createImportService } from "./imports.service";

export async function importRoutes(
  app: FastifyInstance,
  options: { db: Db; parseCsv: CsvParser; previewSecret: string },
) {
  const service = createImportService(options);
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const access = [
    ...app.inFirm(),
    async (req: Parameters<typeof app.authenticate>[0]) =>
      requireImportRole(req.firm.role),
  ];
  app.addHook("preSerialization", async (_req, reply, payload) => {
    reply
      .header("cache-control", "private, no-store")
      .header("pragma", "no-cache");
    return payload;
  });
  app.addHook("onSend", async (_req, reply, payload) => {
    reply
      .header("cache-control", "private, no-store")
      .header("pragma", "no-cache");
    reply.removeHeader("etag");
    return payload;
  });
  const limits = {
    preHandler: access,
    bodyLimit: MAX_IMPORT_BYTES * 6 + 4096,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  };
  typed.get(
    "/imports/template",
    {
      ...limits,
      schema: {
        querystring: ImportKindQuery,
        response: { 200: ImportTemplate },
      },
    },
    (req) => {
      requireImportRole(req.firm.role, isFinancialImport(req.query.kind));
      return service.template(req.query.kind);
    },
  );
  typed.post(
    "/imports/preview",
    {
      ...limits,
      schema: { body: ImportPreviewInput, response: { 200: ImportPreview } },
    },
    (req) => {
      requireImportRole(req.firm.role, isFinancialImport(req.body.kind));
      return service.preview(options.db, req.firm.id, req.user.id, req.body);
    },
  );
  typed.post(
    "/imports/apply",
    {
      ...limits,
      schema: {
        body: ImportApplyInput,
        headers: ImportRequestHeaders,
        response: { 200: ImportApplyResponse },
      },
    },
    (req) => {
      requireImportRole(req.firm.role, isFinancialImport(req.body.kind));
      return service.apply(
        options.db,
        req.firm.id,
        req.user.id,
        req.body,
        req.headers["idempotency-key"],
      );
    },
  );
}
