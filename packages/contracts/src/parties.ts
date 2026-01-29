import { z } from "zod";
import { ImportedOpeningBill, MAX_IMPORT_ROWS } from "./imports";
import {
  Gstin,
  Id,
  IsoDate,
  NonNegativePaise,
  Paise,
  Phone,
  StateCode,
  requiredText,
} from "./common";

export const PartyType = z.enum(["customer", "supplier"]);

/** What the party form sends. Duplicate names and GSTINs are checked by the server, since they need the other parties. */
export const PartyInput = z.object({
  name: requiredText("Enter the party name."),
  type: PartyType,
  phone: Phone.or(z.literal("")),
  city: z.string().max(100),
  stateCode: StateCode,
  gstin: Gstin.optional().or(z.literal("")),
  creditDays: z
    .number()
    .int("Credit days should be 0 to 365.")
    .min(0, "Credit days should be 0 to 365.")
    .max(365, "Credit days should be 0 to 365."),
  creditLimit: NonNegativePaise.describe("0 means no limit"),
  // Positive = they owe us, negative = we owe them
  openingBalance: Paise,
});

export const Party = PartyInput.extend({
  id: Id,
  openingGstBalance: Paise.nullable()
    .transform((value) => value ?? undefined)
    .optional(),
  openingDate: IsoDate,
  openingBills: z.array(ImportedOpeningBill).max(MAX_IMPORT_ROWS).optional(),
});

export const PartyListQuery = z.object({
  type: PartyType.optional(),
  search: z.string().max(100).optional(),
});

export type PartyInput = z.infer<typeof PartyInput>;
export type Party = z.infer<typeof Party>;

/** A party as the list and detail screens get it. `balance` is worked out from the books: positive = they owe us, negative = we owe them. */
export const PartyRow = Party.extend({
  version: z.number().int(),
  balance: Paise,
});

export const PartyListParams = PartyListQuery.extend({
  sort: z.enum(["name", "balance"]).default("name"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export type PartyRow = z.infer<typeof PartyRow>;
export type PartyListParams = z.infer<typeof PartyListParams>;
