/**
 * Who can do what. The real API must check the same rules on the server;
 * the app only uses them to hide buttons a person can't use.
 */
import type { Role } from "./types";

export type Permission =
  | "sales"
  | "purchase"
  | "payments"
  | "accounts"
  | "gst"
  | "reports"
  | "settings"
  | "team";

export const PERMISSIONS: { key: Permission; label: string }[] = [
  { key: "sales", label: "Sales and receipts" },
  { key: "purchase", label: "Purchases and payments" },
  { key: "payments", label: "Cash and bank balances" },
  { key: "accounts", label: "Journals, final accounts" },
  { key: "gst", label: "GST returns" },
  { key: "reports", label: "Reports" },
  { key: "settings", label: "Firm settings" },
  { key: "team", label: "Team and roles" },
];

export const ROLES: {
  role: Role;
  label: string;
  /** For narrow table headers. */
  short: string;
  note: string;
  can: Permission[];
}[] = [
  {
    role: "owner",
    short: "Owner",
    label: "Owner",
    note: "Everything, including team and settings",
    can: PERMISSIONS.map((p) => p.key),
  },
  {
    role: "accountant",
    short: "Acct.",
    label: "Accountant",
    note: "All books and GST, no team changes",
    can: [
      "sales",
      "purchase",
      "payments",
      "accounts",
      "gst",
      "reports",
      "settings",
    ],
  },
  {
    role: "sales",
    short: "Sales",
    label: "Sales staff",
    note: "Billing and collecting payments only",
    can: ["sales"],
  },
  {
    role: "viewer",
    short: "Viewer",
    label: "Viewer",
    note: "Can look at reports, can't change anything",
    can: ["reports"],
  },
];

export function roleInfo(role: Role) {
  return ROLES.find((r) => r.role === role)!;
}

export function can(role: Role, permission: Permission): boolean {
  return roleInfo(role).can.includes(permission);
}

/**
 * Purchase costs (purchase price, opening cost, lot and stock cost) are visible
 * to roles that buy or read the books: owner, accountant and viewer. Sales staff
 * bill at sale prices and never see what the goods cost.
 */
export const canSeeCosts = (role: Role | null | undefined): boolean =>
  !!role && (can(role, "purchase") || can(role, "reports"));

/** Cost fields on items, opening lots and voucher lines; zeroed rather than removed so contracts still parse. */
const COST_KEYS = new Set([
  "purchasePrice",
  "openingCost",
  "stockCost",
  "unitCost",
]);

/**
 * Blanks purchase costs in a response or cached answer for roles that may not see
 * them. A stock lot's carrying value goes too (identified by its lot fields), as
 * do the cost fields inside bills' frozen item copies.
 */
export function costPayloadForRead<T>(
  role: Role | null | undefined,
  payload: T,
): T {
  if (canSeeCosts(role)) return payload;
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      const items = value.map(visit);
      return items.some((item, index) => item !== value[index]) ? items : value;
    }
    if (
      !value ||
      typeof value !== "object" ||
      Object.getPrototypeOf(value) !== Object.prototype
    )
      return value;
    const row = value as Record<string, unknown>;
    const lot = "unitCost" in row && "minimumQty" in row && "bookScope" in row;
    let result = row;
    for (const [key, entry] of Object.entries(row)) {
      const hidden =
        (COST_KEYS.has(key) || (lot && key === "value")) &&
        typeof entry === "number";
      const visible = hidden ? 0 : visit(entry);
      if (visible !== entry) {
        if (result === row) result = { ...row };
        result[key] = visible;
      }
    }
    return result;
  };
  return visit(payload) as T;
}
