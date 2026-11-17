import { useState } from "react";
import { View } from "react-native";
import {
  fieldsFor,
  formatCustomValue,
  type CustomFieldDef,
  type CustomFieldEntity,
  type CustomFieldValues,
  type VoucherType,
} from "@repo/core";
import { Checkbox } from "./Checkbox";
import { DateField } from "./DateField";
import { PickerSheet } from "./PickerSheet";
import { SelectField, TextField } from "./Field";
import { Txt } from "./Txt";
import { space } from "@/theme";

/**
 * Inputs for a record's custom fields (doc 37, T07). Shows the active fields
 * for this record (and voucher type), plus any switched-off field that already
 * has a value, so nothing stored is hidden while editing.
 */
export function CustomFieldInputs({
  defs,
  entity,
  voucherType,
  values,
  onChange,
}: {
  defs: CustomFieldDef[] | undefined;
  entity: CustomFieldEntity;
  voucherType?: VoucherType;
  values: CustomFieldValues;
  onChange: (values: CustomFieldValues) => void;
}) {
  const [choice, setChoice] = useState<CustomFieldDef | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const shown = new Set(fieldsFor(defs, entity, voucherType).map((d) => d.key));
  const fields = (defs ?? [])
    .filter(
      (d) =>
        d.entity === entity &&
        (shown.has(d.key) || values[d.key] !== undefined),
    )
    .sort((a, b) => a.position - b.position);
  if (!fields.length) return null;
  const set = (key: string, value: string | number | boolean | undefined) => {
    const next = { ...values };
    if (value === undefined || value === "") delete next[key];
    else next[key] = value;
    onChange(next);
  };
  return (
    <View style={{ gap: space.md }}>
      {fields.map((field) => {
        const value = values[field.key];
        const label = `${field.name}${field.required && shown.has(field.key) ? " *" : ""}`;
        if (field.kind === "checkbox")
          return (
            <Checkbox
              key={field.key}
              label={label}
              checked={value === true}
              onChange={(checked) => set(field.key, checked)}
            />
          );
        if (field.kind === "date")
          return (
            <DateField
              key={field.key}
              label={label}
              value={typeof value === "string" ? value : ""}
              onChange={(date) => set(field.key, date)}
            />
          );
        if (field.kind === "choice")
          return (
            <SelectField
              key={field.key}
              label={label}
              value={typeof value === "string" ? value : ""}
              onPress={() => setChoice(field)}
            />
          );
        return (
          <TextField
            key={field.key}
            label={label}
            value={
              texts[field.key] ?? (value === undefined ? "" : String(value))
            }
            keyboardType={field.kind === "decimal" ? "decimal-pad" : "default"}
            onChangeText={(text) => {
              setTexts((current) => ({ ...current, [field.key]: text }));
              set(
                field.key,
                field.kind === "decimal" &&
                  text.trim() !== "" &&
                  Number.isFinite(Number(text))
                  ? Number(text)
                  : text,
              );
            }}
            maxLength={1000}
          />
        );
      })}
      <PickerSheet
        visible={!!choice}
        title={choice?.name ?? "Choose"}
        options={[
          ...(choice && !choice.required ? [{ id: "", title: "None" }] : []),
          ...(choice?.choices ?? []).map((value) => ({
            id: value,
            title: value,
          })),
        ]}
        onSelect={(value) => {
          if (choice) set(choice.key, value || undefined);
          setChoice(null);
        }}
        onClose={() => setChoice(null)}
      />
    </View>
  );
}

/** A record's custom values as label: value lines; nothing when there are none. */
export function CustomFieldValuesView({
  defs,
  entity,
  values,
}: {
  defs: CustomFieldDef[] | undefined;
  entity: CustomFieldEntity;
  values: CustomFieldValues | undefined;
}) {
  const rows = (defs ?? [])
    .filter((d) => d.entity === entity && values?.[d.key] !== undefined)
    .sort((a, b) => a.position - b.position);
  if (!rows.length) return null;
  return (
    <View style={{ gap: 2 }}>
      {rows.map((d) => (
        <Txt key={d.key} variant="caption" tone="body">
          {d.name}: {formatCustomValue(values?.[d.key])}
        </Txt>
      ))}
    </View>
  );
}
