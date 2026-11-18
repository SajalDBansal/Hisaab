/**
 * Audit trail report (doc 37, T55): the edit log for a period as a document,
 * so it downloads as PDF, Excel or CSV like every other report. IP address
 * and device columns appear only when the books say the reader may see them
 * (`auditOrigin`); the API also strips those fields for everyone else.
 */
import { AUDIT_ACTION_LABEL } from "../accounting/audit";
import { formatDate } from "../dates";
import { moneyColumn, reportRow, textColumn } from "./helpers";
import {
  ENTRY_LABELS,
  REPORTS,
  type ReportBooks,
  type ReportRequest,
  type ReportSection,
} from "./types";

const istParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** ISO instant → Indian date ("YYYY-MM-DD") and time ("HH:MM"). */
export function istDateTime(iso: string): { date: string; time: string } {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return { date: "", time: "" };
  const parts = istParts.formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

/** Edit-log entries made on the period's days (Indian time), oldest first. */
export function auditTrailSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const origin = !!books.auditOrigin;
  const vouchers = new Map(books.vouchers.map((v) => [v.id, v]));
  // A GST / non-GST report lists only changes to that book's entries.
  const inScope = (voucherId: string) =>
    (request.tax ?? "all") === "all" || vouchers.has(voucherId);
  const rows = (books.auditLog ?? [])
    .map((entry) => ({ entry, when: istDateTime(entry.at) }))
    .filter(
      ({ entry, when }) =>
        when.date >= request.from &&
        when.date <= request.to &&
        inScope(entry.voucherId),
    )
    .sort(
      (a, b) =>
        a.entry.at.localeCompare(b.entry.at) ||
        a.entry.id.localeCompare(b.entry.id),
    )
    .map(({ entry, when }) => {
      const voucher = vouchers.get(entry.voucherId);
      const changes = entry.changes
        .map((c) => `${c.field}: ${c.before || "—"} → ${c.after || "—"}`)
        .join("; ");
      const cells: (string | number)[] = [
        formatDate(when.date),
        when.time,
        entry.userName,
        AUDIT_ACTION_LABEL[entry.action] ?? entry.action,
        ENTRY_LABELS[entry.voucherType] ?? entry.voucherType,
        entry.number,
        voucher ? formatDate(voucher.date) : "",
        voucher?.amount ?? 0,
        [changes, entry.note].filter(Boolean).join(" · "),
      ];
      if (origin) cells.push(entry.ipAddress ?? "", entry.device ?? "");
      return reportRow(...cells);
    });
  return {
    title: REPORTS[request.report].title,
    columns: [
      textColumn("Date"),
      textColumn("Time (IST)"),
      textColumn("User"),
      textColumn("Action"),
      textColumn("Entry"),
      textColumn("Number"),
      textColumn("Entry date"),
      moneyColumn("Amount now"),
      textColumn("Changes"),
      ...(origin ? [textColumn("IP address"), textColumn("Device")] : []),
    ],
    rows,
  };
}
