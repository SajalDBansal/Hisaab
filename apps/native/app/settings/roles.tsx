import { useState } from "react";
import { Pressable, View } from "react-native";
import {
  ALL_VOUCHER_TYPES,
  PERMISSIONS,
  VOUCHER_ACTIONS,
  VOUCHER_MODULE,
  roleProblem,
  type Permission,
  type RoleFlags,
  type RoleRights,
  type VoucherAction,
} from "@repo/core";
import type { CustomRole } from "@repo/contracts";
import {
  Button,
  Checkbox,
  Header,
  ListRow,
  QueryView,
  Screen,
  TextField,
  Txt,
  showError,
} from "@/components";
import { confirmAction } from "@/data/confirm";
import { voucherTypeLabel } from "@/data/labels";
import { useDeleteRole, useRoles, useSaveRole } from "@/data/queries";
import { colors, radius, space } from "@/theme";

const FLAGS: { key: keyof RoleFlags; label: string; note: string }[] = [
  {
    key: "hidePurchaseRate",
    label: "Hide purchase rates",
    note: "Purchase prices, opening cost and stock cost show as zero",
  },
  {
    key: "ownRecordsOnly",
    label: "Only entries they made",
    note: "Lists, details and changes are limited to their own entries",
  },
  {
    key: "viewProfitMargin",
    label: "See profit margin",
    note: "On sales, once the firm turns margins on",
  },
  {
    key: "viewAudit",
    label: "See where changes came from",
    note: "IP address and device in the edit log",
  },
  {
    key: "restoreCancelled",
    label: "Restore cancelled entries",
    note: "Put a cancelled entry back",
  },
];
const ACTION_LABEL: Record<VoucherAction, string> = {
  view: "See",
  create: "Add",
  edit: "Edit",
  cancel: "Cancel",
};

type Draft = {
  id?: string;
  version?: number;
  name: string;
  description: string;
  rights: RoleRights;
};

/** Custom roles (doc 37, T57): the owner gives each role exactly what it needs. */
export default function RolesScreen() {
  const roles = useRoles();
  const [draft, setDraft] = useState<Draft | null>(null);
  return (
    <Screen
      header={
        <Header close title="Roles" subtitle="Who can see and change what" />
      }
    >
      {draft ? (
        <RoleEditor
          key={draft.id ?? `new-${draft.name}`}
          draft={draft}
          done={() => setDraft(null)}
        />
      ) : null}
      <QueryView query={roles}>
        {(view) => (
          <View style={{ gap: space.lg }}>
            <View style={{ gap: space.sm }}>
              <Txt variant="heading">Your roles</Txt>
              {view.custom.length === 0 ? (
                <Txt variant="caption" tone="body">
                  None yet. Copy a built-in role below or start a new one.
                </Txt>
              ) : null}
              {view.custom.map((role: CustomRole, i) => (
                <ListRow
                  key={role.id}
                  title={role.name}
                  subtitle={`${role.members} ${role.members === 1 ? "person" : "people"}${role.description ? ` · ${role.description}` : ""}`}
                  chevron
                  last={i === view.custom.length - 1}
                  onPress={() =>
                    setDraft({
                      id: role.id,
                      version: role.version,
                      name: role.name,
                      description: role.description,
                      rights: role.rights as RoleRights,
                    })
                  }
                />
              ))}
              <Button
                label="New role"
                icon="plus"
                size="sm"
                onPress={() =>
                  setDraft({
                    name: "",
                    description: "",
                    rights: {
                      permissions: [],
                      vouchers: {},
                      flags: {
                        hidePurchaseRate: true,
                        viewProfitMargin: false,
                        ownRecordsOnly: false,
                        viewAudit: false,
                        restoreCancelled: false,
                      },
                    },
                  })
                }
              />
            </View>
            <View style={{ gap: space.sm }}>
              <Txt variant="heading">Built-in roles</Txt>
              {view.builtIn.map((role, i) => (
                <ListRow
                  key={role.role}
                  title={role.label}
                  subtitle={role.note}
                  last={i === view.builtIn.length - 1}
                  right={
                    role.role === "owner" ? undefined : (
                      <Button
                        label="Copy"
                        size="sm"
                        onPress={() =>
                          setDraft({
                            name: `${role.label} (copy)`,
                            description: role.note,
                            rights: role.rights as RoleRights,
                          })
                        }
                      />
                    )
                  }
                />
              ))}
              <Txt variant="caption" tone="body">
                Built-in roles don&apos;t change. Copy one to make a role you
                can adjust. The owner always has every right.
              </Txt>
            </View>
          </View>
        )}
      </QueryView>
    </Screen>
  );
}

