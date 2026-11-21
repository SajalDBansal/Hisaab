import type { Item } from "@repo/core";

type ExtrasRow = {
  kind: "goods" | "service";
  notForSale: boolean;
  tags: string[];
  maxStock: number | null;
};

/**
 * Item master extras and maximum stock (doc 37, T37/T39) as the core item keeps
 * them: absent when unset, so goods without them read exactly as before.
 */
export const itemExtras = (
  row: ExtrasRow,
): Pick<Item, "kind" | "notForSale" | "tags" | "maxStock"> => ({
  ...(row.kind === "service" ? { kind: "service" as const } : {}),
  ...(row.notForSale ? { notForSale: true } : {}),
  ...(row.tags?.length ? { tags: [...row.tags] } : {}),
  ...(row.maxStock ? { maxStock: row.maxStock } : {}),
});

/** Columns for an item save. */
export const itemExtraColumns = (
  i: Pick<Item, "kind" | "notForSale" | "tags" | "maxStock">,
) => ({
  kind: i.kind ?? "goods",
  notForSale: i.notForSale ?? false,
  tags: i.tags ?? [],
  maxStock: i.maxStock || null,
});
