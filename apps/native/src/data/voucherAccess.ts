import { can, type Permission, type Role, type VoucherType } from "@repo/core";

const rights: Record<VoucherType, Permission> = {
  sale: "sales",
  receipt: "sales",
  "credit-note": "sales",
  estimate: "sales",
  "sales-order": "sales",
  "delivery-note": "sales",
  purchase: "purchase",
  payment: "purchase",
  expense: "purchase",
  "debit-note": "purchase",
  "purchase-order": "purchase",
  journal: "accounts",
  contra: "payments",
};

/** Reading a voucher never grants permission to edit it or record a payment. */
export const canManageVoucher = (role: Role | null, type?: VoucherType) =>
  !!role && !!type && can(role, rights[type]);
