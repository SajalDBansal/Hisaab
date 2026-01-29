import { z } from "zod";
import { Id, IsoDate, Paise } from "./common";
import { VoucherType } from "./vouchers";

export const SearchQuery = z.object({
  q: z.string().trim().max(100).default(""),
});

export const SearchHit = z.object({
  kind: z.enum(["party", "item", "voucher", "ledger"]),
  id: Id,
  title: z.string(),
  subtitle: z.string(),
  amount: Paise.optional(),
  voucherType: VoucherType.optional(),
  date: IsoDate.optional(),
  cancelled: z.boolean().optional(),
});

export const SearchResults = z.object({
  query: z.string(),
  parties: z.array(SearchHit),
  items: z.array(SearchHit),
  vouchers: z.array(SearchHit),
  ledgers: z.array(SearchHit),
});

export type SearchHit = z.infer<typeof SearchHit>;
export type SearchResults = z.infer<typeof SearchResults>;
