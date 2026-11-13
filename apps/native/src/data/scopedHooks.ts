import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  type QueryKey,
} from "@tanstack/react-query";
import type { PagedList } from "@repo/core";
import { useEffect, useRef } from "react";
import { associatePayloadForRead } from "@repo/core/src/accounting/associates";
import { useAuth } from "../auth/AuthProvider";
import { useData } from "./DataProvider";
import { scopedKey } from "./firmSelection";
import type { Services } from "./services";
import { createPendingForm } from "./pendingForm";

export function useServiceQuery<T>(options: {
  queryKey: QueryKey;
  queryFn: (services: Services) => Promise<T>;
  enabled?: boolean;
  staleTime?: number;
  refetchInterval?: number;
}) {
  const data = useData();
  const auth = useAuth();
  // Read at call time: a refetch right after going offline uses the offline services.
  const current = useRef(data);
  current.current = data;
  const account = options.queryKey[0] === "firms";
  return useQuery({
    ...options,
    networkMode: "always",
    queryKey: scopedKey(
      data.userId,
      data.firmId,
      options.queryKey,
      data.accessKey,
    ),
    enabled:
      auth.status === "signedIn" &&
      !auth.locked &&
      (account || !!data.firmId) &&
      options.enabled !== false,
    queryFn: async () =>
      associatePayloadForRead(
        current.current.role,
        await options.queryFn(current.current.services),
      ),
  });
}

/**
 * A list read a page at a time. `loadMore` asks for the next page and is safe
 * to call repeatedly (the screen calls it while scrolling). While filters
 * change, the previous rows stay on screen until the new first page arrives.
 */
export function useServicePages<T, S>(options: {
  queryKey: QueryKey;
  queryFn: (
    services: Services,
    cursor: string | undefined,
  ) => Promise<PagedList<T, S>>;
  enabled?: boolean;
}) {
  const data = useData();
  const auth = useAuth();
  // Read at call time: a refetch right after going offline uses the offline services.
  const current = useRef(data);
  current.current = data;
  const query = useInfiniteQuery({
    networkMode: "always",
    queryKey: scopedKey(
      data.userId,
      data.firmId,
      options.queryKey,
      data.accessKey,
    ),
    enabled:
      auth.status === "signedIn" &&
      !auth.locked &&
      !!data.firmId &&
      options.enabled !== false,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: PagedList<T, S>) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    queryFn: async ({ pageParam }) =>
      associatePayloadForRead(
        current.current.role,
        await options.queryFn(current.current.services, pageParam),
      ),
  });
  const pages = query.data?.pages ?? [];
  return {
    query,
    items: pages.flatMap((page) => page.items),
    summary: pages[0]?.summary,
    total: pages[0]?.total ?? 0,
    loadMore: () => {
      if (
        query.hasNextPage &&
        !query.isFetchingNextPage &&
        !query.isFetchNextPageError
      )
        void query.fetchNextPage();
    },
  };
}
export type ServicePages<T, S> = ReturnType<typeof useServicePages<T, S>>;

export function useServiceMutation<T, V = void>(options: {
  mutationFn: (services: Services, input: V) => Promise<T>;
  onSuccess?: () => unknown;
  changesFirm?: boolean;
}) {
  const { services, userId, firmId, accessKey, role } = useData();
  const auth = useAuth();
  const scope = JSON.stringify([
    userId,
    firmId,
    accessKey,
    auth.status,
    auth.locked,
  ]);
  const current = useRef(scope);
  const submit = useRef(createPendingForm());
  const mounted = useRef(true);
  current.current = scope;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useMutation({
    networkMode: "always",
    mutationKey: scopedKey(userId, firmId, ["mutation"], accessKey),
    mutationFn: async (input: V) => {
      if (
        auth.status !== "signedIn" ||
        auth.locked ||
        (!firmId && !options.changesFirm)
      )
        throw new Error("Sign in, unlock and select a firm before saving.");
      const result = await submit.current(() =>
        options.mutationFn(services, input),
      );
      // A save may finish after switching firms or roles; never display its old-scope result.
      if (
        !options.changesFirm &&
        (!mounted.current || current.current !== scope)
      )
        throw new Error(
          "The open firm or your access changed. Reload before continuing.",
        );
      return associatePayloadForRead(role, result);
    },
    onSuccess: options.onSuccess,
  });
}
