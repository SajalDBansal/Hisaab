import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { can } from "@repo/core";
import { useAuth } from "../auth/AuthProvider";
import { REQUIRE_LOGIN } from "../auth/config";
import { useData } from "./DataProvider";
import { scopedKey } from "./firmSelection";
import { useServiceMutation, useServiceQuery } from "./scopedHooks";
import {
  createReportPreferences,
  type SavedReportFilter,
} from "./reportPreferences";
import { reportPreferencesStorage } from "./reportPreferencesStorage";

export function useReportPreferences(firmId: string) {
  const data = useData();
  const auth = useAuth();
  const cache = useQueryClient();
  const allowed =
    auth.status === "signedIn" &&
    !auth.locked &&
    !!data.role &&
    can(data.role, "reports") &&
    (!REQUIRE_LOGIN || data.firmId === firmId);
  const store = useMemo(
    () =>
      allowed
        ? createReportPreferences(reportPreferencesStorage, {
            userId: data.userId,
            firmId,
          })
        : null,
    [data.userId, firmId, allowed],
  );
  const currentStore = () => {
    if (!allowed || !store)
      throw new Error("Report access is required for this firm.");
    return store;
  };
  const queryKey = ["report-preferences", firmId];
  const query = useServiceQuery({
    queryKey,
    enabled: allowed,
    queryFn: () => currentStore().list(),
  });
  const invalidate = () =>
    cache.invalidateQueries({
      queryKey: scopedKey(data.userId, data.firmId, queryKey, data.accessKey),
    });
  const save = useServiceMutation({
    mutationFn: (_services, input: SavedReportFilter) =>
      currentStore().save(input),
    onSuccess: invalidate,
  });
  const remove = useServiceMutation({
    mutationFn: (_services, id: string) => currentStore().remove(id),
    onSuccess: invalidate,
  });
  return { query, save, remove, allowed };
}