function RoleEditor({ draft, done }: { draft: Draft; done: () => void }) {
  const save = useSaveRole();
  const remove = useDeleteRole();
  const [name, setName] = useState(draft.name);
  const [description, setDescription] = useState(draft.description);
  const [rights, setRights] = useState<RoleRights>(draft.rights);

  const hasModule = (p: Permission) => rights.permissions.includes(p);
  const toggleModule = (p: Permission, on: boolean) => {
    const permissions = on
      ? [...rights.permissions, p]
      : rights.permissions.filter((x) => x !== p);
    // Turning a module off also drops changes to its voucher types.
    const vouchers = { ...rights.vouchers };
    if (!on)
      for (const type of ALL_VOUCHER_TYPES)
        if (VOUCHER_MODULE[type] === p && vouchers[type])
          vouchers[type] = vouchers[type]!.filter((a) => a === "view");
    setRights({ ...rights, permissions, vouchers });
  };
  const hasAction = (
    type: (typeof ALL_VOUCHER_TYPES)[number],
    a: VoucherAction,
  ) => rights.vouchers[type]?.includes(a) ?? false;
  const toggleAction = (
    type: (typeof ALL_VOUCHER_TYPES)[number],
    a: VoucherAction,
  ) => {
    const current = rights.vouchers[type] ?? [];
    let next = current.includes(a)
      ? current.filter((x) => x !== a)
      : [...current, a];
    // Changing needs seeing; not seeing removes the changes.
    if (a !== "view" && next.includes(a) && !next.includes("view"))
      next = ["view", ...next];
    if (a === "view" && !next.includes("view")) next = [];
    setRights({ ...rights, vouchers: { ...rights.vouchers, [type]: next } });
  };

  const problem = !name.trim() ? "Name the role." : roleProblem(rights);
  const submit = async () => {
    if (problem) return;
    try {
      await save.mutateAsync({
        input: { name: name.trim(), description: description.trim(), rights },
        id: draft.id,
        version: draft.version,
      });
      done();
    } catch (e) {
      showError("Couldn't save the role", e);
    }
  };

  return (
    <View
      style={{
        gap: space.md,
        borderWidth: 1,
        borderColor: colors.hairline,
        borderRadius: radius.card,
        padding: space.md,
      }}
    >
      <Txt variant="heading">
        {draft.id ? `Edit ${draft.name}` : "New role"}
      </Txt>
      <TextField
        label="Role name"
        value={name}
        onChangeText={setName}
        maxLength={60}
      />
      <TextField
        label="What it's for (optional)"
        value={description}
        onChangeText={setDescription}
        maxLength={200}
      />

      <Txt variant="bodyStrong">Areas</Txt>
      {PERMISSIONS.map((p) => (
        <Checkbox
          key={p.key}
          label={p.label}
          checked={hasModule(p.key)}
          onChange={(on) => toggleModule(p.key, on)}
        />
      ))}

      <Txt variant="bodyStrong">Entries</Txt>
      <Txt variant="caption" tone="body">
        Adding, editing and cancelling a type needs its area ticked above.
      </Txt>
      {ALL_VOUCHER_TYPES.map((type) => {
        const moduleOn = hasModule(VOUCHER_MODULE[type]);
        return (
          <View key={type} style={{ gap: 4 }}>
            <Txt variant="small">{voucherTypeLabel[type]}</Txt>
            <View
              style={{ flexDirection: "row", gap: space.xs, flexWrap: "wrap" }}
            >
              {VOUCHER_ACTIONS.map((a) => {
                const on = hasAction(type, a);
                const disabled = a !== "view" && !moduleOn;
                return (
                  <Pressable
                    key={a}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled }}
                    accessibilityLabel={`${ACTION_LABEL[a]} ${voucherTypeLabel[type]}`}
                    disabled={disabled}
                    onPress={() => toggleAction(type, a)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: on ? colors.ink : colors.hairline,
                      backgroundColor: on ? colors.primary : "transparent",
                      opacity: disabled ? 0.4 : 1,
                    }}
                  >
                    <Txt
                      variant="small"
                      style={{ color: on ? colors.onPrimary : colors.ink }}
                    >
                      {ACTION_LABEL[a]}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}

      <Txt variant="bodyStrong">Extra rights</Txt>
      {FLAGS.map((f) => (
        <View key={f.key} style={{ gap: 2 }}>
          <Checkbox
            label={f.label}
            checked={rights.flags[f.key]}
            onChange={(on) =>
              setRights({ ...rights, flags: { ...rights.flags, [f.key]: on } })
            }
          />
          <Txt variant="caption" tone="body">
            {f.note}
          </Txt>
        </View>
      ))}

      {problem ? <Txt tone="give">{problem}</Txt> : null}
      <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
        <Button
          label="Save role"
          icon="check"
          variant="primary"
          disabled={!!problem}
          loading={save.isPending}
          onPress={submit}
        />
        <Button label="Close" icon="x" onPress={done} />
        {draft.id ? (
          <Button
            label="Delete"
            icon="trash-2"
            variant="danger"
            loading={remove.isPending}
            onPress={() =>
              confirmAction(
                `Delete ${draft.name}?`,
                "Only a role nobody has can be deleted.",
                "Delete",
                async () => {
                  try {
                    await remove.mutateAsync(draft.id!);
                    done();
                  } catch (e) {
                    showError("Couldn't delete the role", e);
                  }
                },
              )
            }
          />
        ) : null}
      </View>
    </View>
  );
}
