import { View } from "react-native";
import { formatINR, type Paise } from "@repo/core";
import { Txt, type TxtProps } from "./Txt";

/** A rupee amount from paise, e.g. ₹1,23,456.00. */
export function Money({
  value,
  decimals = true,
  ...rest
}: { value: Paise; decimals?: boolean } & Omit<TxtProps, "children">) {
  return (
    <Txt num {...rest}>
      {formatINR(value, { decimals })}
    </Txt>
  );
}

/**
 * Party balance with the plain-language label used across the app.
 * Positive → "You'll get" (green). Negative → "You'll give" (red). Zero → "Settled".
 */
export function Balance({
  value,
  align = "right",
}: {
  value: Paise;
  align?: "left" | "right";
}) {
  const tone = value > 0 ? "get" : value < 0 ? "give" : "body";
  const label =
    value > 0 ? "You'll get" : value < 0 ? "You'll give" : "Settled";
  return (
    <View style={{ alignItems: align === "right" ? "flex-end" : "flex-start" }}>
      <Money
        value={Math.abs(value)}
        tone={tone}
        variant="bodyStrong"
        style={{ fontWeight: "600" }}
      />
      <Txt variant="caption" tone={tone}>
        {label}
      </Txt>
    </View>
  );
}
