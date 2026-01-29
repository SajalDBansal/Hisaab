import { buildNotices, type Notice } from "../accounting/notifications";
import { dueReminders, type ReminderDue } from "../accounting/reminders";
import { today } from "../dates";
import { markNoticesRead, markReminded, updateReminders } from "../mock/db";
import type { ReminderSettings } from "../types";
import { clone, delay, getDb } from "./client";

export interface NoticeRow extends Notice {
  read: boolean;
}

export interface NoticeList {
  notices: NoticeRow[];
  unread: number;
}

function reminderList(): ReminderDue[] {
  const db = getDb();
  return dueReminders(
    db.parties,
    db.vouchers,
    db.reminders,
    today(),
    db.remindedOn,
  );
}

export const notificationService = {
  /** Real API: http.get<NoticeList>("/notifications") */
  async list(): Promise<NoticeList> {
    await delay();
    const db = getDb();
    const read = new Set(db.readNotices);
    const notices = buildNotices({
      firm: db.firm,
      parties: db.parties,
      items: db.items,
      vouchers: db.vouchers,
      reminders: reminderList(),
      lastBackupAt: db.lastBackupAt,
      today: today(),
    }).map((n) => ({ ...n, read: read.has(n.id) }));
    return clone({ notices, unread: notices.filter((n) => !n.read).length });
  },

  /** Real API: http.post("/notifications/read", { ids }) */
  async markRead(ids: string[]): Promise<void> {
    await delay();
    markNoticesRead(getDb(), ids);
  },
};

export const reminderService = {
  /** Real API: http.get<ReminderSettings>("/settings/reminders") */
  async settings(): Promise<ReminderSettings> {
    await delay();
    return clone(getDb().reminders);
  },

  /** Real API: http.patch<ReminderSettings>("/settings/reminders", patch) */
  async update(patch: Partial<ReminderSettings>): Promise<ReminderSettings> {
    await delay();
    return clone(updateReminders(getDb(), patch));
  },

  /**
   * Customers to remind today under the current rules.
   * Real API: http.get<ReminderDue[]>("/reminders/due") — the server also sends them on a schedule.
   */
  async due(): Promise<ReminderDue[]> {
    await delay();
    return clone(reminderList());
  },

  /** Record that a reminder went out, so it isn't suggested again too soon. Real API: http.post(`/parties/${partyId}/reminders`, {}) */
  async markSent(partyId: string): Promise<void> {
    await delay();
    markReminded(getDb(), partyId, today());
  },
};
