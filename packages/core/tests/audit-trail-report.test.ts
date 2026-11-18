import { describe, expect, test } from "bun:test";
import { blankBooks } from "../src/mock/seed";
import {
  buildReport,
  reportCsv,
  reportXlsx,
  type ReportRequest,
} from "../src/reporting";
import type { AuditEntry } from "../src/types";

const request = (extra: Partial<ReportRequest> = {}): ReportRequest => ({
  report: "audit-trail",
  from: "2026-10-01",
  to: "2026-10-25",
  includeNarration: false,
  includeZeroBalances: false,
  ...extra,
});

const entry = (
  id: string,
  at: string,
  extra: Partial<AuditEntry> = {},
): AuditEntry => ({
  id,
  voucherId: "v1",
  number: "SI/26-27/0001",
  voucherType: "sale",
  action: "edited",
  at,
  userId: "u1",
  userName: "Asha",
  changes: [{ field: "Amount", before: "₹1,000.00", after: "₹1,200.00" }],
  ipAddress: "203.0.113.9",
  device: "Owner Phone (App)",
  ...extra,
});

function books() {
  const db = blankBooks(
    {
      id: "f",
      name: "F",
      city: "Mathura",
      stateCode: "09",
      gstRegistration: "regular",
      gstin: "09AAAAA0000A1Z0",
    },
    "2026-10-26",
  );
  db.auditLog = [
    entry("a2", "2026-10-25T20:00:00.000Z"), // 26 Oct 01:30 in India
    entry("a1", "2026-10-02T04:30:00.000Z", {
      action: "created",
      changes: [],
      ipAddress: undefined,
      device: undefined,
    }),
    entry("a0", "2026-09-30T19:00:00.000Z", { action: "cancelled" }), // 1 Oct 00:30 IST
  ];
  return db;
}

describe("audit trail report (T55)", () => {
  test("entries of the period's Indian days, oldest first, without origin by default", () => {
    const doc = buildReport(books(), request());
    const [section] = doc.sections;
    expect(section.columns.map((c) => c.label)).toEqual([
      "Date",
      "Time (IST)",
      "User",
      "Action",
      "Entry",
      "Number",
      "Entry date",
      "Amount now",
      "Changes",
    ]);
    expect(section.rows.map((r) => r.cells.slice(0, 4))).toEqual([
      ["01-10-2026", "00:30", "Asha", "Cancelled"],
      ["02-10-2026", "10:00", "Asha", "Created"],
    ]);
    expect(section.rows[0].cells[8]).toBe("Amount: ₹1,000.00 → ₹1,200.00");
    expect(JSON.stringify(doc)).not.toContain("203.0.113.9");
    expect(doc.notes.join(" ")).toContain("audit right");
  });

  test("IP address and device only when the reader has the audit right; files build", () => {
    const db = { ...books(), auditOrigin: true };
    const doc = buildReport(db, request({ to: "2026-10-26" }));
    const [section] = doc.sections;
    expect(section.columns.slice(-2).map((c) => c.label)).toEqual([
      "IP address",
      "Device",
    ]);
    expect(section.rows).toHaveLength(3);
    expect(section.rows[2].cells.slice(-2)).toEqual([
      "203.0.113.9",
      "Owner Phone (App)",
    ]);
    expect(section.rows[1].cells.slice(-2)).toEqual(["", ""]);
    expect(reportCsv(doc)).toContain("203.0.113.9");
    expect(reportXlsx(doc).length).toBeGreaterThan(100);
  });
});
