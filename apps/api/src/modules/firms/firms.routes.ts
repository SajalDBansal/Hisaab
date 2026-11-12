import {
  FirmDetail,
  FirmListRow,
  FirmSummary,
  FirmUpdate,
  Invitation,
  InviteInput,
  Member,
  MemberParams,
  MemberRoleInput,
  TransferOwnershipInput,
  MyInvitation,
  NewFirmInput,
  IdParams,
} from "@repo/contracts";
import { blankBooks, checkNewFirm, ROLES, type Role } from "@repo/core";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import type { Auth } from "../../auth/auth";
import { insertFirm } from "../../db/seedFirm";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { viaAuth } from "../../lib/auth-call";

type Profile = typeof schema.firmProfile.$inferSelect;

const toFirm = (name: string, p: Profile) => ({
  id: p.firmId,
  name,
  city: p.city,
  state: p.state,
  stateCode: p.stateCode,
  gstin: p.gstin,
  gstRegistration: p.gstRegistration,
  ...(p.compositionType ? { compositionType: p.compositionType } : {}),
  fyStart: p.fyStart,
  ...(p.address ? { address: p.address } : {}),
  ...(p.phone ? { phone: p.phone } : {}),
  ...(p.email ? { email: p.email } : {}),
  ...(p.pan ? { pan: p.pan } : {}),
});

const toRole = (value: string | null): Role =>
  ROLES.some((r) => r.role === value) ? (value as Role) : "viewer";

