import { useRef, useState } from "react";
import * as Crypto from "expo-crypto";
import { useData } from "@/data/DataProvider";
import { useAddDocument } from "@/data/queries";
import { showError } from "@/components";
import { createAttachmentQueue } from "@/data/attachmentRecovery";
import {
  createAttachmentDrafts,
  type DraftRecord,
} from "@/data/attachmentDrafts";
import type { FinancialAttachmentPath } from "@/data/attachmentDraftModel";
import { attachmentStorage } from "@/data/attachmentStorage";
import { pendingAttachmentInput } from "./pendingAttachmentActions";
import { useEntryAttachments } from "./useEntryAttachments";

const drafts = createAttachmentDrafts(attachmentStorage, Crypto.randomUUID);
const queue = createAttachmentQueue(attachmentStorage, Crypto.randomUUID);

export function useFinancialAttachments(
  existingId?: string,
  target: "voucher" | "account" = "voucher",
) {
  const attachments = useEntryAttachments(existingId, target);
  const { userId, firmId, role, accessKey, offline } = useData();
  const add = useAddDocument();
  const identity = JSON.stringify([
    userId,
    firmId,
    role,
    accessKey,
    existingId,
  ]);
  const operation = useRef<{
    identity: string;
    working: boolean;
    draft?: DraftRecord;
  }>({ identity, working: false });
  if (operation.current.identity !== identity)
    operation.current = { identity, working: false };
  const [state, setState] = useState({ identity, busy: false, recovery: "" });

  const save = async <
    T extends object,
    R extends { id: string } | { id: string }[],
  >(
    path: FinancialAttachmentPath,
    input: T,
    send: (body: T) => Promise<R>,
    expectedVouchers: 1 | 2 = 1,
  ): Promise<R> => {
    attachments.assertActive();
    const current = operation.current;
    if (current.working) throw new Error("This save is already in progress.");
    if (current.draft)
      throw new Error(
        "Recover the original save in Pending uploads. Do not save another entry to retry its attachments.",
      );
    if (!role || !firmId) throw new Error("Choose a firm first.");
    const actor = { userId, firmId, role };
    current.working = true;
    setState({ identity, busy: true, recovery: "" });
    try {
      if (!attachments.files.length) return await send(input);
      current.draft = await drafts.prepare(
        actor,
        path,
        input,
        attachments.files,
        expectedVouchers,
        attachments.assertActive,
        offline ? "operations-v1" : undefined,
      );
      const result = await drafts.submit(
        actor,
        current.draft,
        (body) => send(body as T),
        attachments.assertActive,
      );
      attachments.assertActive();
      if (result.warning)
        showError(
          "Entry saved; attachments need attention",
          new Error(result.warning),
        );
      else {
        for (const reference of result.references) {
          let file;
          try {
            attachments.assertActive();
            const record = await attachmentStorage.read(
              reference.scope,
              reference.id,
            );
            if (!record) continue;
            file = await queue.open(actor, reference, attachments.assertActive);
            const saved = await add.mutateAsync({
              ...pendingAttachmentInput(record),
              file,
            });
            await queue.complete(file, saved);
          } catch (error) {
            attachments.assertActive();
            showError("Entry saved; attachments need attention", error);
            break;
          } finally {
            if (file) queue.release(file);
          }
        }
      }
      attachments.assertActive();
      return (path === "/sales/split"
        ? result.response
        : result.response[0]) as unknown as R;
    } catch (error) {
      if (operation.current === current)
        setState({
          identity,
          busy: false,
          recovery: current.draft
            ? "The original request and available copies are retained in Pending uploads."
            : attachments.files.length
              ? "Attachment preparation did not finish. Check Pending uploads for preserved copies before trying again."
              : "",
        });
      throw error;
    } finally {
      current.working = false;
      if (operation.current === current)
        setState((value) => ({ ...value, busy: false }));
    }
  };
  return {
    ...attachments,
    save,
    busy: attachments.busy || (state.identity === identity && state.busy),
    recovery: state.identity === identity ? state.recovery : "",
    setFiles: async (files: Parameters<typeof attachments.setFiles>[0]) => {
      if (operation.current.working || operation.current.draft)
        throw new Error(
          "The original attachment selection is retained. Open Pending uploads to recover it.",
        );
      await attachments.setFiles(files);
    },
  };
}
