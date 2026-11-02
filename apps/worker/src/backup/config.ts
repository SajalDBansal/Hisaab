import { z } from "zod";

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/);
const settings = z.object({
  DATABASE_URL: z.string().min(1),
  BACKUP_INSTALLATION_ID: identifier,
  BACKUP_WRITER_ID: identifier,
  BACKUP_R2_BUCKET: z.string().min(3),
  BACKUP_R2_ENDPOINT: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value.replace(/\/$/, "");
  }),
  BACKUP_R2_ACCESS_KEY_ID: z.string().min(1),
  BACKUP_R2_SECRET_ACCESS_KEY: z.string().min(1),
  BACKUP_HEARTBEAT_URL: z.preprocess((value) => value === "" ? undefined : value, z.url().optional()),
  SENTRY_RELEASE: z.preprocess((value) => value === "" ? undefined : value, z.string().default("unknown")),
});

export type BackupConfig = z.infer<typeof settings>;
export const MAX_ARCHIVE_BYTES = 1024 ** 3;
export const BACKUP_TIMEOUT_MS = 20 * 60_000;

// Disabled is the default even when a restored database contains backup state.
export function backupEnabled(source: NodeJS.ProcessEnv = process.env) {
  if (
    source.BACKUP_ENABLED &&
    !["true", "false"].includes(source.BACKUP_ENABLED)
  )
    throw new Error("BACKUP_ENABLED must be true or false.");
  return source.BACKUP_ENABLED === "true";
}

export function readBackupConfig(source: NodeJS.ProcessEnv = process.env) {
  const result = settings.safeParse(source);
  if (!result.success)
    throw new Error(
      `Invalid backup settings: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  const config = result.data;
  if ([source.R2_BUCKET, source.S3_BUCKET].includes(config.BACKUP_R2_BUCKET))
    throw new Error("Backups require a separate private bucket.");
  if (
    config.BACKUP_HEARTBEAT_URL &&
    new URL(config.BACKUP_HEARTBEAT_URL).protocol !== "https:"
  )
    throw new Error("Backup heartbeat requires HTTPS.");
  return config;
}

export class BackupError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "BackupError";
  }
}

// Provider and PostgreSQL messages can contain secrets; only our fixed codes escape.
export function backupErrorCode(error: unknown) {
  return error instanceof BackupError ? error.code : "BACKUP_FAILED";
}
