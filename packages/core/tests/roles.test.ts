import { describe, expect, test } from "bun:test";
import {
  ALL_VOUCHER_TYPES,
  BUILT_IN_ROLES,
  VOUCHER_MODULE,
  canVoucher,
  registerRoles,
  rightsOf,
  roleProblem,
  type RoleDefinition,
} from "../src/roles";
import {
  can,
  canSeeCosts,
  roleInfo,
  type Permission,
} from "../src/permissions";
import type { VoucherType } from "../src/types";

// What each role could do before custom roles (doc 33, unchanged in doc 37).
const BEFORE: Record<string, Permission[]> = {
  owner: [
    "sales",
    "purchase",
    "payments",
    "accounts",
    "gst",
    "reports",
    "settings",
    "team",
  ],
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
const ALL: Permission[] = BEFORE.owner;
// Proforma invoices (Phase 1) are sales documents like estimates.
const SALES_READ: VoucherType[] = [
  "sale",
  "receipt",
  "credit-note",
  "estimate",
  "proforma",
  "sales-order",
  "delivery-note",
];

describe("built-in roles behave exactly as before (doc 37, T57)", () => {
  for (const role of BUILT_IN_ROLES) {
    test(role, () => {
      for (const p of ALL) expect(can(role, p)).toBe(BEFORE[role].includes(p));
      expect(canSeeCosts(role)).toBe(
        BEFORE[role].includes("purchase") || BEFORE[role].includes("reports"),
      );
      for (const type of ALL_VOUCHER_TYPES) {
        const changes = BEFORE[role].includes(VOUCHER_MODULE[type]);
        for (const action of ["create", "edit", "cancel"] as const)
          expect(canVoucher(role, type, action)).toBe(changes);
        const reads =
          BEFORE[role].includes("reports") ||
          (BEFORE[role].includes("sales") && SALES_READ.includes(type));
        expect(canVoucher(role, type, "view")).toBe(reads);
      }
    });
  }
});

describe("custom roles", () => {
  const id = "r_0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" as const;
  const counter: RoleDefinition = {
    id,
    name: "Counter staff",
    description: "",
    version: 1,
    permissions: ["sales"],
    vouchers: { sale: ["view", "create"], receipt: ["view", "create"] },
    flags: {
      hidePurchaseRate: true,
      viewProfitMargin: false,
      ownRecordsOnly: true,
      viewAudit: false,
      restoreCancelled: false,
    },
  };

  test("an unknown custom role has no rights", () => {
    const stranger = "r_00000000-0000-7000-8000-000000000000";
    expect(rightsOf(stranger).permissions).toEqual([]);
    expect(can(stranger, "sales")).toBe(false);
    expect(canVoucher(stranger, "sale", "view")).toBe(false);
  });

  test("a registered role grants exactly its matrix", () => {
    registerRoles([counter]);
    expect(can(id, "sales")).toBe(true);
    expect(can(id, "reports")).toBe(false);
    expect(canVoucher(id, "sale", "create")).toBe(true);
    expect(canVoucher(id, "sale", "cancel")).toBe(false);
    expect(canVoucher(id, "credit-note", "view")).toBe(false);
    expect(canSeeCosts(id)).toBe(false);
    expect(roleInfo(id).label).toBe("Counter staff");
  });

  test("role checks refuse inconsistent matrices", () => {
    expect(roleProblem(counter)).toBeNull();
    expect(
      roleProblem({ ...counter, vouchers: { purchase: ["view", "create"] } }),
    ).toContain("purchase module");
    expect(
      roleProblem({ ...counter, vouchers: { sale: ["create"] } }),
    ).toContain("must also see");
    expect(
      roleProblem({ ...counter, permissions: ["sales", "reports"] }),
    ).toContain("Only own records");
  });
});
