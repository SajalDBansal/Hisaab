import { z } from "zod";
import {
  BUSINESS_TYPES,
  checkFirmStatutory,
  MSME_TYPES,
  OWNERSHIP_TYPES,
} from "@repo/core";
import {
  Email,
  Gstin,
  IsoDate,
  Pan,
  Phone,
  StateCode,
  requiredText,
} from "./common";
import { Id } from "./common";

export const GstRegistration = z.enum([
  "regular",
  "composition",
  "unregistered",
]);
export const CompositionType = z.enum(["trader", "restaurant", "services"]);
export const MsmeType = z.enum(MSME_TYPES);
export const OwnershipType = z.enum(OWNERSHIP_TYPES);
export const BusinessType = z.enum(BUSINESS_TYPES);

/** Optional statutory details (doc 37, T61), as stored and sent back. */
export const FirmStatutory = z.object({
  ownershipType: OwnershipType.optional(),
  businessType: BusinessType.optional(),
  industry: z.string().optional(),
  cin: z.string().optional(),
  tan: z.string().optional(),
  udyamNumber: z.string().optional(),
  msmeType: MsmeType.optional(),
  iec: z.string().optional(),
  fssai: z.string().optional(),
  drugLicence: z.string().optional(),
  website: z.string().optional(),
});

export const Firm = z
  .object({
    id: Id,
    name: z.string(),
    city: z.string(),
    state: z.string(),
    stateCode: StateCode,
    gstin: z.string(),
    gstRegistration: GstRegistration,
    compositionType: CompositionType.optional(),
    fyStart: IsoDate,
    address: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    pan: z.string().optional(),
  })
  .extend(FirmStatutory.shape);

/** GST rules shared by creating and editing a firm. */
const gstRules = (
  f: {
    gstRegistration?: string;
    gstin?: string;
    stateCode?: string;
    compositionType?: string;
  },
  ctx: z.RefinementCtx,
) => {
  const gstin = (f.gstin ?? "").trim().toUpperCase();
  if (f.gstRegistration === "unregistered") {
    if (gstin)
      ctx.addIssue({
        code: "custom",
        path: ["gstin"],
        message: "Leave GSTIN empty for a firm not registered under GST.",
      });
    return;
  }
  if (f.gstRegistration === undefined) return;
  if (!gstin)
    ctx.addIssue({
      code: "custom",
      path: ["gstin"],
      message: "Enter the GSTIN, or choose Not registered.",
    });
  else if (!Gstin.safeParse(gstin).success)
    ctx.addIssue({
      code: "custom",
      path: ["gstin"],
      message: "GSTIN should be 15 characters, like 09AAAAA0000A1Z0.",
    });
  else if (f.stateCode && gstin.slice(0, 2) !== f.stateCode)
    ctx.addIssue({
      code: "custom",
      path: ["gstin"],
      message: `GSTIN should start with the state code ${f.stateCode}.`,
    });
  if (f.gstRegistration === "composition" && !f.compositionType)
    ctx.addIssue({
      code: "custom",
      path: ["compositionType"],
      message: "Pick the business type for the composition rate.",
    });
};

/** Adding another firm. */
export const NewFirmInput = z
  .object({
    name: requiredText("Enter the firm name."),
    city: requiredText("Enter the city."),
    stateCode: StateCode,
    gstin: z.string().optional(),
    gstRegistration: GstRegistration,
    compositionType: CompositionType.optional(),
  })
  .superRefine(gstRules);

/** Firm profile edits: send only what changed. */
export const FirmUpdate = z
  .object({
    name: requiredText("Enter the firm name."),
    address: z.string().max(300),
    city: requiredText("Enter the city."),
    phone: Phone.or(z.literal("")),
    email: Email.or(z.literal("")),
    gstin: Gstin.or(z.literal("")),
    pan: Pan.or(z.literal("")),
    gstRegistration: GstRegistration,
    compositionType: CompositionType,
    // Statutory details (doc 37, T61): "" clears one. Shapes are checked below.
    ownershipType: OwnershipType.or(z.literal("")),
    businessType: BusinessType.or(z.literal("")),
    industry: z.string().max(100),
    cin: z.string().max(30),
    tan: z.string().max(20),
    udyamNumber: z.string().max(30),
    msmeType: MsmeType.or(z.literal("")),
    iec: z.string().max(20),
    fssai: z.string().max(20),
    drugLicence: z.string().max(100),
    website: z.string().max(100),
  })
  .partial()
  .superRefine((patch, ctx) => {
    // Only fields sent are checked here; the server checks the merged profile.
    const sent = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined && v !== ""),
    );
    const problems = checkFirmStatutory(sent);
    for (const [key, message] of Object.entries(problems))
      if (key in sent && message)
        ctx.addIssue({ code: "custom", path: [key], message });
  });

