import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import * as Crypto from "expo-crypto";
import { formatINR } from "@repo/core";
import { Button, Notice, Txt } from "@/components";
import { useAuth } from "@/auth/AuthProvider";
import { sessionStore } from "@/auth/session";
import { useData } from "@/data/DataProvider";
import { useRefreshAll } from "@/data/queries";
import { confirmAction } from "@/data/confirm";
import { attachmentStorage } from "@/data/attachmentStorage";
import {
  createAttachmentDrafts,
  type PendingAttachmentDraft,
} from "@/data/attachmentDrafts";
import {
  attachmentDraftProblem,
  type FinancialAttachmentPath,
} from "@/data/attachmentDraftModel";
import { sendAttachmentDraft } from "@/data/voucherServices";
import { colors, space } from "@/theme";

const drafts = createAttachmentDrafts(attachmentStorage, Crypto.randomUUID);
const labels: Record<FinancialAttachmentPath, string> = {
  "/inventory/adjustments": "Stock adjustment",
  "/accounts/masters": "Account",
  "/ledgers": "Cash/bank account",
  "/sales": "Sale",
  "/sales/split": "Sale",
  "/purchases": "Purchase",
  "/receipts": "Receipt",
  "/payments": "Payment",
  "/expenses": "Expense",
  "/journals": "Journal",
  "/contras": "Contra",
  "/credit-notes": "Credit note",
  "/debit-notes": "Debit note",
  "/orders/estimate": "Estimate",
  "/orders/sales-order": "Sales order",
  "/orders/purchase-order": "Purchase order",
  "/orders/delivery-note": "Delivery note",
};

