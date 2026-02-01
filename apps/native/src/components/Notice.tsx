import { View } from "react-native";
import { colors, radius } from "@/theme";
import { Icon } from "./Icon";
import { Txt } from "./Txt";

/** Amber warning box, e.g. "Over credit limit". `info` is a neutral grey note. */
export function Notice({
  text,
  tone = "warn",
}: {
  text: string;
  tone?: "warn" | "info";
}) {
  const warn = tone === "warn";
  return (
    <View
      accessibilityRole={warn ? "alert" : undefined}
      style={{
        flexDirection: "row",
        gap: 10,
        padding: 12,
        borderRadius: radius.card,
        borderWidth: 1,
        backgroundColor: warn ? colors.warnBg : colors.surfaceSoft,
        borderColor: warn ? colors.warnBorder : colors.hairline,
      }}
    >
      <Icon
        name={warn ? "alert-triangle" : "info"}
        size={18}
        color={warn ? colors.warnText : colors.charcoal}
      />
      <Txt
        variant="small"
        style={{ color: warn ? colors.warnText : colors.charcoal, flex: 1 }}
      >
        {text}
      </Txt>
    </View>
  );
}
