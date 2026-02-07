import { useState } from "react";
import { View } from "react-native";
import type {
  AssociateField,
  AssociateInput,
} from "@repo/contracts/src/associates";
import {
  Checkbox,
  DateField,
  PickerSheet,
  SelectField,
  TextField,
} from "@/components";
import { space } from "@/theme";

export function AssociateFields({
  definitions,
  values,
  onChange,
}: {
  definitions: AssociateField[];
  values: AssociateInput["fields"];
  onChange: (values: AssociateInput["fields"]) => void;
}) {
  const [choice, setChoice] = useState<AssociateField | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const set = (id: string, value: string | number | boolean) =>
    onChange({ ...values, [id]: value });
  return (
    <View style={{ gap: space.md }}>
      {definitions
        .filter((f) => f.active || values[f.id] !== undefined)
        .map((field) => {
          const value = values[field.id];
          const label = `${field.name}${field.required ? " *" : ""}`;
          if (field.kind === "checkbox")
            return (
              <Checkbox
                key={field.id}
                label={label}
                checked={value === true}
                onChange={(checked) => set(field.id, checked)}
              />
            );
          if (field.kind === "date")
            return (
              <DateField
                key={field.id}
                label={label}
                value={typeof value === "string" ? value : ""}
                onChange={(date) => set(field.id, date)}
              />
            );
          if (field.kind === "choice")
            return (
              <SelectField
                key={field.id}
                label={label}
                value={typeof value === "string" ? value : ""}
                onPress={() => setChoice(field)}
              />
            );
          return (
            <TextField
              key={field.id}
              label={label}
              value={
                texts[field.id] ?? (value === undefined ? "" : String(value))
              }
              keyboardType={
                field.kind === "decimal" ? "decimal-pad" : "default"
              }
              onChangeText={(text) => {
                setTexts((current) => ({ ...current, [field.id]: text }));
                set(
                  field.id,
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
        options={(choice?.choices ?? []).map((value) => ({
          id: value,
          title: value,
        }))}
        onSelect={(value) => {
          if (choice) set(choice.id, value);
          setChoice(null);
        }}
        onClose={() => setChoice(null)}
      />
    </View>
  );
}
