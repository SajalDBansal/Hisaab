import { Pressable, StyleSheet, View } from "react-native";
import { colors, radius, space } from "@/theme";
import { Icon, type IconName } from "./Icon";
import { Txt } from "./Txt";

/** Round grey circle with initials ("Gupta Kirana Store" → "GK") or an icon. */
export function Avatar({
  name,
  icon,
  size = 40,
}: {
  name?: string;
  icon?: IconName;
  size?: number;
}) {
  const initials = (name ?? "")
    .split(/\s+/)
    .filter((w) => /[A-Za-z]/.test(w[0] ?? ""))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
  return (
    <View style={[styles.avatar, { width: size, height: size }]}>
      {icon ? (
        <Icon name={icon} size={18} />
      ) : (
        <Txt variant="label" style={{ fontWeight: "600" }}>
          {initials}
        </Txt>
      )}
    </View>
  );
}

/**
 * Standard list row: optional avatar/icon on the left, title and subtitle, and anything on the right.
 * Rows are separated by a hairline, as in the design.
 */
export function ListRow({
  title,
  subtitle,
  left,
  right,
  onPress,
  chevron,
  last,
}: {
  title: string;
  subtitle?: React.ReactNode;
  left?: React.ReactNode;
  right?: React.ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  last?: boolean;
}) {
  const body = (
    <>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {title}
        </Txt>
        {typeof subtitle === "string" ? (
          <Txt variant="small" tone="body" numberOfLines={1}>
            {subtitle}
          </Txt>
        ) : (
          subtitle
        )}
      </View>
      {right}
      {chevron ? (
        <Icon name="chevron-right" size={18} color={colors.body} />
      ) : null}
    </>
  );
  const style = [styles.row, last && { borderBottomWidth: 0 }];
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

/** Label on the left, value on the right, with a soft divider. */
export function KeyValue({
  label,
  value,
  strong,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <View style={styles.kv}>
      <Txt
        variant="small"
        tone={strong ? "ink" : "body"}
        style={strong && { fontWeight: "600" }}
      >
        {label}
      </Txt>
      {typeof value === "string" ? (
        <Txt variant="small" num style={strong && { fontWeight: "600" }}>
          {value}
        </Txt>
      ) : (
        value
      )}
    </View>
  );
}

/** Section title with an optional link on the right ("See all"). */
export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.section}>
      <Txt variant="heading">{title}</Txt>
      {action ? (
        <Pressable accessibilityRole="link" onPress={onAction} hitSlop={10}>
          <Txt
            variant="small"
            tone="body"
            style={{ textDecorationLine: "underline" }}
          >
            {action}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  kv: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairlineSoft,
  },
  section: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: space.xs,
  },
});
