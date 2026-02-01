import type { Permission } from "@repo/core";
import type { Href } from "expo-router";
import type { IconName } from "../components/Icon";

export interface CreateAction {
  label: string;
  icon: IconName;
  href: Href;
  permission: Permission;
  primary?: boolean;
}

const SECTIONS: { title: string; actions: CreateAction[] }[] = [
  {
    title: "Vouchers",
    actions: [
      {
        label: "Sale",
        icon: "file-text",
        href: "/sale/new",
        permission: "sales",
        primary: true,
      },
      {
        label: "Purchase",
        icon: "shopping-cart",
        href: "/purchase/new",
        permission: "purchase",
      },
      {
        label: "Receipt",
        icon: "arrow-down-left",
        href: "/receipt/new",
        permission: "sales",
      },
      {
        label: "Payment",
        icon: "arrow-up-right",
        href: "/payment/new",
        permission: "purchase",
      },
      {
        label: "Expense",
        icon: "credit-card",
        href: "/expense/new",
        permission: "purchase",
      },
      {
        label: "Contra",
        icon: "repeat",
        href: "/contra/new",
        permission: "payments",
      },
      {
        label: "Journal",
        icon: "book",
        href: "/journal/new",
        permission: "accounts",
      },
      {
        label: "Sales return",
        icon: "corner-up-left",
        href: "/note/new?kind=credit",
        permission: "sales",
      },
      {
        label: "Purchase return",
        icon: "corner-up-right",
        href: "/note/new?kind=debit",
        permission: "purchase",
      },
    ],
  },
  {
    title: "Accounts and documents",
    actions: [
      {
        label: "Settlement",
        icon: "repeat",
        href: "/settlements/new",
        permission: "accounts",
      },
      {
        label: "Associate",
        icon: "user",
        href: "/associates/new",
        permission: "accounts",
      },
      {
        label: "Stock adjustment",
        icon: "package",
        href: "/inventory/new",
        permission: "accounts",
      },
      {
        label: "Loan / capital",
        icon: "repeat",
        href: "/journal/financing",
        permission: "accounts",
      },
      {
        label: "New ledger",
        icon: "book-open",
        href: "/account/new",
        permission: "accounts",
      },
      {
        label: "Document",
        icon: "paperclip",
        href: "/documents/new",
        permission: "accounts",
      },
    ],
  },
  {
    title: "Orders and quotes",
    actions: [
      {
        label: "Estimate",
        icon: "clipboard",
        href: "/order/new?type=estimate",
        permission: "sales",
      },
      {
        label: "Sales Order",
        icon: "check-square",
        href: "/order/new?type=sales-order",
        permission: "sales",
      },
      {
        label: "Purchase Order",
        icon: "package",
        href: "/order/new?type=purchase-order",
        permission: "purchase",
      },
      {
        label: "Delivery Challan",
        icon: "truck",
        href: "/order/new?type=delivery-note",
        permission: "sales",
      },
    ],
  },
];

/** Match the server's write permissions and omit empty sections. */
export function createSections(permissions: readonly Permission[]) {
  return SECTIONS.map((section) => ({
    ...section,
    actions: section.actions.filter((action) =>
      permissions.includes(action.permission),
    ),
  })).filter((section) => section.actions.length > 0);
}
