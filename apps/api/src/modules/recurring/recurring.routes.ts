import {
  ApprovalSettings,
  ApprovalSettingsView,
  EntryActionInput,
  EntryActionResult,
  IdParams,
  PendingEntry,
  PendingEntryList,
  RecurringFromVoucherInput,
  RecurringSchedule,
  RecurringScheduleInput,
  RecurringScheduleUpdate,
  RejectEntryInput,
  SubmitEntryInput,
} from "@repo/contracts";
import { canApprove } from "@repo/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { withFirmWrite } from "@repo/backend/lib/firm-write";
import { expectedVersion } from "@repo/backend/modules/masters/shared";
import { loadApprovalControls } from "@repo/backend/modules/recurring/recurring.repo";
import { requireVoucherRead } from "../../lib/read-permissions";
import type { Ctx } from "../vouchers/vouchers.service";
import { entriesService, recurringService } from "./recurring.service";

const ctxOf = (req: FastifyRequest): Ctx => ({
  id: req.user.id,
  name: req.user.name,
  firmId: req.firm.id,
  role: req.firm.role,
});

/**
 * Recurring entries (doc 37, T03) and approvals (T06). Schedules and pending
 * entries are seen by people who may create that type of entry; entries
 * waiting for approval also by approvers. Nothing here posts by itself: the
 * worker only makes drafts, and posting goes through the normal voucher rules.
 */
