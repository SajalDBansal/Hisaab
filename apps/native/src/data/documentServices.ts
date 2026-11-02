import { z } from "zod";
import * as c from "@repo/contracts";
import type { Client } from "./client";
import type { Services } from "./services";
import type { DocumentFile } from "@repo/core";
import { assertRecoveryEpoch } from "./recoveryEpoch";
import {
  attachmentRetry,
  attachmentReservationProblem,
  checkAttachmentTarget,
  type AttachmentProgress,
} from "./attachmentRecovery";

export function documentServices(
  { request }: Client,
  uploadFile: (url: string, file: DocumentFile) => Promise<void>,
): Services["documentService"] {
  const pending = new Map<string, AttachmentProgress>();
  const running = new Map<string, Promise<c.StoredDocument>>();

  async function transfer(
    file: DocumentFile,
    body: c.UploadRequest,
    key: string,
  ) {
    const retry = attachmentRetry(file);
    const check = () => retry && checkAttachmentTarget(retry, body);
    check();
    const record = await retry?.read();
    if (record) assertRecoveryEpoch(record.recoveryEpoch);
    if (
      retry?.scope.target === "library" &&
      (!record?.input ||
        JSON.stringify(record.input) !==
          JSON.stringify(c.NewDocumentInput.parse(body)))
    )
      throw new Error(
        "Restore the pending document's original upload details before retrying.",
      );
    if (record?.completed) return record.completed;
    await retry?.prepare(c.NewDocumentInput.parse(body));
    let job = record?.progress ?? pending.get(key);
    const remember = async (value: AttachmentProgress) => {
      pending.set(key, value);
      await retry?.save(value);
    };
    const confirm = async () => {
      check();
      return request(
        `/documents/${job!.ticket.document.id}/confirm`,
        c.StoredDocument,
        { body: {} },
      );
    };
    const finish = async (saved: c.StoredDocument) => {
      await retry?.complete(saved);
      pending.delete(key);
      return saved;
    };
    const renew = async () => {
      check();
      const ticket = await request(
        `/documents/${job!.ticket.document.id}/upload-url`,
        c.UploadTicket,
      );
      job = { ticket, uploaded: false };
      await remember(job);
    };
    const upload = async () => {
      check();
      if (retry)
        await retry.upload((current) =>
          uploadFile(job!.ticket.uploadUrl, current),
        );
      else await uploadFile(job!.ticket.uploadUrl, file);
      job = { ...job!, uploaded: true };
      await remember(job);
    };
    if (!job && retry && record && attachmentReservationProblem(record)) {
      const answer = await request(
        `/operations/${retry.id}/document-reservation`,
        z.discriminatedUnion("state", [
          z.object({ state: z.literal("found"), id: z.uuid() }),
          z.object({ state: z.literal("unknown"), message: z.string() }),
        ]),
        { body },
      );
      if (answer.state === "unknown") throw new Error(answer.message);
      check();
      try {
        const ticket = await request(
          `/documents/${answer.id}/upload-url`,
          c.UploadTicket,
        );
        job = { ticket, uploaded: false };
        await remember(job);
      } catch (error) {
        if ((error as { code?: string }).code === "UPLOAD_CLOSED")
          return finish(
            await request(`/documents/${answer.id}/confirm`, c.StoredDocument, {
              body: {},
            }),
          );
        throw error;
      }
    }
    if (!job) {
      await retry?.verifyFile();
      await retry?.reserve();
      check();
      const ticket = await request("/documents/upload-url", c.UploadTicket, {
        body,
        headers: retry ? { "idempotency-key": retry.id } : undefined,
      });
      job = { ticket, uploaded: false };
    }
    // The document ID must reach durable storage before any object is uploaded.
    await remember(job);
    if (!job.uploaded) {
      if (new Date(job.ticket.expiresAt).getTime() <= Date.now()) {
        try {
          await renew();
        } catch (error) {
          if ((error as { code?: string }).code === "UPLOAD_CLOSED")
            return finish(await confirm());
          throw error;
        }
      }
      await upload();
    }
    let saved: c.StoredDocument;
    try {
      saved = await confirm();
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (!retry || !(status === 404 || (status && status >= 500))) throw error;
      // An old staging object may have expired; renew only this same document.
      try {
        await renew();
      } catch (renewalError) {
        if ((renewalError as { code?: string }).code === "UPLOAD_CLOSED")
          return finish(await confirm());
        throw renewalError;
      }
      await upload();
      saved = await confirm();
    }
    return finish(saved);
  }

  return {
    list: (filters = {}) =>
      request("/documents/search", z.array(c.StoredDocument), {
        body: filters,
      }),
    folders: () => request("/documents/folders", z.array(z.string())),
    download: (id) =>
      request(`/documents/${id}/download-url`, c.DownloadTicket),
    thumbnail: (id) =>
      request(`/documents/${id}/thumbnail-url`, c.DownloadTicket),
    update: (id, patch) =>
      request(`/documents/${id}`, c.StoredDocument, {
        method: "PATCH",
        body: patch,
      }),
    async add({ file, ...input }) {
      const body = c.UploadRequest.parse({
        ...input,
        sizeBytes: file.sizeBytes,
        contentType: file.contentType,
      });
      const retry = attachmentRetry(file);
      if (retry) checkAttachmentTarget(retry, body);
      const key = retry?.key ?? JSON.stringify([file.uri, body]);
      const existing = running.get(key);
      if (existing) return existing;
      const work = async () => {
        try {
          return await transfer(file, body, key);
        } catch (error) {
          try {
            await retry?.fail(error);
          } catch {
            throw new Error(
              `${error instanceof Error ? error.message : "Upload failed."} The failure details could not be saved on this device.`,
            );
          }
          throw error;
        }
      };
      const result = (retry ? retry.run(work) : work()).finally(() =>
        running.delete(key),
      );
      running.set(key, result);
      return result;
    },
    async remove(id) {
      await request(`/documents/${id}`, z.object({ ok: z.boolean() }), {
        method: "DELETE",
      });
    },
  };
}