export type Firm = z.infer<typeof Firm>;
export type NewFirmInput = z.infer<typeof NewFirmInput>;
export type FirmUpdate = z.infer<typeof FirmUpdate>;

// ---- Who can do what in a firm -------------------------------------------

export const BuiltInRole = z.enum(["owner", "accountant", "sales", "viewer"]);
/** A custom role's id, "r_<uuid>" (doc 37, T57). */
export const CustomRoleId = z.custom<`r_${string}`>(
  (value) => typeof value === "string" && /^r_[0-9a-f-]{36}$/.test(value),
  "That role isn't valid.",
);
export const Role = z.union([BuiltInRole, CustomRoleId]);
/** Roles an owner can give to someone else: any but owner (one owner per firm). */
export const AssignableRole = z.union([
  z.enum(["accountant", "sales", "viewer"]),
  CustomRoleId,
]);
export const Permission = z.enum([
  "sales",
  "purchase",
  "payments",
  "accounts",
  "gst",
  "reports",
  "settings",
  "team",
]);

/** One row in "my firms". */
export const FirmSummary = z.object({
  id: Id,
  name: z.string(),
  city: z.string(),
  state: z.string(),
  gstin: z.string(),
  role: Role,
});

/** The open firm, with what the caller may do in it (the app hides the rest). */
export const FirmDetail = Firm.extend({
  role: Role,
  permissions: z.array(Permission),
});

/**
 * The caller's custom role in a firm (doc 37, T57), so the app knows its rights
 * offline and before any screen checks them. Voucher types are plain keys here
 * (vouchers.ts imports this file); the server builds this from validated roles.
 */
export const MyCustomRole = z.object({
  id: CustomRoleId,
  name: z.string(),
  description: z.string(),
  version: z.number().int(),
  rights: z.object({
    permissions: z.array(Permission),
    vouchers: z.record(
      z.string(),
      z.array(z.enum(["view", "create", "edit", "cancel"])),
    ),
    flags: z.object({
      hidePurchaseRate: z.boolean(),
      viewProfitMargin: z.boolean(),
      ownRecordsOnly: z.boolean(),
      viewAudit: z.boolean(),
      restoreCancelled: z.boolean(),
    }),
  }),
});

export const FirmListRow = Firm.extend({
  role: Role,
  parties: z.number().int(),
  vouchers: z.number().int(),
  customRole: MyCustomRole.optional(),
});

export const Member = z.object({
  id: Id,
  userId: Id,
  name: z.string(),
  email: z.string(),
  role: Role,
  joinedAt: z.string(),
});
export const MemberRoleInput = z.object({ role: AssignableRole });

/**
 * The owner hands the firm to another member. The owner's own new role is chosen
 * (accountant by default); the firm name is typed to confirm.
 */
export const TransferOwnershipInput = z.object({
  memberId: Id,
  previousOwnerRole: AssignableRole.default("accountant"),
  confirmName: z.string().trim().min(1, "Type the firm name to confirm."),
});
export type TransferOwnershipInput = z.infer<typeof TransferOwnershipInput>;

/** Invitations use a built-in role; the owner can move the person to a custom role after they join. */
export const InviteInput = z.object({
  email: Email,
  role: z.enum(["accountant", "sales", "viewer"]),
});
/** A pending invitation, as the owner sees it. */
export const Invitation = z.object({
  id: Id,
  email: z.string(),
  role: Role,
  expiresAt: z.string(),
  invitedAt: z.string(),
});
/** An invitation waiting for the logged-in person. */
export const MyInvitation = z.object({
  id: Id,
  firmName: z.string(),
  role: Role,
  invitedBy: z.string(),
  expiresAt: z.string(),
});
export const MemberParams = z.object({ memberId: Id });

export type Role = z.infer<typeof Role>;
export type Permission = z.infer<typeof Permission>;
export type FirmSummary = z.infer<typeof FirmSummary>;
export type FirmDetail = z.infer<typeof FirmDetail>;
export type Member = z.infer<typeof Member>;
export type InviteInput = z.infer<typeof InviteInput>;
export type Invitation = z.infer<typeof Invitation>;
export type MyInvitation = z.infer<typeof MyInvitation>;
