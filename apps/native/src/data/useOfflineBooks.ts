import { useSyncExternalStore } from "react";
import { useData } from "./DataProvider";
import type { OfflineStatus } from "./offlineBooks";

const empty: OfflineStatus = {
  entries: [],
  online: true,
  syncing: false,
  error: "",
};
const snapshot = () => empty;
const subscribe = () => () => {};
export function useOfflineBooks() {
  const { offline } = useData();
  const status = useSyncExternalStore(
    offline?.subscribe ?? subscribe,
    offline?.getSnapshot ?? snapshot,
    snapshot,
  );
  return { books: offline, ...status };
}
