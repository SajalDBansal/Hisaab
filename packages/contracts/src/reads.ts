import { z } from "zod";

/**
 * Book reads the app keeps for offline viewing. The phone caches answers only
 * for these paths and a batch may hold only these paths, so the two can't drift.
 */
export const OFFLINE_READABLE_PATH =
  /^\/v1\/(parties|items|ledgers|vouchers|reports|accounts|units|gst|inventory|loans|settlements|associates|audit-log|notifications|reminders)(\/|\?|$)|^\/v1\/settings\/(invoice|books|reminders|team)(\/|\?|$)|^\/v1\/firms\/current(\?|$)/;
export const BATCH_READABLE_PATH = OFFLINE_READABLE_PATH;
/** Reads that render files or start work are never batched. */
export const BATCH_EXCLUDED_PATH =
  /\/(pdf|print|export|exports|download)(\/|\?|$)/;
export const MAX_BATCH_READS = 200;

/** Up to 200 GET paths answered together, each exactly as its own route would answer. */
export const BatchReadInput = z.object({
  paths: z.array(z.string().min(4).max(600)).min(1).max(MAX_BATCH_READS),
});

export const BatchReadResult = z.object({
  results: z.array(
    z.object({
      path: z.string(),
      status: z.number().int(),
      /** "json" bodies are parsed; anything else is returned as text. */
      format: z.enum(["json", "text"]),
      body: z.unknown(),
    }),
  ),
});

export type BatchReadInput = z.infer<typeof BatchReadInput>;
export type BatchReadResult = z.infer<typeof BatchReadResult>;
