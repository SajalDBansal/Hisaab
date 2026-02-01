/**
 * Date picker: looks like a field, opens a sheet with quick picks (Today, Yesterday …)
 * and a month calendar. Dates outside `min`–`max` can't be picked.
 * Built from plain views so it works the same on Android, iOS and web.
 */
import { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  addDays,
  formatDate,
  monthLabel,
  today as businessToday,
  type ISODate,
} from "@repo/core";
import { colors, radius, space, touch } from "@/theme";
import { IconButton } from "./Button";
import { Chip } from "./Chip";
import { SelectField } from "./Field";
import { Txt } from "./Txt";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** "2026-10" → the cells of that month's calendar (Monday first), null for blanks. */
function monthCells(month: string): (ISODate | null)[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7; // Monday = 0
  const cells: (ISODate | null)[] = Array(offset).fill(null);
  for (let d = 1; d <= days; d++)
    cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};

export function DateField({
  label = "Date",
  value,
  onChange,
  min,
  max,
}: {
  label?: string;
  value: ISODate;
  onChange: (date: ISODate) => void;
  min?: ISODate;
  max?: ISODate;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const today = businessToday();
  const anchor =
    value || (max && today > max ? max : min && today < min ? min : today);
  const [month, setMonth] = useState(anchor.slice(0, 7));
  const allowed = (d: ISODate) => (!min || d >= min) && (!max || d <= max);
  const quick: { label: string; date: ISODate }[] = [
    { label: "Today", date: today },
    { label: "Yesterday", date: addDays(today, -1) },
    { label: "2 days ago", date: addDays(today, -2) },
  ].filter((q) => allowed(q.date));

  const pick = (d: ISODate) => {
    onChange(d);
    setOpen(false);
  };

  return (
    <>
      <SelectField
        label={label}
        value={value ? formatDate(value) : undefined}
        placeholder="Choose date"
        onPress={() => {
          setMonth(anchor.slice(0, 7));
          setOpen(true);
        }}
      />
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          style={styles.overlay}
          onPress={() => setOpen(false)}
          accessibilityLabel="Close"
        />
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, space.lg) },
          ]}
        >
          <View style={styles.handle} />
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Txt variant="heading" style={{ flex: 1, fontSize: 20 }}>
              {label}
            </Txt>
            <IconButton icon="x" label="Close" onPress={() => setOpen(false)} />
          </View>
          <View
            style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}
          >
            {quick.map((q) => (
              <Chip
                key={q.label}
                label={q.label}
                selected={value === q.date}
                onPress={() => pick(q.date)}
              />
            ))}
          </View>

          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <IconButton
              icon="chevron-left"
              label="Previous month"
              onPress={() => setMonth(shiftMonth(month, -1))}
            />
            <Txt variant="bodyStrong" center style={{ flex: 1 }}>
              {monthLabel(month)} {month.slice(0, 4)}
            </Txt>
            <IconButton
              icon="chevron-right"
              label="Next month"
              onPress={() => setMonth(shiftMonth(month, 1))}
            />
          </View>

          <View style={styles.grid}>
            {WEEKDAYS.map((w) => (
              <View key={w} style={styles.cell}>
                <Txt variant="caption" tone="body">
                  {w}
                </Txt>
              </View>
            ))}
            {monthCells(month).map((d, i) => {
              if (!d) return <View key={`b${i}`} style={styles.cell} />;
              const ok = allowed(d);
              const selected = d === value;
              return (
                <Pressable
                  key={d}
                  accessibilityRole="button"
                  accessibilityLabel={formatDate(d)}
                  accessibilityState={{ selected, disabled: !ok }}
                  disabled={!ok}
                  onPress={() => pick(d)}
                  style={styles.cell}
                >
                  <View
                    style={[
                      styles.day,
                      selected && { backgroundColor: colors.ink },
                      d === today &&
                        !selected && {
                          borderWidth: 1,
                          borderColor: colors.ink,
                        },
                    ]}
                  >
                    <Txt
                      variant="small"
                      num
                      style={{
                        color: selected
                          ? colors.onPrimary
                          : ok
                            ? colors.ink
                            : colors.mute,
                      }}
                    >
                      {Number(d.slice(8))}
                    </Txt>
                  </View>
                </Pressable>
              );
            })}
          </View>
          {min ? (
            <Txt variant="caption" tone="body" center>
              Entries can go back to {formatDate(min)}. Future dates aren't
              allowed.
            </Txt>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.canvas,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    gap: space.md,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.hairlineStrong,
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: `${100 / 7}%`,
    height: touch,
    alignItems: "center",
    justifyContent: "center",
  },
  day: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
});
