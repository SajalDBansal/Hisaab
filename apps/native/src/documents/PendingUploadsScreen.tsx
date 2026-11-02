import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import {
  Button,
  Checkbox,
  Header,
  Notice,
  Screen,
  Txt,
  showError,
} from "@/components";
import { useAuth } from "@/auth/AuthProvider";
import { useData } from "@/data/DataProvider";
import { serverRecovery } from "@/data/recoveryEpoch";
import { confirmAction } from "@/data/confirm";
import {
  attachmentScopeKey,
  attachmentReservationProblem,
  type PendingAttachment,
} from "@/data/attachmentRecovery";
import { colors, space } from "@/theme";
import {
  pendingAttachmentProblem,
  pendingAttachmentRoute,
} from "./pendingAttachmentActions";
import { usePendingAttachments } from "./usePendingAttachments";
import { PendingFinancialDrafts } from "./PendingFinancialDrafts";

const keyOf = ({ record }: PendingAttachment) =>
  `${attachmentScopeKey(record.scope)}:${record.id}`;

export function PendingUploadsScreen() {
  const { userId, firmId, accessKey } = useData();
  const { status, locked } = useAuth();
  return (
    <PendingUploads
      key={JSON.stringify([userId, firmId, accessKey, status, locked])}
    />
  );
}

