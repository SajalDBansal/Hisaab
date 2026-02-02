import { useState } from "react";
import { View } from "react-native";
import * as Crypto from "expo-crypto";
import { Button, PickerSheet, SelectField, TextField, Txt } from "@/components";
import { space } from "@/theme";
import { useReportPreferences } from "./reportPreferencesHooks";
import type { SavedReportFilter } from "./reportPreferences";

type FilterValue = SavedReportFilter extends infer T
  ? T extends SavedReportFilter
    ? Omit<T, "id" | "name">
    : never
  : never;

export function ReportPreferencesControls({
  firmId,
  value,
  onLoad,
  disabled = false,
}: {
  firmId: string;
  value: FilterValue;
  onLoad: (filter: SavedReportFilter) => void;
  disabled?: boolean;
}) {
  const prefs = useReportPreferences(firmId);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [problem, setProblem] = useState("");
  const [message, setMessage] = useState("");
  const filters = (prefs.allowed ? (prefs.query.data ?? []) : []).filter(
    (filter) => filter.kind === value.kind,
  );
  const existing = filters.find((filter) => filter.id === selected);
  const updating =
    !!existing && existing.name.toLowerCase() === name.trim().toLowerCase();
  const busy = disabled || prefs.save.isPending || prefs.remove.isPending;
  const save = async () => {
    setProblem("");
    setMessage("");
    try {
      const filter = await prefs.save.mutateAsync({
        ...value,
        id: updating ? existing.id : Crypto.randomUUID(),
        name,
      });
      setSelected(filter.id);
      setName(filter.name);
      setMessage("Saved on this device.");
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Couldn't save the filter.",
      );
    }
  };
  const remove = async () => {
    if (!selected) return;
    setProblem("");
    setMessage("");
    try {
      await prefs.remove.mutateAsync(selected);
      setSelected(null);
      setName("");
      setMessage("Saved filter deleted.");
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Couldn't delete the filter.",
      );
    }
  };
  return (
    <View style={{ gap: space.sm }}>
      <Txt variant="label">Saved filters (this device)</Txt>
      {prefs.query.isError ? (
        <>
          <Txt variant="small" tone="give">
            {prefs.query.error.message}
          </Txt>
          <Button
            label="Retry saved filters"
            icon="refresh-cw"
            onPress={() => void prefs.query.refetch()}
          />
        </>
      ) : null}
      <View pointerEvents={busy ? "none" : "auto"} style={{ gap: space.sm }}>
        <SelectField
          label="Load filter"
          value={
            existing?.name ??
            (prefs.query.isPending
              ? "Loading..."
              : filters.length
                ? "Choose saved filter"
                : "No saved filters")
          }
          onPress={() => {
            if (!busy && prefs.allowed && filters.length) setPicker(true);
          }}
        />
        <TextField
          label="Filter name"
          value={name}
          maxLength={60}
          editable={!busy && prefs.allowed}
          onChangeText={(text) => {
            setName(text);
            setMessage("");
            setProblem("");
          }}
        />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        <Button
          label={updating ? "Update saved filter" : "Save filter"}
          icon="save"
          loading={prefs.save.isPending}
          disabled={
            busy ||
            !prefs.allowed ||
            !name.trim() ||
            prefs.query.isPending ||
            prefs.query.isError
          }
          onPress={() => void save()}
        />
        {existing ? (
          <Button
            label="Delete saved filter"
            icon="trash-2"
            disabled={busy || !prefs.allowed}
            loading={prefs.remove.isPending}
            onPress={() => void remove()}
          />
        ) : null}
      </View>
      {problem ? (
        <Txt variant="small" tone="give">
          {problem}
        </Txt>
      ) : null}
      {message ? <Txt variant="small">{message}</Txt> : null}
      <PickerSheet
        visible={picker}
        title="Load saved filter"
        options={filters.map((filter) => ({
          id: filter.id,
          title: filter.name,
        }))}
        onClose={() => setPicker(false)}
        onSelect={(id) => {
          const filter = filters.find((entry) => entry.id === id);
          if (filter && prefs.allowed && !busy) {
            onLoad(filter);
            setSelected(id);
            setName(filter.name);
            setProblem("");
            setMessage("");
          }
          setPicker(false);
        }}
      />
    </View>
  );
}
