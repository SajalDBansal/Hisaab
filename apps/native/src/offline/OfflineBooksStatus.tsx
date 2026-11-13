import { router, usePathname } from "expo-router";
import { Button } from "@/components/Button";
import { useOfflineBooks } from "@/data/useOfflineBooks";
import { useData } from "@/data/DataProvider";
import { space } from "@/theme";

export function OfflineBooksStatus() {
  const { books, entries, online, cachedAt, error, quarantine } =
    useOfflineBooks();
  const path = usePathname();
  const { replica, offlineMode } = useData();
  if (offlineMode)
    return (
      <Button
        icon="wifi-off"
        size="sm"
        style={{ alignSelf: "center", margin: space.sm }}
        label="Offline - view only"
        onPress={() => router.push("/settings/offline-books")}
      />
    );
  // A new phone: the firm's books are being saved here for the first time.
  if (replica?.phase === "downloading")
    return (
      <Button
        icon="download"
        size="sm"
        style={{ alignSelf: "center", margin: space.sm }}
        label={`Downloading your firm's books… ${Math.round(replica.progress * 100)}%`}
        onPress={() => router.push("/settings/offline-books")}
      />
    );
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
