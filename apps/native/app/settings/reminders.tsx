import { router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import {
  formatDate,
  formatINR,
  parseRupees,
  type ReminderDue,
  type ReminderReason,
  type ReminderSettings,
  count,
  can,
} from "@repo/core";
import {
  AmountField,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  Chip,
  ChipRow,
  EmptyState,
  Header,
  ListRow,
  QueryView,
  Screen,
  Txt,
  showError,
} from "@/components";
import {
  useReminderSettings,
  useRemindersDue,
  useUpdateReminders,
} from "@/data/queries";
import { useSendReminder } from "@/data/share";
import { useData } from "@/data/DataProvider";
import { space } from "@/theme";

const BEFORE = [0, 1, 3, 7];
const REPEAT = [0, 3, 7, 15];

const REASON: Record<
  ReminderReason,
  { label: string; tone: "warn" | "bad" | "neutral" }
> = {
  overdue: { label: "Overdue", tone: "bad" },
  "due-today": { label: "Due today", tone: "warn" },
  "before-due": { label: "Due soon", tone: "neutral" },
};

/**
 * WhatsApp payment reminders: the rules, and the customers to remind today.
 * The app suggests; you tap Send. (With the server, these can go out on their own.)
 */
export default function RemindersScreen() {
  const settings = useReminderSettings();
  return (
    <Screen
      header={
        <Header title="Reminders" subtitle="WhatsApp payment reminders" />
      }
    >
      <QueryView query={settings}>{(s) => <Rules saved={s} />}</QueryView>
      <DueToday />
    </Screen>
  );
}

function Rules({ saved }: { saved: ReminderSettings }) {
  const { role } = useData();
  const canEdit = !!role && can(role, "settings");
  const update = useUpdateReminders();
  const [draft, setDraft] = useState(saved);
  const [minText, setMinText] = useState(String(saved.minAmount / 100));
  useEffect(() => {
    setDraft(saved);
    setMinText(String(saved.minAmount / 100));
  }, [saved]);

  const set = (patch: Partial<ReminderSettings>) =>
    setDraft({ ...draft, ...patch });
  const minAmount = minText.trim() ? parseRupees(minText) : 0;
  const invalidAmount = minAmount === null || !Number.isSafeInteger(minAmount);
  const changed =
    JSON.stringify({ ...draft, minAmount }) !== JSON.stringify(saved);

  const save = () => {
    if (!canEdit || invalidAmount || minAmount === null) return;
    update.mutate(
      { ...draft, minAmount },
      {
        onError: (e) => showError("Couldn't save", e),
      },
    );
  };

  return (
    <Card style={{ gap: space.lg }}>
      <View
        pointerEvents={canEdit && !update.isPending ? "auto" : "none"}
        style={{ gap: space.lg }}
      >
        <Checkbox
          label="Suggest payment reminders"
          note="Customers with bills due show in the list below and in the bell."
          checked={draft.enabled}
          onChange={(enabled) => set({ enabled })}
        />
        {draft.enabled ? (
          <>
            <View style={{ gap: space.sm }}>
              <Txt variant="label" tone="charcoal">
                Remind before the due date
              </Txt>
              <ChipRow>
                {BEFORE.map((d) => (
                  <Chip
                    key={d}
                    label={
                      d === 0 ? "Don't" : `${d} day${d > 1 ? "s" : ""} before`
                    }
                    selected={draft.daysBefore === d}
                    onPress={() => set({ daysBefore: d })}
                  />
                ))}
              </ChipRow>
            </View>
            <Checkbox
              label="Remind on the due date"
              checked={draft.onDueDate}
              onChange={(onDueDate) => set({ onDueDate })}
            />
            <View style={{ gap: space.sm }}>
              <Txt variant="label" tone="charcoal">
                While overdue, remind again every
              </Txt>
              <ChipRow>
                {REPEAT.map((d) => (
                  <Chip
                    key={d}
                    label={d === 0 ? "Only once" : `${d} days`}
                    selected={draft.repeatEvery === d}
                    onPress={() => set({ repeatEvery: d })}
                  />
                ))}
              </ChipRow>
            </View>
            <View style={{ flexDirection: "row" }}>
              <AmountField
                label="Skip customers who owe less than ₹"
                value={minText}
                onChangeText={setMinText}
                editable={canEdit}
                error={
                  invalidAmount
                    ? "Enter a valid amount with up to two decimal places."
                    : undefined
                }
              />
            </View>
          </>
        ) : null}
      </View>
      {changed && canEdit ? (
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
        >
          <Txt variant="caption" tone="body" style={{ flex: 1 }}>
            Unsaved changes
          </Txt>
          <Button
            label="Save rules"
            variant="primary"
            loading={update.isPending}
            disabled={invalidAmount}
            onPress={save}
          />
        </View>
      ) : null}
    </Card>
  );
}

function DueToday() {
  const { role } = useData();
  const canSend = !!role && can(role, "sales");
  const due = useRemindersDue();
  const sendReminder = useSendReminder();
  const [sending, setSending] = useState<string | null>(null);

  const send = async (r: ReminderDue) => {
    setSending(r.partyId);
    try {
      await sendReminder(r.partyId);
    } catch (e) {
      showError("Couldn't open WhatsApp", e);
    } finally {
      setSending(null);
    }
  };

  return (
    <View style={{ gap: space.sm }}>
      <Txt variant="heading">To remind today</Txt>
      <QueryView query={due}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState
              icon="check-circle"
              title="No reminders due today"
              message="Customers show here when a bill is about to fall due or is overdue."
            />
          ) : (
            <View>
              {list.map((r, i) => (
                <ListRow
                  key={r.partyId}
                  left={<Avatar name={r.partyName} />}
                  title={r.partyName}
                  subtitle={
                    <View style={{ gap: 4 }}>
                      <Txt variant="small" tone="body" num>
                        Owes {formatINR(r.pending)} · {r.bill.number} due{" "}
                        {formatDate(r.bill.dueDate)}
                      </Txt>
                      <View style={{ flexDirection: "row", gap: 6 }}>
                        <Badge
                          label={
                            r.reason === "overdue"
                              ? `${REASON.overdue.label} ${count(r.overdueDays, "day")}`
                              : REASON[r.reason].label
                          }
                          tone={REASON[r.reason].tone}
                        />
                        {r.lastSent ? (
                          <Badge
                            label={`Last sent ${formatDate(r.lastSent)}`}
                          />
                        ) : null}
                      </View>
                    </View>
                  }
                  onPress={() => router.push(`/party/${r.partyId}`)}
                  right={
                    canSend ? (
                      <Button
                        label="Send"
                        icon="message-circle"
                        size="sm"
                        loading={sending === r.partyId}
                        onPress={() => send(r)}
                      />
                    ) : undefined
                  }
                  last={i === list.length - 1}
                />
              ))}
            </View>
          )
        }
      </QueryView>
    </View>
  );
}
