import { auditPage, type AuditPageQuery } from "../listPages";
import type { AuditEntry } from "../types";
import { clone, delay, getDb } from "./client";

/** The firm's edit log (audit trail): every voucher created, edited or cancelled, newest first. */
export const auditService = {
  /** Real API: http.get<AuditEntry[]>(`/audit-log?limit=${limit}`) */
  /** One page of the edit log. Real API: http.get(`/audit-log/page?filter=…`) */
  async page(query: AuditPageQuery) {
    return auditPage(await this.list(), query);
  },
  async list(limit?: number): Promise<AuditEntry[]> {
    await delay();
    return clone(
      [...getDb().auditLog]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit),
    );
  },
};
