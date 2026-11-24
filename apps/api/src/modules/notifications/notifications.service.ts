import {
  buildNotices,
  dueReminders,
  entryNotices,
  today,
  type Role,
} from "@repo/core";
import type { NoticeList } from "@repo/contracts";
import type { Db } from "@repo/backend/db/client";
import { canReadBooks } from "../../lib/read-permissions";
import { notificationsRepo } from "@repo/backend/modules/notifications/notifications.repo";
import { entriesService } from "../recurring/recurring.service";

export const notificationsService = {
  async list(
    db: Db,
    firmId: string,
    userId: string,
    role: Role,
    userName = "",
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
    // Recurring drafts to review and entries waiting for approval (doc 37, T03/T06).
    const pending = entryNotices({
      ...(await entriesService.notices(db, {
        id: userId,
        name: userName,
        firmId,
        role,
      })),
      today: asOf,
    });
    const notices = [
      ...pending,
      ...buildNotices({
        firm: books.firm,
        parties: books.parties,
        items: books.items,
        vouchers: books.vouchers,
        reminders,
        today: asOf,
      }),
    ]
      .filter(
        (notice) =>
          canReadBooks(role) ||
          ["overdue", "reminders", "low-stock", "estimate", "entries"].includes(
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
