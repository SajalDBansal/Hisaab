import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { colors, radius, space } from "@/theme";
import { Txt } from "./Txt";

/** Filter chip. Selected chips get a black outline. */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipOn]}
    >
      <Txt
        variant="small"
        tone={selected ? "ink" : "charcoal"}
        style={selected && { fontWeight: "500" }}
      >
        {label}
      </Txt>
    </Pressable>
  );
}

/** A horizontally scrolling row of chips that runs edge to edge. */
export function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -space.lg, flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }}
    >
      {children}
    </ScrollView>
  );
}

/** Two to four mutually exclusive options in a pill track. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, on && styles.segmentOn]}
          >
            <Txt variant="label" tone={on ? "ink" : "body"} numberOfLines={1}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceSoft,
    justifyContent: "center",
  },
  chipOn: { borderColor: colors.ink, backgroundColor: colors.canvas },
  track: {
    flexDirection: "row",
    padding: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  segment: {
    flex: 1,
    height: 38,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  segmentOn: {
    backgroundColor: colors.canvas,
    borderColor: colors.hairlineStrong,
  },
});
