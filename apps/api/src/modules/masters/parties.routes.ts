import {
  IdParams,
  PartyInput,
  PartyListParams,
  PartyRow,
  PartyListRow,
  PartyDetail,
  NonNegativePaise,
  pageOf as pageSchema,
} from "@repo/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@repo/backend/db/client";
import { partiesService } from "./parties.service";
import { expectedVersion } from "@repo/backend/modules/masters/shared";
import { listParties, readParty } from "./views.service";
import { allocatePayments } from "./allocations.service";

/** Sales readers see customers; book readers also see suppliers. Write rights are separate. */
export async function partyRoutes(app: FastifyInstance, options: { db: Db }) {
  const { db } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const write = app.inFirm(["sales", "purchase"]);

  typed.post(
    "/parties/:id/allocate-payments",
    {
      preHandler: write,
      schema: {
        params: IdParams,
        response: { 200: z.object({ allocated: NonNegativePaise }) },
      },
    },
    async (req) =>
      allocatePayments(db, req.firm.id, req.params.id, req.user, req.firm.role),
  );

  typed.get(
    "/parties",
    {
      preHandler: app.inFirm(),
      schema: {
        querystring: PartyListParams,
        response: { 200: pageSchema(PartyListRow) },
      },
    },
    async (req) => listParties(db, req.firm.id, req.query, req.firm.role),
  );

  typed.get(
    "/parties/:id",
    {
      preHandler: app.inFirm(),
      schema: { params: IdParams, response: { 200: PartyDetail } },
    },
    async (req) => readParty(db, req.firm.id, req.params.id, req.firm.role),
  );

  typed.post(
    "/parties",
    {
      preHandler: write,
      schema: { body: PartyInput, response: { 201: PartyRow } },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(
          await partiesService.create(db, req.firm.id, req.body, req.firm.role),
        ),
  );

  typed.put(
    "/parties/:id",
    {
      preHandler: write,
      schema: {
        params: IdParams,
        body: PartyInput,
        response: { 200: PartyRow },
      },
    },
    async (req) =>
      partiesService.update(
        db,
        req.firm.id,
        req.params.id,
        expectedVersion(req.headers["if-match"]),
        req.body,
        req.firm.role,
      ),
  );

  typed.delete(
    "/parties/:id",
    {
      preHandler: write,
      schema: {
        params: IdParams,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      await partiesService.remove(
        db,
        req.firm.id,
        req.params.id,
        expectedVersion(req.headers["if-match"]),
        req.firm.role,
      );
      return { ok: true as const };
    },
  );
}
