import { useSyncExternalStore } from "react";
import type { TaxScope } from "@repo/core";
import { useData } from "./DataProvider";

const selections = new Map<string, TaxScope>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Keep report drill-downs in the same category without leaking it across firms or users. */
export function useReportScope(): [TaxScope, (scope: TaxScope) => void] {
  const { userId, firmId } = useData();
  const key = `${userId}:${firmId}`;
  const value = useSyncExternalStore(
    subscribe,
    () => selections.get(key) ?? "all",
    () => "all" as TaxScope,
  );
  return [
    value,
    (scope) => {
      selections.set(key, scope);
      listeners.forEach((listener) => listener());
    },
  ];
}
