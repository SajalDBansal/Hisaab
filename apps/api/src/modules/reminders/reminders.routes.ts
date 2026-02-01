import {
  IdParams,
  PaymentReminder,
  ReminderDue,
  ReminderSettings,
} from "@repo/contracts";
import {
  collectionBills,
  dueReminders,
  openBills,
  partyBalance,
  reminderText,
  today,
} from "@repo/core";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { notFound } from "@repo/backend/modules/masters/shared";
import { notificationsRepo } from "@repo/backend/modules/notifications/notifications.repo";
import { loadReportBooks } from "@repo/backend/modules/reports/books";

async function reminder(db: Db, firmId: string, partyId: string) {
  const books = await loadReportBooks(db, firmId);
  const party = books.parties.find((p) => p.id === partyId);
  if (!party) throw notFound("party");
  const balance = partyBalance(party, books.vouchers, today());
  if (party.type !== "customer" || balance <= 0)
    throw new AppError("NOTHING_DUE", "No customer payment is pending.", 409);
  return {
    balance,
    phone: party.phone || undefined,
    text: reminderText({
      firm: books.firm,
      partyName: party.name,
      balance,
      openBills: openBills(collectionBills(party, books.vouchers, today())),
      upiId: books.invoiceSettings.bankAccount?.upiId,
    }),
  };
}

export async function reminderRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.get(
    "/settings/reminders",
    {
      preHandler: app.inFirm(),
      schema: { response: { 200: ReminderSettings } },
    },
    async (req) => (await notificationsRepo.books(db, req.firm.id)).reminders,
  );

  typed.patch(
    "/settings/reminders",
    {
      preHandler: app.inFirm("settings"),
      schema: {
        body: ReminderSettings.partial(),
        response: { 200: ReminderSettings },
      },
    },
    async (req) => {
      const [row] = await db
        .update(schema.reminderSettings)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(schema.reminderSettings.firmId, req.firm.id))
        .returning();
      return ReminderSettings.parse(row);
    },
  );

  typed.get(
    "/reminders/due",
    {
      preHandler: app.inFirm(),
      schema: { response: { 200: z.array(ReminderDue) } },
    },
    async (req) => {
      const b = await notificationsRepo.books(db, req.firm.id);
      return dueReminders(
        b.parties,
        b.vouchers,
        b.reminders,
        today(),
        b.remindedOn,
      );
    },
  );

  typed.get(
    "/parties/:id/reminder",
    {
      preHandler: app.inFirm("sales"),
      schema: { params: IdParams, response: { 200: PaymentReminder } },
    },
    async (req) => reminder(db, req.firm.id, req.params.id),
  );

  // The client calls this only after the user confirms sending, not merely opening WhatsApp.
  typed.post(
    "/parties/:id/reminders",
    {
      preHandler: app.inFirm("sales"),
      schema: {
        params: IdParams,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      await reminder(db, req.firm.id, req.params.id);
      const row = {
        firmId: req.firm.id,
        partyId: req.params.id,
        sentOn: today(),
      };
      await db
        .insert(schema.remindersSent)
        .values(row)
        .onConflictDoUpdate({
          target: [schema.remindersSent.firmId, schema.remindersSent.partyId],
          set: { sentOn: row.sentOn },
        });
      return { ok: true as const };
    },
  );
}
