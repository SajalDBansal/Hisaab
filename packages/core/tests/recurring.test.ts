import { describe, expect, test } from "bun:test";
import {
  canApprove,
  describeRecurring,
  dueRuns,
  entryNotices,
  needsApproval,
  nextOccurrence,
  occurrenceDate,
  recurringProblem,
  recurringTemplate,
} from "../src/accounting/recurring";
import { registerRoles, presetRights } from "../src/roles";
import type { Voucher } from "../src/types";

describe("recurring dates (T03)", () => {
  test("monthly from the 31st lands on month ends and comes back", () => {
    const plan = {
      frequency: "monthly" as const,
      interval: 1,
      startDate: "2026-01-31",
    };
    expect([0, 1, 2, 3].map((n) => occurrenceDate(plan, n))).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
    expect(occurrenceDate({ ...plan, startDate: "2027-12-29" }, 2)).toBe(
      "2028-02-29",
    );
  });

  test("daily, weekly, quarterly and yearly steps with an interval", () => {
    const at = (frequency: "daily" | "weekly" | "quarterly" | "yearly") =>
      occurrenceDate({ frequency, interval: 2, startDate: "2026-04-01" }, 1);
    expect(at("daily")).toBe("2026-04-03");
    expect(at("weekly")).toBe("2026-04-15");
    expect(at("quarterly")).toBe("2026-10-01");
    expect(at("yearly")).toBe("2028-04-01");
  });

  test("end date and count stop the schedule", () => {
    const plan = {
      frequency: "monthly" as const,
      interval: 1,
      startDate: "2026-04-10",
      endDate: "2026-06-10",
    };
    expect(nextOccurrence(plan, 2)).toBe("2026-06-10");
    expect(nextOccurrence(plan, 3)).toBeNull();
    expect(nextOccurrence({ ...plan, endDate: null, maxCount: 2 }, 2)).toBe(
      null,
    );
  });

  test("due runs catch up, skip closed dates and cap the batch", () => {
    const plan = {
      frequency: "daily" as const,
      interval: 1,
      startDate: "2026-05-01",
    };
    const runs = dueRuns(plan, 0, "2026-05-04", "2026-05-02");
    expect(runs.map((r) => [r.date, r.action])).toEqual([
      ["2026-05-01", "skip"],
      ["2026-05-02", "skip"],
      ["2026-05-03", "draft"],
      ["2026-05-04", "draft"],
    ]);
    expect(dueRuns(plan, 4, "2026-05-04")).toEqual([]);
    expect(dueRuns(plan, 0, "2026-12-31", null, 31)).toHaveLength(31);
  });

  test("problems and descriptions in plain words", () => {
    const plan = {
      frequency: "weekly" as const,
      interval: 2,
      startDate: "2026-05-01",
    };
    expect(recurringProblem(plan)).toBeNull();
    expect(recurringProblem({ ...plan, interval: 0 })).toMatch(/1 to 99/);
    expect(recurringProblem({ ...plan, endDate: "2026-04-01" })).toMatch(
      /before/,
    );
    expect(describeRecurring(plan)).toBe("Every 2 weeks");
    expect(describeRecurring({ ...plan, interval: 1, maxCount: 4 })).toBe(
      "Every week, 4 times",
    );
  });
});

describe("recurring templates", () => {
  const base = {
    id: "v1",
    number: "PAY-1",
    date: "2026-05-01",
    status: "posted",
    createdAt: "2026-05-01T00:00:00.000Z",
  } as const;

  test("a payment repeats without the bills it settled or its date", () => {
    const t = recurringTemplate({
      ...base,
      type: "payment",
      partyId: "p1",
      amount: 50_000,
      mode: "cash",
      ledgerId: "l1",
      allocations: [{ voucherId: "b1", amount: 50_000 }],
    } as Voucher);
    expect(t).toEqual({
      partyId: "p1",
      amount: 50_000,
      mode: "cash",
      ledgerId: "l1",
      allocations: [],
    });
  });

  test("a sale repeats its items, not order links or stock lots", () => {
    const t = recurringTemplate({
      ...base,
      type: "sale",
      partyId: "c1",
      amount: 0,
      sourceId: "o1",
      lines: [
        {
          itemId: "i1",
          qty: 2,
          rate: 1000,
          gstRate: 5,
          stockLotId: "lot",
          billDiscountShare: 10,
        },
      ],
      charges: [],
    } as Voucher);
    expect(t).toEqual({
      partyId: "c1",
      lines: [{ itemId: "i1", qty: 2, rate: 1000, gstRate: 5 }],
      charges: [],
    });
  });

  test("contra and journals map to their inputs; cancelled entries can't repeat", () => {
    expect(
      recurringTemplate({
        ...base,
        type: "contra",
        ledgerId: "cash",
        toLedgerId: "bank",
        amount: 500,
      } as Voucher),
    ).toEqual({ fromLedgerId: "cash", toLedgerId: "bank", amount: 500 });
    expect(() =>
      recurringTemplate({
        ...base,
        status: "cancelled",
        type: "journal",
        amount: 0,
      } as Voucher),
    ).toThrow(/not cancelled/);
    expect(() =>
      recurringTemplate({ ...base, type: "estimate", amount: 0 } as Voucher),
    ).toThrow();
  });
});

describe("approvals (T06)", () => {
  test("only money, expense and journal types wait, and only for non-approvers", () => {
    expect(needsApproval("payment", ["payment"], "accountant")).toBe(true);
    expect(needsApproval("payment", ["payment"], "owner")).toBe(false);
    expect(needsApproval("receipt", ["payment"], "accountant")).toBe(false);
    // Sales never wait, even if a setting names them.
    expect(needsApproval("sale", ["sale"], "accountant")).toBe(false);
    expect(canApprove("owner")).toBe(true);
    expect(canApprove("accountant")).toBe(false);
  });

  test("a custom role can be given the approve right", () => {
    const rights = presetRights("accountant");
    registerRoles([
      {
        id: "r_00000000-0000-4000-8000-00000000a001",
        name: "Checker",
        description: "",
        version: 1,
        ...rights,
        flags: { ...rights.flags, approveEntries: true },
      },
    ]);
    expect(canApprove("r_00000000-0000-4000-8000-00000000a001")).toBe(true);
    expect(
      needsApproval(
        "journal",
        ["journal"],
        "r_00000000-0000-4000-8000-00000000a001",
      ),
    ).toBe(false);
  });

  test("notices for drafts, approvals and skipped dates", () => {
    const notices = entryNotices({
      drafts: 2,
      submitted: 1,
      rejected: 0,
      latest: "2026-05-01T10:00:00.000Z",
      skipped: [{ scheduleId: "s1", name: "Rent", date: "2026-03-31" }],
      today: "2026-05-01",
    });
    expect(notices.map((n) => n.title)).toEqual([
      "2 recurring entries to review",
      "1 entry waits for approval",
      "Rent: 31-03-2026 skipped",
    ]);
    expect(notices.every((n) => n.link.screen === "entries")).toBe(true);
  });
});
