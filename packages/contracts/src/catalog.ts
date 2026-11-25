import { z } from "zod";
import { Id } from "./common";

// ---------------------------------------------------------------------------
// Salespersons (doc 37, T10)
// ---------------------------------------------------------------------------

export const SalespersonInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter the salesperson's name.")
    .max(80, "Use up to 80 characters."),
  /** The firm member (login) this salesperson is; null = none. */
  userId: Id.nullable().optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s-]{0,20}$/, "Enter a phone number.")
    .optional(),
  active: z.boolean().default(true),
});

export const Salesperson = z.object({
  id: Id,
  name: z.string(),
  userId: Id.optional(),
  phone: z.string().optional(),
  active: z.boolean(),
  version: z.number().int(),
});

export const SalespersonList = z.object({
  rows: z.array(Salesperson),
  /** The caller's own active salesperson, the sales forms' default. */
  mine: Id.nullable(),
});

export type SalespersonInput = z.infer<typeof SalespersonInput>;
export type Salesperson = z.infer<typeof Salesperson>;
export type SalespersonList = z.infer<typeof SalespersonList>;