export function PendingFinancialDrafts({
  onChanged,
  refreshSignal,
}: {
  onChanged(): Promise<void>;
  refreshSignal: unknown;
}) {
  const { userId, firmId, role, accessKey, services, offline } = useData();
  const { status, locked } = useAuth();
  const invalidate = useRefreshAll();
  const sessionRevision = sessionStore.revision;
  const identity = JSON.stringify([
    userId,
    firmId,
    role,
    accessKey,
    status,
    locked,
    sessionRevision,
  ]);
  const current = useRef(identity);
  const mounted = useRef(true);
  const running = useRef(false);
  current.current = identity;
  const [state, setState] = useState({
    identity,
    items: [] as PendingAttachmentDraft[],
    busy: false,
    error: "",
  });
  const enabled =
    status === "signedIn" &&
    !locked &&
    !!role &&
    !!firmId &&
    userId !== "demo" &&
    userId !== "signed-out";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const active = useCallback(
    () =>
      enabled &&
      mounted.current &&
      current.current === identity &&
      sessionStore.revision === sessionRevision,
    [enabled, identity, sessionRevision],
  );
  const assertActive = useCallback(() => {
    if (!active())
      throw new Error(
        "The account, firm or role changed. Reopen Pending uploads.",
      );
  }, [active]);
  const refresh = useCallback(async () => {
    if (!active() || !role || !firmId) return;
    try {
      const items = await drafts.list({ userId, firmId, role }, assertActive);
      if (active()) setState((old) => ({ ...old, identity, items }));
    } catch (error) {
      if (active())
        setState((old) => ({ ...old, identity, error: String(error) }));
    }
  }, [active, assertActive, firmId, identity, role, userId]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  useEffect(() => {
    void refresh();
  }, [refresh, refreshSignal]);
  const run = async (item: PendingAttachmentDraft, discard = false) => {
    if (!active() || !firmId || !role || running.current) return;
    running.current = true;
    setState((old) => ({ ...old, busy: true, error: "" }));
    try {
      const actor = { userId, firmId, role };
      if (discard) await drafts.discard(actor, item.record, assertActive);
      else {
        const result = await drafts.submit(
          actor,
          item.record,
          (body) => sendAttachmentDraft(services, item.record.draft.path, body),
          assertActive,
          offline
            ? (record) =>
                offline.lookupOriginal(record.id, {
                  method: "POST",
                  path: record.draft.path,
                  body: record.draft.body,
                  role: record.draft.role,
                  legacy:
                    !record.draft.receiptProtocol &&
                    record.draft.firstAttemptAt !== undefined,
                })
            : undefined,
        );
        assertActive();
        await invalidate();
        if (result.warning)
          setState((old) => ({ ...old, error: result.warning! }));
      }
      assertActive();
      await onChanged();
    } catch (error) {
      if (active())
        setState((old) => ({
          ...old,
          error: error instanceof Error ? error.message : "Recovery failed.",
        }));
    } finally {
      running.current = false;
      if (active()) {
        setState((old) => ({ ...old, busy: false }));
        await refresh();
      }
    }
  };
  if (!enabled || state.identity !== identity) return null;
  return (
    <>
      {state.error ? <Notice tone="warn" text={state.error} /> : null}
      {state.items.length ? (
        <Txt variant="heading">Retained entry saves</Txt>
      ) : null}
      {state.items.map((item) => {
        const { record, missingFiles } = item;
        const draft = record.draft;
        const problem = attachmentDraftProblem(draft);
        const title = labels[draft.path];
        const date = typeof draft.body.date === "string" ? draft.body.date : "";
        const amount =
          typeof draft.body.amount === "number"
            ? formatINR(draft.body.amount)
            : "";
        const summary = `${title}${date ? `, ${date}` : ""}${amount ? `, ${amount}` : ""}`;
        const canDiscard =
          (draft.firstAttemptAt === undefined || draft.cancelled) &&
          !draft.response;
        return (
          <View
            key={record.id}
            style={{
              gap: space.sm,
              paddingVertical: space.md,
              borderBottomWidth: 1,
              borderColor: colors.hairline,
            }}
          >
            <Txt variant="bodyStrong">{summary}</Txt>
            <Txt variant="small">
              {draft.files.map(({ file }) => file.name).join(", ")}
            </Txt>
            <Txt variant="small" tone="body">
              {draft.expectedVouchers === 2
                ? "Every file belongs to both invoices."
                : "Files belong to the original entry."}
            </Txt>
            <Txt variant="small" tone="warn">
              {problem ??
                (draft.response
                  ? "Entry saved; attachment binding pending."
                  : draft.firstAttemptAt
                    ? "Save result unknown. Original request retained."
                    : "Files preserved; original save not sent.")}
            </Txt>
            {missingFiles.length ? (
              <Txt variant="small" tone="warn">
                Missing draft copies: {missingFiles.join(", ")}
              </Txt>
            ) : null}
            {record.failure ? (
              <Txt variant="small" tone="warn">
                Last failure: {record.failure.message}
              </Txt>
            ) : null}
            <View
              style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}
            >
              <Button
                label={
                  draft.response
                    ? "Finish attachment binding"
                    : "Check original save"
                }
                icon="refresh-cw"
                size="sm"
                disabled={
                  state.busy ||
                  !!draft.cancelled ||
                  (!offline &&
                    (!!problem || (!draft.response && !!missingFiles.length)))
                }
                onPress={() =>
                  confirmAction(
                    draft.response
                      ? "Finish saved entry attachments?"
                      : "Resume the original save?",
                    `${summary}\n\n${draft.response ? "This finishes local attachment binding. No financial request will be sent." : "This sends the original retained request using its original key. If already saved, the server returns that answer. If never received, it can save this original entry once. Edited form values are not used."}`,
                    "Continue",
                    () => void run(item),
                  )
                }
              />
              {canDiscard ? (
                <Button
                  label="Discard draft copies"
                  icon="trash-2"
                  size="sm"
                  variant="danger"
                  disabled={state.busy}
                  onPress={() =>
                    confirmAction(
                      "Discard unsent draft copies?",
                      `${summary}\n\n${draft.cancelled ? "The original request is definitively cancelled or rejected." : "No financial request was sent."} Only this draft's app-owned copies will be removed. Original files are kept.`,
                      "Discard",
                      () => void run(item, true),
                    )
                  }
                />
              ) : null}
              {draft.response?.map((voucher) => (
                <Button
                  key={voucher.id}
                  label={`Open ${"number" in voucher ? voucher.number : voucher.name}`}
                  icon="external-link"
                  size="sm"
                  disabled={state.busy}
                  onPress={() => {
                    assertActive();
                    if (draft.path === "/accounts/masters")
                      router.push({
                        pathname: "/account/[key]",
                        params: { key: `account:${voucher.id}` },
                      });
                    else if (draft.path === "/ledgers")
                      router.push({
                        pathname: "/ledger/[id]",
                        params: { id: voucher.id },
                      });
                    else
                      router.push({
                        pathname: "/voucher/[id]",
                        params: { id: voucher.id },
                      });
                  }}
                />
              ))}
            </View>
            {offline && !draft.response ? (
              <Button
                label="Review retained request"
                icon="list"
                size="sm"
                onPress={() => router.push("/settings/offline-books")}
              />
            ) : null}
          </View>
        );
      })}
    </>
  );
}
