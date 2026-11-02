import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import * as Crypto from "expo-crypto";
import { useAuth } from "@/auth/AuthProvider";
import { sessionStore } from "@/auth/session";
import { api } from "@/auth/api";
import { recoverUpload } from "@/data/recoverUpload";
import { useData } from "@/data/DataProvider";
import { useAddDocument } from "@/data/queries";
import {
  attachmentRetry,
  createAttachmentQueue,
  type AttachmentReference,
  type PendingAttachment,
} from "@/data/attachmentRecovery";
import { attachmentStorage } from "@/data/attachmentStorage";
import {
  pendingAttachmentInput,
  pendingAttachmentProblem,
} from "./pendingAttachmentActions";

const queue = createAttachmentQueue(attachmentStorage, Crypto.randomUUID);
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The pending upload operation failed.";

export function usePendingAttachments() {
  const { userId, firmId, accessKey } = useData();
  const { status, locked } = useAuth();
  const enabled =
    status === "signedIn" &&
    !locked &&
    !!firmId &&
    userId !== "demo" &&
    userId !== "signed-out";
  const sessionRevision = sessionStore.revision;
  const identity = JSON.stringify([
    userId,
    firmId,
    accessKey,
    status,
    locked,
    sessionRevision,
  ]);
  const current = useRef(identity);
  const mounted = useRef(true);
  const running = useRef(false);
  const listRevision = useRef(0);
  current.current = identity;
  const [state, setState] = useState({
    identity,
    items: [] as PendingAttachment[],
    loading: true,
    busy: false,
    error: "",
    notice: "",
  });
  const add = useAddDocument();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isActive = useCallback(
    () =>
      mounted.current &&
      enabled &&
      current.current === identity &&
      sessionStore.revision === sessionRevision,
    [enabled, identity, sessionRevision],
  );
  const assertActive = useCallback(() => {
    if (!isActive())
      throw new Error(
        "The account, firm or access changed. Reopen pending uploads to continue.",
      );
  }, [isActive]);
  const refresh = useCallback(async () => {
    if (!isActive() || !firmId) return;
    const revision = ++listRevision.current;
    setState((old) => ({
      ...old,
      ...(old.identity === identity
        ? {}
        : { items: [], error: "", notice: "" }),
      identity,
      loading: true,
    }));
    try {
      const items = await queue.enumerate({ userId, firmId }, assertActive);
      if (isActive() && revision === listRevision.current)
        setState((old) => ({
          ...old,
          identity,
          items,
          loading: false,
          error: "",
        }));
    } catch (error) {
      if (isActive() && revision === listRevision.current)
        setState((old) => ({
          ...old,
          identity,
          loading: false,
          error: message(error),
        }));
    }
  }, [assertActive, firmId, identity, isActive, userId]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const execute = async (work: () => Promise<string>) => {
    if (!isActive() || running.current) return;
    running.current = true;
    setState((old) => ({ ...old, busy: true, error: "", notice: "" }));
    try {
      const notice = await work();
      assertActive();
      setState((old) => ({ ...old, notice }));
    } catch (error) {
      if (isActive()) setState((old) => ({ ...old, notice: message(error) }));
    } finally {
      running.current = false;
      if (isActive()) {
        setState((old) => ({ ...old, busy: false }));
        await refresh();
      }
    }
  };
  const owner = { userId, firmId: firmId ?? "" };
  const retry = (references: AttachmentReference[]) =>
    execute(async () => {
      let uploaded = 0,
        failed = 0;
      for (const reference of references) {
        assertActive();
        let file;
        try {
          file = await queue.open(owner, reference, assertActive);
          const record = await attachmentRetry(file)!.read();
          if (!record.completed) {
            const problem = pendingAttachmentProblem({
              record,
              fileError: attachmentRetry(file)?.fileError,
            });
            if (problem) throw new Error(problem);
          }
          const saved =
            record.completed ??
            (await add.mutateAsync({
              ...pendingAttachmentInput(record),
              file,
            }));
          await queue.complete(file, saved);
          uploaded++;
        } catch {
          assertActive();
          failed++;
        } finally {
          if (file) queue.release(file);
        }
      }
      return `${uploaded} confirmed; ${failed} still need attention.`;
    });
  const discard = (references: AttachmentReference[]) =>
    execute(async () => {
      const result = await queue.discardMany(owner, references, assertActive);
      return (
        `${result.discarded} pending copies discarded; ${result.completed} already confirmed; ${result.missing} already removed.` +
        (result.failures.length
          ? ` ${result.failures.length} could not be removed: ${result.failures[0]!.message}`
          : "")
      );
    });
  const cleanup = (references: AttachmentReference[]) =>
    execute(async () => {
      await queue.cleanupCompleted(owner, references, assertActive);
      return "Confirmed local copies cleaned up.";
    });
  const recover = (reference: AttachmentReference) =>
    execute(async () => {
      await queue.recover(
        owner,
        reference,
        (record, epoch) => recoverUpload(record, api, epoch),
        assertActive,
      );
      return "Restored reservation checked. The local file is kept; retry its existing upload or clean the confirmed copy.";
    });
  return {
    items: enabled && state.identity === identity ? state.items : [],
    enabled,
    busy: state.busy,
    loading: enabled && (state.identity !== identity || state.loading),
    error: enabled && state.identity === identity ? state.error : "",
    notice: enabled && state.identity === identity ? state.notice : "",
    refresh,
    retry,
    discard,
    cleanup,
    recover,
    assertActive,
  };
}
