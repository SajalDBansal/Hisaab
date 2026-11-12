import { useEffect } from "react";
import { AppState } from "react-native";
import type { QueryClient } from "@tanstack/react-query";
import { PLATFORM, deviceName } from "@/auth/device";
import type { Transport } from "./client";
import { createLiveConnection, type LiveSocket } from "./liveConnection";
import { subscribeOfflineReconnect } from "./offlineReconnect";

/** Refetches open screens when another person or device changes the books. */
export function useLiveUpdates(options: {
  enabled: boolean;
  userId: string;
  firmId: string | null;
  /** A new role means a new pass, so the connection restarts. */
  role: string | null;
  transport: Transport;
  cache: QueryClient;
}) {
  const { enabled, userId, firmId, role, transport, cache } = options;
  useEffect(() => {
    if (!enabled || !firmId) return;
    let seenVersion: string | undefined;
    let pending: ReturnType<typeof setTimeout> | undefined;
    // Several notices in a row cost one refetch; ETags make unchanged reads cheap.
    const refetchBooks = () => {
      clearTimeout(pending);
      pending = setTimeout(() => {
        void cache.invalidateQueries({ queryKey: ["books", userId, firmId] });
      }, 300);
    };
    const live = createLiveConnection({
      platform: PLATFORM,
      device: deviceName(),
      getTicket: () =>
        transport("/v1/live/ticket", {
          method: "POST",
          body: {},
          headers: { "x-firm-id": firmId },
        }),
      openSocket: (url) => new WebSocket(url) as unknown as LiveSocket,
      onAccessChanged: () =>
        void cache.invalidateQueries({ queryKey: ["firm-selection", userId] }),
      onMessage: (message) => {
        switch (message.type) {
          case "ready":
            // Catch up on anything missed while disconnected.
            if (message.version !== seenVersion) refetchBooks();
            seenVersion = message.version;
            break;
          case "changed":
            seenVersion = message.version;
            refetchBooks();
            break;
          case "resync":
            refetchBooks();
            break;
          case "presence":
            void cache.invalidateQueries({
              queryKey: ["books", userId, firmId],
              predicate: (query) => query.queryKey.includes("presence"),
            });
            break;
          case "access":
            void cache.invalidateQueries({
              queryKey: ["firm-selection", userId],
            });
            break;
          case "beat":
            break;
        }
      },
    });
    live.start();
    // Closed in the background so a phone doesn't keep a socket awake.
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        live.start();
        live.reconnectNow();
      } else if (state === "background") live.stop();
    });
    const unsubscribe = subscribeOfflineReconnect(() => live.reconnectNow());
    return () => {
      clearTimeout(pending);
      appState.remove();
      unsubscribe();
      live.stop();
    };
  }, [enabled, userId, firmId, role, transport, cache]);
}
