import { Text, type TextProps } from "react-native";
import { colors, fonts, type } from "@/theme";

type Variant = keyof typeof type | "mono";
type Tone =
  | "ink"
  | "charcoal"
  | "body"
  | "mute"
  | "get"
  | "give"
  | "warn"
  | "onDark"
  | "onDarkMute";

export interface TxtProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
  /** Line up digits in columns (use for money). */
  num?: boolean;
  bold?: boolean;
  center?: boolean;
}

/** The only text component screens should use. Picks size, font and colour from the theme. */
export function Txt({
  variant = "body",
  tone = "ink",
  num,
  bold,
  center,
  style,
  ...rest
}: TxtProps) {
  const base =
    variant === "mono"
      ? { fontFamily: fonts.mono, fontSize: 13, lineHeight: 18 }
      : type[variant];
  return (
    <Text
      {...rest}
      style={[
        base,
        { color: colors[tone] },
        num && { fontVariant: ["tabular-nums"] },
        bold && { fontWeight: "600" },
        center && { textAlign: "center" },
        style,
      ]}
    />
  );
}
