import type { FirmUpdate, Firm, InvoiceSettings, TeamMember } from "../types";
import {
  inviteMember,
  updateFirm,
  updateInvoiceSettings,
  updateMember,
} from "../mock/db";
import { clone, delay, getDb } from "./client";

export interface InvoiceSettingsView extends InvoiceSettings {
  /** Name of the bank printed on invoices, e.g. "HDFC Current ··4521". */
  bankName: string;
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

  /** Invitations are addressed to the person's verified sign-in email. */
  async invite(input: {
    email: string;
    role: Exclude<TeamMember["role"], "owner">;
  }): Promise<TeamMember> {
    await delay();
    return clone(inviteMember(getDb(), input));
  },
};
