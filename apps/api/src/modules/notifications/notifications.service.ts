import { buildNotices, dueReminders, today, type Role } from "@repo/core";
import type { NoticeList } from "@repo/contracts";
import type { Db } from "@repo/backend/db/client";
import { canReadBooks } from "../../lib/read-permissions";
import { notificationsRepo } from "@repo/backend/modules/notifications/notifications.repo";

export const notificationsService = {
  async list(
    db: Db,
    firmId: string,
    userId: string,
    role: Role,
  ): Promise<NoticeList> {
    const books = await notificationsRepo.books(db, firmId);
    const asOf = today();
    const reminders = dueReminders(
      books.parties,
      books.vouchers,
      books.reminders,
      asOf,
      books.remindedOn,
    );
    const read = await notificationsRepo.readKeys(db, firmId, userId);
    const notices = buildNotices({
      firm: books.firm,
      parties: books.parties,
      items: books.items,
      vouchers: books.vouchers,
      reminders,
      today: asOf,
    })
      .filter(
        (notice) =>
          canReadBooks(role) ||
          ["overdue", "reminders", "low-stock", "estimate"].includes(
            notice.kind,
          ),
      )
      .map((notice) => ({ ...notice, read: read.has(notice.id) }));
    return { notices, unread: notices.filter((notice) => !notice.read).length };
  },

  async markRead(db: Db, firmId: string, userId: string, ids: string[]) {
    await notificationsRepo.markRead(db, firmId, userId, ids);
  },
};
