import { useState } from "react";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { formatDate, formatINR, today } from "@repo/core";
import type { BookControlChange, BookControlView } from "@repo/contracts";
import {
  Button,
  Checkbox,
  DateField,
  Header,
  Notice,
  QueryView,
  Screen,
  Segmented,
  TextField,
  Txt,
  showError,
} from "@/components";
import {
  useBookControlHistory,
  useBookControls,
  useUpdateBookControls,
} from "@/data/queries";
import { useData } from "@/data/DataProvider";
import { confirmAction } from "@/data/confirm";
import { colors, space } from "@/theme";

type ControlTab = "openings" | "period" | "history";
type EditorProps = {
  view: BookControlView;
  base: Pick<BookControlChange, "version" | "reason">;
  disabled: boolean;
  save: (input: BookControlChange) => Promise<void>;
};

export default function BookControlsScreen() {
  const { firmId } = useData();
  const controls = useBookControls();
  const update = useUpdateBookControls();
  const [tab, setTab] = useState<ControlTab>("openings");
  const [reason, setReason] = useState("");
  const save = async (input: BookControlChange) => {
    try {
      await update.mutateAsync(input);
      setReason("");
    } catch (error) {
      showError("Couldn't update books", error);
    }
  };
  return (
    <Screen
      header={<Header title="Book controls" />}
      onRefresh={() => controls.refetch()}
      refreshing={controls.isRefetching}
    >
      <Button
        label="Opening allocations"
        icon="sliders"
        onPress={() => router.push("/settings/opening-allocations")}
      />
      <Button
        label="Financial year review"
        icon="calendar"
        onPress={() => router.push("/settings/year-end")}
      />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "openings", label: "Openings" },
          { value: "period", label: "Period close" },
          { value: "history", label: "History" },
        ]}
      />
      <QueryView query={controls}>
        {(view) => {
          const editor = {
            view,
            save,
            base: { version: view.version, reason },
            disabled:
              !view.canManage || reason.trim().length < 10 || update.isPending,
          };
          return (
            <>
              <ControlRow
                label="Closed through"
                value={
                  view.closedThrough
                    ? formatDate(view.closedThrough)
                    : "No closed period"
                }
              />
              <ControlRow
                label="Opening approval"
                value={
                  view.openingApprovedAt
                    ? `Approved by ${view.openingApprovedBy}`
                    : "Awaiting review"
                }
              />
              {tab !== "history" && view.canManage ? (
                <TextField
                  label="Reason / review note"
                  value={reason}
                  onChangeText={setReason}
                  maxLength={500}
                />
              ) : null}
              {tab === "openings" ? (
                <OpeningReview key={view.version} {...editor} />
              ) : null}
              {tab === "period" ? <PeriodClose {...editor} /> : null}
              {tab === "history" ? (
                <ControlHistory key={`${firmId}:${view.version}`} />
              ) : null}
            </>
          );
        }}
      </QueryView>
    </Screen>
  );
}

// Owner acknowledgement includes the existing automatic capital balancing entry.
function OpeningReview({ view, base, disabled, save }: EditorProps) {
  const [reviewed, setReviewed] = useState(false);
  return (
    <>
      {view.opening.rows.map((row, index) => (
        <ControlRow
          key={`${row.account}-${index}`}
          label={row.ledger}
          value={`${formatINR(row.debit || row.credit)} ${row.debit ? "Dr" : "Cr"}`}
        />
      ))}
      <ControlRow
        label="Calculated capital offset"
        value={`${formatINR(Math.abs(view.opening.capital))} ${view.opening.capital > 0 ? "Dr" : "Cr"}`}
      />
      {!view.canManage ? null : view.openingApprovedAt ? (
        <Button
          label="Reopen opening balances"
          icon="unlock"
          disabled={disabled || !!view.closedThrough}
          onPress={() =>
            confirmAction(
              "Reopen opening balances?",
              "All periods must remain open while opening balances are changed.",
              "Reopen",
              () => save({ ...base, action: "reopen-openings" }),
            )
          }
        />
      ) : (
        <>
          <Checkbox
            label="I approve these opening balances and the calculated capital offset"
            checked={reviewed}
            onChange={setReviewed}
          />
          <Button
            label="Approve opening balances"
            icon="check"
            disabled={disabled || !reviewed}
            onPress={() =>
              void save({
                ...base,
                action: "approve-openings",
                digest: view.opening.digest,
                capital: view.opening.capital,
              })
            }
          />
        </>
      )}
    </>
  );
}

