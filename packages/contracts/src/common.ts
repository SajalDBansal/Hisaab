import {
  GSTIN_PATTERN,
  PAN_PATTERN,
  hasStoredPrecision,
  MAX_QUANTITY,
} from "@repo/core";
import { z } from "zod";

// Building blocks used by every other file. Messages are written for a shop owner.

/** Ids are UUIDs (v7 from the server). */
export const Id = z.uuid("That id isn't valid.");

/** Whole paise: ₹12.50 is 1250. Never decimals. */
export const Paise = z
  .number("Enter an amount.")
  .int("Amounts are whole paise.")
  .safe();
export const PositivePaise = Paise.positive("Enter an amount more than 0.");
export const NonNegativePaise = Paise.min(0, "Can't be negative.");

export const Quantity = z
  .number()
  .min(-MAX_QUANTITY)
  .max(MAX_QUANTITY)
  .refine(hasStoredPrecision, "Use at most 3 decimal places.");
export const Percentage = z
  .number()
  .min(0)
  .max(100)
  .refine(hasStoredPrecision, "Use at most 3 decimal places.");

/** Business date, "2026-10-08". */
export const IsoDate = z.iso.date("Pick a date.");
/** A moment in time, "2026-10-08T10:15:00Z". */
export const IsoDateTime = z.iso.datetime({ offset: true });

export const StateCode = z
  .string("Pick the state.")
  .regex(/^\d{2}$/, "Pick the state (needed for CGST/SGST or IGST).");

export const Gstin = z
  .string()
  .regex(GSTIN_PATTERN, "GSTIN should be 15 characters, like 09AAAAA0000A1Z5.");
export const Pan = z
  .string()
  .regex(PAN_PATTERN, "PAN should be 10 characters, like AAAAA0000A.");

/** A 10-digit mobile number; spaces are allowed ("98370 45120"). */
export const Phone = z
  .string()
  .refine(
    (value) => /^\d{10}$/.test(value.replace(/\s/g, "")),
    "Enter a 10-digit mobile number.",
  );

export const Email = z
  .string()
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email.");

/** A required piece of text: trimmed, not empty. */
export const requiredText = (message: string, max = 200) =>
  z
    .string(message)
    .trim()
    .min(1, message)
    .max(max, `Keep it under ${max} characters.`);

export const GstRate = z.literal([0, 5, 18, 40], "Pick a GST rate.");

/** The reply for any failure (see roadmap, API conventions). */
export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z.record(z.string(), z.string()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

/** `?limit=50&cursor=...` on every list. */
export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

/** `{ items, nextCursor }`: nextCursor is null on the last page. */
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

/** Every firm-level request carries this header. */
export const FirmHeaders = z.object({ "x-firm-id": Id });

/** Create requests carry this header so a retry can't make a second bill. */
export const IdempotencyHeaders = z.object({
  "idempotency-key": z.string().min(8).max(100),
});

/** Updates carry the version they read, so two people editing at once is caught. */
export const IfMatchHeaders = z.object({
  "if-match": z.string().regex(/^\d+$/, "Missing version."),
});

export const IdParams = z.object({ id: Id });
