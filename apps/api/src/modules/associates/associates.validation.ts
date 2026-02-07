import { z } from "zod";
import type {
  AssociateField,
  AssociateInput,
} from "@repo/contracts/src/associates";

/** Field definitions describe data only. No expressions or account keys are interpreted. */
export function validateAssociateFields(
  definitions: AssociateField[],
  values: AssociateInput["fields"],
) {
  const known = new Map(definitions.map((d) => [d.id, d]));
  for (const id of Object.keys(values)) {
    if (!known.has(id))
      throw new Error("A custom field does not belong to this firm.");
  }
  for (const field of definitions) {
    const value = values[field.id];
    if (value === undefined || value === "") {
      if (field.active && field.required)
        throw new Error(`${field.name} is required.`);
      continue;
    }
    const valid =
      field.kind === "checkbox"
        ? typeof value === "boolean"
        : field.kind === "decimal"
          ? typeof value === "number" && Number.isFinite(value)
          : field.kind === "date"
            ? z.iso.date().safeParse(value).success
            : field.kind === "choice"
              ? typeof value === "string" && field.choices.includes(value)
              : typeof value === "string" && value.length <= 1000;
    if (!valid) throw new Error(`${field.name} has an invalid value.`);
  }
}
