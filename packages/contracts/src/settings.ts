import { z } from "zod";
import { Id, NonNegativePaise } from "./common";
import { Role } from "./firms";

export const GstMode = z.enum(["regular", "composition", "off"]);
export const InvoiceTemplate = z.enum(["classic", "modern", "compact"]);

export const BankAccount = z.object({
  accountName: z.string().min(1, "Enter the account name."),
  accountNumber: z
    .string()
    .regex(/^\d{6,20}$/, "Account number should be 6 to 20 digits."),
  ifsc: z
    .string()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC should look like HDFC0001234."),
  upiId: z
    .string()
    .regex(/^[\w.-]+@[\w]+$/, "UPI id should look like name@bank.")
    .optional(),
});

/** Voucher number prefixes, e.g. { sale: "SI" } gives SI/26-27/0001. */
const Prefix = z
  .string()
  .regex(/^[A-Z0-9-]{1,5}$/, "Use 1 to 5 capital letters, digits or hyphens.");

/** Number format for one voucher type; see NumberingRule in @repo/core. */
export const NumberingRule = z.strictObject({
  start: z
    .number()
    .int()
    .min(1, "Start from 1 or more.")
    .max(99_999_999, "Use a starting number up to 99,999,999."),
  digits: z
    .number()
    .int()
    .min(1, "Use 1 to 8 digits.")
    .max(8, "Use 1 to 8 digits."),
  showYear: z.boolean(),
});

export const InvoiceSettings = z.object({
  template: InvoiceTemplate,
  terms: z.string().max(1000),
  showBankDetails: z.boolean(),
  bankLedgerId: Id.or(z.literal("")),
  bankAccount: BankAccount.optional(),
  prefixes: z.record(z.string(), Prefix),
  billOfSupplyPrefix: Prefix,
  // Keyed by voucher type (core rejects unknown types; vouchers.ts imports this file).
  numbering: z.record(z.string(), NumberingRule),
});

export const InvoiceSettingsUpdate = InvoiceSettings.partial();
export const InvoiceSettingsView = InvoiceSettings.extend({
  bankName: z.string(),
});

export const TeamView = z.object({
  currentUserId: Id,
  members: z.array(
    z.object({
      id: Id,
      name: z.string(),
      phone: z.string(),
      email: z.string().optional(),
      role: Role,
      active: z.boolean(),
    }),
  ),
});

export const ReminderSettings = z.object({
  enabled: z.boolean(),
  daysBefore: z.number().int().min(0).max(30),
  onDueDate: z.boolean(),
  repeatEvery: z.number().int().min(0).max(60),
  minAmount: NonNegativePaise,
});

export type InvoiceSettings = z.infer<typeof InvoiceSettings>;
export type ReminderSettings = z.infer<typeof ReminderSettings>;
