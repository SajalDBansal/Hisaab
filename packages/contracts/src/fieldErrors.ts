import type { z } from "zod";

/**
 * Turns a failed parse into one message per field, the same shape the server
 * sends in `error.fields`: { "lines.0.qty": "Quantity must be more than 0." }.
 * Forms use it to show the message under the right input.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "form";
    fields[path] ??= issue.message;
  }
  return fields;
}

/** Checks a value against a schema. Returns the field messages, or null when all is well. */
export function check<T extends z.ZodType>(
  schema: T,
  value: unknown,
): Record<string, string> | null {
  const result = schema.safeParse(value);
  return result.success ? null : fieldErrors(result.error);
}
