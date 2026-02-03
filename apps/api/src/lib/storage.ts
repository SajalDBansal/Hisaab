import {
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AppError } from "@repo/backend/lib/app-error";
import { documentImages } from "./document-images";
import {
  DOWNLOAD_EXPIRES_SECONDS,
  type StorageTicket,
} from "@repo/backend/lib/storage-contracts";
export {
  DOWNLOAD_EXPIRES_SECONDS,
  type StorageTicket,
} from "@repo/backend/lib/storage-contracts";

export const UPLOAD_EXPIRES_SECONDS = 5 * 60;
export const THUMBNAIL_MAX_BYTES = 128 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface FileStorage {
  uploadUrl(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<StorageTicket>;
  downloadUrl(key: string): Promise<StorageTicket>;
  finalize(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    maxSizeBytes?: number;
  }): Promise<{
    sizeBytes: number;
    contentType: string;
    thumbnailKey?: string;
  }>;
  remove(key: string): Promise<void>;
  createThumbnail(key: string): Promise<{ thumbnailKey: string }>;
}

export const pendingKey = (key: string) => `pending/${key}`;
export const thumbnailKey = (key: string) => `${key}.thumb.jpg`;

// Reject renamed executables and mismatched files before making them visible.
export function matchesFileType(bytes: Uint8Array, type: string) {
  const data = Buffer.from(bytes);
  if (type === "application/pdf")
    return data.subarray(0, 5).toString() === "%PDF-";
  if (type === "image/jpeg")
    return data.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (type === "image/png")
    return data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return (
    ["image/heic", "image/heif"].includes(type) &&
    data.subarray(4, 8).toString() === "ftyp" &&
    /heic|heix|hevc|hevx|mif1|msf1/.test(data.subarray(8, 32).toString())
  );
}

function expiresAt(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function checkOutputSize(bytes: number, maximum = MAX_IMAGE_BYTES) {
  if (bytes > maximum)
    throw new AppError(
      "DOCUMENT_QUOTA_EXCEEDED",
      "The processed file exceeds the available storage. Choose a smaller image or ask the owner to increase the limit.",
      409,
    );
}

async function objectHead(client: S3Client, bucket: string, key: string) {
  try {
    return await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
  } catch (error) {
    if (
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 404
    )
      return undefined;
    throw error;
  }
}

function validThumbnail(head: Awaited<ReturnType<typeof objectHead>>) {
  if (
    head?.ContentType !== "image/jpeg" ||
    !head.ContentLength ||
    head.ContentLength > THUMBNAIL_MAX_BYTES
  )
    throw new AppError(
      "INVALID_THUMBNAIL",
      "The existing thumbnail cannot be reused.",
      409,
    );
}

async function createMissingThumbnail(
  client: S3Client,
  bucket: string,
  key: string,
) {
  const source = await objectHead(client, bucket, key);
  if (
    !source?.ContentType?.startsWith("image/") ||
    !source.ContentLength ||
    source.ContentLength > MAX_IMAGE_BYTES ||
    !source.ETag
  )
    throw new AppError(
      "INVALID_IMAGE",
      "The saved image is missing, unsupported, or larger than 10 MB.",
      422,
    );
  const target = thumbnailKey(key);
  const existing = await objectHead(client, bucket, target);
  if (existing) {
    validThumbnail(existing);
    return { thumbnailKey: target };
  }
  const object = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key, IfMatch: source.ETag }),
  );
  const bytes = await object.Body?.transformToByteArray();
  if (
    !bytes ||
    bytes.length !== source.ContentLength ||
    !matchesFileType(bytes, source.ContentType)
  )
    throw new AppError(
      "INVALID_IMAGE",
      "The saved image cannot be verified.",
      422,
    );
  const { thumbnail } = await documentImages(bytes);
  checkOutputSize(thumbnail.length, THUMBNAIL_MAX_BYTES);
  try {
    // A retry after a lost DB commit must not replace even the existing preview.
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: target,
        Body: thumbnail,
        ContentType: "image/jpeg",
        CacheControl: "private, max-age=300",
        IfNoneMatch: "*",
      }),
    );
  } catch (error) {
    if (
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode !== 412
    )
      throw error;
    validThumbnail(await objectHead(client, bucket, target));
  }
  return { thumbnailKey: target };
}

export function documentKey(input: {
  firmId: string;
  documentId: string;
  name: string;
  contentType: string;
}) {
  return `firms/${input.firmId}/documents/${input.documentId}${extensionOf(
    input.contentType,
  )}`;
}

function extensionOf(contentType: string) {
  return (
    {
      "application/pdf": ".pdf",
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/heic": ".heic",
      "image/heif": ".heif",
    }[contentType] ?? ""
  );
}

