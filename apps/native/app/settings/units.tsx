import { useState } from "react";
import { Switch, View } from "react-native";
import { UQC_CODES, type UnitRow } from "@repo/core";
import {
  Badge,
  Button,
  Header,
  IconButton,
  QueryView,
  Screen,
  Txt,
  showError,
} from "@/components";
import { confirmAction } from "@/data/confirm";
import { useRemoveUnit, useSetUnitEnabled, useUnits } from "@/data/queries";
import { AddUnitSheet } from "@/forms/AddUnitSheet";
import { colors, space } from "@/theme";
import { useGstMode } from "@/data/gstMode";

const uqcLabel = (code: string) =>
  `${code} · ${UQC_CODES.find((c) => c.code === code)?.label ?? ""}`;

/** Units of measure: switch on the ones the firm uses, add its own. */
export default function UnitsScreen() {
  const units = useUnits();
  const setEnabled = useSetUnitEnabled();
  const remove = useRemoveUnit();
  const [adding, setAdding] = useState(false);

  const toggle = async (u: UnitRow, enabled: boolean) => {
    try {
      await setEnabled.mutateAsync({ name: u.name, enabled });
    } catch (e) {
      showError("Couldn't change", e);
    }
  };

  const onDelete = (u: UnitRow) =>
    confirmAction(
      `Delete ${u.name}?`,
      "It will be removed from the unit list.",
      "Delete",
      async () => {
        try {
          await remove.mutateAsync(u.name);
        } catch (e) {
          showError("Couldn't delete", e);
        }
      },
    );

  return (
    <Screen
      header={
        <Header
          title="Units"
          subtitle="Units your items can be counted in"
          right={
            <Button
              label="Add"
              size="sm"
              icon="plus"
              onPress={() => setAdding(true)}
            />
          }
        />
      }
      onRefresh={() => units.refetch()}
      refreshing={units.isRefetching}
    >
      <QueryView query={units}>
        {(list) => {
          const on = list.filter((u) => u.enabled);
          const off = list.filter((u) => !u.enabled);
          return (
            <>
              <Section
                title={`Switched on · ${on.length}`}
                note="Shown when adding or editing items"
                rows={on}
                onToggle={toggle}
                onDelete={onDelete}
              />
              {off.length ? (
                <Section
                  title={`Switched off · ${off.length}`}
                  note="Hidden from new items. Items already using them keep them."
                  rows={off}
                  onToggle={toggle}
                  onDelete={onDelete}
                />
              ) : null}
            </>
          );
        }}
      </QueryView>
      <AddUnitSheet visible={adding} onClose={() => setAdding(false)} />
    </Screen>
  );
}

function Section({
  title,
  note,
  rows,
  onToggle,
  onDelete,
}: {
  title: string;
  note: string;
  rows: UnitRow[];
  onToggle: (u: UnitRow, enabled: boolean) => void;
  onDelete: (u: UnitRow) => void;
}) {
  const gst = useGstMode();
  return (
    <View>
      <Txt variant="heading">{title}</Txt>
      <Txt variant="caption" tone="body" style={{ marginBottom: space.xs }}>
        {note}
      </Txt>
      {rows.map((u, i) => (
        <View
          key={u.name}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.md,
            minHeight: 60,
            paddingVertical: 8,
            borderBottomWidth: i === rows.length - 1 ? 0 : 1,
            borderBottomColor: colors.hairline,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <Txt variant="bodyStrong">{u.name}</Txt>
              {u.builtIn ? null : <Badge label="Added by you" tone="dashed" />}
            </View>
            <Txt variant="caption" tone="body">
              {gst.on ? "GST " : "Code "}
              {uqcLabel(u.uqc)}
              {u.itemCount
                ? ` · ${u.itemCount} item${u.itemCount > 1 ? "s" : ""}`
                : ""}
            </Txt>
          </View>
          {!u.builtIn && u.itemCount === 0 ? (
            <IconButton
              icon="trash-2"
              label={`Delete ${u.name}`}
              onPress={() => onDelete(u)}
            />
          ) : null}
          <Switch
            value={u.enabled}
            onValueChange={(v) => onToggle(u, v)}
            accessibilityLabel={`${u.name} switched ${u.enabled ? "on" : "off"}`}
            trackColor={{ true: colors.ink, false: colors.hairlineStrong }}
            thumbColor={colors.canvas}
            {...({ activeThumbColor: colors.canvas } as object)}
          />
        </View>
      ))}
    </View>
  );
}