export async function recurringRoutes(
  app: FastifyInstance,
  options: { db: Db },
) {
  const { db } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const version = (req: FastifyRequest) =>
    expectedVersion(req.headers["if-match"]);

  // ---- Schedules ----------------------------------------------------------
  typed.get(
    "/recurring",
    {
      preHandler: app.inFirm(),
      schema: { response: { 200: z.array(RecurringSchedule) } },
    },
    async (req) => recurringService.list(db, ctxOf(req)),
  );
  typed.get(
    "/recurring/:id",
    {
      preHandler: app.inFirm(),
      schema: { params: IdParams, response: { 200: RecurringSchedule } },
    },
    async (req) => recurringService.get(db, ctxOf(req), req.params.id),
  );
  typed.post(
    "/recurring",
    {
      preHandler: app.inFirm(),
      schema: {
        body: RecurringScheduleInput,
        response: { 201: RecurringSchedule },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(await recurringService.create(db, ctxOf(req), req.body)),
  );
  typed.post(
    "/recurring/from-voucher/:id",
    {
      preHandler: app.inFirm(),
      schema: {
        params: IdParams,
        body: RecurringFromVoucherInput,
        response: { 201: RecurringSchedule },
      },
    },
    async (req, reply) => {
      await requireVoucherRead(
        db,
        req.firm.id,
        req.firm.role,
        req.params.id,
        req.user.id,
      );
      return reply
        .code(201)
        .send(
          await recurringService.fromVoucher(
            db,
            ctxOf(req),
            req.params.id,
            req.body,
          ),
        );
    },
  );
  typed.put(
    "/recurring/:id",
    {
      preHandler: app.inFirm(),
      schema: {
        params: IdParams,
        body: RecurringScheduleUpdate,
        response: { 200: RecurringSchedule },
      },
    },
    async (req) =>
      recurringService.update(
        db,
        ctxOf(req),
        req.params.id,
        version(req),
        req.body,
      ),
  );
  typed.delete(
    "/recurring/:id",
    {
      preHandler: app.inFirm(),
      schema: {
        params: IdParams,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      await recurringService.remove(
        db,
        ctxOf(req),
        req.params.id,
        version(req),
      );
      return { ok: true as const };
    },
  );

  // ---- Pending entries (drafts and approvals) --------------------------------
  typed.get(
    "/entries",
    {
      preHandler: app.inFirm(),
      schema: { response: { 200: PendingEntryList } },
    },
    async (req) => entriesService.list(db, ctxOf(req)),
  );
  typed.get(
    "/entries/:id",
    {
      preHandler: app.inFirm(),
      schema: { params: IdParams, response: { 200: PendingEntry } },
    },
    async (req) => entriesService.get(db, ctxOf(req), req.params.id),
  );
  typed.post(
    "/entries",
    {
      preHandler: app.inFirm(),
      schema: { body: SubmitEntryInput, response: { 201: PendingEntry } },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(
          await entriesService.submit(
            db,
            ctxOf(req),
            req.body.voucherType,
            req.body.input,
          ),
        ),
  );
  typed.put(
    "/entries/:id",
    {
      preHandler: app.inFirm(),
      schema: {
        params: IdParams,
        body: z.strictObject({ input: EntryActionInput.shape.input.unwrap() }),
        response: { 200: PendingEntry },
      },
    },
    async (req) =>
      entriesService.update(
        db,
        ctxOf(req),
        req.params.id,
        version(req),
        req.body.input,
      ),
  );
  typed.post(
    "/entries/:id/save",
    {
      preHandler: app.inFirm(),
      schema: {
        params: IdParams,
        body: EntryActionInput,
        response: { 200: EntryActionResult },
      },
    },
    async (req) =>
      entriesService.save(
        db,
        ctxOf(req),
        req.params.id,
        version(req),
        req.body.input,
      ),
  );
  typed.post(
    "/entries/:id/approve",
    {
      preHandler: app.inFirm(),
      schema: {
        params: IdParams,
        body: EntryActionInput,
        response: { 200: EntryActionResult },
      },
    },
    async (req) =>
      entriesService.approve(
        db,
        ctxOf(req),
        req.params.id,
        version(req),
        req.body.input,
      ),
  );
  typed.post(
    "/entries/:id/reject",
    {
      preHandler: app.inFirm(),
      schema: {
        params: IdParams,
        body: RejectEntryInput,
        response: { 200: PendingEntry },
      },
    },
    async (req) =>
      entriesService.reject(
        db,
        ctxOf(req),
        req.params.id,
        version(req),
        req.body.reason,
      ),
  );
  typed.post(
    "/entries/:id/discard",
    {
      preHandler: app.inFirm(),
      schema: { params: IdParams, response: { 200: PendingEntry } },
    },
    async (req) =>
      entriesService.discard(db, ctxOf(req), req.params.id, version(req)),
  );

  // ---- Approval settings (owner) ---------------------------------------------
  typed.get(
    "/settings/approvals",
    {
      preHandler: app.inFirm(),
      schema: { response: { 200: ApprovalSettingsView } },
    },
    async (req) => {
      const current = await loadApprovalControls(db, req.firm.id);
      return {
        types: current.types as ApprovalSettingsView["types"],
        version: current.version,
        canApprove: canApprove(req.firm.role),
      };
    },
  );
  typed.put(
    "/settings/approvals",
    {
      preHandler: app.inFirm("team"),
      schema: {
        body: ApprovalSettings,
        response: { 200: ApprovalSettingsView },
      },
    },
    async (req) => {
      const expected = version(req);
      return withFirmWrite(db, req.firm.id, async (tx) => {
        const current = await loadApprovalControls(tx, req.firm.id);
        if (current.version !== expected)
          throw new AppError(
            "EDITED_ELSEWHERE",
            "Someone changed approvals. Reload and try again.",
            409,
          );
        const types = [...new Set(req.body.types)];
        await tx
          .insert(schema.approvalControls)
          .values({ firmId: req.firm.id, types })
          .onConflictDoUpdate({
            target: schema.approvalControls.firmId,
            set: {
              types,
              version: sql`${schema.approvalControls.version} + 1`,
              updatedAt: new Date(),
            },
          });
        const saved = await loadApprovalControls(tx, req.firm.id);
        return {
          types: saved.types as ApprovalSettingsView["types"],
          version: saved.version,
          canApprove: canApprove(req.firm.role),
        };
      });
    },
  );
}
