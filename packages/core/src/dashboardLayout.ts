/**
 * Home dashboard cards (doc 37, T63): which cards exist, their default order
 * and visibility, and how a person's saved choice is merged with them. The
 * choice is kept per user on the device for now (server later).
 *
 * To add a card: add it here (where it should sit by default), add its figures
 * to `DashboardData` (accounting/reports.ts and the contract), and give it a
 * renderer on the Home screen. A saved layout picks the new card up in its
 * default place. Expiring stock (lot expiry, built separately) is meant to be
 * added this way as `expiring-stock`, next to `low-stock`.
 */
import { canSeeCosts, can } from "./permissions";
import type { Role } from "./types";

export const DASHBOARD_CARD_IDS = [
  "balances",
  "actions",
  "cash",
  "bank",
  "today-sales",
  "month-sales",
  "gst",
  "low-stock",
  "itc-at-risk",
  "stock-value",
  "payables-due",
  "sales-chart",
  "cash-chart",
  "receivables-ageing",
  "top-customers",
  "top-suppliers",
  "quiet-customers",
  "open-orders",
  "overdue",
  "recent",
  "upcoming",
] as const;
export type DashboardCardId = (typeof DASHBOARD_CARD_IDS)[number];

export interface DashboardCardDefinition {
  title: string;
  note: string;
  /** Half-width figure cards sit two to a row. */
  size: "half" | "wide";
  /** Shown until the person hides it. */
  defaultVisible: boolean;
  /** Only for roles that may see purchase costs. */
  costs?: boolean;
  /** Only for roles that can make sales (quick actions). */
  sales?: boolean;
}

export const DASHBOARD_CARDS: Record<DashboardCardId, DashboardCardDefinition> =
  {
    balances: {
      title: "To collect and to pay",
      note: "What customers owe you and what you owe suppliers",
      size: "wide",
      defaultVisible: true,
    },
    actions: {
      title: "Quick actions",
      note: "New sale, receive payment, pay supplier…",
      size: "wide",
      defaultVisible: true,
      sales: true,
    },
    cash: {
      title: "Cash in hand",
      note: "Cash-in-hand ledger",
      size: "half",
      defaultVisible: true,
    },
    bank: {
      title: "Bank balances",
      note: "All bank accounts",
      size: "half",
      defaultVisible: true,
    },
    "today-sales": {
      title: "Today's sales",
      note: "Invoices made today, with GST",
      size: "half",
      defaultVisible: true,
    },
    "month-sales": {
      title: "This month's net sales",
      note: "Without GST, after returns",
      size: "half",
      defaultVisible: true,
    },
    gst: {
      title: "GST estimate",
      note: "Last month's GST (composition tax, or purchases without GST)",
      size: "half",
      defaultVisible: true,
    },
    "low-stock": {
      title: "Low stock",
      note: "Items at or below their reorder level",
      size: "half",
      defaultVisible: true,
    },
    "itc-at-risk": {
      title: "ITC at risk",
      note: "Unpaid supplier bills near the 180-day limit (regular GST)",
      size: "half",
      defaultVisible: true,
    },
    "stock-value": {
      title: "Stock value",
      note: "Closing stock at cost (FIFO)",
      size: "half",
      defaultVisible: true,
      costs: true,
    },
    "payables-due": {
      title: "Payables due",
      note: "Supplier bills due this week and overdue",
      size: "half",
      defaultVisible: false,
    },
    "sales-chart": {
      title: "Sales vs purchases",
      note: "Last 6 months",
      size: "wide",
      defaultVisible: true,
    },
    "cash-chart": {
      title: "Cash and bank balance",
      note: "Month-end balance, last 6 months",
      size: "wide",
      defaultVisible: true,
    },
    "receivables-ageing": {
      title: "Receivables by age",
      note: "What customers owe, by how old the bills are",
      size: "wide",
      defaultVisible: false,
    },
    "top-customers": {
      title: "Top customers this month",
      note: "Biggest buyers, after returns",
      size: "wide",
      defaultVisible: true,
    },
    "top-suppliers": {
      title: "Top suppliers this month",
      note: "Biggest purchases, after returns",
      size: "wide",
      defaultVisible: false,
    },
    "quiet-customers": {
      title: "Customers gone quiet",
      note: "No sale in the last 90 days",
      size: "wide",
      defaultVisible: false,
    },
    "open-orders": {
      title: "Open estimates and orders",
      note: "Estimates, proformas and orders not yet billed",
      size: "wide",
      defaultVisible: true,
    },
    overdue: {
      title: "Overdue customers",
      note: "Biggest overdue amounts, with reminders",
      size: "wide",
      defaultVisible: true,
    },
    recent: {
      title: "Recent transactions",
      note: "The last five entries",
      size: "wide",
      defaultVisible: true,
    },
    upcoming: {
      title: "Coming up",
      note: "GST returns and supplier bills due this week",
      size: "wide",
      defaultVisible: true,
    },
  };

