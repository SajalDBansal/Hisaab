import { useCallback, useState } from "react";
import { PAGE_SIZE } from "@repo/core";

/**
 * For lists that arrive in one answer (report tables, reconciliation): draw a
 * page of rows, and another each time the screen scrolls near the end. Pass
 * `more` to `Screen onEndReached` and slice rows with `count`.
 */
export function useReveal(step = PAGE_SIZE) {
  const [count, setCount] = useState(step);
  const more = useCallback(() => setCount((n) => n + step), [step]);
  const reset = useCallback(() => setCount(step), [step]);
  return { count, more, reset };
}
