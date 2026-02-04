import { useEffect, useRef, useState } from "react";
import * as Crypto from "expo-crypto";
import type {
  DocumentFile,
  NewDocumentInput,
  StoredDocument,
} from "@repo/core";
import { useAuth } from "@/auth/AuthProvider";
import { sessionStore } from "@/auth/session";
import { showError } from "@/components";
import { useData } from "@/data/DataProvider";
import { useAddDocument } from "@/data/queries";
import {
  createAttachmentQueue,
  attachmentRetry,
  type AttachmentScope,
} from "@/data/attachmentRecovery";
import { attachmentStorage } from "@/data/attachmentStorage";

const queue = createAttachmentQueue(attachmentStorage, Crypto.randomUUID);
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The file transfer failed.";

export function useEntryAttachments(
  voucherId?: string,
  target: "voucher" | "account" | "library" = "voucher",
) {
  const { userId, firmId, accessKey } = useData();
  const { status, locked } = useAuth();
  const viewKey = JSON.stringify([userId, firmId, target, voucherId]);
  const mounted = useRef(true);
  const active = useRef(false);
  const running = useRef<number | null>(null);
  const generation = useRef({ identity: "", value: 0 });
  const owned = useRef(new Set<DocumentFile>());
  active.current = status === "signedIn" && !locked && !!firmId;
  const sessionRevision = sessionStore.revision;
  const identity = JSON.stringify([
    viewKey,
    accessKey,
    status,
    locked,
    sessionRevision,
  ]);
  if (generation.current.identity !== identity)
    generation.current = { identity, value: generation.current.value + 1 };
  const revision = generation.current.value;
  const [state, setState] = useState({
    key: viewKey,
    files: [] as DocumentFile[],
    busy: !!voucherId,
    error: "",
  });
  const add = useAddDocument();
  const files = state.key === viewKey && active.current ? state.files : [];
  const assertActive = () => {
    if (
      !mounted.current ||
      generation.current.value !== revision ||
      sessionStore.revision !== sessionRevision ||
      !active.current
    )
      throw new Error(
        "The open account or firm changed. Reopen the original entry to retry its attachments.",
      );
  };
  const scopeFor = (entryId: string): AttachmentScope => {
    assertActive();
    if (!entryId || !firmId) throw new Error("Choose a saved entry first.");
    return { userId, firmId, target, entryId };
  };
  const keep = (next: DocumentFile[]) => {
    next.forEach((file) => owned.current.add(file));
    return next;
  };
  const show = (next: DocumentFile[], error = "", busy = false) => {
    if (mounted.current && generation.current.value === revision)
      setState({ key: viewKey, files: next, error, busy });
  };

  useEffect(() => {
    const ownedFiles = owned.current;
    mounted.current = true;
    show([], "", !!voucherId);
    return () => {
      mounted.current = false;
      ownedFiles.forEach(queue.release);
      ownedFiles.clear();
    };
    // Each account, firm and entry owns its preview URLs, never its source files.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  useEffect(() => {
    let cancelled = false;
    if (voucherId && active.current) {
      void queue.load(scopeFor(voucherId), assertActive).then(
        (restored) => {
          if (cancelled) restored.forEach(queue.release);
          else show(keep(restored));
        },
        (error) => {
          if (!cancelled) show([], message(error));
        },
      );
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  const changeFiles = async (next: DocumentFile[]) => {
    assertActive();
    if (running.current === revision || state.busy)
      throw new Error("Wait for the attachments to finish loading.");
    if (!voucherId) {
      show(next);
      return;
    }
    running.current = revision;
    show(files, "", true);
    try {
      const staged = keep(
        await queue.stage(scopeFor(voucherId), next, assertActive),
      );
      for (const file of files.filter((file) => !next.includes(file)))
        await queue.discard(file);
      assertActive();
      show(staged);
    } catch (error) {
      show(files, message(error));
      throw error;
    } finally {
      if (running.current === revision) running.current = null;
    }
  };

  const attachTo = async (
    id: string,
    details?: Omit<NewDocumentInput, "name">,
  ) => {
    assertActive();
    if (running.current === revision) return;
    running.current = revision;
    show(files, "", true);
    let remaining: DocumentFile[] = files;
    const uploaded: StoredDocument[] = [];
    try {
      const scope = scopeFor(id);
      const staged = keep(await queue.stage(scope, files, assertActive));
      remaining = keep(await queue.load(scope, assertActive));
      if (target === "library") {
        const selected = new Set(
          staged.map((file) => attachmentRetry(file)!.id),
        );
        remaining = remaining.filter((file) =>
          selected.has(attachmentRetry(file)!.id),
        );
        if (!details)
          throw new Error("Check the document details before uploading.");
        await queue.describe(scope, remaining, details, assertActive);
      }
      for (const file of [...remaining]) {
        assertActive();
        const metadata =
          target === "library"
            ? (await attachmentRetry(file)!.read()).input!
            : {
                name: file.name,
                kind: "bill" as const,
                ...(target === "voucher"
                  ? { voucherId: id }
                  : { accountKey: id }),
              };
        const saved = await add.mutateAsync({
          ...metadata,
          file,
        });
        await queue.complete(file, saved);
        uploaded.push(saved);
        remaining = remaining.filter((value) => value !== file);
      }
      assertActive();
      show(remaining);
      return uploaded;
    } catch (error) {
      if (
        !mounted.current ||
        generation.current.value !== revision ||
        !active.current
      )
        throw error;
      show(remaining, message(error));
      // An attachment failure must never make a saved financial entry look unsaved.
      showError(
        target === "library"
          ? "Pending documents need attention"
          : "Entry saved; attachments need attention",
        error,
      );
    } finally {
      if (running.current === revision) running.current = null;
      if (mounted.current && generation.current.value === revision)
        setState((value) => ({ ...value, busy: false }));
    }
  };

  return {
    assertActive,
    files,
    setFiles: changeFiles,
    busy: state.key !== viewKey || state.busy,
    error: state.key === viewKey ? state.error : "",
    attachTo,
  };
}
