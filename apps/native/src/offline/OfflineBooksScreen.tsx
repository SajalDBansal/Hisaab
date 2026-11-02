import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Button, Header, Notice, Screen, TextField, Txt } from "@/components";
import { useData } from "@/data/DataProvider";
import { confirmAction } from "@/data/confirm";
import { useOfflineBooks } from "@/data/useOfflineBooks";
import { downloadOfflineBooks } from "@/data/offlineWarmup";
import { offlineDefinition } from "@/data/offlineOperation";
import type { OfflineBooks, OutboxEntry } from "@/data/offlineBooks";
import { colors, space } from "@/theme";

const date = (value?: number) =>
  value ? new Date(value).toLocaleString() : "Not downloaded";
const terminal = (entry: OutboxEntry) =>
  ["committed", "cancelled", "superseded", "retained"].includes(entry.state);
const json = (value: unknown) => JSON.stringify(value, null, 2);

function Entry({
  entry,
  books,
  busy,
  run,
}: {
  entry: OutboxEntry;
  books: OfflineBooks;
  busy: boolean;
  run(work: () => Promise<unknown>): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [reviewNote, setReviewNote] = useState(
    entry.recoveryReview?.note ?? "",
  );
  const quarantine = books.getSnapshot().quarantine;
  const [body, setBody] = useState(json(entry.request.body));
  const [version, setVersion] = useState(
    String(entry.request.expectedVersion ?? ""),
  );
  const label =
    offlineDefinition(entry.request.method, entry.request.path)?.label ??
    entry.request.path;
  const conflict =
    entry.state === "conflict" && entry.result?.state === "conflict"
      ? entry.result
      : null;
  const answers =
    entry.result?.state === "committed"
      ? ((Array.isArray(entry.result.response)
          ? entry.result.response
          : [entry.result.response]) as {
          id?: string;
          number?: string;
          name?: string;
        }[])
      : [];
  const open = (id: string) => {
    const path = entry.request.path;
    if (path === "/accounts/masters")
      router.push({
        pathname: "/account/[key]",
        params: { key: `account:${id}` },
      });
    else if (path.startsWith("/ledgers"))
      router.push({ pathname: "/ledger/[id]", params: { id } });
    else if (path.startsWith("/parties"))
      router.push({ pathname: "/party/[id]", params: { id } });
    else if (path.startsWith("/items"))
      router.push({ pathname: "/item/[id]", params: { id } });
    else router.push({ pathname: "/voucher/[id]", params: { id } });
  };
  return (
    <View
      style={{
        gap: space.sm,
        paddingVertical: space.md,
        borderBottomWidth: 1,
        borderColor: colors.hairline,
      }}
    >
      <Txt variant="bodyStrong">
        {label} -{" "}
        {entry.recoveryReview ? "retained recovery history" : entry.state}
      </Txt>
      <Txt variant="small">{date(entry.createdAt)}</Txt>
      <Txt variant="small" selectable>
        {entry.key}
      </Txt>
      {entry.error ? <Notice tone="warn" text={entry.error} /> : null}
      {quarantine ? (
        <View style={{ gap: space.sm }}>
          <Notice
            tone="warn"
            text="This request will not be replayed after recovery. Check the restored entry and original answer; keep missing work for manual reconciliation."
          />
          <Button
            label="Check restored answer"
            disabled={busy}
            onPress={() => run(() => books.inspectRecovery(entry.key))}
          />
          {entry.recoveryLookup?.epoch === quarantine.current ? (
            <>
              <Txt variant="small" selectable>
                {json(entry.recoveryLookup.result)}
              </Txt>
              <TextField
                label="What did you reconcile?"
                value={reviewNote}
                onChangeText={setReviewNote}
                multiline
              />
              <Button
                label="Record review and keep original"
                disabled={busy || reviewNote.trim().length < 10}
                onPress={() =>
                  confirmAction(
                    "Record this recovery review?",
                    "No financial entry will be posted or deleted. Keep the original request and attachments. Missing or different entries must be reconciled with the owner/accountant before manual re-entry.",
                    "Record review",
                    () =>
                      run(() => books.reviewRecovery(entry.key, reviewNote)),
                  )
                }
              />
            </>
          ) : null}
          {entry.recoveryReview?.epoch === quarantine.current ? (
            <Txt variant="small">
              Recovery review recorded; original retained.
            </Txt>
          ) : null}
        </View>
      ) : null}
      {entry.state === "retained" ? (
        <Notice
          tone="info"
          text="Preserved after recovery for manual reconciliation. This request will never be replayed automatically."
        />
      ) : null}
      {entry.recoveryReview ? (
        <Txt
          variant="small"
          selectable
        >{`Recovery review: ${entry.recoveryReview.note}. Restored answer: ${entry.recoveryLookup?.result.state ?? "not checked"}. Original local state: ${entry.state}.`}</Txt>
      ) : null}
      {entry.replacedBy ? (
        <Txt variant="small" selectable>
          Replacement: {entry.replacedBy}
        </Txt>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        <Button
          label={expanded ? "Hide request" : "Review request"}
          icon={expanded ? "chevron-up" : "chevron-down"}
          size="sm"
          onPress={() => setExpanded(!expanded)}
        />
        {!terminal(entry) && !quarantine ? (
          <Button
            label="Check original answer"
            icon="refresh-cw"
            size="sm"
            disabled={busy}
            onPress={() => run(() => books.reconcile(entry.key))}
          />
        ) : null}
        {!terminal(entry) && !quarantine ? (
          <Button
            label={
              conflict ? "Discard rejected request" : "Cancel original request"
            }
            icon="x"
            size="sm"
            variant="danger"
            disabled={busy}
            onPress={() =>
              confirmAction(
                conflict
                  ? "Discard rejected request?"
                  : "Cancel original request?",
                conflict
                  ? "The server rejected this request. No replacement will be sent. Attachment copies remain in Pending uploads until explicitly discarded."
                  : "The server will check the original key under its write lock. An already committed entry is kept. Otherwise a permanent cancellation prevents this key from posting later. Attachment copies are retained.",
                "Confirm",
                () =>
                  run(() =>
                    conflict
                      ? books.dismissConflict(entry.key)
                      : books.reconcile(entry.key, true),
                  ),
              )
            }
          />
        ) : null}
        {answers.map((answer) =>
          answer.id ? (
            <Button
              key={answer.id}
              label={`Open ${answer.number ?? answer.name ?? "entry"}`}
              icon="external-link"
              size="sm"
              onPress={() => open(answer.id!)}
            />
          ) : null,
        )}
      </View>
      {expanded ? (
        <>
          <Txt variant="small" selectable>
            {entry.request.method} {entry.request.path}
          </Txt>
          <Txt variant="small" selectable>
            {json(entry.request.body)}
          </Txt>
          {conflict && !quarantine ? (
            <>
              <Txt variant="bodyStrong">Current server record</Txt>
              <Txt variant="small" selectable>
                {json(conflict.current)}
              </Txt>
              {conflict.fields ? (
                <Txt variant="small" tone="warn">
                  {Object.entries(conflict.fields)
                    .map(([field, error]) => `${field}: ${error}`)
                    .join("\n")}
                </Txt>
              ) : null}
              <TextField
                label="Replacement request JSON (amounts in paise)"
                value={body}
                onChangeText={setBody}
                multiline
              />
              {entry.request.method === "PUT" ? (
                <TextField
                  label="Reviewed server version"
                  value={version}
                  onChangeText={setVersion}
                  keyboardType="number-pad"
                />
              ) : null}
              <Button
                label="Confirm replacement"
                icon="check"
                size="sm"
                disabled={busy}
                onPress={() =>
                  confirmAction(
                    "Queue reviewed replacement?",
                    "The original key remains rejected. The edited values and selected server version will be queued with a new key. Existing attachment copies retain their original binding plan, including both invoices for a mixed sale. No server version is selected automatically.",
                    "Queue replacement",
                    () =>
                      run(async () => {
                        const input: unknown = JSON.parse(body);
                        if (
                          !input ||
                          typeof input !== "object" ||
                          Array.isArray(input)
                        )
                          throw new Error("Enter a request object.");
                        await books.replace(
                          entry.key,
                          input as Record<string, unknown>,
                          entry.request.method === "PUT"
                            ? Number(version)
                            : undefined,
                        );
                      }),
                  )
                }
              />
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

export default function OfflineBooksScreen() {
  const { services, firmId, role } = useData();
  const {
    books,
    entries,
    online,
    syncing,
    error,
    downloadedAt,
    cachedAt,
    quarantine,
  } = useOfflineBooks();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [history, setHistory] = useState(false);
  const run = (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setFailure("");
    void work()
      .catch((reason: unknown) =>
        setFailure(
          reason instanceof Error ? reason.message : "The action failed.",
        ),
      )
      .finally(() => setBusy(false));
  };
  const pending = entries.filter((entry) => !terminal(entry));
  return (
    <Screen header={<Header title="Offline books" />}>
      {!books ? (
        <Notice
          tone="warn"
          text="Sign in, unlock and select an authorized firm to open retained books."
        />
      ) : (
        <>
          <Txt variant="bodyStrong">
            {online ? "Connected" : "Offline"} - {pending.length} pending
          </Txt>
          <Txt variant="small" selectable>
            {firmId} - {role}
          </Txt>
          <Txt variant="small">
            Last completed download: {date(downloadedAt)}
          </Txt>
          {cachedAt ? (
            <Txt variant="small" tone="warn">
              Cached answer: {date(cachedAt)}
            </Txt>
          ) : null}
          {failure || error ? (
            <Notice tone="warn" text={failure || error} />
          ) : null}
          {quarantine ? (
            <View style={{ gap: space.sm }}>
              <Notice
                tone="warn"
                text="Server recovery detected. Automatic saves are paused. Review every retained request below, including completed history. Existing attachments remain in Pending uploads and require their own original-record check."
              />
              <Button
                label="Resume new work after review"
                disabled={
                  busy ||
                  syncing ||
                  entries.some(
                    (entry) =>
                      entry.recoveryReview?.epoch !== quarantine.current,
                  )
                }
                onPress={() =>
                  confirmAction(
                    "Resume new work?",
                    "Confirm that the retained requests were reconciled with the restored books. Old requests remain preserved and are not replayed. Cached answers will be refreshed; retained attachments remain protected separately.",
                    "Resume new work",
                    () => run(() => books.finishRecovery()),
                  )
                }
              />
            </View>
          ) : null}
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}
          >
            <Button
              label="Sync pending"
              icon="refresh-cw"
              size="sm"
              loading={syncing}
              disabled={busy || !!quarantine}
              onPress={() => run(() => books.sync())}
            />
            <Button
              label="Download books"
              icon="download"
              size="sm"
              disabled={busy || syncing || !!quarantine}
              onPress={() => run(() => downloadOfflineBooks(books, services))}
            />
            <Button
              label="Pending uploads"
              icon="paperclip"
              size="sm"
              onPress={() => router.push("/settings/pending-uploads")}
            />
            <Button
              label="Clear downloaded books"
              icon="trash-2"
              size="sm"
              disabled={busy || syncing}
              onPress={() =>
                confirmAction(
                  "Clear this scope's downloaded books?",
                  "Only cached read answers for this account, firm and role will be removed. Pending writes, attachment copies and server records are kept.",
                  "Clear",
                  () => run(() => books.clearReads()),
                )
              }
            />
          </View>
          <Button
            label={
              history ? "Hide completed history" : "Show completed history"
            }
            icon="list"
            size="sm"
            onPress={() => setHistory(!history)}
          />
          {!(history || quarantine ? entries : pending).length ? (
            <Txt variant="body">No pending changes.</Txt>
          ) : null}
          {(history || quarantine ? entries : pending).map((entry) => (
            <Entry
              key={entry.key}
              entry={entry}
              books={books}
              busy={busy || syncing}
              run={run}
            />
          ))}
        </>
      )}
    </Screen>
  );
}
