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
