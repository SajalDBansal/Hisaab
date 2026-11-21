import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  availableDashboardCards,
  resolveDashboardLayout,
  saveDashboardLayout,
  type DashboardCardSlot,
  type Role,
  type SavedDashboardLayout,
} from "@repo/core";
import { useData } from "./DataProvider";
import { dataStorage } from "./storage";

// Home card order and visibility (doc 37, T63), per user on this device for now.

const Stored = z.object({
  version: z.literal(1),
  order: z.array(z.string().max(60)).max(100),
  hidden: z.array(z.string().max(60)).max(100),
});

/** SecureStore keys allow only letters, digits, ".", "-" and "_". */
export const dashboardLayoutKey = (userId: string) =>
  `hisaab.dashboard.${userId.replace(/[^A-Za-z0-9._-]/g, "_")}`;

/** A damaged or unknown stored value falls back to the default layout. */
export function parseStoredLayout(
  raw: string | null,
): SavedDashboardLayout | null {
  if (!raw) return null;
  try {
    const parsed = Stored.safeParse(JSON.parse(raw));
    return parsed.success
      ? { order: parsed.data.order, hidden: parsed.data.hidden }
      : null;
  } catch {
    return null;
  }
}

export function useDashboardLayout(options: { canCreate?: boolean } = {}) {
  const { userId, role } = useData();
  const cache = useQueryClient();
  const queryKey = ["dashboard-layout", userId];
  const saved = useQuery({
    queryKey,
    queryFn: async () =>
      parseStoredLayout(await dataStorage.get(dashboardLayoutKey(userId))),
    staleTime: Infinity,
  });
  const available = availableDashboardCards(role as Role | null, options);
  const slots = resolveDashboardLayout(saved.data, available);
  const save = useMutation({
    mutationFn: async (next: DashboardCardSlot[] | null) => {
      const key = dashboardLayoutKey(userId);
      if (!next) {
        await dataStorage.remove(key);
        return null;
      }
      const layout = saveDashboardLayout(next);
      await dataStorage.set(key, JSON.stringify({ version: 1, ...layout }));
      return layout;
    },
    // Show the change at once; the device copy is written behind it.
    onMutate: (next) =>
      cache.setQueryData(queryKey, next ? saveDashboardLayout(next) : null),
  });
  return {
    /** Loaded (or nothing saved yet): render without waiting on storage errors. */
    ready: !saved.isPending,
    slots,
    /** Save a new order/visibility; null goes back to the default. */
    save: (next: DashboardCardSlot[] | null) => save.mutate(next),
    error: save.error,
  };
}
