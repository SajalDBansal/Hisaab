import type { SearchResults } from "@repo/contracts";
import type { Role } from "@repo/core";
import type { Db } from "@repo/backend/db/client";
import { canReadBooks, readableVoucherTypes } from "../../lib/read-permissions";
import { searchRepo } from "./search.repo";

export const searchService = {
  async search(
    db: Db,
    firmId: string,
    query: string,
    role: Role,
  ): Promise<SearchResults> {
    const q = query.trim();
    const [parties, items, vouchers, ledgers] = await Promise.all([
      searchRepo.parties(
        db,
        firmId,
        q,
        canReadBooks(role) ? undefined : "customer",
      ),
      searchRepo.items(db, firmId, q),
      searchRepo.vouchers(db, firmId, q, readableVoucherTypes(role)),
      searchRepo.ledgers(db, firmId, q),
    ]);
    return { query: q, parties, items, vouchers, ledgers };
  },
};
