import {
  can,
  costPayloadForRead,
  PERMISSIONS,
  roleInfo,
  type Permission,
  type Role,
} from "@repo/core";
import { Id } from "@repo/contracts";
import { associatePayloadForRead } from "@repo/core/src/accounting/associates";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";

declare module "fastify" {
  interface FastifyRequest {
    /** Set on firm routes: the firm named in X-Firm-Id and the caller's role in it. */
    firm: { id: string; role: Role };
  }
  interface FastifyInstance {
    /**
     * Use as `preHandler` on a firm's routes: logs the caller in, reads X-Firm-Id,
     * checks they belong to that firm and, if given, that their role allows `permission`.
     */
    inFirm: (permission?: Permission | Permission[]) => FirmPreHandler[];
  }
}

type FirmPreHandler = (
  req: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

const WHAT: Record<Permission, string> = Object.fromEntries(
  PERMISSIONS.map((p) => [p.key, p.label.toLowerCase()]),
) as Record<Permission, string>;

export function registerFirmContext(app: FastifyInstance, db: Db) {
  app.decorateRequest("firm");
  // Includes reads, writes and historical replay answers; never mutate stored snapshots.
  // Commission policies and purchase costs are hidden from roles that may not see them.
  app.addHook("preSerialization", async (req, _reply, payload) =>
    req.firm
      ? costPayloadForRead(
          req.firm.role,
          associatePayloadForRead(req.firm.role, payload),
        )
      : payload,
  );

  const firmContext = async (req: FastifyRequest) => {
    const header = req.headers["x-firm-id"];
    const parsed = Id.safeParse(Array.isArray(header) ? header[0] : header);
    if (!parsed.success)
      throw new AppError(
        "FIRM_REQUIRED",
        "Choose a firm first (the X-Firm-Id header is missing or not valid).",
        400,
      );
    const [row] = await db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, parsed.data),
          eq(schema.member.userId, req.user.id),
        ),
      );
    // Same reply for "no such firm" and "not your firm", so ids can't be probed
    if (!row)
      throw new AppError(
        "NOT_A_MEMBER",
        "You don't have access to this firm.",
        403,
      );
    req.firm = { id: parsed.data, role: row.role as Role };
  };

  app.decorate("inFirm", (permission?: Permission | Permission[]) => {
    const checks: FirmPreHandler[] = [app.authenticate, firmContext];
    // A list means "any one of these is enough"
    const allowed = permission === undefined ? [] : [permission].flat();
    const [first] = allowed;
    if (first)
      checks.push(async (req: FastifyRequest) => {
        if (!allowed.some((p) => can(req.firm.role, p)))
          throw new AppError(
            "FORBIDDEN",
            `Your role (${roleInfo(req.firm.role).label}) can't use ${WHAT[first]}. Ask the owner of the firm.`,
            403,
          );
      });
    checks.push(app.checkFreshFirmRead);
    return checks;
  });
}
