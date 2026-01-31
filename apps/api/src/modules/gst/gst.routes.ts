import {
  CompositionQuarter,
  CountQuery,
  GstMonth,
  Gstr1,
  Gstr3b,
  MonthQuery,
} from "@repo/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@repo/backend/db/client";
import { gstService } from "./gst.service";

export async function gstRoutes(app: FastifyInstance, options: { db: Db }) {
  const { db } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const read = app.inFirm(["gst", "reports"]);

  typed.get(
    "/gst/months",
    {
      preHandler: read,
      schema: {
        querystring: CountQuery,
        response: { 200: z.array(GstMonth) },
      },
    },
    async (req) => gstService.months(db, req.firm.id, req.query.count),
  );

  typed.get(
    "/gst/gstr1",
    {
      preHandler: read,
      schema: {
        querystring: MonthQuery,
        response: { 200: Gstr1 },
      },
    },
    async (req) => gstService.gstr1(db, req.firm.id, req.query.month),
  );

  typed.get(
    "/gst/gstr3b",
    {
      preHandler: read,
      schema: {
        querystring: MonthQuery,
        response: { 200: Gstr3b },
      },
    },
    async (req) => gstService.gstr3b(db, req.firm.id, req.query.month),
  );

  typed.get(
    "/gst/composition",
    {
      preHandler: read,
      schema: {
        querystring: CountQuery,
        response: { 200: z.array(CompositionQuarter) },
      },
    },
    async (req) => gstService.composition(db, req.firm.id, req.query.count),
  );
}
