/**
 * Roles (doc 37, T57). The four built-in roles are fixed presets that behave
 * exactly as before; an owner can also make custom roles from a matrix of
 * module rights, per-voucher-type actions and a few extra rights.
 *
 * Custom role ids look like "r_<uuid>" and are unique across firms, so one
 * registry serves every firm: the API refreshes a role from the database on
 * each request, the app when it loads the firm. A role that isn't in the
 * registry has no rights at all (never more).
 */
import type { Permission } from "./permissions";
import type { VoucherType } from "./types";

export const BUILT_IN_ROLES = [
  "owner",
  "accountant",
  "sales",
  "viewer",
] as const;
export type BuiltInRole = (typeof BUILT_IN_ROLES)[number];
export type CustomRoleId = `r_${string}`;

export const isBuiltInRole = (role: string): role is BuiltInRole =>
  (BUILT_IN_ROLES as readonly string[]).includes(role);
export const isCustomRoleId = (role: string): role is CustomRoleId =>
  /^r_[0-9a-f-]{36}$/.test(role);

export type VoucherAction = "view" | "create" | "edit" | "cancel";
export const VOUCHER_ACTIONS: VoucherAction[] = [
  "view",
  "create",
  "edit",
  "cancel",
];

/** Rights beyond modules and voucher actions. */
export interface RoleFlags {
  /** Never see purchase prices, opening cost or lot/stock cost. */
  hidePurchaseRate: boolean;
  /** See profit margin while making a sale (when the firm turns it on). */
  viewProfitMargin: boolean;
  /** See and change only entries this user created. */
  ownRecordsOnly: boolean;
  /** See the IP address and device of each change in the edit log. */
  viewAudit: boolean;
  /** Put cancelled entries back. */
  restoreCancelled: boolean;
}

export interface RoleRights {
  permissions: Permission[];
  vouchers: Partial<Record<VoucherType, VoucherAction[]>>;
  flags: RoleFlags;
}

export interface RoleDefinition extends RoleRights {
  id: CustomRoleId;
  name: string;
  description: string;
  version: number;
}

/** The module each voucher type belongs to (who may change it, before roles). */
export const VOUCHER_MODULE: Record<VoucherType, Permission> = {
  sale: "sales",
  "credit-note": "sales",
  receipt: "sales",
  estimate: "sales",
  proforma: "sales",
  "sales-order": "sales",
  "delivery-note": "sales",
  purchase: "purchase",
  "debit-note": "purchase",
  payment: "purchase",
  expense: "purchase",
  "purchase-order": "purchase",
  contra: "payments",
  journal: "accounts",
};

export const ALL_VOUCHER_TYPES = Object.keys(VOUCHER_MODULE) as VoucherType[];

/** Sales staff read these without the reports right. */
const SALES_READ_TYPES: VoucherType[] = [
  "sale",
  "receipt",
  "credit-note",
  "estimate",
  "proforma",
  "sales-order",
  "delivery-note",
];

const ALL_PERMISSIONS: Permission[] = [
  "sales",
  "purchase",
  "payments",
  "accounts",
  "gst",
  "reports",
  "settings",
  "team",
];

const PRESET_PERMISSIONS: Record<BuiltInRole, Permission[]> = {
  owner: ALL_PERMISSIONS,
  accountant: [
    "sales",
    "purchase",
    "payments",
    "accounts",
    "gst",
    "reports",
    "settings",
  ],
  sales: ["sales"],
  viewer: ["reports"],
};

const NO_FLAGS: RoleFlags = {
  hidePurchaseRate: false,
  viewProfitMargin: false,
  ownRecordsOnly: false,
  viewAudit: false,
  restoreCancelled: false,
};

/** The built-in roles as rights, exactly matching how they worked before custom roles. */
export function presetRights(role: BuiltInRole): RoleRights {
  const permissions = PRESET_PERMISSIONS[role];
  const has = (p: Permission) => permissions.includes(p);
  const vouchers: Partial<Record<VoucherType, VoucherAction[]>> = {};
  for (const type of ALL_VOUCHER_TYPES) {
    const actions: VoucherAction[] = [];
    if (has("reports") || (has("sales") && SALES_READ_TYPES.includes(type)))
      actions.push("view");
    if (has(VOUCHER_MODULE[type])) actions.push("create", "edit", "cancel");
    if (actions.length) vouchers[type] = [...new Set(actions)];
  }
  return {
    permissions,
    vouchers,
    flags: {
      ...NO_FLAGS,
      // Sales staff never saw costs; every other preset did.
      hidePurchaseRate: role === "sales",
      viewProfitMargin: role !== "sales" && role !== "viewer",
      viewAudit: role === "owner",
      restoreCancelled: role === "owner",
    },
  };
}

const registry = new Map<string, RoleDefinition>();

/** Remember custom roles (the API per request, the app per firm). */
export function registerRoles(roles: Iterable<RoleDefinition>) {
  for (const role of roles) registry.set(role.id, role);
}

export function registeredRole(id: string): RoleDefinition | undefined {
  return registry.get(id);
}

const NONE: RoleRights = { permissions: [], vouchers: {}, flags: NO_FLAGS };

/** What a role may do: a preset, a registered custom role, or nothing. */
export function rightsOf(role: string | null | undefined): RoleRights {
  if (!role) return NONE;
  if (isBuiltInRole(role)) return presetRights(role);
  return registry.get(role) ?? NONE;
}

export function canVoucher(
  role: string | null | undefined,
  type: VoucherType,
  action: VoucherAction,
): boolean {
  return rightsOf(role).vouchers[type]?.includes(action) ?? false;
}

export const roleFlag = (
  role: string | null | undefined,
  flag: keyof RoleFlags,
) => rightsOf(role).flags[flag];

/**
 * Check a custom role's rights before saving: actions only on types whose
 * module is granted, editing needs viewing, and "only own records" can't be
 * combined with reports (those show everyone's totals) or with team rights.
 */
export function roleProblem(rights: RoleRights): string | null {
  for (const [type, actions] of Object.entries(rights.vouchers) as [
    VoucherType,
    VoucherAction[],
  ][]) {
    const changes = actions.filter((a) => a !== "view");
    if (changes.length && !rights.permissions.includes(VOUCHER_MODULE[type]))
      return `Give the ${VOUCHER_MODULE[type]} module to change ${type} entries.`;
    if (changes.length && !actions.includes("view"))
      return `A role that changes ${type} entries must also see them.`;
  }
  if (rights.flags.ownRecordsOnly && rights.permissions.includes("reports"))
    return "\"Only own records\" can't be combined with reports, which show everyone's figures.";
  if (rights.flags.ownRecordsOnly && rights.permissions.includes("team"))
    return '"Only own records" can\'t be combined with team management.';
  return null;
}
