import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AppError } from "../../lib/app-error";
import {
  DOWNLOAD_EXPIRES_SECONDS,
  type StorageTicket,
  type StorageConfig,
} from "../../lib/storage-contracts";

export interface PdfStorage {
  exists(key: string): Promise<boolean>;
  put(key: string, bytes: Buffer): Promise<void>;
  download(key: string, fileName: string): Promise<StorageTicket>;
  close(): void;
}

// Server artifacts use their own prefix, never upload tickets or attachment metadata.
export function createPdfStorage(env: StorageConfig): PdfStorage {
  const bucket = env.R2_BUCKET || env.S3_BUCKET;
  const client = new S3Client({
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
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
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const requireBucket = () => {
    if (!bucket)
      throw new AppError(
        "STORAGE_UNAVAILABLE",
        "PDF storage is not configured.",
        503,
      );
    return bucket;
  };
  return {
    async exists(key) {
      try {
        await client.send(
          new HeadObjectCommand({ Bucket: requireBucket(), Key: key }),
        );
        return true;
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode === 404
        )
          return false;
        throw error;
      }
    },
    async put(key, bytes) {
      if (
        bytes.length > 20 * 1024 * 1024 ||
        bytes.subarray(0, 5).toString() !== "%PDF-"
      )
        throw new AppError(
          "INVALID_PDF",
          "The generated PDF is invalid or exceeds 20 MB.",
        );
      await client.send(
        new PutObjectCommand({
          Bucket: requireBucket(),
          Key: key,
          Body: bytes,
          ContentType: "application/pdf",
          CacheControl: "private, no-store",
        }),
      );
    },
    async download(key, fileName) {
      const safeName = fileName.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 140);
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: requireBucket(),
          Key: key,
          ResponseContentDisposition: `attachment; filename="${safeName}"`,
        }),
        { expiresIn: DOWNLOAD_EXPIRES_SECONDS },
      );
      return {
        url,
        expiresAt: new Date(
          Date.now() + DOWNLOAD_EXPIRES_SECONDS * 1000,
        ).toISOString(),
      };
    },
    close() {
      client.destroy();
    },
  };
}
