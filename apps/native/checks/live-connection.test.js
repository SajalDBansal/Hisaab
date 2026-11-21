import assert from "node:assert/strict";
import { test } from "node:test";
import { LIVE_CLOSE } from "@repo/contracts";
import { createLiveConnection } from "../src/data/liveConnection.ts";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function harness(tickets) {
  const sockets = [];
  const messages = [];
  const states = [];
  let accessChanged = 0;
  let asked = 0;
  const live = createLiveConnection({
    platform: "web",
    device: "Chrome on Windows",
    random: () => 0,
    getTicket: async () => {
      const next = tickets[Math.min(asked++, tickets.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    },
    openSocket: (url) => {
      const socket = {
        url,
        readyState: 0,
        sent: [],
        closedWith: undefined,
        send(data) {
          this.sent.push(JSON.parse(data));
        },
        close(code) {
          this.closedWith = code;
          this.readyState = 3;
        },
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        // Test helpers: what the server would do.
        open() {
          this.readyState = 1;
          this.onopen?.();
        },
        receive(message) {
          this.onmessage?.({ data: JSON.stringify(message) });
        },
        drop(code) {
          this.readyState = 3;
          this.onclose?.({ code });
        },
      };
      sockets.push(socket);
      return socket;
    },
    onMessage: (message) => messages.push(message),
    onAccessChanged: () => accessChanged++,
    onState: (state) => states.push(state),
  });
  return {
    live,
    sockets,
    messages,
    states,
    asked: () => asked,
    accessChanged: () => accessChanged,
  };
}

const pass = {
  enabled: true,
  ticket: "pass",
  url: "ws://live.test/live",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
const ready = {
  type: "ready",
  firmId: "00000000-0000-4000-8000-000000000001",
  version: "7",
  beatMs: 25_000,
};

test("connects with a pass, says hello and passes notices on", async () => {
  const h = harness([pass]);
  h.live.start();
  await wait(0);
  const [socket] = h.sockets;
  assert.equal(socket.url, pass.url);
  socket.open();
  assert.deepEqual(socket.sent, [
    {
      type: "hello",
      ticket: "pass",
      platform: "web",
      device: "Chrome on Windows",
    },
  ]);
  socket.receive(ready);
  socket.receive({ type: "changed", version: "8" });
  socket.receive({ type: "nonsense" });
  assert.deepEqual(
    h.messages.map((m) => m.type),
    ["ready", "changed"],
  );
  assert.equal(h.states.at(-1), "live");
  h.live.stop();
  assert.equal(socket.closedWith, 1000);
});

test("reloads firms when access changes, then reconnects with a new pass", async () => {
  const h = harness([pass]);
  h.live.start();
  await wait(0);
  h.sockets[0].open();
  h.sockets[0].receive(ready);
  h.sockets[0].drop(LIVE_CLOSE.accessChanged);
  assert.equal(h.accessChanged(), 1);
  assert.equal(h.states.at(-1), "waiting");
  await wait(600);
  assert.equal(h.asked(), 2);
  assert.equal(h.sockets.length, 2);
  h.live.stop();
});

test("waits and retries when the pass can't be fetched", async () => {
  const h = harness([new Error("offline"), pass]);
  h.live.start();
  await wait(0);
  assert.equal(h.sockets.length, 0);
  await wait(600);
  assert.equal(h.sockets.length, 1);
  h.live.stop();
});

test("stays off when live updates aren't set up, and stop means stop", async () => {
  const off = harness([{ enabled: false }]);
  off.live.start();
  await wait(0);
  assert.equal(off.sockets.length, 0);
  assert.equal(off.states.at(-1), "waiting");
  off.live.stop();

  const h = harness([pass]);
  h.live.start();
  await wait(0);
  h.sockets[0].open();
  h.live.stop();
  h.sockets[0].drop(1006);
  await wait(600);
  assert.equal(h.sockets.length, 1);
});
