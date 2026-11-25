import { z } from "zod";
import { requiredText } from "./common";
import { BuiltInRole, CustomRoleId, Permission } from "./firms";
import { VoucherType } from "./vouchers";

/** Custom roles (doc 37, T57): module rights, per-voucher-type actions and extra rights. */
export const VoucherAction = z.enum(["view", "create", "edit", "cancel"]);

export const RoleFlags = z.strictObject({
  hidePurchaseRate: z.boolean(),
  viewProfitMargin: z.boolean(),
  ownRecordsOnly: z.boolean(),
  viewAudit: z.boolean(),
  restoreCancelled: z.boolean(),
  // Approvals (doc 37, T06); roles saved before it have none (= no).
  approveEntries: z.boolean().optional(),
});

export const RoleRights = z.strictObject({
  permissions: z.array(Permission).max(8),
  vouchers: z.partialRecord(VoucherType, z.array(VoucherAction).max(4)),
  flags: RoleFlags,
});

export const RoleInput = z.strictObject({
  name: requiredText("Name the role.", 60),
  description: z.string().max(200).default(""),
  rights: RoleRights,
});

export const CustomRole = RoleInput.extend({
  id: CustomRoleId,
  version: z.number().int().positive(),
  /** How many members have this role. */
  members: z.number().int().nonnegative(),
});

export const BuiltInRoleInfo = z.object({
  role: BuiltInRole,
  label: z.string(),
  note: z.string(),
  rights: RoleRights,
});

export const RolesView = z.object({
  builtIn: z.array(BuiltInRoleInfo),
  custom: z.array(CustomRole),
});

export type RoleInput = z.infer<typeof RoleInput>;
export type CustomRole = z.infer<typeof CustomRole>;
export type RolesView = z.infer<typeof RolesView>;
