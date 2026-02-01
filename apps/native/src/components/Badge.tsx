import { StyleSheet, View } from "react-native";
import { colors, radius } from "@/theme";
import { Txt } from "./Txt";

export type BadgeTone = "neutral" | "ok" | "warn" | "bad" | "ink" | "dashed";

const toneStyle = {
  neutral: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.hairline,
    color: colors.charcoal,
  },
  ok: {
    backgroundColor: colors.okBg,
    borderColor: colors.okBorder,
    color: colors.okText,
  },
  warn: {
    backgroundColor: colors.warnBg,
    borderColor: colors.warnBorder,
    color: colors.warnText,
  },
  bad: {
    backgroundColor: colors.badBg,
    borderColor: colors.badBorder,
    color: colors.badText,
  },
  ink: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
    color: colors.onDark,
  },
  dashed: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.mute,
    color: colors.charcoal,
  },
} as const;

/** Small status pill: Draft, Paid, Overdue, Pending sync … */
export function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: BadgeTone;
}) {
  const t = toneStyle[tone];
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: t.backgroundColor, borderColor: t.borderColor },
        tone === "dashed" && { borderStyle: "dashed" },
      ]}
    >
      <Txt
        variant="caption"
        style={{ color: t.color, fontWeight: "500" }}
        numberOfLines={1}
      >
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
