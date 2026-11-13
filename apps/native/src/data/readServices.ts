import * as c from "@repo/contracts";
import { z } from "zod";
import { PAGE_SIZE } from "@repo/core";
import { type Client, pageQuery, queryString, statementPageOf } from "./client";
import { type Services } from "./services";

export function readServices({ request, pages }: Client) {
  const team = () => request("/settings/team", c.TeamView);
  return {
    bookControlService: {
      get: () => request("/settings/books", c.BookControlView),
      history: (cursor) =>
        request(
          `/settings/books/history${queryString({ cursor })}`,
          c.BookControlHistoryPage,
        ),
      update: (input) =>
        request("/settings/books", c.BookControlView, { body: input }),
      allocations: () =>
        request("/settings/books/allocations", c.OpeningAllocationView),
      allocate: (input) =>
        request("/settings/books/allocations", c.OpeningAllocationView, {
          body: input,
        }),
      yearEnd: (year) =>
        request(
          `/settings/books/year-end${queryString({ year })}`,
          c.YearEndView,
        ),
      closeYear: (input) =>
        request("/settings/books/year-end", c.YearEndView, { body: input }),
    } satisfies Services["bookControlService"],
    auditService: {
      list: (limit) => pages("/audit-log", c.AuditEntry, {}, limit),
      page: (query) =>
        request(`/audit-log/page${pageQuery(query)}`, c.AuditPage),
    } satisfies Services["auditService"],
    bankService: {
      reconciliation: (ledgerId, asOf) =>
        request(
          `/ledgers/${ledgerId}/reconciliation${queryString({ asOf })}`,
          c.ReconciliationView,
        ),
      setCleared: async (id, clearedOn, ledgerId) => {
        await request(`/vouchers/${id}/bank-date`, c.Voucher, {
          method: "PATCH",
          body: { clearedOn, ledgerId },
        });
      },
    } satisfies Services["bankService"],
    reportService: {
      exportReport: (input) =>
        request("/reports/export", c.ReportDocument, { body: input }),
      dashboard: (tax) =>
        request(`/reports/dashboard${queryString({ tax })}`, c.DashboardData),
      outstanding: (type, tax) =>
        request(
          `/reports/outstanding${queryString({ type, tax })}`,
          c.Outstanding,
        ),
      tradeSummary: (kind, period, tax) =>
        request(
          `/reports/${kind}-summary${queryString({ period, tax })}`,
          c.TradeSummary,
        ),
      expenses: (period, tax) =>
        request(
          `/reports/expenses${queryString({ period, tax })}`,
          c.ExpenseSummary,
        ),
      stock: (tax) =>
        request(`/reports/stock${queryString({ tax })}`, c.StockSummary),
    } satisfies Services["reportService"],
    accountService: {
      list: () => request("/accounts/masters", z.array(c.CustomAccount)),
      create: (input) =>
        request("/accounts/masters", c.CustomAccount, { body: input }),
      chart: (tax) =>
        request(
          `/accounts/chart${queryString({ tax })}`,
          z.array(c.ChartGroup),
        ),
      trialBalance: (tax) =>
        request(
          `/reports/trial-balance${queryString({ tax })}`,
          c.TrialBalance,
        ),
      finalAccounts: (tax, from, asOf) =>
        request(
          `/reports/final-accounts${queryString({ tax, from, asOf })}`,
          c.FinalAccounts,
        ),
      statement: (key, tax) =>
        request(
          `/accounts/${encodeURIComponent(key)}/statement${queryString({ tax })}`,
          c.AccountStatement,
        ),
      statementPage: async (key, tax, query) =>
        statementPageOf(
          await request(
            `/accounts/${encodeURIComponent(key)}/statement${pageQuery({ tax, limit: PAGE_SIZE, cursor: query.cursor })}`,
            c.AccountStatement,
          ),
        ),
      pickable: () => request("/accounts", z.array(c.AccountInfo)),
    } satisfies Services["accountService"],
    gstService: {
      months: (count) =>
        request(`/gst/months${queryString({ count })}`, z.array(c.GstMonth)),
      gstr1: (month) => request(`/gst/gstr1${queryString({ month })}`, c.Gstr1),
      gstr3b: (month) =>
        request(`/gst/gstr3b${queryString({ month })}`, c.Gstr3b),
      compositionQuarters: (count) =>
        request(
          `/gst/composition${queryString({ count })}`,
          z.array(c.CompositionQuarter),
        ),
    } satisfies Services["gstService"],
    printService: {
      voucher: (id, template) =>
        request(
          `/vouchers/${id}/print${queryString({ template })}`,
          c.PrintableVoucher,
        ),
      reminder: (id) => request(`/parties/${id}/reminder`, c.PaymentReminder),
    } satisfies Services["printService"],
    reminderService: {
      settings: () => request("/settings/reminders", c.ReminderSettings),
      update: (patch) =>
        request("/settings/reminders", c.ReminderSettings, {
          method: "PATCH",
          body: patch,
        }),
      due: () => request("/reminders/due", z.array(c.ReminderDue)),
      markSent: async (id) => {
        await request(
          `/parties/${id}/reminders`,
          z.object({ ok: z.boolean() }),
          { body: {} },
        );
      },
    } satisfies Services["reminderService"],
    settingsService: {
      invoice: () => request("/settings/invoice", c.InvoiceSettingsView),
      updateFirm: (patch) =>
        request("/firms/current", c.FirmDetail, {
          method: "PATCH",
          body: patch,
        }),
      updateInvoice: (body) =>
        request("/settings/invoice", c.InvoiceSettings, {
          method: "PATCH",
          body,
        }),
      team,
      updateMember: async (id, patch) => {
        const target = (await team()).members.find(
          (member) => member.id === id,
        );
        if (!target) throw new Error("Team member not found.");
        if (patch.active === false) {
          await request(
            `/firms/current/${target.active ? "members" : "invitations"}/${id}`,
            z.object({ ok: z.boolean() }),
            { method: "DELETE" },
          );
          return { ...target, active: false };
        }
        if (!target.active)
          throw new Error(
            "Cancel and resend an invitation to change its role.",
          );
        await request(
          `/firms/current/members/${id}`,
          z.object({ ok: z.boolean() }),
          {
            method: "PATCH",
            body: { role: patch.role },
          },
        );
        return { ...target, ...patch };
      },
      presence: () => request("/firms/current/presence", c.FirmPresence),
      transferOwnership: async (input) => {
        await request(
          "/firms/current/transfer-ownership",
          z.object({ ok: z.boolean() }),
          { body: input },
        );
      },
      invite: async (input) => {
        const invitation = await request(
          "/firms/current/invitations",
          c.Invitation,
          { body: input },
        );
        return {
          id: invitation.id,
          name: invitation.email,
          email: invitation.email,
          phone: "",
          role: invitation.role,
          active: false,
        };
      },
    } satisfies Services["settingsService"],
    searchService: {
      search: (q) => request(`/search${queryString({ q })}`, c.SearchResults),
    } satisfies Services["searchService"],
    notificationService: {
      list: () => request("/notifications", c.NoticeList),
      markRead: async (ids) => {
        await request("/notifications/read", z.object({ ok: z.boolean() }), {
          body: { ids },
        });
      },
    } satisfies Services["notificationService"],
  };
}
