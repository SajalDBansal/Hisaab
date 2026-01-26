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
