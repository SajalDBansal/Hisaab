import { offlineStore } from "../data/offlineStore.web";
import { createWebSessionStore } from "./webSessionStore";

const channel =
  typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("hisaab-session-events-v1")
    : undefined;

export const sessionStore = createWebSessionStore(offlineStore, {
  broadcast: channel
    ? {
        publish: () => channel.postMessage("changed"),
        subscribe: (listener) =>
          channel.addEventListener("message", (event) => {
            if (event.data === "changed") listener();
          }),
      }
    : undefined,
});
