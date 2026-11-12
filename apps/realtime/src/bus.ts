import pg from "pg";
import {
  LIVE_CHANNEL,
  parseLiveEvent,
  type LiveEvent,
} from "@repo/backend/lib/live";

type Log = {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
};

/**
 * One dedicated PostgreSQL connection that LISTENs for live events. If it
 * drops, it reconnects with back-off and reports `restored`, because notices
 * sent while it was away are lost and every screen must refetch.
 */
export function listenLive(options: {
  databaseUrl: string;
  log: Log;
  onEvent: (event: LiveEvent) => void;
  onRestored: () => void;
}) {
  let client: pg.Client | undefined;
  let listening = false;
  let stopped = false;
  let everListened = false;
  let attempt = 0;
  let retry: NodeJS.Timeout | undefined;
  let probe: NodeJS.Timeout | undefined;

  const lost = (error?: unknown) => {
    if (!listening && client === undefined) return;
    listening = false;
    clearInterval(probe);
    const old = client;
    client = undefined;
    old?.removeAllListeners();
    old?.on("error", () => undefined);
    void old?.end().catch(() => undefined);
    if (stopped) return;
    options.log.warn({ err: error }, "Live event connection lost");
    const delay = Math.min(30_000, 500 * 2 ** attempt++);
    retry = setTimeout(() => void connect(), delay);
  };

  async function connect() {
    if (stopped) return;
    const next = new pg.Client({
      connectionString: options.databaseUrl,
      keepAlive: true,
      connectionTimeoutMillis: 5_000,
    });
    client = next;
    next.on("notification", (message) => {
      if (message.channel !== LIVE_CHANNEL) return;
      const event = parseLiveEvent(message.payload);
      if (event) options.onEvent(event);
    });
    next.on("error", lost);
    next.on("end", () => lost());
    try {
      await next.connect();
      await next.query(`LISTEN ${LIVE_CHANNEL}`);
    } catch (error) {
      if (client === next) lost(error);
      return;
    }
    if (stopped || client !== next) return;
    listening = true;
    attempt = 0;
    // A half-open TCP connection would otherwise go silently deaf.
    probe = setInterval(() => {
      next.query("select 1").catch(lost);
    }, 30_000);
    if (everListened) options.onRestored();
    everListened = true;
    options.log.info({}, "Listening for live events");
  }

  void connect();

  return {
    listening: () => listening,
    async close() {
      stopped = true;
      clearTimeout(retry);
      clearInterval(probe);
      listening = false;
      const old = client;
      client = undefined;
      old?.removeAllListeners();
      old?.on("error", () => undefined);
      await old?.end().catch(() => undefined);
    },
  };
}
