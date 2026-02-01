import {
  InvoiceSettings,
  InvoiceSettingsUpdate,
  InvoiceSettingsView,
  TeamView,
  Role,
} from "@repo/contracts";
import { can, updateInvoiceSettings } from "@repo/core";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { loadReportBooks } from "@repo/backend/modules/reports/books";

const toRole = (value: string | null) => Role.safeParse(value).data ?? "viewer";

export async function settingsRoutes(
  app: FastifyInstance,
  options: { db: Db },
) {
  const db = options.db;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.patch(
    "/settings/invoice",
    {
      preHandler: app.inFirm("settings"),
      schema: {
        body: InvoiceSettingsUpdate,
        response: { 200: InvoiceSettings },
      },
    },
    async (req) =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${req.firm.id}, 0))`,
        );
        const books = await loadReportBooks(tx, req.firm.id);
        let settings;
        try {
          settings = updateInvoiceSettings(books, req.body);
        } catch (error) {
          throw new AppError("INVALID_SETTINGS", (error as Error).message, 400);
        }
        if (settings.bankLedgerId) {
          const [bank] = await tx
            .select()
            .from(schema.ledgers)
            .where(
              and(
                eq(schema.ledgers.firmId, req.firm.id),
                eq(schema.ledgers.id, settings.bankLedgerId),
                eq(schema.ledgers.kind, "bank"),
                isNull(schema.ledgers.deletedAt),
              ),
            );
          if (!bank)
            throw new AppError(
              "INVALID_BANK",
              "Select a bank account belonging to this firm.",
              400,
            );
        }
        await tx
          .update(schema.invoiceSettings)
          .set({
            ...settings,
            bankLedgerId: settings.bankLedgerId || null,
            version: sql`${schema.invoiceSettings.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(schema.invoiceSettings.firmId, req.firm.id));
        return settings;
      }),
  );

  typed.get(
    "/settings/team",
    {
      preHandler: app.inFirm(),
      schema: { response: { 200: TeamView } },
    },
    async (req) => {
      const manage = can(req.firm.role, "team");
      const rows = await db
        .select({
          id: schema.member.id,
          userId: schema.user.id,
          name: schema.user.name,
          phone: schema.user.phoneNumber,
          email: schema.user.email,
          role: schema.member.role,
        })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
        .where(
          and(
            eq(schema.member.organizationId, req.firm.id),
            manage ? undefined : eq(schema.member.userId, req.user.id),
          ),
        )
        .orderBy(asc(schema.member.createdAt));
      const invitations = manage
        ? await db
            .select()
            .from(schema.invitation)
            .where(
              and(
                eq(schema.invitation.organizationId, req.firm.id),
                eq(schema.invitation.status, "pending"),
                gt(schema.invitation.expiresAt, new Date()),
              ),
            )
        : [];
      const member = rows.find((row) => row.userId === req.user.id);
      if (!member)
        throw new AppError(
          "FORBIDDEN",
          "You no longer belong to this firm.",
          403,
        );
      return {
        currentUserId: member.id,
        members: [
          ...rows.map((row) => ({
            ...row,
            phone: row.phone ?? "",
            role: toRole(row.role),
            active: true,
          })),
          ...invitations.map((row) => ({
            id: row.id,
            name: row.email,
            email: row.email,
            phone: "",
            role: toRole(row.role),
            active: false,
          })),
        ],
      };
    },
  );
  app.withTypeProvider<ZodTypeProvider>().get(
    "/settings/invoice",
    {
      preHandler: app.inFirm(),
      schema: { response: { 200: InvoiceSettingsView } },
    },
    async (req) => {
      const books = await loadReportBooks(options.db, req.firm.id);
      const bank = books.ledgers.find(
        (row) => row.id === books.invoiceSettings.bankLedgerId,
      );
      return { ...books.invoiceSettings, bankName: bank?.name ?? "" };
    },
  );
}