export function createS3Storage(options: {
  bucket?: string;
  region: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}): FileStorage {
  if (!options.bucket) return unavailableStorage();

  const client = new S3Client({
    maxAttempts: 3,
    requestHandler: {
      connectionTimeout: 5_000,
      requestTimeout: 30_000,
      socketTimeout: 30_000,
      throwOnRequestTimeout: true,
    },
    region: options.region,
    endpoint: options.endpoint,
    credentials: options.credentials,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return {
    async uploadUrl({ key, contentType, sizeBytes }) {
      const command = new PutObjectCommand({
        Bucket: options.bucket,
        Key: pendingKey(key),
        ContentType: contentType,
        ContentLength: sizeBytes,
      });
      return {
        url: await getSignedUrl(client, command, {
          expiresIn: UPLOAD_EXPIRES_SECONDS,
          signableHeaders: new Set(["content-type", "content-length"]),
        }),
        expiresAt: expiresAt(UPLOAD_EXPIRES_SECONDS),
      };
    },
    async finalize({ key, contentType, sizeBytes, maxSizeBytes }) {
      checkOutputSize(sizeBytes, maxSizeBytes);
      const isImage = contentType.startsWith("image/");
      const staged = pendingKey(key);
      const head = await client.send(
        new HeadObjectCommand({ Bucket: options.bucket, Key: staged }),
      );
      if (
        head.ContentLength !== sizeBytes ||
        head.ContentType !== contentType ||
        !head.ETag
      )
        throw new AppError(
          "INVALID_FILE",
          "The uploaded file size or type does not match. Select the file again.",
          422,
        );
      const sample = await client.send(
        new GetObjectCommand({
          Bucket: options.bucket,
          Key: staged,
          ...(!isImage ? { Range: "bytes=0-31" } : {}),
          IfMatch: head.ETag,
        }),
      );
      const bytes = await sample.Body?.transformToByteArray();
      if (!bytes || !matchesFileType(bytes, contentType))
        throw new AppError(
          "INVALID_FILE",
          "This file is not a supported image or PDF.",
          422,
        );
      if (isImage) {
        if (bytes.length !== sizeBytes)
          throw new AppError(
            "INVALID_FILE",
            "The uploaded image is incomplete.",
            422,
          );
        const images = await documentImages(bytes);
        checkOutputSize(images.full.length, maxSizeBytes);
        checkOutputSize(images.thumbnail.length, THUMBNAIL_MAX_BYTES);
        for (const [objectKey, body] of [
          [key, images.full],
          [thumbnailKey(key), images.thumbnail],
        ] as const) {
          await client.send(
            new PutObjectCommand({
              Bucket: options.bucket,
              Key: objectKey,
              Body: body,
              ContentType: "image/jpeg",
              CacheControl: "private, max-age=300",
            }),
          );
        }
        return {
          sizeBytes: images.full.length,
          contentType: "image/jpeg",
          thumbnailKey: thumbnailKey(key),
        };
      }
      // The upload URL can only replace staging data, never an already saved document.
      await client.send(
        new CopyObjectCommand({
          Bucket: options.bucket,
          Key: key,
          CopySource: `${options.bucket}/${staged}`,
          CopySourceIfMatch: head.ETag,
          MetadataDirective: "REPLACE",
          ContentType: contentType,
          CacheControl: "private, no-store",
        }),
      );
      return { sizeBytes, contentType };
    },
    async remove(key) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: options.bucket,
          Key: thumbnailKey(key),
        }),
      );
      await client.send(
        new DeleteObjectCommand({ Bucket: options.bucket, Key: key }),
      );
      await client.send(
        new DeleteObjectCommand({
          Bucket: options.bucket,
          Key: pendingKey(key),
        }),
      );
    },
    async createThumbnail(key) {
      return createMissingThumbnail(client, options.bucket as string, key);
    },
    async downloadUrl(key) {
      const command = new GetObjectCommand({
        Bucket: options.bucket,
        Key: key,
      });
      return {
        url: await getSignedUrl(client, command, {
          expiresIn: DOWNLOAD_EXPIRES_SECONDS,
        }),
        expiresAt: expiresAt(DOWNLOAD_EXPIRES_SECONDS),
      };
    },
  };
}

export function fakeStorage(): FileStorage {
  return {
    async finalize({ key, sizeBytes, contentType, maxSizeBytes }) {
      checkOutputSize(sizeBytes, maxSizeBytes);
      return {
        sizeBytes,
        contentType,
        ...(contentType.startsWith("image/")
          ? { thumbnailKey: thumbnailKey(key) }
          : {}),
      };
    },
    async remove() {},
    async createThumbnail(key) {
      return { thumbnailKey: thumbnailKey(key) };
    },
    async uploadUrl({ key }) {
      return {
        url: `https://storage.local/upload/${encodeURIComponent(key)}`,
        expiresAt: expiresAt(UPLOAD_EXPIRES_SECONDS),
      };
    },
    async downloadUrl(key) {
      return {
        url: `https://storage.local/download/${encodeURIComponent(key)}`,
        expiresAt: expiresAt(DOWNLOAD_EXPIRES_SECONDS),
      };
    },
  };
}

function unavailableStorage(): FileStorage {
  const fail = async (): Promise<never> => {
    throw new AppError(
      "STORAGE_UNAVAILABLE",
      "Document storage is not configured. Ask the owner to configure Cloudflare R2.",
      503,
    );
  };
  return {
    uploadUrl: fail,
    downloadUrl: fail,
    finalize: fail,
    remove: fail,
    createThumbnail: fail,
  };
}
