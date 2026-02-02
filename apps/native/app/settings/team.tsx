import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import {
  can,
  PERMISSIONS,
  ROLES,
  roleInfo,
  type Role,
  type TeamMember,
} from "@repo/core";
import {
  Avatar,
  Badge,
  Button,
  Header,
  Icon,
  ListRow,
  PickerSheet,
  QueryView,
  Screen,
  TableRow,
  Txt,
  showError,
} from "@/components";
import { useTeam, useUpdateMember } from "@/data/queries";
import { confirmAction } from "@/data/confirm";
import { colors, radius, space } from "@/theme";

/** People who use the books, their roles, and what each role can do. */
export default function TeamScreen() {
  const team = useTeam();
  const updateMember = useUpdateMember();
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const me = team.data?.members.find((m) => m.id === team.data?.currentUserId);
  const canManage = !!me && can(me.role, "team");

  const setRole = async (role: Role) => {
    if (!editing) return;
    const member = editing;
    setEditing(null);
    try {
      await updateMember.mutateAsync({ id: member.id, patch: { role } });
    } catch (e) {
      showError("Couldn't change role", e);
    }
  };

  return (
    <Screen
      header={
        <Header
          title="Team and roles"
          subtitle="Who can see and do what"
          right={
            canManage ? (
              <Button
                label="Invite"
                size="sm"
                icon="user-plus"
                onPress={() => router.push("/settings/invite")}
              />
            ) : undefined
          }
        />
      }
      onRefresh={() => team.refetch()}
      refreshing={team.isRefetching}
    >
      <QueryView query={team}>
        {({ members, currentUserId }) => (
          <View>
            {members.map((m, i) => (
              <ListRow
                key={m.id}
                left={<Avatar name={m.name} />}
                title={m.id === currentUserId ? `${m.name} (you)` : m.name}
                subtitle={[
                  m.email || m.phone,
                  m.active ? "Active" : "Invite sent",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                onPress={
                  canManage && m.role !== "owner" && m.active
                    ? () => setEditing(m)
                    : undefined
                }
                right={
                  <View style={{ alignItems: "flex-end", gap: 3 }}>
                    <Badge
                      label={roleInfo(m.role).label}
                      tone={m.role === "owner" ? "ink" : "neutral"}
                    />
                    {!m.active ? <Badge label="Invited" tone="dashed" /> : null}
                    {canManage && m.role !== "owner" ? (
                      <Button
                        label={m.active ? "Remove" : "Cancel invite"}
                        icon="x"
                        size="sm"
                        onPress={() =>
                          confirmAction(
                            m.active ? "Remove access?" : "Cancel invitation?",
                            m.email || m.name,
                            "Confirm",
                            async () => {
                              await updateMember.mutateAsync({
                                id: m.id,
                                patch: { active: false },
                              });
                            },
                          )
                        }
                      />
                    ) : null}
                  </View>
                }
                last={i === members.length - 1}
              />
            ))}
          </View>
        )}
      </QueryView>
      {updateMember.isPending ? (
        <Txt variant="caption" tone="body" center>
          Saving…
        </Txt>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Txt variant="heading">Role permissions</Txt>
        <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}>
          <View
            style={{
              minWidth: 500,
              flex: 1,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: radius.card,
              overflow: "hidden",
            }}
          >
            <TableRow
              header
              width={52}
              cells={["", ...ROLES.map((r) => r.short)]}
            />
            {PERMISSIONS.map((p, i) => (
              <TableRow
                key={p.key}
                width={52}
                last={i === PERMISSIONS.length - 1}
                cells={[
                  p.label,
                  ...ROLES.map((r) =>
                    r.can.includes(p.key) ? (
                      <Icon
                        key={r.role}
                        name="check"
                        size={16}
                        color={colors.get}
                      />
                    ) : (
                      <Txt key={r.role} variant="small" tone="mute">
                        —
                      </Txt>
                    ),
                  ),
                ]}
              />
            ))}
          </View>
        </ScrollView>
      </View>

      <PickerSheet
        visible={!!editing}
        title={editing ? `Role for ${editing.name}` : "Role"}
        onClose={() => setEditing(null)}
        onSelect={(role) => setRole(role as Role)}
        options={ROLES.filter((r) => r.role !== "owner").map((r) => ({
          id: r.role,
          title: r.label,
          subtitle: r.note,
          right:
            editing?.role === r.role ? (
              <Icon name="check" size={18} />
            ) : undefined,
        }))}
      />
    </Screen>
  );
}
