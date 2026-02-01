import { Pressable, View } from "react-native";
import { colors, radius, space } from "@/theme";
import { Txt } from "./Txt";

/**
 * A list row with a thin horizontal bar under it showing its share of the largest value.
 * Used in reports ("Sales by party", "Expenses by head").
 */
export function BarRow({
  title,
  subtitle,
  value,
  share,
  onPress,
}: {
  title: string;
  subtitle?: string;
  /** Formatted value shown on the right, e.g. "₹12,400". */
  value: string;
  /** 0 to 1. */
  share: number;
  onPress?: () => void;
}) {
  const body = (
    <>
      <View
        style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="bodyStrong" numberOfLines={1}>
            {title}
          </Txt>
          {subtitle ? (
            <Txt variant="caption" tone="body" numberOfLines={1}>
              {subtitle}
            </Txt>
          ) : null}
        </View>
        <Txt variant="small" num style={{ fontWeight: "600" }}>
          {value}
        </Txt>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: radius.pill,
          backgroundColor: colors.hairlineSoft,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            width: `${Math.max(2, Math.min(1, share) * 100)}%`,
            height: 6,
            borderRadius: radius.pill,
            backgroundColor: colors.ink,
          }}
        />
      </View>
    </>
  );
  const style = { gap: 6, paddingVertical: 10, minHeight: 44 };
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [style, pressed && { opacity: 0.7 }]}
    >
      {body}
    </Pressable>
  );
}