/** Firms, the people in them, and invitations. */
export async function firmRoutes(
  app: FastifyInstance,
  options: { db: Db; auth: Auth },
) {
  const { db, auth } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const asCaller = (req: { headers: Record<string, unknown> }) =>
    fromNodeHeaders(req.headers as never);

  const loadFirm = async (firmId: string) => {
    const [row] = await db
      .select({ name: schema.organization.name, profile: schema.firmProfile })
      .from(schema.organization)
      .innerJoin(
        schema.firmProfile,
        eq(schema.firmProfile.firmId, schema.organization.id),
      )
      .where(eq(schema.organization.id, firmId));
    if (!row) throw new AppError("NOT_FOUND", "This firm was not found.", 404);
    return row;
  };

  // ---- My firms ----------------------------------------------------------

  typed.get(
    "/firms",
    {
      preHandler: app.authenticate,
      schema: { response: { 200: z.array(FirmListRow) } },
    },
    async (req) => {
      const rows = await db
        .select({
          name: schema.organization.name,
          role: schema.member.role,
          profile: schema.firmProfile,
          parties: sql<number>`(select count(*)::int from ${schema.parties} where ${schema.parties.firmId} = ${schema.organization.id} and ${schema.parties.deletedAt} is null)`,
          vouchers: sql<number>`(select count(*)::int from ${schema.vouchers} where ${schema.vouchers.firmId} = ${schema.organization.id})`,
        })
        .from(schema.member)
        .innerJoin(
          schema.organization,
          eq(schema.organization.id, schema.member.organizationId),
        )
        .innerJoin(
          schema.firmProfile,
          eq(schema.firmProfile.firmId, schema.organization.id),
        )
        .where(eq(schema.member.userId, req.user.id))
        .orderBy(asc(schema.organization.createdAt));
      return rows.map((r) => ({
        ...toFirm(r.name, r.profile),
        parties: r.parties,
        vouchers: r.vouchers,
        role: toRole(r.role),
      }));
    },
  );

  typed.post(
    "/firms",
    {
      preHandler: app.authenticate,
      schema: { body: NewFirmInput, response: { 201: FirmDetail } },
    },
    async (req, reply) => {
      const mine = await db
        .select({ name: schema.organization.name })
        .from(schema.member)
        .innerJoin(
          schema.organization,
          eq(schema.organization.id, schema.member.organizationId),
        )
        .where(eq(schema.member.userId, req.user.id));
      if (
        mine.some(
          (f) => f.name.toLowerCase() === req.body.name.trim().toLowerCase(),
        )
      )
        throw new AppError(
          "DUPLICATE_FIRM",
          "You already have a firm with this name.",
          409,
          { name: "You already have a firm with this name." },
        );
      // The same blank books the app starts a new firm with (Cash ledger, units, invoice settings)
      const books = blankBooks({ ...req.body, id: "new-firm" });
      const firmId = await insertFirm(db, books, req.user.id);
      const { name, profile } = await loadFirm(firmId);
      return reply.code(201).send({
        ...toFirm(name, profile),
        role: "owner" as const,
        permissions: ROLES.find((r) => r.role === "owner")?.can ?? [],
      });
    },
  );

  // ---- The open firm (X-Firm-Id) ------------------------------------------

  typed.get(
    "/firms/current",
    {
      preHandler: app.inFirm(),
      schema: { response: { 200: FirmDetail } },
    },
    async (req) => {
      const { name, profile } = await loadFirm(req.firm.id);
      return {
        ...toFirm(name, profile),
        role: req.firm.role,
        permissions: ROLES.find((r) => r.role === req.firm.role)?.can ?? [],
      };
    },
  );

  typed.patch(
    "/firms/current",
    {
      preHandler: app.inFirm("settings"),
      schema: { body: FirmUpdate, response: { 200: FirmDetail } },
    },
    async (req) => {
      const { name, profile } = await loadFirm(req.firm.id);
      const patch = req.body;
      // The GST rules depend on several fields together, so check the result, not just the patch
      const problems = checkNewFirm({
        name: patch.name ?? name,
        city: patch.city ?? profile.city,
        stateCode: profile.stateCode,
        gstin: patch.gstin ?? profile.gstin,
        gstRegistration: patch.gstRegistration ?? profile.gstRegistration,
      });
      if (Object.keys(problems).length > 0)
        throw new AppError(
          "INVALID_INPUT",
          "Please check the highlighted fields.",
          400,
          problems as Record<string, string>,
        );

      await db.transaction(async (tx) => {
        if (patch.name !== undefined)
          await tx
            .update(schema.organization)
            .set({ name: patch.name.trim() })
            .where(eq(schema.organization.id, req.firm.id));
        const { name: _name, ...rest } = patch;
        await tx
          .update(schema.firmProfile)
          .set({
            ...rest,
            ...(patch.gstRegistration === "composition"
              ? {}
              : patch.gstRegistration
                ? { compositionType: null }
                : {}),
            version: sql`${schema.firmProfile.version} + 1`,
          })
          .where(eq(schema.firmProfile.firmId, req.firm.id));
      });
      const fresh = await loadFirm(req.firm.id);
      return {
        ...toFirm(fresh.name, fresh.profile),
        role: req.firm.role,
        permissions: ROLES.find((r) => r.role === req.firm.role)?.can ?? [],
      };
    },
  );

  // ---- Team ---------------------------------------------------------------

  typed.get(
    "/firms/current/members",
    {
      preHandler: app.inFirm("team"),
      schema: { response: { 200: z.array(Member) } },
    },
    async (req) => {
      const rows = await db
        .select({
          id: schema.member.id,
          userId: schema.user.id,
          name: schema.user.name,
          email: schema.user.email,
          role: schema.member.role,
          joinedAt: schema.member.createdAt,
        })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
        .where(eq(schema.member.organizationId, req.firm.id))
        .orderBy(asc(schema.member.createdAt));
      return rows.map((r) => ({
        ...r,
        role: toRole(r.role),
        joinedAt: r.joinedAt.toISOString(),
      }));
    },
  );

  // The owner is never changed or removed from here
  const loadTarget = async (firmId: string, memberId: string) => {
    const [target] = await db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.id, memberId),
          eq(schema.member.organizationId, firmId),
        ),
      );
    if (!target)
      throw new AppError("NOT_FOUND", "That team member was not found.", 404);
    if (target.role === "owner")
      throw new AppError(
        "OWNER_PROTECTED",
        "The owner of the firm can't be changed or removed.",
        403,
      );
  };

  typed.patch(
    "/firms/current/members/:memberId",
    {
      preHandler: app.inFirm("team"),
      schema: {
        params: MemberParams,
        body: MemberRoleInput,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      await loadTarget(req.firm.id, req.params.memberId);
      await viaAuth(() =>
        auth.api.updateMemberRole({
          body: {
            memberId: req.params.memberId,
            role: req.body.role,
            organizationId: req.firm.id,
          },
          headers: asCaller(req),
        }),
      );
      return { ok: true as const };
    },
  );

  typed.delete(
    "/firms/current/members/:memberId",
    {
      preHandler: app.inFirm("team"),
      schema: {
        params: MemberParams,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      await loadTarget(req.firm.id, req.params.memberId);
      await viaAuth(() =>
        auth.api.removeMember({
          body: {
            memberIdOrEmail: req.params.memberId,
            organizationId: req.firm.id,
          },
          headers: asCaller(req),
        }),
      );
      return { ok: true as const };
    },
  );

  // ---- Handing the firm to another member -----------------------------------

  /**
   * The owner makes another member the owner and takes the chosen role, in one
   * transaction under the firm's write lock, so the firm always has exactly one
   * owner. Saves still in flight under the old roles are refused afterwards,
   * because every save rechecks its role. The change is kept in the firm's
   * control history.
   */
  typed.post(
    "/firms/current/transfer-ownership",
    {
      preHandler: app.inFirm("team"),
      schema: {
        body: TransferOwnershipInput,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      const firmId = req.firm.id;
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${firmId}, 0))`,
        );
        const [firm] = await tx
          .select({ name: schema.organization.name })
          .from(schema.organization)
          .where(eq(schema.organization.id, firmId));
        const members = await tx
          .select({
            id: schema.member.id,
            userId: schema.member.userId,
            role: schema.member.role,
          })
          .from(schema.member)
          .where(eq(schema.member.organizationId, firmId))
          .for("update");
        const caller = members.find((m) => m.userId === req.user.id);
        if (caller?.role !== "owner")
          throw new AppError(
            "OWNER_ONLY",
            "Only the owner can hand over the firm.",
            403,
          );
        const target = members.find((m) => m.id === req.body.memberId);
        if (!target)
          throw new AppError(
            "NOT_FOUND",
            "That team member was not found.",
            404,
          );
        if (target.id === caller.id)
          throw new AppError(
            "INVALID_INPUT",
            "Pick another team member to hand the firm to.",
            400,
            { memberId: "Pick another team member." },
          );
        const typed = req.body.confirmName.trim().toLowerCase();
        if (!firm || typed !== firm.name.trim().toLowerCase())
          throw new AppError(
            "INVALID_INPUT",
            "Type the firm name exactly to confirm.",
            400,
            { confirmName: "Type the firm name exactly to confirm." },
          );
        const [newOwner] = await tx
          .select({ name: schema.user.name })
          .from(schema.user)
          .where(eq(schema.user.id, target.userId));
        await tx
          .update(schema.member)
          .set({ role: "owner" })
          .where(eq(schema.member.id, target.id));
        await tx
          .update(schema.member)
          .set({ role: req.body.previousOwnerRole })
          .where(eq(schema.member.id, caller.id));
        await tx.insert(schema.bookControlEvents).values({
          id: uuidv7(),
          firmId,
          action: "transfer-ownership",
          reason: `Ownership handed to ${newOwner?.name ?? "another member"}`,
          userId: req.user.id,
          userName: req.user.name,
          before: { owner: caller.userId, newOwnerRole: target.role },
          after: {
            owner: target.userId,
            previousOwnerRole: req.body.previousOwnerRole,
          },
        });
      });
      return { ok: true as const };
    },
  );

  // ---- Invitations the owner sent ----------------------------------------

  typed.get(
    "/firms/current/invitations",
    {
      preHandler: app.inFirm("team"),
      schema: { response: { 200: z.array(Invitation) } },
    },
    async (req) => {
      const rows = await db
        .select()
        .from(schema.invitation)
        .where(
          and(
            eq(schema.invitation.organizationId, req.firm.id),
            eq(schema.invitation.status, "pending"),
            gt(schema.invitation.expiresAt, new Date()),
          ),
        )
        .orderBy(asc(schema.invitation.createdAt));
      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        role: toRole(r.role),
        expiresAt: r.expiresAt.toISOString(),
        invitedAt: r.createdAt.toISOString(),
      }));
    },
  );

  typed.post(
    "/firms/current/invitations",
    {
      preHandler: app.inFirm("team"),
      schema: { body: InviteInput, response: { 201: Invitation } },
    },
    async (req, reply) => {
      const created = await viaAuth(() =>
        auth.api.createInvitation({
          body: {
            email: req.body.email,
            role: req.body.role,
            organizationId: req.firm.id,
          },
          headers: asCaller(req),
        }),
      );
      return reply.code(201).send({
        id: created.id,
        email: created.email,
        role: toRole(created.role),
        expiresAt: new Date(created.expiresAt).toISOString(),
        invitedAt: new Date(created.createdAt).toISOString(),
      });
    },
  );

  typed.delete(
    "/firms/current/invitations/:id",
    {
      preHandler: app.inFirm("team"),
      schema: {
        params: IdParams,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      const [found] = await db
        .select({ id: schema.invitation.id })
        .from(schema.invitation)
        .where(
          and(
            eq(schema.invitation.id, req.params.id),
            eq(schema.invitation.organizationId, req.firm.id),
          ),
        );
      if (!found)
        throw new AppError("NOT_FOUND", "That invitation was not found.", 404);
      await viaAuth(() =>
        auth.api.cancelInvitation({
          body: { invitationId: req.params.id },
          headers: asCaller(req),
        }),
      );
      return { ok: true as const };
    },
  );

  // ---- Invitations waiting for me ------------------------------------------

  typed.get(
    "/me/invitations",
    {
      preHandler: app.authenticate,
      schema: { response: { 200: z.array(MyInvitation) } },
    },
    async (req) => {
      const rows = await db
        .select({
          id: schema.invitation.id,
          role: schema.invitation.role,
          expiresAt: schema.invitation.expiresAt,
          firmName: schema.organization.name,
          invitedBy: schema.user.name,
        })
        .from(schema.invitation)
        .innerJoin(
          schema.organization,
          eq(schema.organization.id, schema.invitation.organizationId),
        )
        .innerJoin(schema.user, eq(schema.user.id, schema.invitation.inviterId))
        .where(
          and(
            sql`lower(${schema.invitation.email}) = lower(${req.user.email})`,
            eq(schema.invitation.status, "pending"),
            gt(schema.invitation.expiresAt, new Date()),
          ),
        );
      return rows.map((r) => ({
        ...r,
        role: toRole(r.role),
        expiresAt: r.expiresAt.toISOString(),
      }));
    },
  );

  typed.post(
    "/me/invitations/:id/accept",
    {
      preHandler: app.authenticate,
      schema: { params: IdParams, response: { 200: FirmSummary } },
    },
    async (req) => {
      const accepted = await viaAuth(() =>
        auth.api.acceptInvitation({
          body: { invitationId: req.params.id },
          headers: asCaller(req),
        }),
      );
      const firmId = accepted?.invitation.organizationId ?? "";
      const { name, profile } = await loadFirm(firmId);
      return {
        id: firmId,
        name,
        city: profile.city,
        state: profile.state,
        gstin: profile.gstin,
        role: toRole(accepted?.member.role ?? null),
      };
    },
  );

  typed.post(
    "/me/invitations/:id/decline",
    {
      preHandler: app.authenticate,
      schema: {
        params: IdParams,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      await viaAuth(() =>
        auth.api.rejectInvitation({
          body: { invitationId: req.params.id },
          headers: asCaller(req),
        }),
      );
      return { ok: true as const };
    },
  );
}
