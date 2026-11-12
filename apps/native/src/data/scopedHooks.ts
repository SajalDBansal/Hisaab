import { useMutation, useQuery, type QueryKey } from "@tanstack/react-query";
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
      associatePayloadForRead(data.role, await options.queryFn(data.services)),
  });
}

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
