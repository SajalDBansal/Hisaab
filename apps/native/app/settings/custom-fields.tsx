import { useState } from "react";
import { View } from "react-native";
import {
  CUSTOM_FIELD_VOUCHER_TYPES,
  type CustomFieldDef,
  type CustomFieldEntity,
  type CustomFieldKind,
  type VoucherType,
} from "@repo/core";
import {
  Button,
  Checkbox,
  Header,
  ListRow,
  PickerSheet,
  QueryView,
  Screen,
  SelectField,
  TextField,
  Txt,
  showError,
} from "@/components";
import { voucherTypeLabel } from "@/data/labels";
import { useCustomFields, useSaveCustomField } from "@/data/queries";
import { space } from "@/theme";

const ENTITIES: { id: CustomFieldEntity; title: string; note: string }[] = [
  { id: "party", title: "Parties", note: "e.g. Area, Route, Drug licence no." },
  { id: "item", title: "Items", note: "e.g. Brand, Size, Shelf" },
  {
    id: "voucher",
    title: "Bills and orders",
    note: "e.g. Vehicle no., Transport, PO ref.",
  },
];
const KINDS: { id: CustomFieldKind; title: string }[] = [
  { id: "text", title: "Text" },
  { id: "decimal", title: "Number" },
  { id: "date", title: "Date" },
  { id: "checkbox", title: "Yes / no" },
  { id: "choice", title: "Pick from a list" },
];
const kindTitle = (kind: CustomFieldKind) =>
  KINDS.find((k) => k.id === kind)?.title ?? kind;

/** Custom fields on parties, items and bill headers (doc 37, T07). */
export default function CustomFieldsScreen() {
  const query = useCustomFields();
  const [editing, setEditing] = useState<
    { entity: CustomFieldEntity; field?: CustomFieldDef } | undefined
  >();
  return (
    <Screen
      header={
        <Header
          close
          title="Custom fields"
          subtitle="Your own fields on parties, items and bills"
        />
      }
    >
      {editing ? (
        <FieldEditor
          key={editing.field?.id ?? `new-${editing.entity}`}
          entity={editing.entity}
          original={editing.field}
          done={() => setEditing(undefined)}
        />
      ) : null}
      <QueryView query={query}>
        {(defs) => (
          <View style={{ gap: space.lg }}>
            {ENTITIES.map((entity) => {
              const rows = defs.filter((d) => d.entity === entity.id);
              return (
                <View key={entity.id} style={{ gap: space.sm }}>
                  <Txt variant="heading">{entity.title}</Txt>
                  <Txt variant="caption" tone="body">
                    {entity.note}
                  </Txt>
                  {rows.map((row, i) => (
                    <ListRow
                      key={row.id}
                      title={row.name}
                      last={i === rows.length - 1}
                      chevron
                      onPress={() =>
                        setEditing({ entity: entity.id, field: row })
                      }
                      subtitle={[
                        kindTitle(row.kind),
                        row.required ? "Required" : "",
                        row.print ? "Printed" : "",
                        row.entity === "voucher" && row.voucherTypes.length
                          ? row.voucherTypes
                              .map((t) => voucherTypeLabel[t])
                              .join(", ")
                          : "",
                        row.active ? "" : "Switched off",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    />
                  ))}
                  <Button
                    label={`Add a field to ${entity.title.toLowerCase()}`}
                    icon="plus"
                    size="sm"
                    onPress={() => setEditing({ entity: entity.id })}
                  />
                </View>
              );
            })}
            <Txt variant="caption" tone="body">
              A field&apos;s type can&apos;t change once saved, so stored values
              keep their meaning. Switch a field off instead of removing it;
              values already saved stay on the records.
            </Txt>
          </View>
        )}
      </QueryView>
    </Screen>
  );
}

function FieldEditor({
  entity,
  original,
  done,
}: {
  entity: CustomFieldEntity;
  original?: CustomFieldDef;
  done: () => void;
}) {
  const [name, setName] = useState(original?.name ?? "");
  const [kind, setKind] = useState<CustomFieldKind>(original?.kind ?? "text");
  const [newChoices, setNewChoices] = useState("");
  const [required, setRequired] = useState(original?.required ?? false);
  const [active, setActive] = useState(original?.active ?? true);
  const [print, setPrint] = useState(original?.print ?? false);
  const [types, setTypes] = useState<VoucherType[]>(
    original?.voucherTypes ?? [],
  );
  const [picker, setPicker] = useState(false);
  const save = useSaveCustomField();
  const existing = original?.choices ?? [];
  const added = newChoices
    .split("\n")
    .map((v) => v.trim())
    .filter((v) => v && !existing.includes(v));
  const choices = kind === "choice" ? [...existing, ...new Set(added)] : [];
  const problem = !name.trim()
    ? "Name the field."
    : kind === "choice" && !choices.length
      ? "Add at least one choice."
      : null;

  const submit = async () => {
    if (problem) return;
    try {
      await save.mutateAsync({
        input: {
          entity,
          name: name.trim(),
          kind,
          choices,
          required: kind === "checkbox" ? false : required,
          active,
          print,
          voucherTypes: entity === "voucher" ? types : [],
        },
        id: original?.id,
        version: original?.version,
      });
      done();
    } catch (error) {
      showError("Couldn't save the field", error);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <Txt variant="heading">
        {original ? `Edit ${original.name}` : "New field"}
      </Txt>
      <TextField
        label="Field name"
        value={name}
        onChangeText={setName}
        maxLength={60}
      />
      {original ? (
        <Txt tone="body">Type: {kindTitle(kind)}</Txt>
      ) : (
        <SelectField
          label="Type"
          value={kindTitle(kind)}
          onPress={() => setPicker(true)}
        />
      )}
      {kind === "choice" ? (
        <View style={{ gap: space.sm }}>
          {existing.length ? (
            <Txt variant="caption" tone="body">
              Choices: {existing.join(", ")} (these stay; add more below)
            </Txt>
          ) : null}
          <TextField
            label={
              existing.length
                ? "More choices (one per line)"
                : "Choices (one per line)"
            }
            value={newChoices}
            onChangeText={setNewChoices}
            multiline
          />
        </View>
      ) : null}
      {kind !== "checkbox" ? (
        <Checkbox label="Required" checked={required} onChange={setRequired} />
      ) : null}
      <Checkbox
        label="Print on bills and orders"
        checked={print}
        onChange={setPrint}
      />
      <Checkbox label="Switched on" checked={active} onChange={setActive} />
      {entity === "voucher" ? (
        <View style={{ gap: space.xs }}>
          <Txt variant="caption" tone="body">
            Shows on (none ticked = all of these)
          </Txt>
          {CUSTOM_FIELD_VOUCHER_TYPES.map((type) => (
            <Checkbox
              key={type}
              label={voucherTypeLabel[type]}
              checked={types.includes(type)}
              onChange={(on) =>
                setTypes(
                  on ? [...types, type] : types.filter((t) => t !== type),
                )
              }
            />
          ))}
        </View>
      ) : null}
      {problem ? <Txt tone="give">{problem}</Txt> : null}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button
          label="Save field"
          icon="check"
          variant="primary"
          disabled={!!problem}
          loading={save.isPending}
          onPress={submit}
        />
        <Button label="Cancel" icon="x" onPress={done} />
      </View>
      <PickerSheet
        visible={picker}
        title="Field type"
        options={KINDS.map((k) => ({ id: k.id, title: k.title }))}
        onSelect={(id) => {
          setKind(id as CustomFieldKind);
          setPicker(false);
        }}
        onClose={() => setPicker(false)}
      />
    </View>
  );
}
