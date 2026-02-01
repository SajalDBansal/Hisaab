import { Pressable, View } from "react-native";
import { colors } from "@/theme";
import { Icon } from "./Icon";
import { Txt } from "./Txt";

/** Square tick box with a label. The whole row is the touch target (44 pt high). */
export function Checkbox({
  label,
  checked,
  onChange,
  note,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Small grey text after the label, e.g. "1 Box = 12 Pcs". */
  note?: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      aria-checked={checked}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        minHeight: 44,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          borderWidth: 1.5,
          borderColor: checked ? colors.ink : colors.hairlineStrong,
          backgroundColor: checked ? colors.ink : colors.canvas,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? (
          <Icon name="check" size={14} color={colors.onPrimary} />
        ) : null}
      </View>
      <Txt variant="small" style={{ flex: 1 }}>
        {label}
        {note ? (
          <Txt variant="small" tone="body">
            {"  "}
            {note}
          </Txt>
        ) : null}
      </Txt>
    </Pressable>
  );
}
