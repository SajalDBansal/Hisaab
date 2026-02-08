import { router } from "expo-router";
import { Button } from "@/components";
import { useOfflineBooks } from "@/data/useOfflineBooks";

export function OfflineBooksStatus() {
  const { books, entries, online, cachedAt, error } = useOfflineBooks();
  const pending = entries.filter(
    (entry) => !["committed", "cancelled", "superseded"].includes(entry.state),
  ).length;
  if (!books || (!pending && online && !cachedAt && !error)) return null;
  return (
    <Button
      icon="refresh-cw"
      size="sm"
      label={
        pending
          ? `${pending} pending changes`
          : online
            ? "Offline books need attention"
            : "Offline books"
      }
      onPress={() => router.push("/settings/offline-books")}
    />
  );
}
