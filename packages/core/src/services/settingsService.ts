import type { FirmUpdate, Firm, InvoiceSettings, TeamMember } from "../types";

import {
  inviteMember,
  updateFirm,
  updateInvoiceSettings,
  updateMember,
  transferOwnership,
} from "../mock/db";
import { clone, delay, getDb } from "./client";
import {
  DEFAULT_STOCK_POLICY,
  type StockPolicy,
} from "../accounting/stockPolicy";
import {
  DEFAULT_OVERDUE_SALES_POLICY,
  type OverdueSalesPolicy,
} from "../accounting/creditControl";

/** Credit control (doc 37, T11), with the saved version. */
export interface SalesControlsView {
  overdueSales: OverdueSalesPolicy;
  /** Stock control (doc 37, T37). */
  stockPolicy: StockPolicy;
  version: number;
}

/** Logo and signature as data:image URIs, with the saved version. */
export interface Branding {
  logo: string | null;
  signature: string | null;
  version: number;
}

export interface InvoiceSettingsView extends InvoiceSettings {
  /** Name of the bank printed on invoices, e.g. "HDFC Current ··4521". */
  bankName: string;
}

/** Who is online now, as the owner sees it on the team screen. */
export interface TeamPresence {
  members: {
    memberId: string;
    userId: string;
    name: string;
    role: TeamMember["role"];
    online: boolean;
    devices: { platform: "app" | "web"; device: string; since: string }[];
    lastActiveAt: string | null;
  }[];
}

export const settingsService = {
  /** Real API: http.patch<Firm>("/firms/current", patch) */
  async updateFirm(patch: FirmUpdate): Promise<Firm> {
    await delay();
    return clone(updateFirm(getDb(), patch));
  },

  /** Real API: http.get<InvoiceSettingsView>("/settings/invoice") */
  async invoice(): Promise<InvoiceSettingsView> {
    await delay();
    const db = getDb();
    const bank = db.ledgers.find(
      (l) => l.id === db.invoiceSettings.bankLedgerId,
    );
    return clone({ ...db.invoiceSettings, bankName: bank?.name ?? "" });
  },

  /** Real API: http.patch<InvoiceSettings>("/settings/invoice", patch) */
  async updateInvoice(
    patch: Partial<InvoiceSettings>,
  ): Promise<InvoiceSettings> {
    await delay();
    return clone(updateInvoiceSettings(getDb(), patch));
  },

  /** Logo and signature for documents (doc 37, T16). Real API: GET /settings/branding */
  async branding(): Promise<Branding> {
    await delay();
    return clone(
      getDb().branding ?? { logo: null, signature: null, version: 0 },
    );
  },

  /** Real API: PUT /settings/branding with If-Match. */
  async updateBranding(
    input: { logo: string | null; signature: string | null },
    _version?: number,
  ): Promise<Branding> {
    void _version;
    await delay();
    const db = getDb();
    db.branding = { ...input, version: (db.branding?.version ?? 0) + 1 };
    return clone(db.branding);
  },

  /** Credit control (doc 37, T11). Real API: GET /settings/sales-controls */
  async salesControls(): Promise<SalesControlsView> {
    await delay();
    const saved = getDb().salesControls;
    return clone({
      overdueSales: saved?.overdueSales ?? DEFAULT_OVERDUE_SALES_POLICY,
      stockPolicy: saved?.stockPolicy ?? DEFAULT_STOCK_POLICY,
      version: saved?.version ?? 0,
    });
  },

  /** Real API: PUT /settings/sales-controls with If-Match. */
  async updateSalesControls(
    input: { overdueSales: OverdueSalesPolicy; stockPolicy?: StockPolicy },
    _version?: number,
  ): Promise<SalesControlsView> {
    void _version;
    await delay();
    const db = getDb();
    db.salesControls = {
      overdueSales: input.overdueSales,
      stockPolicy:
        input.stockPolicy ??
        db.salesControls?.stockPolicy ??
        DEFAULT_STOCK_POLICY,
      version: (db.salesControls?.version ?? 0) + 1,
    };
    return clone({
      ...db.salesControls,
      stockPolicy: db.salesControls.stockPolicy!,
    });
  },

  /** Real API: http.get<{ members: TeamMember[]; currentUserId: string }>("/team") */
  async team(): Promise<{ members: TeamMember[]; currentUserId: string }> {
    await delay();
    const db = getDb();
    return clone({ members: db.team, currentUserId: db.currentUserId });
  },

  /** Real API: http.patch<TeamMember>(`/team/${id}`, patch) */
  async updateMember(
    id: string,
    patch: Partial<Pick<TeamMember, "role" | "active">>,
  ): Promise<TeamMember> {
    await delay();
    return clone(updateMember(getDb(), id, patch));
  },

  /** Real API: http.get<TeamPresence>("/firms/current/presence") */
  async presence(): Promise<TeamPresence> {
    await delay();
    const db = getDb();
    const now = new Date().toISOString();
    return clone({
      members: db.team
        .filter((m) => m.active)
        .map((m) => {
          const me = m.id === db.currentUserId;
          return {
            memberId: m.id,
            userId: m.id,
            name: m.name,
            role: m.role,
            online: me,
            devices: me
              ? [
                  {
                    platform: "app" as const,
                    device: "This device",
                    since: now,
                  },
                ]
              : [],
            lastActiveAt: me
              ? now
              : m.lastActive
                ? `${m.lastActive}T09:00:00.000Z`
                : null,
          };
        }),
    });
  },

  /** Real API: http.post("/firms/current/transfer-ownership", input) */
  async transferOwnership(input: {
    memberId: string;
    previousOwnerRole: Exclude<TeamMember["role"], "owner">;
    confirmName: string;
  }): Promise<void> {
    await delay();
    transferOwnership(getDb(), input);
  },

  /** Invitations are addressed to the person's verified sign-in email. */
  async invite(input: {
    email: string;
    role: Exclude<TeamMember["role"], "owner">;
  }): Promise<TeamMember> {
    await delay();
    return clone(inviteMember(getDb(), input));
  },
};
