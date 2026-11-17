/**
 * Custom fields on parties, items and voucher headers (doc 37, T07).
 * Values are keyed by the field's permanent key ("cf_…"), never by row id.
 */
import type { VoucherType } from "./types";

export type CustomFieldEntity = "party" | "item" | "voucher";
export type CustomFieldKind =
  "text" | "decimal" | "date" | "checkbox" | "choice";
export type CustomFieldValue = string | number | boolean;
export type CustomFieldValues = Record<string, CustomFieldValue>;

export interface CustomFieldDef {
  id: string;
  key: string;
  entity: CustomFieldEntity;
  name: string;
  kind: CustomFieldKind;
  choices: string[];
  required: boolean;
  active: boolean;
  print: boolean;
  /** Voucher fields: the types they appear on; empty means every supported type. */
  voucherTypes: VoucherType[];
  position: number;
  version: number;
}

export const CUSTOM_FIELD_VOUCHER_TYPES: VoucherType[] = [
  "sale",
  "purchase",
  "estimate",
  "sales-order",
  "delivery-note",
  "purchase-order",
];

/** The fields shown on a form: active ones for this entity (and voucher type), in order. */
export function fieldsFor(
  defs: CustomFieldDef[] | undefined,
  entity: CustomFieldEntity,
  voucherType?: VoucherType,
): CustomFieldDef[] {
  return (defs ?? [])
    .filter(
      (d) =>
        d.entity === entity &&
        d.active &&
        (entity !== "voucher" ||
          (voucherType !== undefined &&
            CUSTOM_FIELD_VOUCHER_TYPES.includes(voucherType) &&
            (!d.voucherTypes.length || d.voucherTypes.includes(voucherType)))),
    )
    .sort((a, b) => a.position - b.position);
}

/** A new field's permanent key. */
export function newCustomFieldKey(random: () => number = Math.random): string {
  let key = "cf_";
  while (key.length < 13) key += Math.floor(random() * 36).toString(36);
  return key;
}

/**
 * Check values against the firm's definitions and return them cleaned (empty
 * text dropped). Values of inactive fields are kept as they were; unknown keys
 * are refused. Throws with a message naming the field.
 */
export function checkCustomValues(
  defs: CustomFieldDef[] | undefined,
  entity: CustomFieldEntity,
  values: CustomFieldValues | undefined,
  voucherType?: VoucherType,
  /**
   * Enforce required fields. Forms send a value map and are checked; entries
   * made without one (order conversions, split sales, imports) are not, so a
   * newly required field can't break them.
   */
  enforceRequired = values !== undefined,
): CustomFieldValues {
  const all = (defs ?? []).filter((d) => d.entity === entity);
  const byKey = new Map(all.map((d) => [d.key, d]));
  const shown = new Set(fieldsFor(defs, entity, voucherType).map((d) => d.key));
  const out: CustomFieldValues = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    const def = byKey.get(key);
    if (!def) throw new Error("A custom field does not belong to this firm.");
    if (typeof value === "string" && !value.trim()) continue;
    const valid =
      def.kind === "checkbox"
        ? typeof value === "boolean"
        : def.kind === "decimal"
          ? typeof value === "number" && Number.isFinite(value)
          : def.kind === "date"
            ? typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
            : def.kind === "choice"
              ? typeof value === "string" && def.choices.includes(value)
              : typeof value === "string" && value.length <= 1000;
    if (!valid) throw new Error(`${def.name} has an invalid value.`);
    out[key] = typeof value === "string" ? value.trim() : value;
  }
  for (const def of all) {
    if (!enforceRequired) break;
    if (!shown.has(def.key) || !def.required || def.kind === "checkbox")
      continue;
    if (out[def.key] === undefined) throw new Error(`${def.name} is required.`);
  }
  return out;
}

/** Checked values to store: undefined when there are none. */
export function storedCustomValues(
  defs: CustomFieldDef[] | undefined,
  entity: CustomFieldEntity,
  values: CustomFieldValues | undefined,
  voucherType?: VoucherType,
): CustomFieldValues | undefined {
  const checked = checkCustomValues(defs, entity, values, voucherType);
  return Object.keys(checked).length ? checked : undefined;
}

/** "Yes"/"No", plain text, or the number as typed. */
export function formatCustomValue(value: CustomFieldValue | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
