/**
 * Item variants (doc 37, T35): a parent item with attributes (Size: S/M/L,
 * Colour: Red/Blue) generates child items, one per combination. Each child
 * is an ordinary item (own code, price, stock, FIFO lots, GST) that keeps its
 * parent's id for grouping in pickers and reports. The parent is a template:
 * it holds no stock and is never billed.
 */
import { newId, type Db } from "./books/base";
import type { ID, Item, VariantAttribute, VariantValue } from "./types";

export const MAX_VARIANT_ATTRIBUTES = 3;
export const MAX_VARIANT_VALUES = 20;
export const MAX_VARIANTS = 100;

export const isVariantParent = (item: Pick<Item, "variantAttributes">) =>
  !!item.variantAttributes?.length;

/** Trimmed attributes with blank and repeated values dropped. */
export function cleanVariantAttributes(
  attributes: VariantAttribute[],
): VariantAttribute[] {
  return attributes
    .map((a) => {
      const seen = new Set<string>();
      return {
        name: a.name.trim(),
        values: a.values
          .map((v) => v.trim())
          .filter((v) => {
            const key = v.toLowerCase();
            if (!v || seen.has(key)) return false;
            seen.add(key);
            return true;
          }),
      };
    })
    .filter((a) => a.name || a.values.length);
}

/** Every combination, in the attributes' order: S/Red, S/Blue, M/Red … */
export function variantCombinations(
  attributes: VariantAttribute[],
): VariantValue[][] {
  return attributes.reduce<VariantValue[][]>(
    (combos, a) =>
      combos.flatMap((c) =>
        a.values.map((value) => [...c, { name: a.name, value }]),
      ),
    [[]],
  );
}

/** Problem with the attributes, or null. Existing attributes and values can't be removed. */
export function checkVariantAttributes(
  attributes: VariantAttribute[],
  current?: VariantAttribute[],
): string | null {
  if (!attributes.length) return "Add an attribute, e.g. Size.";
  if (attributes.length > MAX_VARIANT_ATTRIBUTES)
    return `Use up to ${MAX_VARIANT_ATTRIBUTES} attributes.`;
  const names = new Set<string>();
  for (const a of attributes) {
    if (!a.name) return "Name each attribute, e.g. Size or Colour.";
    if (a.name.length > 20) return "Keep attribute names to 20 characters.";
    if (names.has(a.name.toLowerCase())) return `${a.name} is there twice.`;
    names.add(a.name.toLowerCase());
    if (!a.values.length) return `Add the values of ${a.name}, e.g. S, M, L.`;
    if (a.values.length > MAX_VARIANT_VALUES)
      return `Use up to ${MAX_VARIANT_VALUES} values for ${a.name}.`;
    if (a.values.some((v) => v.length > 20 || /[/–]/.test(v)))
      return `Keep each value of ${a.name} short (20 characters, no / or –).`;
  }
  if (variantCombinations(attributes).length > MAX_VARIANTS)
    return `That makes more than ${MAX_VARIANTS} variants.`;
  if (current?.length) {
    if (
      current.length !== attributes.length ||
      current.some((c, i) => c.name !== attributes[i]?.name)
    )
      return "The attributes can't change once variants exist; add values instead.";
    for (const [i, c] of current.entries())
      for (const v of c.values)
        if (!attributes[i]?.values.includes(v))
          return `${c.name} ${v} already has a variant, so it stays.`;
  }
  return null;
}

/** e.g. "Cotton Shirt – M / Red". */
export const variantName = (parentName: string, values: VariantValue[]) =>
  `${parentName} – ${values.map((v) => v.value).join(" / ")}`;

/** e.g. "SHIRT-M-RED" from the parent's code; "" when the parent has none. */
export function variantCode(parentCode: string, values: VariantValue[]) {
  if (!parentCode) return "";
  return [
    parentCode,
    ...values.map((v) => v.value.toUpperCase().replace(/[^A-Z0-9]/g, "")),
  ]
    .join("-")
    .slice(0, 40);
}

const keyOf = (values: VariantValue[]) =>
  values
    .map((v) => `${v.name.toLowerCase()}=${v.value.toLowerCase()}`)
    .join("|");

/** The combinations that have no child item yet. */
export function missingVariants(
  attributes: VariantAttribute[],
  children: Pick<Item, "variantValues">[],
): VariantValue[][] {
  const have = new Set(children.map((c) => keyOf(c.variantValues ?? [])));
  return variantCombinations(attributes).filter((c) => !have.has(keyOf(c)));
}

/** A new child item: the parent's details, its own name and code, no stock yet. */
export function variantItem(
  parent: Item,
  values: VariantValue[],
): Omit<Item, "id"> {
  const {
    id: _id,
    version: _version,
    variantAttributes: _attrs,
    openingLots: _lots,
    batch: _batch,
    customFields: _custom,
    ...rest
  } = parent;
  return {
    ...rest,
    name: variantName(parent.name, values),
    code: variantCode(parent.code, values),
    openingStock: 0,
    openingCost: undefined,
    reorderLevel: 0,
    parentId: parent.id,
    variantValues: values,
  };
}

/** Bills, orders and challans never carry a variant parent; pick a variant. */
export function assertNoVariantParents(items: Item[], lines: { itemId: ID }[]) {
  for (const line of lines) {
    const item = items.find((i) => i.id === line.itemId);
    if (item && isVariantParent(item))
      throw new Error(
        `${item.name} has variants; pick its size, colour or other variant.`,
      );
  }
}

/** For reports: the item a row is grouped under (its parent, else itself). */
export function reportItemOf(items: Item[], itemId: ID): Item | undefined {
  const item = items.find((i) => i.id === itemId);
  if (!item?.parentId) return item;
  return items.find((i) => i.id === item.parentId) ?? item;
}

/**
 * In-app demo of POST /items/:id/variants: set the parent's attributes and
 * add a child item for each new combination. The API applies the same rules.
 */
export function makeVariants(
  db: Db,
  parentId: ID,
  input: VariantAttribute[],
): { parent: Item; created: Item[] } {
  const parent = db.items.find((i) => i.id === parentId);
  if (!parent) throw new Error("Item not found");
  if (parent.parentId) throw new Error("A variant can't have variants.");
  const attributes = cleanVariantAttributes(input);
  const problem = checkVariantAttributes(attributes, parent.variantAttributes);
  if (problem) throw new Error(problem);
  if (
    !isVariantParent(parent) &&
    (parent.openingStock > 0 ||
      db.vouchers.some((v) => v.lines?.some((l) => l.itemId === parentId)))
  )
    throw new Error(
      "This item already has stock or entries; make a new item for the variants.",
    );
  const children = db.items.filter((i) => i.parentId === parentId);
  const created: Item[] = [];
  for (const values of missingVariants(attributes, children)) {
    const child: Item = { id: newId("i"), ...variantItem(parent, values) };
    const clash = db.items.find(
      (i) =>
        i.name.toLowerCase() === child.name.toLowerCase() ||
        (child.code && i.code === child.code),
    );
    if (clash) throw new Error(`${clash.name} already exists.`);
    created.push(child);
  }
  parent.variantAttributes = attributes;
  parent.openingStock = 0;
  db.items.push(...created);
  return { parent, created };
}
