import { useState } from "react";
import { View } from "react-native";
import {
  RECURRING_FREQUENCIES,
  addDays,
  describeRecurring,
  nextOccurrence,
  recurringProblem,
  today,
  formatDate,
  type RecurringFrequency,
} from "@repo/core";
import {
  Chip,
  ChipRow,
  DateField,
  TextField,
  Txt,
  Checkbox,
} from "@/components";
import { space } from "@/theme";

/** A schedule's plan as the form edits it (doc 37, T03). */
export interface PlanDraft {
  name: string;
  frequency: RecurringFrequency;
  interval: string;
  startDate: string;
  endDate: string | null;
  maxCount: string;
}

const FREQUENCY_LABEL: Record<RecurringFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export function planDraft(
  name: string,
  from?: Partial<{
    frequency: RecurringFrequency;
    interval: number;
    startDate: string;
    endDate: string | null;
    maxCount: number | null;
  }>,
): PlanDraft {
  return {
    name,
    frequency: from?.frequency ?? "monthly",
    interval: String(from?.interval ?? 1),
    startDate: from?.startDate ?? today(),
    endDate: from?.endDate ?? null,
    maxCount: from?.maxCount ? String(from.maxCount) : "",
  };
}

/** The plan as the API takes it, or the problem in plain words. */
export function planInput(draft: PlanDraft) {
  const plan = {
    name: draft.name.trim(),
    frequency: draft.frequency,
    interval: Number(draft.interval) || 0,
    startDate: draft.startDate,
    endDate: draft.endDate,
    maxCount: draft.maxCount ? Number(draft.maxCount) || 0 : null,
  };
  const problem = !plan.name
    ? "Name the schedule, like Shop rent."
    : recurringProblem(plan);
  return { plan, problem };
}

export function ScheduleFields({
  draft,
  onChange,
  showErrors,
}: {
  draft: PlanDraft;
  onChange: (draft: PlanDraft) => void;
  showErrors?: boolean;
}) {
  const [ends, setEnds] = useState(!!draft.endDate);
  const set = (patch: Partial<PlanDraft>) => onChange({ ...draft, ...patch });
  const { plan, problem } = planInput(draft);
  const upcoming = problem
    ? []
    : [0, 1, 2]
        .map((n) => nextOccurrence(plan, n))
        .filter((d): d is string => !!d);
  return (
    <View style={{ gap: space.md }}>
      <TextField
        label="Name"
        value={draft.name}
        onChangeText={(name) => set({ name })}
        placeholder="Shop rent"
        maxLength={80}
        error={showErrors && !plan.name ? "Name the schedule." : undefined}
      />
      <Txt variant="small" tone="body">
        Repeats
      </Txt>
      <ChipRow>
        {RECURRING_FREQUENCIES.map((f) => (
          <Chip
            key={f}
            label={FREQUENCY_LABEL[f]}
            selected={draft.frequency === f}
            onPress={() => set({ frequency: f })}
          />
        ))}
      </ChipRow>
      <TextField
        label="Every how many (1 = every time)"
        value={draft.interval}
        onChangeText={(interval) =>
          set({ interval: interval.replace(/\D/g, "").slice(0, 2) })
        }
        keyboardType="number-pad"
      />
      <DateField
        label="First entry on"
        value={draft.startDate}
        onChange={(startDate) => set({ startDate })}
      />
      <Checkbox
        label="Stop on a date"
        checked={ends}
        onChange={(on) => {
          setEnds(on);
          set({ endDate: on ? addDays(draft.startDate, 365) : null });
        }}
      />
      {ends && draft.endDate ? (
        <DateField
          label="Last date"
          value={draft.endDate}
          min={draft.startDate}
          onChange={(endDate) => set({ endDate })}
        />
      ) : null}
      <TextField
        label="How many entries in all (optional)"
        value={draft.maxCount}
        onChangeText={(maxCount) =>
          set({ maxCount: maxCount.replace(/\D/g, "").slice(0, 4) })
        }
        keyboardType="number-pad"
        placeholder="No limit"
      />
      <Txt variant="small" tone={problem && showErrors ? "give" : "body"}>
        {problem
          ? problem
          : `${describeRecurring(plan)}. Next: ${upcoming.map(formatDate).join(", ") || "none"}`}
      </Txt>
    </View>
  );
}
