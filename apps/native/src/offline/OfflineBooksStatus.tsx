import { router, usePathname } from "expo-router";
import { Button } from "@/components/Button";
import { useOfflineBooks } from "@/data/useOfflineBooks";
import { space } from "@/theme";

export function OfflineBooksStatus() {
  const { books, entries, online, cachedAt, error, quarantine } =
    useOfflineBooks();
  const path = usePathname();
  const pending = entries.filter(
    (entry) =>
      !["committed", "cancelled", "superseded", "retained"].includes(
        entry.state,
      ),
  ).length;
  if (
    !books ||
    path === "/settings/offline-books" ||
    (!pending && online && !cachedAt && !error && !quarantine)
  )
    return null;
  return (
    <Button
      icon="refresh-cw"
      size="sm"
      style={{ alignSelf: "center", margin: space.sm }}
      label={
        quarantine
          ? "Review restored books"
          : pending
            ? `${pending} ${pending === 1 ? "entry" : "entries"} to review`
            : online
              ? "Review offline books"
              : "Offline - view only"
      }
      onPress={() => router.push("/settings/offline-books")}
    />
  );
}
