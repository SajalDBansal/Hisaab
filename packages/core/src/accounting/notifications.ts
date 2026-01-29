/**
 * The bell: things that need the owner's attention today, worked out from the books.
 * Nothing is stored except which notices were read, so they are always current.
 */
import { addDays, daysBetween, formatDate, yearMonth } from "../dates";
import { formatINR } from "../money";
import type { Firm, ISODate, Item, Party, Voucher } from "../types";
import { openBills, collectionBills } from "./bills";
import { orderStatus } from "./orders";
import type { ReminderDue } from "./reminders";
import { isLowStock, stockQty } from "./stock";

export type NoticeKind =
  | "overdue"
  | "payable"
  | "reminders"
  | "low-stock"
  | "estimate"
  | "gst"
  | "backup";

/** Where tapping a notice goes. */
export interface NoticeLink {
  screen:
    | "party"
    | "item"
    | "voucher"
    | "reminders"
    | "gst"
    | "backup"
    | "outstanding";
  id?: string;
}

export interface Notice {
  /** Stable while the fact is the same, so a read notice stays read until something changes. */
  id: string;
  kind: NoticeKind;
  title: string;
  body: string;
  date: ISODate;
  tone: "give" | "warn" | "ink";
  link: NoticeLink;
}

/** GST returns due this month for last month (regular: GSTR-1 on 11th, GSTR-3B on 20th; composition: CMP-08 on 18th after a quarter). */
export function gstFilingsDue(
  firm: Firm,
  todayIso: ISODate,
): { form: string; due: ISODate; period: string }[] {
  const month = yearMonth(todayIso);
  const prev = yearMonth(addDays(`${month}-01`, -1));
  const day = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  if (firm.gstRegistration === "regular")
    return [
      { form: "GSTR-1", due: day(11), period: prev },
      { form: "GSTR-3B", due: day(20), period: prev },
    ];
  if (
    firm.gstRegistration === "composition" &&
    ["01", "04", "07", "10"].includes(month.slice(5))
  )
    return [{ form: "CMP-08", due: day(18), period: prev }];
  return [];
}

export function buildNotices(input: {
  firm: Firm;
  parties: Party[];
  items: Item[];
  vouchers: Voucher[];
  reminders: ReminderDue[];
  lastBackupAt?: string;
  today: ISODate;
}): Notice[] {
  const { parties, items, vouchers, reminders, today } = input;
  const out: Notice[] = [];

  if (reminders.length > 0)
    out.push({
      id: `reminders:${today}:${reminders.length}`,
      kind: "reminders",
      title: `${reminders.length} payment reminder${reminders.length > 1 ? "s" : ""} to send today`,
      body:
        reminders
          .slice(0, 3)
          .map((r) => r.partyName)
          .join(", ") +
        (reminders.length > 3 ? ` and ${reminders.length - 3} more` : ""),
      date: today,
      tone: "warn",
      link: { screen: "reminders" },
    });

  // Filing deadlines are intentionally omitted: the app provides book reports only.

  for (const p of parties) {
    const bills = openBills(collectionBills(p, vouchers, today));
    if (bills.length === 0) continue;
    const pending = bills.reduce((s, b) => s + b.pending, 0);
    const late = Math.max(...bills.map((b) => b.overdueDays));
    if (p.type === "customer" && late > 0)
      out.push({
        id: `overdue:${p.id}:${pending}`,
        kind: "overdue",
        title: `${p.name} owes ${formatINR(pending)}`,
        body: `Oldest bill is ${late} day${late > 1 ? "s" : ""} overdue.`,
        date: today,
        tone: late > 30 ? "give" : "warn",
        link: { screen: "party", id: p.id },
      });
    if (p.type === "supplier") {
      const soon = bills.filter((b) => daysBetween(today, b.dueDate) <= 7);
      if (soon.length === 0) continue;
      const amount = soon.reduce((s, b) => s + b.pending, 0);
      const first = soon[0];
      const left = daysBetween(today, first.dueDate);
      out.push({
        id: `payable:${p.id}:${amount}`,
        kind: "payable",
        title: `Pay ${p.name} ${formatINR(amount)}`,
        body:
          left < 0
            ? `${first.number} was due ${-left} day${left < -1 ? "s" : ""} ago.`
            : left === 0
              ? `${first.number} is due today.`
              : `${first.number} is due on ${formatDate(first.dueDate)}.`,
        date: today,
        tone: left < 0 ? "give" : "ink",
        link: { screen: "party", id: p.id },
      });
    }
  }

  for (const item of items) {
    const qty = stockQty(item, vouchers);
    if (!isLowStock(item, qty)) continue;
    out.push({
      id: `low:${item.id}:${qty}`,
      kind: "low-stock",
      title: `${item.name} is running low`,
      body: `${qty} ${item.unit} left; reorder level is ${item.reorderLevel}.`,
      date: today,
      tone: qty <= 0 ? "give" : "warn",
      link: { screen: "item", id: item.id },
    });
  }

  for (const v of vouchers) {
    if (v.type !== "estimate" || !v.validUntil) continue;
    if (orderStatus(v, today) !== "open") continue;
    const left = daysBetween(today, v.validUntil);
    if (left > 3) continue;
    const party = parties.find((p) => p.id === v.partyId);
    out.push({
      id: `estimate:${v.id}`,
      kind: "estimate",
      title: `Estimate ${v.number} expires ${left === 0 ? "today" : `in ${left} day${left > 1 ? "s" : ""}`}`,
      body: `${party?.name ?? ""} · ${formatINR(v.amount)}. Follow up or turn it into a bill.`,
      date: today,
      tone: "ink",
      link: { screen: "voucher", id: v.id },
    });
  }

  const backupAge = input.lastBackupAt
    ? daysBetween(input.lastBackupAt.slice(0, 10), today)
    : Infinity;
  if (backupAge > 7)
    out.push({
      id: `backup:${input.lastBackupAt ?? "never"}`,
      kind: "backup",
      title: input.lastBackupAt
        ? `Last backup was ${backupAge} days ago`
        : "Your books have never been backed up",
      body: "Save a backup file to keep your data safe.",
      date: today,
      tone: "ink",
      link: { screen: "backup" },
    });

  return out;
}
