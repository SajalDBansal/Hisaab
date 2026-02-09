/**
 * Backup and restore of one firm's books as a single JSON file.
 * Cloud sync comes with the real API: the server will keep the books and every phone syncs.
 */
import type { Db } from "../mock/db";
import { clone, delay, getDb, restoreBooks } from "./client";

export const BACKUP_APP = "hisaab";
export const BACKUP_VERSION = 1;

export interface BackupFile {
  app: typeof BACKUP_APP;
  version: number;
  savedAt: string;
  firmName: string;
  books: Db;
}

export interface BackupStatus {
  lastBackupAt?: string;
  firmName: string;
  counts: {
    parties: number;
    items: number;
    vouchers: number;
    documents: number;
  };
}

/** What's inside a backup file, to show before restoring. */
export interface BackupSummary {
  firmName: string;
  savedAt: string;
  counts: BackupStatus["counts"];
}

const counts = (db: Db) => ({
  parties: db.parties.length,
  items: db.items.length,
  vouchers: db.vouchers.length,
  documents: db.documents.length,
});

/** Check a file really is a Hisaab backup before touching the books. */
export function readBackup(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file isn't a Hisaab backup.");
  }
  const f = data as Partial<BackupFile>;
  if (f?.app !== BACKUP_APP || typeof f.version !== "number")
    throw new Error("This file isn't a Hisaab backup.");
  if (f.version > BACKUP_VERSION)
    throw new Error(
      "This backup is from a newer version of the app. Update the app first.",
    );
  const b = f.books as Partial<Db> | undefined;
  const lists = ["parties", "items", "ledgers", "vouchers"] as const;
  if (!b?.firm?.id || !b.firm.name || lists.some((k) => !Array.isArray(b[k])))
    throw new Error("This backup file is damaged and can't be restored.");
  return f as BackupFile;
}

export function summarize(file: BackupFile): BackupSummary {
  return {
    firmName: file.books.firm.name,
    savedAt: file.savedAt,
    counts: counts(file.books),
  };
}

export const backupService = {
  /** Real API: http.get<BackupStatus>("/backup/status") */
  async status(): Promise<BackupStatus> {
    await delay();
    const db = getDb();
    return clone({
      lastBackupAt: db.lastBackupAt,
      firmName: db.firm.name,
      counts: counts(db),
    });
  },

  /**
   * The open firm's books as a backup file (JSON text) and a file name.
   * Real API: http.get("/backup/export") returns the same file.
   */
  async create(): Promise<{ fileName: string; text: string }> {
    await delay();
    const db = getDb();
    const savedAt = new Date().toISOString();
    db.lastBackupAt = savedAt;
    const file: BackupFile = {
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      savedAt,
      firmName: db.firm.name,
      books: db,
    };
    const safeName = db.firm.name
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    return {
      fileName: `Hisaab_${safeName}_${savedAt.slice(0, 10)}.json`,
      text: JSON.stringify(file),
    };
  },

  /** Look inside a backup file without restoring it. */
  async inspect(text: string): Promise<BackupSummary> {
    await delay();
    return summarize(readBackup(text));
  },

  /**
   * Replace that firm's books with the backup and open it.
   * Real API: http.post("/backup/restore", file)
   */
  async restore(text: string): Promise<BackupSummary> {
    await delay();
    const file = readBackup(text);
    const books = clone(file.books);
    // Fill settings that older backups may not have
    books.reminders ??= getDb().reminders;
    books.remindedOn ??= {};
    books.readNotices ??= [];
    books.documents ??= [];
    books.auditLog ??= [];
    restoreBooks(books);
    return summarize(file);
  },
};
