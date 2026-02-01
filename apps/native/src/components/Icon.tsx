import Feather from "@expo/vector-icons/Feather";
import type { ComponentProps } from "react";
import { colors } from "@/theme";

export type IconName = ComponentProps<typeof Feather>["name"];

/** Thin line icons (Feather) to match the design's stroke icons. */
export function Icon({
  name,
  size = 20,
  color = colors.ink,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <Feather name={name} size={size} color={color} />;
}
