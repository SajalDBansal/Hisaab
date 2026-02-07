import { useState } from "react";
import { View } from "react-native";
import {
  AssociateFieldInput,
  type AssociateField,
} from "@repo/contracts/src/associates";
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
import { AssociateGate } from "@/components/associates/AssociateGate";
import {
  useAssociateFields,
  useSaveAssociateField,
} from "@/data/associateHooks";
import { space } from "@/theme";

export default function ProfileFields() {
  const query = useAssociateFields();
  const [selected, setSelected] = useState<AssociateField | null | undefined>();
  return (
    <Screen header={<Header title="Associate profile fields" />}>
      <AssociateGate>
        <Button
          label="New field"
          icon="plus"
          onPress={() => setSelected(null)}
        />
        {selected !== undefined ? (
          <FieldEditor
            key={selected?.id ?? "new"}
            original={selected ?? undefined}
            done={() => setSelected(undefined)}
          />
        ) : null}
        <QueryView query={query}>
          {(rows) => (
            <View>
              {rows.map((row) => (
                <ListRow
                  key={row.id}
                  title={row.name}
                  subtitle={`${row.kind}${row.required ? " | Required" : ""}${row.active ? "" : " | Archived"}`}
                  chevron
                  onPress={() => setSelected(row)}
                />
              ))}
            </View>
          )}
        </QueryView>
      </AssociateGate>
    </Screen>
  );
}
function FieldEditor({
  original,
  done,
}: {
  original?: AssociateField;
  done: () => void;
}) {
  const [name, setName] = useState(original?.name ?? "");
  const [kind, setKind] = useState<AssociateField["kind"]>(
    original?.kind ?? "text",
  );
  const [choices, setChoices] = useState(original?.choices.join("\n") ?? "");
  const [required, setRequired] = useState(original?.required ?? false);
  const [active, setActive] = useState(original?.active ?? true);
  const [picker, setPicker] = useState(false);
  const mutation = useSaveAssociateField();
  const parsed = AssociateFieldInput.safeParse({
    name,
    kind,
    choices:
      kind === "choice"
        ? choices
            .split("\n")
            .map((v) => v.trim())
            .filter(Boolean)
        : [],
    required,
    active,
  });
  const submit = async () => {
    if (!parsed.success || mutation.isPending) return;
    try {
      await mutation.mutateAsync({
        data: parsed.data,
        id: original?.id,
        version: original?.version,
      });
      done();
    } catch (error) {
      showError("Couldn't save field", error);
    }
  };
  return (
    <View style={{ gap: space.md }}>
      <TextField
        label="Field name"
        value={name}
        onChangeText={setName}
        maxLength={80}
      />
      {original ? (
        <Txt>{kind}</Txt>
      ) : (
        <SelectField
          label="Field type"
          value={kind}
          onPress={() => setPicker(true)}
        />
      )}
      {kind === "choice" ? (
        <TextField
          label="Choices (one per line)"
          value={choices}
          onChangeText={setChoices}
          multiline
          editable={!original}
        />
      ) : null}
      <Checkbox label="Required" checked={required} onChange={setRequired} />
      <Checkbox label="Active" checked={active} onChange={setActive} />
      {!parsed.success ? (
        <Txt tone="give">{parsed.error.issues[0]?.message}</Txt>
      ) : null}
      <Button
        label="Save field"
        icon="check"
        variant="primary"
        disabled={!parsed.success}
        loading={mutation.isPending}
        onPress={submit}
      />
      <Button label="Cancel" icon="x" onPress={done} />
      <PickerSheet
        visible={picker}
        title="Field type"
        options={["text", "decimal", "date", "checkbox", "choice"].map(
          (id) => ({ id, title: id }),
        )}
        onSelect={(id) => {
          setKind(id as AssociateField["kind"]);
          setPicker(false);
        }}
        onClose={() => setPicker(false)}
      />
    </View>
  );
}
