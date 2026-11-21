import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { createReplica, type Replica, type ReplicaState } from "@repo/core";
import type { Transport } from "@/data/client";
import { replicaStore, replicaSupported } from "./replicaStore";

/** Sync, then say whether the books moved. */
async function syncAndTell(
  current: Replica,
  tell?: (changed: boolean) => void,
) {
  const before = current.seq();
  await current.sync();
  tell?.(current.seq() !== before);
}

/** A sync every minute catches anything a missed live notice would leave behind. */
const SYNC_EVERY = 60_000;

/**
 * Keeps this firm's books on the phone in step with the server: opens the
 * saved copy, downloads it on a new phone, and syncs on open, on return to
 * the app, every minute and whenever `sync` is called (live notices, saves).
 */
export function useReplica(options: {
  enabled: boolean;
  userId: string;
  firmId: string | null;
  transport: Transport;
  /** After each successful sync; `changed` when new data arrived. */
  onSynced?: (changed: boolean) => void;
}) {
  const { enabled, userId, firmId, transport } = options;
  const onSynced = useRef(options.onSynced);
  onSynced.current = options.onSynced;
  const [state, setState] = useState<ReplicaState | null>(null);
  const replica = useRef<Replica | null>(null);

  useEffect(() => {
    if (!replicaSupported || !enabled || !firmId) {
      replica.current = null;
      setState(null);
      return;
    }
    const current = createReplica({
      firmId,
      storeKey: `${userId}:${firmId}`,
      store: replicaStore,
      // Straight to the server: the copy never reads the offline answer cache.
      get: (path) => transport(path, { headers: { "x-firm-id": firmId } }),
      onState: setState,
    });
    replica.current = current;
    const sync = () => void syncAndTell(current, onSynced.current).catch(() => undefined);
    void current
      .open()
      .then(sync)
      .catch(() => undefined);
    const timer = setInterval(sync, SYNC_EVERY);
    const appState = AppState.addEventListener("change", (s) => {
      if (s === "active") sync();
    });
    return () => {
      clearInterval(timer);
      appState.remove();
      if (replica.current === current) replica.current = null;
    };
  }, [enabled, userId, firmId, transport]);

  return {
    state,
    /** The books, once on the phone; null before the first download. */
    books: () => replica.current?.books() ?? null,
    sync: () => {
      const current = replica.current;
      if (current) void syncAndTell(current, onSynced.current).catch(() => undefined);
    },
    /**
     * Resolves once the phone holds the latest books (rejects if it can't
     * sync). `quiet`: the caller refreshes the screens itself.
     */
    syncNow: async (quiet = false) => {
      const current = replica.current;
      const tell = onSynced.current;
      if (current)
        await syncAndTell(current, quiet ? () => tell?.(false) : tell);
    },
  };
}