/** What a person saved: every card they saw, in their order, and the ones they hid. */
export interface SavedDashboardLayout {
  order: string[];
  hidden: string[];
}

export interface DashboardCardSlot {
  id: DashboardCardId;
  visible: boolean;
}

const isCardId = (id: string): id is DashboardCardId =>
  (DASHBOARD_CARD_IDS as readonly string[]).includes(id);

/** Cards this role may have on its Home screen. */
export function availableDashboardCards(
  role: Role | null | undefined,
  options: { canCreate?: boolean } = {},
): DashboardCardId[] {
  return DASHBOARD_CARD_IDS.filter((id) => {
    const card = DASHBOARD_CARDS[id];
    if (card.costs && !canSeeCosts(role)) return false;
    if (card.sales && !(options.canCreate ?? can(role, "sales"))) return false;
    return true;
  });
}

/**
 * The cards to show, in order. Saved ids that no longer exist (or this role
 * may not have) are dropped; cards the saved layout doesn't know yet are put
 * in their default place (after the card before them by default) with their
 * default visibility.
 */
export function resolveDashboardLayout(
  saved: SavedDashboardLayout | null | undefined,
  available: readonly DashboardCardId[] = DASHBOARD_CARD_IDS,
): DashboardCardSlot[] {
  const allowed = new Set(available);
  if (!saved)
    return available.map((id) => ({
      id,
      visible: DASHBOARD_CARDS[id].defaultVisible,
    }));
  const hidden = new Set(saved.hidden);
  const order: DashboardCardId[] = [];
  for (const id of saved.order)
    if (isCardId(id) && allowed.has(id) && !order.includes(id)) order.push(id);
  const known = new Set(order);
  const slots: DashboardCardSlot[] = order.map((id) => ({
    id,
    visible: !hidden.has(id),
  }));
  for (const id of available) {
    if (known.has(id)) continue;
    const defaults = DASHBOARD_CARD_IDS.slice(
      0,
      DASHBOARD_CARD_IDS.indexOf(id),
    );
    let before = -1;
    slots.forEach((s, i) => {
      if (defaults.includes(s.id)) before = i;
    });
    slots.splice(before + 1, 0, {
      id,
      visible: DASHBOARD_CARDS[id].defaultVisible,
    });
  }
  return slots;
}

/** Saved form of a layout. */
export const saveDashboardLayout = (
  slots: readonly DashboardCardSlot[],
): SavedDashboardLayout => ({
  order: slots.map((s) => s.id),
  hidden: slots.filter((s) => !s.visible).map((s) => s.id),
});

/** Move one card up (-1) or down (+1); at either end nothing changes. */
export function moveDashboardCard(
  slots: readonly DashboardCardSlot[],
  id: DashboardCardId,
  step: -1 | 1,
): DashboardCardSlot[] {
  const from = slots.findIndex((s) => s.id === id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= slots.length) return [...slots];
  const next = [...slots];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export const setDashboardCardVisible = (
  slots: readonly DashboardCardSlot[],
  id: DashboardCardId,
  visible: boolean,
): DashboardCardSlot[] =>
  slots.map((s) => (s.id === id ? { ...s, visible } : s));
