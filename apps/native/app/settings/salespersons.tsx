import { useState } from "react";
import { View } from "react-native";
import { can, type Salesperson } from "@repo/core";
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
import { useSalespersons, useSaveSalesperson } from "@/data/catalogHooks";
import { useData } from "@/data/DataProvider";
import { useTeam } from "@/data/queries";
import { space } from "@/theme";

/** Salespersons (doc 37, T10): who sold it, on bills, orders and reports. */
export default function SalespersonsScreen() {
  const query = useSalespersons();
  const { role } = useData();
  const canEdit = !!role && can(role, "settings");
  const team = useTeam();
  const memberName = (id?: string) =>
    team.data?.members.find((m) => (m.userId ?? m.id) === id)?.name;
  const [editing, setEditing] = useState<{ row?: Salesperson } | undefined>();
  return (
    <Screen
      header={
        <Header
          close
          title="Salespersons"
          subtitle="Who sold it: on bills, orders and reports"
        />
      }
    >
      {editing ? (
        <SalespersonEditor
          key={editing.row?.id ?? "new"}
          original={editing.row}
          done={() => setEditing(undefined)}
        />
      ) : null}
      <QueryView query={query}>
        {(list) => (
          <View style={{ gap: space.sm }}>
            {list.rows.length === 0 ? (
              <Txt tone="body">No salespersons yet.</Txt>
            ) : null}
            {list.rows.map((row, i) => (
              <ListRow
                key={row.id}
                title={row.name}
                last={i === list.rows.length - 1}
                chevron={canEdit}
                onPress={canEdit ? () => setEditing({ row }) : undefined}
                subtitle={[
                  row.userId
                    ? `Login: ${memberName(row.userId) ?? "a member"}`
                    : "No login",
                  row.phone ?? "",
                  row.id === list.mine ? "You" : "",
                  row.active ? "" : "Switched off",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
            {canEdit && !editing ? (
              <Button
                label="Add a salesperson"
                icon="plus"
                size="sm"
                onPress={() => setEditing({})}
              />
            ) : null}
            <Txt variant="caption" tone="body">
              Pick the salesperson on sales, estimates, proformas, sales orders
              and challans; a member linked to a salesperson starts with
              themselves. Roles limited to their own records also see the
              entries where they are the salesperson. Reports → Sales by
              salesperson and Sales orders by salesperson. Switch a salesperson
              off instead of removing them; old entries keep them.
            </Txt>
          </View>
        )}
      </QueryView>
    </Screen>
  );
}

const NO_LOGIN = "__none__";

function SalespersonEditor({
  original,
  done,
}: {
  original?: Salesperson;
  done: () => void;
}) {
  const [name, setName] = useState(original?.name ?? "");
  const [phone, setPhone] = useState(original?.phone ?? "");
  const [userId, setUserId] = useState<string | undefined>(original?.userId);
  const [active, setActive] = useState(original?.active ?? true);
  const [picker, setPicker] = useState(false);
  const team = useTeam();
  const save = useSaveSalesperson();
  // Logins of accepted members (pending invitations have none yet).
  const members = (team.data?.members ?? []).filter((m) => m.active);
  const loginOf = (m: (typeof members)[number]) => m.userId ?? m.id;
  const linked = members.find((m) => loginOf(m) === userId);

  const submit = async () => {
    if (!name.trim()) return showError("Couldn't save", "Enter the name.");
    try {
      await save.mutateAsync({
        input: {
          name: name.trim(),
          phone: phone.trim() || undefined,
          userId: userId ?? null,
          active,
        },
        id: original?.id,
        version: original?.version,
      });
      done();
    } catch (error) {
      showError("Couldn't save the salesperson", error);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <Txt variant="heading">
        {original ? `Edit ${original.name}` : "New salesperson"}
      </Txt>
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        maxLength={80}
      />
      <TextField
        label="Phone"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        maxLength={20}
      />
      <SelectField
        label="Login (optional)"
        value={linked?.name ?? (userId ? "A member" : undefined)}
        placeholder="No login"
        onPress={() => setPicker(true)}
      />
      <Checkbox
        label="Active"
        note="Switched off: stays on old entries, can't be picked again."
        checked={active}
        onChange={setActive}
      />
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button
          label="Save"
          icon="check"
          variant="primary"
          loading={save.isPending}
          onPress={() => void submit()}
        />
        <Button label="Cancel" onPress={done} />
      </View>
      <PickerSheet
        visible={picker}
        title="Linked login"
        onClose={() => setPicker(false)}
        onSelect={(id) => {
          setUserId(id === NO_LOGIN ? undefined : id);
          setPicker(false);
        }}
        options={[
          { id: NO_LOGIN, title: "No login" },
          ...members.map((m) => ({
            id: loginOf(m),
            title: m.name,
            subtitle: m.email ?? m.phone,
          })),
        ]}
      />
    </View>
  );
}
