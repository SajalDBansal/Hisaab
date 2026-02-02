import type { DataStorage } from "./pendingWrites";

export const selectionKey = (userId: string) => `hisaab.firm.${userId}`;

/** Restore only a firm that the server still says this user belongs to. */
export async function restoreFirm(
  storage: DataStorage,
  userId: string,
  firms: { id: string }[],
) {
  const saved = await storage.get(selectionKey(userId));
  return firms.find((firm) => firm.id === saved)?.id ?? firms[0]?.id ?? null;
}

export function scopedKey(
  userId: string,
  firmId: string | null,
  key: readonly unknown[],
  accessKey = "legacy",
) {
  const account = key[0] === "firms" || key[0] === "prefs";
  return [
    "books",
    userId,
    account ? "account" : firmId,
    accessKey,
    ...key,
  ] as const;
}
