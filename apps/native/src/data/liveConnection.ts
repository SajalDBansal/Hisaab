import {
  LIVE_CLOSE,
  LiveServerMessage,
  LiveTicket,
  type LiveServerMessage as Message,
} from "@repo/contracts";

/** The parts of WebSocket this uses (browser, React Native and `ws` agree). */
export type LiveSocket = {
  readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
};

export type LiveState = "off" | "connecting" | "live" | "waiting";

const OPEN = 1;
const MIN_DELAY = 1_000;
const MAX_DELAY = 60_000;
/** Without live updates configured, ask again much later. */
const DISABLED_DELAY = 10 * 60_000;

/**
 * Keeps one live connection open for one firm, and reopens it after any drop
 * with back-off and jitter (1 s up to 60 s). It never carries data: messages
 * only tell the caller what to refetch.
 */
export function createLiveConnection(options: {
  /** POST /v1/live/ticket through the signed-in transport. */
  getTicket: () => Promise<unknown>;
  openSocket: (url: string) => LiveSocket;
  platform: "app" | "web";
  device: string;
  onMessage: (message: Message) => void;
  /** The server closed us because access changed: reload the firm list. */
  onAccessChanged: () => void;
  onState?: (state: LiveState) => void;
  random?: () => number;
}) {
  let socket: LiveSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let running = false;
  let generation = 0;
  const random = options.random ?? Math.random;
  const state = (next: LiveState) => options.onState?.(next);

  const backoff = () =>
    Math.min(MAX_DELAY, MIN_DELAY * 2 ** attempt++) * (0.5 + random() / 2);

  function schedule(delay: number) {
    clearTimeout(retry);
    if (!running) return;
    state("waiting");
    retry = setTimeout(() => void connect(), delay);
  }

  function drop() {
    clearTimeout(watchdog);
    const old = socket;
    socket = undefined;
    if (!old) return;
    old.onopen = old.onmessage = old.onclose = old.onerror = null;
    try {
      old.close(1000, "Closed by the app");
    } catch {
      /* Already closed. */
    }
  }

  async function connect() {
    if (!running) return;
    const mine = ++generation;
    drop();
    state("connecting");
    let pass: LiveTicket;
    try {
      pass = LiveTicket.parse(await options.getTicket());
    } catch {
      if (mine === generation) schedule(backoff());
      return;
    }
    if (mine !== generation || !running) return;
    if (!pass.enabled) {
      state("off");
      schedule(DISABLED_DELAY);
      return;
    }
    const ws = options.openSocket(pass.url);
    socket = ws;
    let beatMs = 30_000;
    // A silent connection (sleeping network, dead proxy) is treated as lost.
    const arm = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (socket === ws) {
          drop();
          schedule(backoff());
        }
      }, beatMs * 2.5);
    };
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "hello",
          ticket: pass.ticket,
          platform: options.platform,
          device: options.device.slice(0, 80),
        }),
      );
      arm();
    };
    ws.onmessage = (event) => {
      let message: Message;
      try {
        message = LiveServerMessage.parse(JSON.parse(String(event.data)));
      } catch {
        return;
      }
      if (message.type === "ready") {
        attempt = 0;
        beatMs = message.beatMs;
        state("live");
      }
      arm();
      options.onMessage(message);
    };
    ws.onerror = () => undefined;
    ws.onclose = ({ code }) => {
      if (socket !== ws) return;
      socket = undefined;
      clearTimeout(watchdog);
      if (code === LIVE_CLOSE.accessChanged) options.onAccessChanged();
      // Restarts reconnect quickly and spread out; everything else backs off.
      schedule(
        code === LIVE_CLOSE.restart ? MIN_DELAY + random() * 4_000 : backoff(),
      );
    };
  }

  return {
    start() {
      if (running) return;
      running = true;
      attempt = 0;
      void connect();
    },
    stop() {
      running = false;
      generation++;
      clearTimeout(retry);
      drop();
      state("off");
    },
    /** The network came back or the app returned to the foreground. */
    reconnectNow() {
      if (!running || socket?.readyState === OPEN) return;
      attempt = 0;
      void connect();
    },
  };
}
