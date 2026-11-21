import { canVoucher, type Role, type VoucherType } from "@repo/core";

/**
 * Reading a voucher never grants permission to edit it or record a payment.
 * With an action, that action on this type; without one, any change (doc 37, T57:
 * built-in roles change exactly the types they could before).
 */
export const canManageVoucher = (
  role: Role | null,
  type?: VoucherType,
  action?: "create" | "edit" | "cancel",
) =>
  !!role &&
  !!type &&
  (action
    ? canVoucher(role, type, action)
    : (["create", "edit", "cancel"] as const).some((a) =>
        canVoucher(role, type, a),
      ));
