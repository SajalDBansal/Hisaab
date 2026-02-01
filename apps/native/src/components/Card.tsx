import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors, radius, space } from "@/theme";

type Variant = "outline" | "soft" | "dark";

/**
 * The two card treatments from design.md: a 1px hairline outline, or the inverted dark card.
 * Use `dark` at most once per screen. `soft` is a light grey panel for notes and summaries.
 */
export function Card({
  children,
  variant = "outline",
  onPress,
  style,
}: {
  children: React.ReactNode;
  variant?: Variant;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const content = [styles.base, styles[variant], style];
  if (!onPress) return <View style={content}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [content, pressed && { opacity: 0.85 }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.card, padding: space.lg, gap: space.xs },
  outline: {
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.canvas,
  },
  soft: { backgroundColor: colors.surfaceSoft },
  dark: { backgroundColor: colors.surfaceDark },
});
