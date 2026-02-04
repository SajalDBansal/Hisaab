import { z } from "zod";
import { CustomAccount, LedgerRow } from "@repo/contracts";
import type { DocumentFile } from "@repo/core";
import {
  AttachmentRecord,
  attachmentOwnedBy,
  attachmentScopeKey,
  type AttachmentReference,
  type AttachmentScope,
  type AttachmentStorage,
} from "./attachmentRecovery";
import {
  AttachmentDraft,
  AttachmentAnswer,
  attachmentDraftProblem,
  canRecoverAttachmentDraft,
  financialAttachmentTypes,
  type DraftActor,
  type FinancialAttachmentPath,
} from "./attachmentDraftModel";
import { bindPendingWrite, ConfirmedWriteError } from "./pendingWrites";
import type { OperationResult } from "./offlineOperation";

export type DraftRecord = AttachmentRecord & { draft: AttachmentDraft };
export type PendingAttachmentDraft = {
  record: DraftRecord;
  missingFiles: string[];
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Attachment recovery failed.";
const responseOf = (value: unknown) =>
  z
    .array(AttachmentAnswer)
    .min(1)
    .parse(Array.isArray(value) ? value : [value]);
const signature = (path: string, body: object) => JSON.stringify([path, body]);

export function createAttachmentDrafts(
  storage: AttachmentStorage,
  newId: () => string,
) {
  function check(
    actor: DraftActor,
    record: DraftRecord,
    assertActive: () => void,
  ) {
    assertActive();
    if (
      !attachmentOwnedBy(record.scope, actor) ||
      !canRecoverAttachmentDraft(actor.role, record.draft)
    )
      throw new Error(
        "This draft belongs to a different account, firm or role.",
      );
  }
  async function read(reference: AttachmentReference): Promise<DraftRecord> {
    const record = await storage.read(reference.scope, reference.id);
    if (
      !record?.draft ||
      record.scope.target !== "draft" ||
      record.scope.entryId !== record.id
    )
      throw new Error("This attachment draft is unavailable.");
    return record as DraftRecord;
  }
  async function write(record: DraftRecord) {
    await storage.write(AttachmentRecord.parse(record));
  }
  async function rememberResponse(record: DraftRecord, value: unknown) {
    const response = responseOf(value);
    if (record.draft.response) {
      if (JSON.stringify(record.draft.response) !== JSON.stringify(response))
        throw new Error("The original saved answer cannot change.");
      return record;
    }
    const links = response.flatMap((entry) =>
      record.draft.files.map((file) => ({
        sourceId: file.id,
        id: newId(),
        voucherId: entry.id,
        released: false,
      })),
    );
    const saved = {
      ...record,
      failure: undefined,
      draft: { ...record.draft, response, links },
    };
    await write(saved);
    return saved;
  }

  async function prepare(
    actor: DraftActor,
    path: FinancialAttachmentPath,
    body: object,
    files: DocumentFile[],
    expectedVouchers: 1 | 2,
    assertActive: () => void,
    receiptProtocol?: "operations-v1",
  ) {
    if (
      actor.userId === "demo" ||
      actor.userId === "signed-out" ||
      !actor.firmId
    )
      throw new Error("Sign in and choose a firm before saving attachments.");
    if (expectedVouchers === 2 && path !== "/sales/split")
      throw new Error(
        "Only a mixed sale can bind attachments to two invoices.",
      );
    // JSON normalization preserves the exact request across restart, without local runtime bindings.
    const immutableBody = JSON.parse(JSON.stringify(body)) as Record<
      string,
      unknown
    >;
    return storage.lock(
      `drafts:${JSON.stringify([actor.userId, actor.firmId])}`,
      async () => {
        assertActive();
        for (const scope of await storage.scopes(actor)) {
          if (scope.target !== "draft") continue;
          const existing = await storage.read(scope, scope.entryId);
          if (
            existing?.draft &&
            signature(existing.draft.path, existing.draft.body) ===
              signature(path, immutableBody)
          )
            throw new Error(
              "This request already has a retained attachment draft. Recover its original save in Pending uploads before saving it again.",
            );
        }
        const id = newId();
        const scope: AttachmentScope = {
          userId: actor.userId,
          firmId: actor.firmId,
          target: "draft",
          entryId: id,
        };
        const draft = AttachmentDraft.parse({
          role: actor.role,
          path,
          body: immutableBody,
          createdAt: Date.now(),
          ready: false,
          receiptProtocol,
          expectedVouchers,
          binding: "all-returned-vouchers",
          files: files.map((file, index) => ({
            id: index ? newId() : id,
            file,
          })),
        });
        let record = AttachmentRecord.parse({
          version: 1,
          id,
          order: 0,
          scope,
          file: draft.files[0]!.file,
          draft,
        }) as DraftRecord;
        check(actor, record, assertActive);
        return storage.lock(attachmentScopeKey(scope), async () => {
          try {
            for (const [index, entry] of draft.files.entries()) {
              check(actor, record, assertActive);
              await storage.write(
                index === 0
                  ? record
                  : {
                      version: 1,
                      id: entry.id,
                      order: index,
                      scope,
                      file: entry.file,
                    },
                files[index],
              );
            }
            check(actor, record, assertActive);
            record = { ...record, draft: { ...draft, ready: true } };
            await write(record);
            return record;
          } catch (error) {
            const saved = await storage.read(scope, id);
            if (saved)
              await storage
                .write({
                  ...saved,
                  failure: {
                    message: message(error).slice(0, 1000),
                    at: Date.now(),
                  },
                })
                .catch(() => {});
            throw error;
          }
        });
      },
    );
  }

  async function list(
    actor: DraftActor,
    assertActive: () => void,
  ): Promise<PendingAttachmentDraft[]> {
    assertActive();
    const result: PendingAttachmentDraft[] = [];
    for (const scope of await storage.scopes(actor)) {
      if (scope.target !== "draft") continue;
      await storage.lock(attachmentScopeKey(scope), async () => {
        assertActive();
        const saved = await storage.read(scope, scope.entryId);
        if (
          !saved?.draft ||
          !attachmentOwnedBy(saved.scope, actor) ||
          !canRecoverAttachmentDraft(actor.role, saved.draft)
        )
          return;
        const record = saved as DraftRecord;
        const missingFiles: string[] = [];
        for (const entry of record.draft.files) {
          try {
            const file = await storage.read(scope, entry.id);
            if (!file) throw new Error("Missing copy");
            storage.release(await storage.open(file));
          } catch {
            missingFiles.push(entry.file.name);
          }
        }
        check(actor, record, assertActive);
        result.push({ record, missingFiles });
      });
    }
    return result.sort(
      (a, b) => a.record.draft.createdAt - b.record.draft.createdAt,
    );
  }

  // Caller holds the draft lock. Targets stay unavailable until release is durable.
  async function publish(
    initial: DraftRecord,
    actor: DraftActor,
    assertActive: () => void,
  ) {
    let record = initial;
    const draft = record.draft;
    if (
      !draft.response ||
      draft.response.length !== draft.expectedVouchers ||
      new Set(draft.response.map((voucher) => voucher.id)).size !==
        draft.expectedVouchers ||
      draft.response.some((entry) =>
        draft.path === "/accounts/masters"
          ? !CustomAccount.safeParse(entry).success
          : draft.path === "/ledgers"
            ? !LedgerRow.safeParse(entry).success
            : !("type" in entry) ||
              entry.type !== financialAttachmentTypes[draft.path],
      ) ||
      (draft.expectedVouchers === 2 &&
        (draft.path !== "/sales/split" ||
          !draft.response.some(
            (voucher) => "bookScope" in voucher && voucher.bookScope === "gst",
          ) ||
          !draft.response.some(
            (voucher) =>
              "bookScope" in voucher && voucher.bookScope === "nongst",
          )))
    )
      throw new Error(
        "The saved entries do not match the confirmed attachment binding plan. Keep this draft for reconciliation.",
      );
    if (
      draft.links.length !== draft.files.length * draft.expectedVouchers ||
      new Set(draft.links.map((link) => link.id)).size !== draft.links.length ||
      draft.response.some((voucher) =>
        draft.files.some(
          (file) =>
            draft.links.filter(
              (link) =>
                link.voucherId === voucher.id && link.sourceId === file.id,
            ).length !== 1,
        ),
      )
    )
      throw new Error("The saved attachment binding plan is incomplete.");
    const references: AttachmentReference[] = [];
    for (let index = 0; index < record.draft.links.length; index++) {
      const link = record.draft.links[index]!;
      const scope: AttachmentScope = {
        ...record.scope,
        target:
          draft.path === "/accounts/masters" || draft.path === "/ledgers"
            ? "account"
            : "voucher",
        entryId:
          draft.path === "/accounts/masters"
            ? `account:${link.voucherId}`
            : draft.path === "/ledgers"
              ? `ledger:${link.voucherId}`
              : link.voucherId,
      };
      references.push({ scope, id: link.id });
      await storage.lock(attachmentScopeKey(scope), async () => {
        check(actor, record, assertActive);
        let destination = await storage.read(scope, link.id);
        if (
          destination &&
          (destination.draftOrigin?.operationId !== record.id ||
            destination.draftOrigin.sourceId !== link.sourceId)
        )
          throw new Error(
            "An attachment binding belongs to another operation.",
          );
        if (!link.released || destination?.bindingPending) {
          if (destination) {
            try {
              storage.release(await storage.open(destination));
            } catch (error) {
              if (
                !destination.bindingPending ||
                destination.progress ||
                destination.completed
              )
                throw error;
              await storage.remove(destination);
              destination = null;
            }
          }
          if (!destination) {
            const source = await storage.read(record.scope, link.sourceId);
            if (!source)
              throw new Error(
                "A preserved draft copy is missing. Keep this draft for reconciliation.",
              );
            const file = await storage.open(source);
            try {
              destination = {
                version: 1,
                id: link.id,
                order: index,
                scope,
                file: source.file,
                reservation: {},
                input: {
                  kind: "bill",
                  name: source.file.name,
                  ...(scope.target === "account"
                    ? { accountKey: scope.entryId }
                    : { voucherId: link.voucherId }),
                },
                bindingPending: true,
                draftOrigin: { operationId: record.id, sourceId: source.id },
              };
              check(actor, record, assertActive);
              await storage.write(destination, file);
            } finally {
              storage.release(file);
            }
          }
          // A published destination can disappear after upload/discard. Record release BEFORE exposing it.
          if (!link.released) {
            const links = record.draft.links.map((value, i) =>
              i === index ? { ...value, released: true } : value,
            );
            record = { ...record, draft: { ...record.draft, links } };
            await write(record);
          }
        }
        check(actor, record, assertActive);
        if (destination?.bindingPending)
          await storage.write({ ...destination, bindingPending: false });
      });
    }
    // Remove the manifest last so an interrupted cleanup remains resumable without publishing again.
    for (const entry of [
      ...record.draft.files.slice(1),
      record.draft.files[0]!,
    ]) {
      check(actor, record, assertActive);
      const source = await storage.read(record.scope, entry.id);
      if (source) await storage.remove(source);
    }
    return references;
  }

  async function submit(
    actor: DraftActor,
    reference: AttachmentReference,
    send: (body: Record<string, unknown>) => Promise<unknown>,
    assertActive: () => void,
    reconcile?: (record: DraftRecord) => Promise<OperationResult>,
  ) {
    return storage.lock(attachmentScopeKey(reference.scope), async () => {
      let record = await read(reference);
      check(actor, record, assertActive);
      let response = record.draft.response;
      let warning: string | undefined;
      if (!response && reconcile && !record.draft.cancelled) {
        const result = await reconcile(record);
        check(actor, record, assertActive);
        if (result.state === "committed") {
          record = await rememberResponse(record, result.response);
          response = record.draft.response;
        } else if (result.state === "cancelled") {
          await write({
            ...record,
            draft: { ...record.draft, cancelled: true },
          });
          throw new Error(
            "The original operation was cancelled. Its copies can now be discarded.",
          );
        } else if (result.state === "conflict" || result.state === "unknown")
          throw new Error(result.message);
        else if (
          record.draft.firstAttemptAt !== undefined &&
          !record.draft.receiptProtocol
        )
          throw new Error(
            "The legacy result cannot be proven. This request will not be posted again.",
          );
      }
      if (!response) {
        const problem = attachmentDraftProblem(record.draft);
        if (problem) throw new Error(problem);
        for (const entry of record.draft.files) {
          const source = await storage.read(record.scope, entry.id);
          if (!source)
            throw new Error(
              "A preserved draft copy is missing. No additional financial request was sent.",
            );
          storage.release(await storage.open(source));
        }
        const body = JSON.parse(JSON.stringify(record.draft.body)) as Record<
          string,
          unknown
        >;
        let prepared = false;
        bindPendingWrite(body, {
          key: record.id,
          userId: actor.userId,
          firmId: actor.firmId,
          path: record.draft.path,
          legacy:
            record.draft.receiptProtocol !== "operations-v1" &&
            record.draft.firstAttemptAt !== undefined,
          assertActive: () => check(actor, record, assertActive),
          beforeSend: async () => {
            check(actor, record, assertActive);
            if (
              signature(record.draft.path, body) !==
              signature(record.draft.path, record.draft.body)
            )
              throw new Error(
                "The original financial request cannot change during recovery.",
              );
            record = {
              ...record,
              failure: undefined,
              draft: {
                ...record.draft,
                firstAttemptAt: record.draft.firstAttemptAt ?? Date.now(),
              },
            };
            await write(record);
            prepared = true;
          },
          afterValidatedResponse: async (value) => {
            response = responseOf(value);
            const links = response.flatMap((voucher) =>
              record.draft.files.map((file) => ({
                sourceId: file.id,
                id: newId(),
                voucherId: voucher.id,
                released: false,
              })),
            );
            record = {
              ...record,
              failure: undefined,
              draft: { ...record.draft, response, links },
            };
            // Persist the validated answer even if logout happened while the server was replying.
            await write(record);
          },
        });
        try {
          await send(body);
          if (!prepared || !response)
            throw new Error(
              "The financial request did not run its durable attachment lifecycle.",
            );
        } catch (error) {
          if (error instanceof ConfirmedWriteError) {
            response = responseOf(error.response);
            warning = error.message;
          } else if (!response) {
            const saved = await read(reference);
            await write({
              ...saved,
              failure: {
                message: message(error).slice(0, 1000),
                at: Date.now(),
              },
            }).catch(() => {});
            throw new Error(
              `The original save is not confirmed. Open Pending uploads to check it using the same request key. ${message(error)}`,
              { cause: error },
            );
          }
        }
      }
      let references: AttachmentReference[] = [];
      if (!warning) {
        try {
          // Read back the durable receipt instead of binding from an uncommitted in-memory result.
          record = await read(reference);
          references = await publish(record, actor, assertActive);
        } catch (error) {
          warning = `Entry saved; attachment binding needs recovery. ${message(error)}`;
          const saved = await storage.read(reference.scope, reference.id);
          if (saved)
            await storage
              .write({
                ...saved,
                failure: { message: warning.slice(0, 1000), at: Date.now() },
              })
              .catch(() => {});
        }
      }
      return { response: response!, references, warning };
    });
  }

  async function discard(
    actor: DraftActor,
    reference: AttachmentReference,
    assertActive: () => void,
  ) {
    return storage.lock(attachmentScopeKey(reference.scope), async () => {
      const record = await read(reference);
      check(actor, record, assertActive);
      if (
        !record.draft.cancelled &&
        (record.draft.firstAttemptAt !== undefined || record.draft.response)
      )
        throw new Error(
          "Recover the original save before discarding its draft. Its financial result may already exist.",
        );
      for (const entry of [
        ...record.draft.files.slice(1),
        record.draft.files[0]!,
      ]) {
        check(actor, record, assertActive);
        const source = await storage.read(record.scope, entry.id);
        if (source) await storage.remove(source);
      }
    });
  }
  async function receive(
    actor: DraftActor,
    reference: AttachmentReference,
    result: OperationResult,
    assertActive: () => void,
  ) {
    return storage.lock(attachmentScopeKey(reference.scope), async () => {
      const saved = await storage.read(reference.scope, reference.id);
      if (!saved?.draft) return;
      let record = saved as DraftRecord;
      check(actor, record, assertActive);
      if (result.state === "cancelled") {
        await write({ ...record, draft: { ...record.draft, cancelled: true } });
        return;
      }
      if (result.state !== "committed") return;
      record = await rememberResponse(record, result.response);
      try {
        await publish(record, actor, assertActive);
      } catch (error) {
        const latest = await read(reference);
        await write({
          ...latest,
          failure: { message: message(error).slice(0, 1000), at: Date.now() },
        });
        throw error;
      }
    });
  }
  async function checkCopies(
    actor: DraftActor,
    reference: AttachmentReference,
    assertActive: () => void,
  ) {
    // The outbox owns its lock here, possibly inside a form's draft lock. Read only:
    // attempted drafts cannot be discarded, and confirmed responses are looked up first.
    const record = await read(reference);
    check(actor, record, assertActive);
    if (!record.draft.ready || record.draft.cancelled || record.draft.response)
      throw new Error(
        "The original attachment draft needs reconciliation before posting.",
      );
    for (const item of record.draft.files) {
      const copy = await storage.read(record.scope, item.id);
      if (!copy)
        throw new Error(
          "A preserved attachment copy is missing. No new financial request was sent.",
        );
      storage.release(await storage.open(copy));
      check(actor, record, assertActive);
    }
  }
  return { prepare, list, submit, discard, receive, checkCopies };
}