// Reopening moves the inclusive lock boundary; it never alters financial entries.
function PeriodClose({ view, base, disabled, save }: EditorProps) {
  const [date, setDate] = useState(today());
  if (!view.canManage) return null;
  return (
    <>
      {!view.openingApprovedAt ? (
        <Notice tone="warn" text="Opening balances are not approved." />
      ) : null}
      <DateField
        label="Lock through date"
        value={date}
        onChange={setDate}
        max={today()}
      />
      <Button
        label="Close through date"
        icon="lock"
        disabled={
          disabled ||
          !view.openingApprovedAt ||
          (!!view.closedThrough && date <= view.closedThrough)
        }
        onPress={() =>
          confirmAction(
            "Close this period?",
            `Entries dated through ${formatDate(date)} will be locked.`,
            "Close period",
            () => save({ ...base, action: "close-period", date }),
          )
        }
      />
      {view.closedThrough ? (
        <>
          <Button
            label="Move lock to earlier date"
            icon="unlock"
            disabled={disabled || date >= view.closedThrough}
            onPress={() =>
              confirmAction(
                "Reopen part of the period?",
                `Only entries dated after ${formatDate(date)} will be reopened.`,
                "Reopen",
                () => save({ ...base, action: "reopen-period", date }),
              )
            }
          />
          <Button
            label="Reopen all periods"
            icon="unlock"
            variant="danger"
            disabled={disabled}
            onPress={() =>
              confirmAction(
                "Reopen all periods?",
                "Previously closed entries can be changed. This reason will remain in the control history.",
                "Reopen",
                () => save({ ...base, action: "reopen-period", date: null }),
              )
            }
          />
        </>
      ) : null}
    </>
  );
}

function ControlHistory() {
  const [cursors, setCursors] = useState<string[]>([]);
  const query = useBookControlHistory(cursors.at(-1));
  return (
    <QueryView query={query}>
      {(page) => (
        <>
          <HistoryRows history={page.items} />
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Button
              label="Newer"
              icon="chevron-left"
              disabled={!cursors.length}
              onPress={() => setCursors((previous) => previous.slice(0, -1))}
            />
            <Button
              label="Older"
              icon="chevron-right"
              disabled={!page.nextCursor}
              onPress={() =>
                page.nextCursor &&
                setCursors((previous) => [...previous, page.nextCursor!])
              }
            />
          </View>
        </>
      )}
    </QueryView>
  );
}

function HistoryRows({ history }: Pick<BookControlView, "history">) {
  return (
    <View style={{ gap: space.md }}>
      <Txt variant="heading">Control changes</Txt>
      {!history.length ? (
        <Txt variant="small">No control changes yet.</Txt>
      ) : null}
      {history.map((event) => (
        <View key={event.id} style={{ gap: space.xs }}>
          <Txt variant="bodyStrong">{event.action.replaceAll("-", " ")}</Txt>
          <Txt variant="small">
            {event.userName} / {formatDate(event.at.slice(0, 10))}
          </Txt>
          <Txt variant="small">{event.reason}</Txt>
        </View>
      ))}
    </View>
  );
}

function ControlRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Txt variant="small" tone="body" style={styles.label}>
        {label}
      </Txt>
      <Txt variant="small" style={styles.value}>
        {value}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairlineSoft,
  },
  label: { flex: 1 },
  value: { flex: 1, textAlign: "right" },
});
