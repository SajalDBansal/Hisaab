import { z } from "zod";
import { Id, requiredText } from "./common";

/**
 * Custom fields on parties, items and voucher headers (doc 37, T07).
 * Values are keyed by the field's permanent `key`, not its row id, so they
 * survive a firm restore (which gives every row a new id) and stay readable in
 * frozen voucher snapshots.
 */
export const CustomFieldEntity = z.enum(["party", "item", "voucher"]);

/** Voucher types whose header can carry custom fields. */
export const CUSTOM_FIELD_VOUCHER_TYPES = [
  "sale",
  "purchase",
  "estimate",
  "proforma",
  "sales-order",
  "delivery-note",
  "purchase-order",
] as const;
export const CustomFieldVoucherType = z.enum(CUSTOM_FIELD_VOUCHER_TYPES);

export const CustomFieldKey = z.string().regex(/^cf_[a-z0-9]{10}$/);
export const CustomFieldValue = z.union([
  z.string().max(1000),
  z.number().finite(),
  z.boolean(),
]);
export const CustomFieldValues = z
  .record(CustomFieldKey, CustomFieldValue)
  .refine((v) => Object.keys(v).length <= 50, "Too many custom fields.");

/** What is stored per field (everything but the record it belongs to). */
const definitionShape = {
  name: requiredText("Name the field.", 60),
  kind: z.enum(["text", "decimal", "date", "checkbox", "choice"]),
  choices: z.array(requiredText("Enter a choice.", 100)).max(50).default([]),
  required: z.boolean().default(false),
  active: z.boolean().default(true),
  /** Print the value on voucher PDFs. */
  print: z.boolean().default(false),
  /** Voucher fields only: the types they appear on; empty means all of them. */
  voucherTypes: z.array(CustomFieldVoucherType).max(6).default([]),
};
/** The stored definition, as kept in the firm export. */
export const CustomFieldDefinition = z.strictObject(definitionShape);

export const CustomFieldInput = z
  .object({ entity: CustomFieldEntity, ...definitionShape })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.kind === "choice" &&
      (!v.choices.length || new Set(v.choices).size !== v.choices.length)
    )
      ctx.addIssue({
        code: "custom",
        path: ["choices"],
        message: "Give at least one choice, each once.",
      });
    if (v.kind !== "choice" && v.choices.length)
      ctx.addIssue({
        code: "custom",
        path: ["choices"],
        message: "Only choice fields have choices.",
      });
    if (v.entity !== "voucher" && v.voucherTypes.length)
      ctx.addIssue({
        code: "custom",
        path: ["voucherTypes"],
        message: "Only voucher fields pick voucher types.",
      });
  });

export const CustomField = CustomFieldInput.safeExtend({
  id: Id,
  key: CustomFieldKey,
  position: z.number().int().nonnegative(),
  version: z.number().int().positive(),
});

export type CustomFieldEntity = z.infer<typeof CustomFieldEntity>;
export type CustomFieldInput = z.infer<typeof CustomFieldInput>;
export type CustomField = z.infer<typeof CustomField>;
export type CustomFieldValues = z.infer<typeof CustomFieldValues>;
