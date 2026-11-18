import { can, PERMISSIONS, type Role } from "@repo/core";
import { demoServices, type Services } from "@/data/services";
import { OfflineWriteError } from "@/data/offlineOperation";

// Offline, screens read the books on the phone through the same core services
// the demo uses (the caller installs the books with setReplicaBooks). Nothing
// can be created or changed offline: every write is refused with the usual
// "you need to be online" message, before it touches anything.

const WRITE =
  /^(create|update|cancel|remove|delete|allocate|invite|transfer|mark|set|save|add|post|close|approve|restore|reverse|import|apply|record|upload|switchTo|send|convert|fulfil|clear|reset|confirm|attach|reconcile|enable|disable|move|split|link|unlink|reopen|change)/;

function readOnly<T extends object>(service: T): T {
  return new Proxy(service, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      if (typeof prop === "string" && WRITE.test(prop))
        return () => Promise.reject(new OfflineWriteError());
      return (value as (...args: unknown[]) => unknown).bind(target);
    },
  });
}

const needsConnection = () =>
  Promise.reject(new Error("This screen needs a connection."));

/** Every screen's reads, answered from the phone; writes refused. */
export function localServices(role: Role): Services {
  const services: Record<string, unknown> = {};
  for (const [name, service] of Object.entries(demoServices))
    services[name] = readOnly(service as object);
  // The open firm as the server describes it: with this user's role and rights.
  const firms = demoServices.firmService;
  services.firmService = readOnly({
    ...firms,
    getCurrent: async () => ({
      ...(await firms.getCurrent()),
      role,
      permissions: PERMISSIONS.map((p) => p.key).filter((key) =>
        can(role, key),
      ),
    }),
  });
  // Kept on the server only.
  services.bookControlService = {
    get: needsConnection,
    history: needsConnection,
    update: needsConnection,
    allocations: needsConnection,
    allocate: needsConnection,
    yearEnd: needsConnection,
    closeYear: needsConnection,
  };
  services.backupService = {
    ...readOnly(demoServices.backupService),
    previewRestore: needsConnection,
    restoreNewFirm: needsConnection,
    recovery: needsConnection,
  };
  return services as unknown as Services;
}

/** Book reads the phone answers, online or offline. */
const PHONE_READS: Record<string, string[]> = {
  partyService: ["list", "page", "get", "items", "itemRates"],
  itemService: ["lots", "list", "page", "get", "parties", "movementPage"],
  ledgerService: ["listCashAndBank", "statement", "statementPage"],
  voucherService: [
    "list",
    "get",
    "listInvoices",
    "listOrders",
    "page",
    "invoicePage",
    "orderPage",
    "returnable",
  ],
  accountService: [
    "list",
    "chart",
    "trialBalance",
    "finalAccounts",
    "statement",
    "statementPage",
    "pickable",
  ],
  reportService: [
    "dashboard",
    "outstanding",
    "tradeSummary",
    "expenses",
    "stock",
  ],
  gstService: ["months", "gstr1", "gstr1Json", "gstr3b", "compositionQuarters"],
  unitService: ["list"],
  settingsService: ["invoice"],
  firmService: ["getCurrent"],
};

/**
 * Saves wait here while the phone is offline or catching up after it
 * reconnects: an entry is made only once the phone shows the latest books.
 */
export interface SaveGate {
  /** Resolves when saving is allowed; rejects offline. */
  ready(): Promise<void>;
  /** After a save: bring the phone's books up to date (never throws). */
  saved(): Promise<void>;
}

function gatedSaves<T extends object>(service: T, gate: SaveGate): T {
  return new Proxy(service, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      const call = value as (...args: unknown[]) => unknown;
      if (typeof prop === "string" && WRITE.test(prop))
        return async (...args: unknown[]) => {
          await gate.ready();
          const result = await call.apply(target, args);
          // The screens refresh when the save returns; by then the phone
          // holds what was saved.
          await gate.saved();
          return result;
        };
      return call.bind(target);
    },
  });
}

/**
 * The firm's book screens read the phone (instant, the same online and
 * offline); numbering, documents, the edit log and every save go to the
 * server. The phone's books are updated from the server after each save.
 */
export function phoneFirstServices(
  remote: Services,
  role: Role,
  gate: SaveGate,
): Services {
  const local = localServices(role) as unknown as Record<string, object>;
  const services: Record<string, unknown> = {};
  for (const [name, service] of Object.entries(remote)) {
    if (!service || typeof service !== "object") {
      services[name] = service;
      continue;
    }
    const reads = PHONE_READS[name] ?? [];
    const phone = local[name] as Record<string, unknown> | undefined;
    const merged: Record<string, unknown> = { ...service };
    for (const method of reads)
      if (phone && typeof phone[method] === "function")
        merged[method] = phone[method];
    services[name] = gatedSaves(merged, gate);
  }
  return services as unknown as Services;
}
