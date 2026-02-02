import { can, type Role } from "@repo/core";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

type Membership = { id: string; role: Role };

// Reordering firms is harmless; changing a role or membership starts a fresh read scope.
export function membershipScope(firms: readonly Membership[] | undefined) {
  if (!firms) return "unverified";
  return JSON.stringify(
    [...firms]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, role }) => [id, role]),
  );
}

export function availableFirm(
  selected: string | null | undefined,
  restored: string | null | undefined,
  firms: readonly Membership[],
) {
  return (
    firms.find((firm) => firm.id === selected)?.id ??
    firms.find((firm) => firm.id === restored)?.id ??
    firms[0]?.id ??
    null
  );
}

export const canShowLedgerBalances = (role: Role | null) =>
  !!role && can(role, "reports");

// Cancel old reads before removing them, so late replies cannot refill a downgraded cache.
export async function clearPreviousBookAccess(
  cache: QueryClient,
  userId: string,
  accessKey: string,
) {
  const outdated = (key: QueryKey | undefined) =>
    key?.[0] === "books" && key[1] === userId && key[3] !== accessKey;
  const filters = {
    predicate: (query: { queryKey: QueryKey }) => outdated(query.queryKey),
  };
  const cancelled = cache.cancelQueries(filters);
  cache.removeQueries(filters);
  for (const mutation of cache.getMutationCache().getAll())
    if (outdated(mutation.options.mutationKey))
      cache.getMutationCache().remove(mutation);
  await cancelled;
}
