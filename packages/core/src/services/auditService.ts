import type { AuditEntry } from "../types";
import { clone, delay, getDb } from "./client";

/** The firm's edit log (audit trail): every voucher created, edited or cancelled, newest first. */
export const auditService = {
  /** Real API: http.get<AuditEntry[]>(`/audit-log?limit=${limit}`) */
  async list(limit?: number): Promise<AuditEntry[]> {
    await delay();
    return clone(
      [...getDb().auditLog]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit),
    );
  },
};
