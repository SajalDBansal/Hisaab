import { randomUUID } from "node:crypto";

/**
 * Marks in-process reads made for one batch request. The batch already counted
 * against the caller's rate limit; the token is random per process, so it can't
 * be sent from outside to skip limits.
 */
export const BATCH_READ_HEADER = "x-hisaab-batch-read";
export const BATCH_READ_TOKEN = randomUUID();
