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

// ---------------------------------------------------------------------------
// Price lists (doc 37, T36)
// ---------------------------------------------------------------------------

export const PriceListRate = z.object({
  itemId: Id,
  rate: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  unit: z.string().min(1).max(20).optional(),
});

export const PriceListInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name the price list.")
    .max(60, "Use up to 60 characters."),
  side: z.enum(["sale", "purchase"]),
  mode: z.enum(["percent", "rates"]),
  percent: z.number().min(-100).max(1000).optional(),
  rates: z.array(PriceListRate).max(5000).default([]),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const PriceList = PriceListInput.extend({
  id: Id,
  version: z.number().int(),
});

export type PriceListInput = z.infer<typeof PriceListInput>;
export type PriceList = z.infer<typeof PriceList>;
