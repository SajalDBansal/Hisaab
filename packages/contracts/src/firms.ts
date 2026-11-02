import { z } from "zod";
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

export const Firm = z.object({
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
});

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
  })
  .partial();

export type Firm = z.infer<typeof Firm>;
export type NewFirmInput = z.infer<typeof NewFirmInput>;
export type FirmUpdate = z.infer<typeof FirmUpdate>;

// ---- Who can do what in a firm -------------------------------------------

export const Role = z.enum(["owner", "accountant", "sales", "viewer"]);
/** Roles an owner can give to someone else. There is one owner per firm for now. */
export const AssignableRole = z.enum(["accountant", "sales", "viewer"]);
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

export const FirmListRow = Firm.extend({
  role: Role,
  parties: z.number().int(),
  vouchers: z.number().int(),
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

export const InviteInput = z.object({
  email: Email,
  role: AssignableRole,
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
