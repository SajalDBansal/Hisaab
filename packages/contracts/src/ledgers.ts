import { z } from "zod";
import { Id, Paise, requiredText } from "./common";

export const LedgerKind = z.enum(["cash", "bank"]);

/** A cash or bank account. */
export const LedgerInput = z.object({
  name: requiredText("Enter the account name."),
  kind: LedgerKind,
  shortName: requiredText("Enter a short name, like HDFC ··4521.", 30),
  openingBalance: Paise,
});

export const Ledger = LedgerInput.extend({
  id: Id,
  openingGstBalance: Paise.nullable()
    .transform((value) => value ?? undefined)
    .optional(),
});

export type LedgerInput = z.infer<typeof LedgerInput>;
export type Ledger = z.infer<typeof Ledger>;

/** A cash or bank account with its balance worked out from the books. */
export const LedgerRow = Ledger.extend({
  version: z.number().int(),
  balance: Paise,
});

export const LedgerListParams = z.object({ kind: LedgerKind.optional() });

export type LedgerRow = z.infer<typeof LedgerRow>;
