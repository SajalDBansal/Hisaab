import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Where the current request came from, for the voucher edit log (doc 37, T55).
 * The API opens a store for every request; authentication fills in the device.
 * Work outside a request (seeding, jobs, tests) has no store and records nulls.
 */
export interface RequestOrigin {
  ipAddress: string | null;
  device: string | null;
}

const store = new AsyncLocalStorage<RequestOrigin>();

export function runWithOrigin(origin: RequestOrigin, next: () => void) {
  store.run(origin, next);
}

/** The current request's origin, or nulls when there is none. */
export function currentOrigin(): RequestOrigin {
  return store.getStore() ?? { ipAddress: null, device: null };
}

/** Called once the session is known. */
export function setOriginDevice(device: string | null) {
  const origin = store.getStore();
  if (origin) origin.device = device;
}

/** A short label for the session's device: its name, else the kind of client. */
export function deviceLabel(session: {
  deviceName?: string | null;
  platform?: string | null;
}): string {
  const name = session.deviceName?.trim();
  const kind = session.platform === "web" ? "Web" : "App";
  return (
    name ? `${name} (${kind})` : kind === "Web" ? "Web browser" : "Phone app"
  ).slice(0, 100);
}
