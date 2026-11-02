import { z } from "zod";

// Store this with pending work; learning a newer epoch must never silently relabel an old save.
export const RECOVERY_EPOCH_HEADER = "x-recovery-epoch";
export const RECOVERY_REQUIRED = "RECOVERY_REQUIRED";
export const SYNC_CURSOR_RESET = "SYNC_CURSOR_RESET";
export const RecoveryEpoch = z.uuid().transform((value) => value.toLowerCase());
export const DEVELOPMENT_RECOVERY_EPOCH =
  "00000000-0000-4000-8000-000000000001";
