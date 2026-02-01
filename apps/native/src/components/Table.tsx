import { Pressable, StyleSheet, View } from "react-native";
import { colors, space } from "@/theme";
import { Txt } from "./Txt";

/**
 * A simple table row: the first cell takes the free space, the rest are
 * right-aligned number columns of equal width. Used for trial balance and GST returns.
 */
export function TableRow({
  cells,
  header,
  strong,
  last,
  width = 92,
  onPress,
}: {
  cells: (string | React.ReactNode)[];
  header?: boolean;
  strong?: boolean;
  last?: boolean;
  /** Width of each number column. */
  width?: number;
  onPress?: () => void;
}) {
  const [first, ...rest] = cells;
  const textStyle = (header || strong) && { fontWeight: "600" as const };
  const body = (
    <>
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof first === "string" ? (
          <Txt
            variant={header ? "caption" : "small"}
            tone={header ? "body" : "ink"}
            numberOfLines={2}
            style={!header && textStyle}
          >
            {first}
          </Txt>
        ) : (
          first
        )}
      </View>
      {rest.map((c, i) => (
        <View key={i} style={{ width, alignItems: "flex-end" }}>
          {typeof c === "string" ? (
            <Txt
              variant={header ? "caption" : "small"}
              tone={header ? "body" : "ink"}
              num={!header}
              numberOfLines={1}
              adjustsFontSizeToFit
              style={!header && textStyle}
            >
              {c}
            </Txt>
          ) : (
            c
          )}
        </View>
      ))}
    </>
  );
  const style = [
    styles.row,
    header && styles.header,
    strong && styles.strong,
    last && { borderBottomWidth: 0 },
  ];
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        style,
        pressed && { backgroundColor: colors.surfaceSoft },
      ]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairlineSoft,
  },
  header: { minHeight: 32, backgroundColor: colors.surfaceSoft },
  strong: { borderTopWidth: 1, borderTopColor: colors.hairline },
});
