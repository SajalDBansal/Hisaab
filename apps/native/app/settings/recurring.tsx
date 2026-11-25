import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import type { RecurringSchedule } from "@repo/contracts";
import { describeRecurring, formatDate, formatINR } from "@repo/core";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Header,
  QueryView,
  Screen,
  Txt,
  showError,
  showToast,
} from "@/components";
import { confirmAction } from "@/data/confirm";
import {
  usePendingEntries,
  useRemoveSchedule,
  useSchedules,
  useUpdateSchedule,
} from "@/data/recurringHooks";
import { voucherTypeLabel } from "@/data/labels";
import {
  ScheduleFields,
  planDraft,
  planInput,
  type PlanDraft,
} from "@/forms/ScheduleFields";
import { space } from "@/theme";

/**
 * Recurring entries (doc 37, T03): each schedule makes a draft on its dates
 * for someone to check and save; nothing posts by itself.
 */
export default function RecurringScreen() {
  const schedules = useSchedules();
  const entries = usePendingEntries();
  const waiting =
    (entries.data?.counts.drafts ?? 0) + (entries.data?.counts.submitted ?? 0);
  return (
    <Screen
      header={
        <Header
          title="Recurring entries"
          subtitle="Drafts made on a schedule"
        />
      }
    >
      <View style={{ gap: space.lg }}>
        <Button
          label={
            waiting ? `Entries to review (${waiting})` : "Entries to review"
          }
          icon="inbox"
          block
          onPress={() => router.push("/entries")}
        />
        <QueryView query={schedules}>
          {(rows) =>
            rows.length ? (
              <View style={{ gap: space.md }}>
                {rows.map((row) => (
                  <ScheduleCard key={row.id} row={row} />
                ))}
              </View>
            ) : (
              <EmptyState
                icon="repeat"
                title="No recurring entries yet"
                message="Open a saved sale, purchase, receipt, payment, expense, journal or contra entry and tap Repeat."
              />
            )
          }
        </QueryView>
      </View>
    </Screen>
  );
}

function ScheduleCard({ row }: { row: RecurringSchedule }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PlanDraft>(() => planDraft(row.name, row));
  const update = useUpdateSchedule();
  const remove = useRemoveSchedule();
  const save = async (active = row.active) => {
    const { plan, problem } = planInput(
      editing ? draft : planDraft(row.name, row),
    );
    if (problem) return showError("Couldn't save", new Error(problem));
    try {
      await update.mutateAsync({
        id: row.id,
        version: row.version,
        input: { ...plan, active },
      });
      setEditing(false);
      showToast(active ? "Schedule saved" : "Schedule paused");
    } catch (e) {
      showError("Couldn't save", e);
    }
  };
  return (
    <Card>
      <View style={{ gap: space.sm }}>
        <View
          style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}
        >
          <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
            {row.name}
          </Txt>
          <Badge
            label={!row.active ? "Paused" : row.nextDate ? "On" : "Ended"}
            tone={row.active && row.nextDate ? "ok" : "neutral"}
          />
        </View>
        <Txt variant="small" tone="body">
          {voucherTypeLabel[row.voucherType]}
          {row.partyName ? ` · ${row.partyName}` : ""}
          {row.amount ? ` · ${formatINR(row.amount)}` : ""}
        </Txt>
        <Txt variant="small">
          {describeRecurring(row)}
          {row.active && row.nextDate
            ? ` · next ${formatDate(row.nextDate)}`
            : ""}
        </Txt>
        {row.lastSkippedOn ? (
          <Txt variant="caption" tone="give">
            {formatDate(row.lastSkippedOn)} was skipped: the books were closed.
          </Txt>
        ) : null}
        {editing ? (
          <ScheduleFields draft={draft} onChange={setDraft} showErrors />
        ) : null}
        <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
          {editing ? (
            <>
              <Button
                label="Save"
                icon="check"
                variant="primary"
                size="sm"
                loading={update.isPending}
                onPress={() => save()}
              />
              <Button
                label="Cancel"
                size="sm"
                onPress={() => setEditing(false)}
              />
            </>
          ) : (
            <>
              <Button
                label="Change"
                icon="edit"
                size="sm"
                onPress={() => {
                  setDraft(planDraft(row.name, row));
                  setEditing(true);
                }}
              />
              <Button
                label={row.active ? "Pause" : "Resume"}
                icon={row.active ? "pause" : "play"}
                size="sm"
                loading={update.isPending}
                onPress={() => save(!row.active)}
              />
              <Button
                label="Delete"
                icon="trash-2"
                variant="danger"
                size="sm"
                loading={remove.isPending}
                onPress={() =>
                  confirmAction(
                    "Delete this schedule?",
                    "Drafts already made stay for review.",
                    "Delete",
                    () =>
                      void remove
                        .mutateAsync({ id: row.id, version: row.version })
                        .catch((e: unknown) => showError("Couldn't delete", e)),
                  )
                }
              />
            </>
          )}
        </View>
      </View>
    </Card>
  );
}
