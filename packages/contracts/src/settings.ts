import { z } from "zod";
import { GstRate, Id, NonNegativePaise } from "./common";
import { Role } from "./firms";

export const GstMode = z.enum(["regular", "composition", "off"]);
export const InvoiceTemplate = z.enum(["classic", "modern", "compact"]);
/** Print-time layout: a template, or "compact-58" for 58 mm thermal rolls ("compact" is 80 mm). */
export const PrintLayout = z.enum([
  "classic",
  "modern",
  "compact",
  "compact-58",
]);

/** UPI QR on sale bills (doc 37, T18): the UPI id and the payee name UPI apps show. */
export const UpiQr = z.object({
  upiId: z
    .string()
    .trim()
    .regex(
      /^[\w.-]{2,256}@[A-Za-z0-9]{2,64}$/,
      "UPI id should look like name@bank.",
    ),
  payeeName: z.string().trim().min(1, "Enter the payee name.").max(60),
});

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

/** A charge the firm picks on bills: packing, insurance, loading (doc 37, T09). */
export const ChargeHead = z.object({
  id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,40}$/, "A charge head has an invalid id."),
  name: z.string().trim().min(1, "Name the charge.").max(60),
  taxType: z.enum(["taxable", "exempt", "nongst"]),
  gstRate: GstRate,
  sac: z.string().max(8).optional(),
  salesLedger: z.string().max(60).optional(),
  purchaseLedger: z.string().max(60).optional(),
  active: z.boolean(),
});
export type ChargeHead = z.infer<typeof ChargeHead>;

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
  chargeHeads: z.array(ChargeHead).max(30).optional(),
  // Retail bills (doc 37, T02): own series and thermal roll.
  retailPrefix: z
    .string()
    .regex(/^[A-Z0-9-]{1,4}$/, "Use 1 to 4 capital letters, digits or hyphens.")
    .optional(),
  retailPaper: z.enum(["58", "80"]).optional(),
  // UPI QR on sale bills (doc 37, T18); null turns it off.
  upiQr: UpiQr.nullable().optional(),
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
export type UpiQr = z.infer<typeof UpiQr>;
export type PrintLayout = z.infer<typeof PrintLayout>;
export type ReminderSettings = z.infer<typeof ReminderSettings>;

/** A small PNG or JPEG as a data URI, printed on documents (doc 37, T16). */
export const BrandingImage = z
  .string()
  .max(200_000, "Use an image under about 150 KB.")
  .regex(
    /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/,
    "Use a PNG or JPEG image.",
  );

/** Firm logo and the authorised signatory's signature or stamp. */
export const Branding = z.object({
  logo: BrandingImage.nullable(),
  signature: BrandingImage.nullable(),
});
export const BrandingView = Branding.extend({ version: z.number().int() });
/** Credit control (doc 37, T11): what overdue bills do to a new sale. */
export const OverdueSalesPolicy = z.enum(["off", "warn", "block"]);
/** Stock control (doc 37, T37): what the minimum stock level does to a new sale. */
export const StockPolicy = z.enum(["warn", "block"]);
export const SalesControls = z.object({
  overdueSales: OverdueSalesPolicy,
  // Optional: older apps send only the overdue policy; the saved one is kept.
  stockPolicy: StockPolicy.optional(),
  // Delivery challans move stock (doc 37, T04); applies to challans issued after it.
  challanStock: z.boolean().optional(),
});
export const SalesControlsView = SalesControls.extend({
  stockPolicy: StockPolicy,
  challanStock: z.boolean(),
  version: z.number().int(),
});
/**
 * Firm security (doc 37, T58). With requireTwoFactor on, members without
 * two-factor sign-in get TWO_FACTOR_REQUIRED (403) from the firm's routes.
 * Only the owner changes it, and only with two-factor on for themselves.
 */
export const FirmSecurity = z.object({ requireTwoFactor: z.boolean() });
export const FirmSecurityView = FirmSecurity.extend({
  version: z.number().int(),
});
export type FirmSecurity = z.infer<typeof FirmSecurity>;
export type FirmSecurityView = z.infer<typeof FirmSecurityView>;
export type SalesControls = z.infer<typeof SalesControls>;
export type SalesControlsView = z.infer<typeof SalesControlsView>;
export type Branding = z.infer<typeof Branding>;
export type BrandingView = z.infer<typeof BrandingView>;
