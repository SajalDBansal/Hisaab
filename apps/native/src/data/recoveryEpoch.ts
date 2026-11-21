import { RECOVERY_REQUIRED, RecoveryEpoch } from "@repo/contracts";
import { ApiFailure } from "../auth/apiFailure";

export const recoveryMessage =
  "The server was restored or moved to a different recovery point. Pending entries and attachments are kept. Review them in Offline books before sending more work. Logging in again does not resolve this.";
export const recoveryRequired = () =>
  new ApiFailure(409, RECOVERY_REQUIRED, recoveryMessage);

/** A response from an older in-flight request cannot rewind the generation learned from the server. */
export function createRecoveryEpoch() {
  let value: string | undefined;
  let revision = 0;
  const listeners = new Set<() => void>();
  const snapshot = () => ({ value, revision });
  function observe(raw: unknown, started = snapshot()) {
    const epoch = RecoveryEpoch.safeParse(raw);
    if (!epoch.success) throw recoveryRequired();
    if (started.revision !== revision && epoch.data !== value)
      throw recoveryRequired();
    if (value !== epoch.data) {
      value = epoch.data;
      revision++;
      listeners.forEach((listener) => listener());
    }
    return value;
  }
  return {
    snapshot,
    current: () => value,
    observe,
    restore(epoch?: string) {
      if (!epoch) return;
      if (value && value !== epoch) throw recoveryRequired();
      if (!value) observe(epoch);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const serverRecovery = createRecoveryEpoch();
export function assertRecoveryEpoch(epoch: string | undefined) {
  if (!epoch || epoch !== serverRecovery.current()) throw recoveryRequired();
}
