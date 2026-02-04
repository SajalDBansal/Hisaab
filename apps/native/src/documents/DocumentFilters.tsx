import { useState } from "react";
import { View } from "react-native";
import {
  financialYear,
  today,
  type DocumentFilters as Filters,
  type DocumentKind,
} from "@repo/core";
import {
  Button,
  Checkbox,
  DateField,
  PickerSheet,
  Segmented,
  SelectField,
} from "@/components";
import { useParties, usePickableAccounts } from "@/data/queries";
import { documentKindLabel } from "@/data/labels";
import { space } from "@/theme";

const kinds: DocumentKind[] = [
  "bill",
  "receipt",
  "certificate",
  "agreement",
  "other",
];
const toggle = <T,>(list: T[] | undefined, id: T) =>
  list?.includes(id) ? list.filter((x) => x !== id) : [...(list ?? []), id];

export function DocumentFilters({
  value,
  onChange,
}: {
  value: Filters;
  onChange: (next: Filters) => void;
}) {
  const parties = useParties();
  const accounts = usePickableAccounts();
  const [picker, setPicker] = useState<"party" | "account" | "kind">("party");
  const [visible, setVisible] = useState(false);
  const open = (next: typeof picker) => {
    setPicker(next);
    setVisible(true);
  };
  const patch = (next: Partial<Filters>) => onChange({ ...value, ...next });
  const options =
    picker === "party"
      ? (parties.data ?? []).map((p) => ({
          id: p.party.id,
          title: p.party.name,
        }))
      : picker === "account"
        ? (accounts.data ?? []).map((a) => ({
            id: a.key,
            title: a.name,
            subtitle: a.group,
          }))
        : kinds.map((id) => ({ id, title: documentKindLabel[id] }));
  const selected =
    picker === "party"
      ? value.partyIds
      : picker === "account"
        ? value.accountKeys
        : value.kinds;
  return (
    <View style={{ gap: space.md }}>
      <SelectField
        label="Parties"
        value={
          value.partyIds?.length
            ? `${value.partyIds.length} selected`
            : "All parties"
        }
        onPress={() => open("party")}
      />
      <SelectField
        label="Ledgers / accounts"
        value={
          value.accountKeys?.length
            ? `${value.accountKeys.length} selected`
            : "All accounts"
        }
        onPress={() => open("account")}
      />
      <SelectField
        label="Document types"
        value={
          value.kinds?.length
            ? value.kinds.map((k) => documentKindLabel[k]).join(", ")
            : "All types"
        }
        onPress={() => open("kind")}
      />
      <Checkbox
        label="Date range"
        checked={!!value.from}
        onChange={(checked) =>
          patch({
            from: checked ? financialYear(today()).start : undefined,
            to: checked ? today() : undefined,
          })
        }
      />
      {value.from ? (
        <>
          <Segmented
            value={value.dateBy ?? "upload"}
            onChange={(dateBy) => patch({ dateBy })}
            options={[
              { value: "upload", label: "Upload date" },
              { value: "entry", label: "Entry date" },
            ]}
          />
          <View style={{ flexDirection: "row", gap: space.md }}>
            <DateField
              label="From"
              value={value.from}
              onChange={(from) => patch({ from })}
            />
            <DateField
              label="To"
              value={value.to ?? today()}
              onChange={(to) => patch({ to })}
            />
          </View>
        </>
      ) : null}
      <Button
        label="Clear filters"
        icon="x"
        size="sm"
        onPress={() => onChange({})}
      />
      <PickerSheet
        visible={visible}
        title={
          picker === "party"
            ? "Parties"
            : picker === "account"
              ? "Ledgers / accounts"
              : "Document types"
        }
        options={options}
        selectedIds={selected ?? []}
        onClose={() => setVisible(false)}
        onSelect={(id) =>
          picker === "party"
            ? patch({ partyIds: toggle(value.partyIds, id) })
            : picker === "account"
              ? patch({ accountKeys: toggle(value.accountKeys, id) })
              : patch({ kinds: toggle(value.kinds, id as DocumentKind) })
        }
      />
    </View>
  );
}