function PendingUploads() {
  const pending = usePendingAttachments();
  const [selection, setSelection] = useState<string[]>([]);
  const unfinished = pending.items.filter(({ record }) => !record.completed);
  const confirmed = pending.items.filter(({ record }) => record.completed);
  const selected = unfinished.filter((item) => selection.includes(keyOf(item)));
  const busy = pending.busy || pending.loading;
  const discard = (items: PendingAttachment[]) => {
    const references = items.map(({ record }) => ({
      id: record.id,
      scope: { ...record.scope },
    }));
    const names = items
      .slice(0, 5)
      .map(({ record }) => record.file.name)
      .join("\n");
    confirmAction(
      `Discard ${items.length === 1 ? "pending copy" : `${items.length} pending copies`}?`,
      `${names}${items.length > 5 ? `\nAnd ${items.length - 5} more selected files.` : ""}\n\nThis removes only the selected app copies from this device. Original files and saved server documents are kept. Pending uploads cannot be recovered from this device after discard.`,
      "Discard copies",
      () => void pending.discard(references),
    );
  };
  return (
    <Screen
      header={
        <Header title="Pending uploads" subtitle="Current account and firm" />
      }
      onRefresh={() => void pending.refresh()}
      refreshing={pending.loading}
    >
      {!pending.enabled ? (
        <Notice
          tone="info"
          text="Sign in and select a firm to view its pending uploads."
        />
      ) : (
        <>
          <Notice
            tone="info"
            text="Pending copies stay on this device after sign-out. They remain private to this account and firm until uploaded or explicitly discarded."
          />
          {pending.error ? <Notice tone="warn" text={pending.error} /> : null}
          {pending.notice ? <Notice tone="info" text={pending.notice} /> : null}
          <PendingFinancialDrafts
            onChanged={pending.refresh}
            refreshSignal={pending.items}
          />
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: space.sm,
              alignItems: "center",
            }}
          >
            <Txt variant="small">
              {unfinished.length} pending, {confirmed.length} awaiting cleanup
            </Txt>
            <Button
              label="Refresh"
              icon="refresh-cw"
              size="sm"
              disabled={busy}
              onPress={() => void pending.refresh()}
            />
          </View>
          {busy ? (
            <ActivityIndicator accessibilityLabel="Updating pending uploads" />
          ) : null}
          {!pending.items.length && !pending.loading && !pending.error ? (
            <Txt tone="body">No entry or library uploads pending.</Txt>
          ) : null}
          {unfinished.length ? (
            <>
              <Checkbox
                label="Select all pending copies"
                checked={selected.length === unfinished.length}
                onChange={(checked) => {
                  if (!busy) setSelection(checked ? unfinished.map(keyOf) : []);
                }}
              />
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: space.sm,
                }}
              >
                <Button
                  label={`Retry selected (${selected.length})`}
                  icon="refresh-cw"
                  size="sm"
                  disabled={
                    busy ||
                    !selected.some((item) => !pendingAttachmentProblem(item))
                  }
                  onPress={() =>
                    void pending.retry(selected.map(({ record }) => record))
                  }
                />
                <Button
                  label={`Discard selected (${selected.length})`}
                  icon="trash-2"
                  variant="danger"
                  size="sm"
                  disabled={busy || !selected.length}
                  onPress={() => discard(selected)}
                />
              </View>
            </>
          ) : null}
          {confirmed.length ? (
            <Button
              label="Clean confirmed copies"
              icon="trash-2"
              size="sm"
              disabled={busy}
              onPress={() =>
                void pending.cleanup(confirmed.map(({ record }) => record))
              }
            />
          ) : null}
          {pending.items.map((item) => {
            const { record, fileError } = item;
            const key = keyOf(item);
            const problem = pendingAttachmentProblem(item);
            const reservationWarning = attachmentReservationProblem(record);
            const location =
              record.scope.target === "library"
                ? "Library upload"
                : `${record.scope.target === "account" ? "Account" : "Entry"}: ${record.scope.entryId}`;
            return (
              <View
                key={key}
                style={{
                  gap: space.sm,
                  paddingVertical: space.md,
                  borderBottomWidth: 1,
                  borderColor: colors.hairline,
                }}
              >
                {record.completed ? (
                  <Txt variant="bodyStrong">{record.file.name}</Txt>
                ) : (
                  <Checkbox
                    label={record.file.name}
                    checked={selection.includes(key)}
                    onChange={(checked) => {
                      if (!busy)
                        setSelection((old) =>
                          checked
                            ? [...old.filter((id) => id !== key), key]
                            : old.filter((id) => id !== key),
                        );
                    }}
                  />
                )}
                <Txt variant="caption" tone="body">
                  {location}
                </Txt>
                <Txt variant="caption" tone="body">
                  {Math.ceil(record.file.sizeBytes / 1024)} KB
                  {record.input?.folder ? `, ${record.input.folder}` : ""}
                </Txt>
                <Txt
                  variant="small"
                  tone={
                    problem || reservationWarning || record.failure
                      ? "warn"
                      : "body"
                  }
                >
                  {problem ??
                    reservationWarning ??
                    (record.progress?.uploaded
                      ? "Awaiting server confirmation"
                      : record.progress
                        ? "Upload interrupted"
                        : "Ready to upload")}
                </Txt>
                {fileError && record.progress?.uploaded ? (
                  <Txt variant="small" tone="warn">
                    {fileError} Server confirmation can still be checked.
                  </Txt>
                ) : null}
                {record.failure ? (
                  <Txt variant="small" tone="warn">
                    Last failure: {record.failure.message}
                  </Txt>
                ) : null}
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: space.sm,
                  }}
                >
                  {(!record.recoveryEpoch ||
                    record.recoveryEpoch !== serverRecovery.current()) &&
                  !record.bindingPending ? (
                    <Button
                      label="Check restored reservation"
                      icon="search"
                      size="sm"
                      disabled={busy}
                      onPress={() =>
                        confirmAction(
                          "Check this restored upload?",
                          "The original reservation and document must still exist before an attempted upload can continue. Missing answers keep this file for manual reconciliation; no replacement financial entry or document reservation is created.",
                          "Check reservation",
                          () => void pending.recover(record),
                        )
                      }
                    />
                  ) : null}
                  {!record.completed ? (
                    <Button
                      label={
                        reservationWarning ? "Check original upload" : "Retry"
                      }
                      icon="refresh-cw"
                      size="sm"
                      disabled={busy || !!problem}
                      onPress={() => void pending.retry([record])}
                    />
                  ) : null}
                  <Button
                    label={
                      record.scope.target === "library"
                        ? "Open library upload"
                        : "Open original entry"
                    }
                    icon="external-link"
                    size="sm"
                    disabled={busy}
                    onPress={() => {
                      try {
                        pending.assertActive();
                        router.push(pendingAttachmentRoute(record));
                      } catch (error) {
                        showError("Couldn't open entry", error);
                      }
                    }}
                  />
                  {!record.completed ? (
                    <Button
                      label="Discard"
                      icon="trash-2"
                      size="sm"
                      variant="danger"
                      disabled={busy || !!record.bindingPending}
                      onPress={() => discard([item])}
                    />
                  ) : null}
                </View>
              </View>
            );
          })}
        </>
      )}
    </Screen>
  );
}
