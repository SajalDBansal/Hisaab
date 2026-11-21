import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { BackupError, type BackupConfig } from "./config";
import { Manifest, type Archive, type StoredManifest } from "./types";

export function createBackupStorage(config: BackupConfig) {
  const client = new S3Client({
    endpoint: config.BACKUP_R2_ENDPOINT,
    region: "auto",
    credentials: {
      accessKeyId: config.BACKUP_R2_ACCESS_KEY_ID,
      secretAccessKey: config.BACKUP_R2_SECRET_ACCESS_KEY,
    },
    maxAttempts: 2,
    requestHandler: {
      connectionTimeout: 5_000,
      requestTimeout: 60_000,
      socketTimeout: 60_000,
      throwOnRequestTimeout: true,
    },
  });
  const bucket = config.BACKUP_R2_BUCKET;
  const prefix = `installations/${config.BACKUP_INSTALLATION_ID}/`;
  const manifestKey = `${prefix}latest.json`;

  async function read(signal: AbortSignal): Promise<StoredManifest | null> {
    try {
      const response = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: manifestKey }),
        { abortSignal: signal },
      );
      if (!response.Body || !response.ETag)
        throw new BackupError("BACKUP_MANIFEST_INVALID");
      let text = "";
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        text += Buffer.from(chunk).toString("utf8");
        if (text.length > 64 * 1024)
          throw new BackupError("BACKUP_MANIFEST_TOO_LARGE");
      }
      const manifest = Manifest.parse(JSON.parse(text));
      if (
        manifest.installationId !== config.BACKUP_INSTALLATION_ID ||
        (manifest.archive &&
          manifest.archive.key !==
            `${prefix}archives/${manifest.archive.id}.dump`)
      )
        throw new BackupError("BACKUP_MANIFEST_INVALID");
      return { manifest, etag: response.ETag, lastModified: response.LastModified };
    } catch (error) {
      if (error instanceof Error && error.name === "NoSuchKey") return null;
      throw error;
    }
  }

  // Conditional replacement prevents stale hosts and ambiguous retries overwriting newer state.
  async function publish(
    manifest: Manifest,
    expectedEtag: string | null,
    signal: AbortSignal,
  ) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: manifestKey,
        Body: JSON.stringify(manifest),
        ContentType: "application/json",
        CacheControl: "no-store",
        ...(expectedEtag ? { IfMatch: expectedEtag } : { IfNoneMatch: "*" }),
      }),
      { abortSignal: signal },
    );
  }

  async function upload(
    path: string,
    archive: Archive,
    md5: string,
    signal: AbortSignal,
  ) {
    const stream = createReadStream(path);
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: archive.key,
          Body: stream,
          ContentType: "application/octet-stream",
          ContentLength: archive.bytes,
          ContentMD5: md5,
          IfNoneMatch: "*",
        }),
        { abortSignal: signal },
      );
    } finally {
      stream.destroy();
    }
  }

  async function verify(archive: Archive, signal: AbortSignal) {
    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: archive.key }),
      { abortSignal: signal },
    );
    if (!response.Body) throw new BackupError("BACKUP_DOWNLOAD_EMPTY");
    let bytes = 0;
    const hash = createHash("sha256");
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      signal.throwIfAborted();
      bytes += chunk.length;
      if (bytes > archive.bytes)
        throw new BackupError("BACKUP_CHECKSUM_MISMATCH");
      hash.update(chunk);
    }
    if (bytes !== archive.bytes || hash.digest("hex") !== archive.sha256)
      throw new BackupError("BACKUP_CHECKSUM_MISMATCH");
  }

  // Called only after a successful CAS settles writes against the previous manifest.
  async function cleanup(current: Manifest, signal: AbortSignal) {
    let cursor: string | undefined;
    let removed = 0;
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: `${prefix}archives/`,
          ContinuationToken: cursor,
          MaxKeys: 100,
        }),
        { abortSignal: signal },
      );
      for (const object of page.Contents ?? []) {
        if (!object.Key || object.Key === current.archive?.key) continue;
        const latest = await read(signal);
        if (latest?.manifest.revision !== current.revision)
          throw new BackupError("BACKUP_WRITER_CHANGED");
        // Another publisher may have read this manifest and started a new upload.
        // R2 timestamps (not host clocks) establish which objects predate publication.
        const publishedAt = latest.lastModified?.getTime();
        const uploadedAt = object.LastModified?.getTime();
        if (!publishedAt || !uploadedAt || uploadedAt >= publishedAt) continue;
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }),
          { abortSignal: signal },
        );
        if (++removed >= 100) return removed;
      }
      cursor = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (cursor);
    return removed;
  }

  return {
    read,
    publish,
    upload,
    verify,
    cleanup,
    close: () => client.destroy(),
  };
}

export type BackupStorage = ReturnType<typeof createBackupStorage>;
