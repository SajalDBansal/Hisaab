import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { AppError } from "../../lib/app-error";
import type { StorageConfig } from "../../lib/storage-contracts";

export interface DocumentCleanupStorage {
  removeObject(key: string, signal?: AbortSignal): Promise<void>;
}

// Object deletion needs no image libraries and runs only in the separate worker.
export function createDocumentCleanupStorage(env: StorageConfig) {
  const bucket = env.R2_BUCKET || env.S3_BUCKET;
  const client = new S3Client({
    maxAttempts: 3,
    requestHandler: {
      connectionTimeout: 5_000,
      requestTimeout: 30_000,
      socketTimeout: 30_000,
      throwOnRequestTimeout: true,
    },
    region: env.R2_BUCKET ? "auto" : env.AWS_REGION,
    endpoint: env.R2_BUCKET
      ? env.R2_ENDPOINT ||
        `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : undefined,
    credentials:
      env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
        ? {
            accessKeyId: env.R2_ACCESS_KEY_ID,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
  return {
    async removeObject(key: string, signal?: AbortSignal) {
      if (!bucket)
        throw new AppError(
          "STORAGE_UNAVAILABLE",
          "Document storage is not configured.",
          503,
        );
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
        abortSignal: signal,
      });
    },
    close() {
      client.destroy();
    },
  } satisfies DocumentCleanupStorage & { close(): void };
}
