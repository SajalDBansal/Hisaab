import type { Href } from "expo-router";

interface Navigation {
  canGoBack(): boolean;
  back(): void;
  replace(href: Href): void;
}

/** Keep modal history, but give directly opened pages a valid destination. */
export function backOrReplace(router: Navigation, fallback: Href = "/") {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
