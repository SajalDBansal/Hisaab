import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from "react-native";
import { colors, fonts, radius, space, touch } from "@/theme";
import { Icon } from "./Icon";
import { Txt } from "./Txt";

/** Labelled pill text input with an error message underneath. */
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  keyboardType,
  mono,
  multiline,
  editable = true,
  hideLabel,
  autoFocus,
  secureTextEntry,
  autoCapitalize,
  autoComplete,
  maxLength,
  onSubmitEditing,
}: {
  label: string;
  /** Keep the label for screen readers only (e.g. inside a table row). */
  hideLabel?: boolean;
  value: string;
  onChangeText?: (text: string) => void;
  /** Read-only fields show a soft grey background. */
  editable?: boolean;
  placeholder?: string;
  error?: string;
  keyboardType?: KeyboardTypeOptions;
  mono?: boolean;
  multiline?: boolean;
  autoFocus?: boolean;
  /** Passwords and PINs: show dots instead of letters. */
  secureTextEntry?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoComplete?: TextInputProps["autoComplete"];
  maxLength?: number;
  /** Called when the person presses Enter / Go on the keyboard. */
  onSubmitEditing?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6, flex: 1 }}>
      {hideLabel ? null : (
        <Txt variant="label" tone="charcoal">
          {label}
        </Txt>
      )}
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mute}
        keyboardType={keyboardType}
        multiline={multiline}
        editable={editable}
        autoFocus={autoFocus}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        maxLength={maxLength}
        onSubmitEditing={onSubmitEditing}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          styles.input,
          multiline && styles.multiline,
          mono && { fontFamily: fonts.mono, fontSize: 14 },
          !editable && {
            backgroundColor: colors.surfaceSoft,
            color: colors.charcoal,
          },
          focused && { borderColor: colors.ink },
          !!error && { borderColor: colors.give },
        ]}
      />
      {error ? (
        <Txt variant="caption" tone="give">
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

/**
 * Rupee input. Shows "₹" in front and only allows numbers with up to 2 decimals.
 * The parent keeps the typed text; convert with `parseRupees` from @repo/core.
 */
export function AmountField(props: {
  editable?: boolean;
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  error?: string;
}) {
  return (
    <TextField
      {...props}
      keyboardType="decimal-pad"
      placeholder="₹0.00"
      onChangeText={(t) => props.onChangeText(t.replace(/[^0-9.]/g, ""))}
    />
  );
}

/** Looks like an input but opens a picker (party, ledger, date …). */
export function SelectField({
  label,
  value,
  placeholder,
  onPress,
  error,
}: {
  label: string;
  value?: string;
  placeholder?: string;
  onPress: () => void;
  error?: string;
}) {
  return (
    <View style={{ gap: 6, flex: 1 }}>
      <Txt variant="label" tone="charcoal">
        {label}
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ?? placeholder ?? ""}`}
        onPress={onPress}
        style={[
          styles.input,
          styles.select,
          !!error && { borderColor: colors.give },
        ]}
      >
        <Txt
          variant="body"
          tone={value ? "ink" : "mute"}
          numberOfLines={1}
          style={{ flex: 1 }}
        >
          {value ?? placeholder}
        </Txt>
        <Icon name="chevron-down" size={16} color={colors.charcoal} />
      </Pressable>
      {error ? (
        <Txt variant="caption" tone="give">
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: touch,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.canvas,
    fontSize: 15,
    color: colors.ink,
  },
  multiline: {
    borderRadius: radius.card,
    paddingVertical: space.md,
    minHeight: 72,
    textAlignVertical: "top",
  },
  select: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
