import { FirmListRow, RecoveryEpoch } from "@repo/contracts";
import { serverRecovery } from "./recoveryEpoch";
import { z } from "zod";
import { offlineKey } from "./offlineOperation";
import type { OfflineStore } from "./offlineStore.types";

const Grant = z.object({
  verifiedAt: z.number(),
  rows: z.array(FirmListRow),
  recoveryEpoch: RecoveryEpoch.optional(),
});
export const offlineAccessMaxAge = 24 * 60 * 60 * 1000;
export const offlineLeaseActive = (expiresAt: number, now = Date.now()) =>
  now >= expiresAt - offlineAccessMaxAge && now < expiresAt;
export function createOfflineAccess(store: OfflineStore, now = Date.now) {
  const key = (userId: string) =>
    JSON.stringify(["offline-v1", userId, "memberships"]);
  async function restoreGrant(userId: string) {
    const value = await store.get(key(userId));
    if (!value)
      throw new Error(
        "Connect once to verify this account's firms before using offline books.",
      );
    const grant = Grant.parse(JSON.parse(value));
    // A successful newer server response revokes older offline memberships and balances.
    serverRecovery.restore(grant.recoveryEpoch);
    if (
      now() < grant.verifiedAt ||
      now() - grant.verifiedAt >= offlineAccessMaxAge
    )
      throw new Error(
        "Connect to verify access. The offline membership grant has expired.",
      );
    return { ...grant, expiresAt: grant.verifiedAt + offlineAccessMaxAge };
  }
  return {
    restoreGrant,
    async save(userId: string, rows: z.infer<typeof FirmListRow>[]) {
      return store.lock(key(userId), async () => {
        const previous = await store.get(key(userId));
        const old = previous ? Grant.parse(JSON.parse(previous)).rows : [];
        for (const firm of old)
          if (
            !rows.some((row) => row.id === firm.id && row.role === firm.role)
          ) {
            const cacheKey = offlineKey(
              { userId, firmId: firm.id, role: firm.role },
              "reads",
            );
            await store.lock(cacheKey, () => store.remove(cacheKey));
          }
        await store.set(
          key(userId),
          JSON.stringify({
            verifiedAt: now(),
            rows: z.array(FirmListRow).parse(rows),
            recoveryEpoch: serverRecovery.current(),
          }),
        );
      });
    },
    async restore(userId: string) {
      return (await restoreGrant(userId)).rows;
    },
  };
}
