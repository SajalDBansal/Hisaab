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
  ["committed", "cancelled", "superseded"].includes(entry.state);
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
        {label} - {entry.state}
      </Txt>
      <Txt variant="small">{date(entry.createdAt)}</Txt>
      <Txt variant="small" selectable>
        {entry.key}
      </Txt>
      {entry.error ? <Notice tone="warn" text={entry.error} /> : null}
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
        {!terminal(entry) ? (
          <Button
            label="Check original answer"
            icon="refresh-cw"
            size="sm"
            disabled={busy}
            onPress={() => run(() => books.reconcile(entry.key))}
          />
        ) : null}
        {!terminal(entry) ? (
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
          {conflict ? (
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
  const { books, entries, online, syncing, error, downloadedAt, cachedAt } =
    useOfflineBooks();
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
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}
          >
            <Button
              label="Sync pending"
              icon="refresh-cw"
              size="sm"
              loading={syncing}
              disabled={busy}
              onPress={() => run(() => books.sync())}
            />
            <Button
              label="Download books"
              icon="download"
              size="sm"
              disabled={busy || syncing}
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
          {!(history ? entries : pending).length ? (
            <Txt variant="body">No pending changes.</Txt>
          ) : null}
          {(history ? entries : pending).map((entry) => (
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
