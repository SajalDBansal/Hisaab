import { z } from "zod";
import { Paise } from "./common";

export const OpeningAllocationKind = z.enum([
  "party",
  "ledger",
  "account",
  "legacy",
]);
export const OpeningAllocationRow = z.object({
  kind: OpeningAllocationKind,
  key: z.string().min(1).max(200),
  name: z.string(),
  total: Paise,
  gst: Paise,
  explicit: z.boolean(),
});
export const OpeningAllocationView = z.object({
  version: z.number().int().nonnegative(),
  digest: z.string().length(64),
  canEdit: z.boolean(),
  rows: z.array(OpeningAllocationRow),
});
export const OpeningAllocationChange = z.object({
  version: z.number().int().nonnegative(),
  digest: z.string().length(64),
  reason: z.string().trim().min(10).max(500),
  kind: OpeningAllocationKind,
  key: z.string().min(1).max(200),
  gst: Paise.nullable(),
});
export type OpeningAllocationView = z.infer<typeof OpeningAllocationView>;
export type OpeningAllocationChange = z.infer<typeof OpeningAllocationChange>;
