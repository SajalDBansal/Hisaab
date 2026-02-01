import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors, radius, space, touch } from "@/theme";
import { Icon, type IconName } from "./Icon";
import { Txt } from "./Txt";

type Variant = "primary" | "secondary" | "danger" | "ghost";

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: "md" | "sm";
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  /** Stretch to fill the row. */
  block?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Pill button. Use `primary` (black) for at most one main action per screen;
 * everything else is `secondary` (outline).
 */
export function Button({
  label,
  onPress,
  variant = "secondary",
  size = "md",
  icon,
  disabled,
  loading,
  block,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const textColor = isDisabled
    ? colors.mute
    : variant === "primary"
      ? colors.onPrimary
      : variant === "danger"
        ? colors.give
        : colors.ink;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        size === "sm" ? styles.sm : styles.md,
        variant === "primary" && styles.primary,
        variant === "secondary" && styles.secondary,
        variant === "danger" && styles.secondary,
        variant === "ghost" && styles.ghost,
        pressed &&
          variant === "primary" && { backgroundColor: colors.primaryPressed },
        pressed &&
          variant !== "primary" && { backgroundColor: colors.surfaceSoft },
        isDisabled && styles.disabled,
        block && { alignSelf: "stretch", flex: 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : icon ? (
        <Icon name={icon} size={16} color={textColor} />
      ) : null}
      <Txt variant="button" style={{ color: textColor }} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** Round icon-only button (44×44). Always pass an accessibility label. */
export function IconButton({
  icon,
  label,
  onPress,
  badge,
  outlined,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  badge?: boolean;
  outlined?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.icon,
        outlined && styles.secondary,
        pressed && { backgroundColor: colors.surfaceSoft },
      ]}
    >
      <Icon name={icon} size={20} />
      {badge ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "transparent",
  },
  md: { minHeight: touch, paddingHorizontal: 18 },
  sm: { minHeight: 36, paddingHorizontal: 14 },
  primary: { backgroundColor: colors.primary, borderColor: colors.primary },
  secondary: {
    backgroundColor: colors.canvas,
    borderColor: colors.hairlineStrong,
  },
  ghost: { backgroundColor: "transparent" },
  disabled: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.hairline,
  },
  icon: {
    width: touch,
    height: touch,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  dot: {
    position: "absolute",
    top: 10,
    right: 11,
    width: 9,
    height: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.give,
    borderWidth: 2,
    borderColor: colors.canvas,
  },
});
