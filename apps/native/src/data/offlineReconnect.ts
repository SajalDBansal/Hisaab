/** Browsers signal connectivity immediately; native foreground retries remain in DataProvider. */
export function subscribeOfflineReconnect(listener: () => void) {
  // React Native also exposes window, but without DOM event methods.
  if (
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function" ||
    typeof window.removeEventListener !== "function"
  )
    return () => {};
  const target = window;
  target.addEventListener("online", listener);
  return () => target.removeEventListener("online", listener);
}
