import { router, useLocalSearchParams } from "expo-router";
import { backOrReplace } from "@/navigation";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { ROLES, type Role } from "@repo/core";
import { TransferOwnershipInput } from "@repo/contracts";
import {
  Button,
  FooterBar,
  Header,
  Notice,
  QueryView,
  Screen,
  TextField,
  Txt,
  showError,
} from "@/components";
import { useFirm, useTeam, useTransferOwnership } from "@/data/queries";
import { colors, radius, space } from "@/theme";

/** The owner hands the firm to another member and picks their own new role. */
export default function TransferScreen() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const team = useTeam();
  const firm = useFirm();
  const transfer = useTransferOwnership();
  const [role, setRole] = useState<Exclude<Role, "owner">>("accountant");
  const [confirmName, setConfirmName] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const target = team.data?.members.find((m) => m.id === memberId);
  const firmName = firm.data?.name ?? "";
  const input = TransferOwnershipInput.safeParse({
    memberId,
    previousOwnerRole: role,
    confirmName,
  });
  const nameMatches =
    !!firmName &&
    confirmName.trim().toLowerCase() === firmName.trim().toLowerCase();

  const save = async () => {
    setShowErrors(true);
    if (!input.success || !nameMatches) return;
    try {
      await transfer.mutateAsync(input.data);
      backOrReplace(router, "/settings/team");
    } catch (e) {
      showError("Couldn't hand over the firm", e);
    }
  };

  return (
    <Screen
      header={
        <Header close title="Hand over the firm" subtitle="Make a new owner" />
      }
      footer={
        <FooterBar>
          <Button
            label="Make owner"
            variant="danger"
            onPress={save}
            loading={transfer.isPending}
            disabled={!target}
            block
          />
        </FooterBar>
      }
    >
      <QueryView query={team}>
        {() =>
          target ? (
            <View style={{ gap: space.lg }}>
              <Notice
                text={`${target.name} becomes the owner of ${firmName}. They can manage the team, settings and every entry, and can change or remove your access. Only they can hand it back.`}
              />
              <View style={{ gap: space.sm }}>
                <Txt variant="label" tone="charcoal">
                  Your role after the hand-over
                </Txt>
                {ROLES.filter((r) => r.role !== "owner").map((r) => (
                  <Pressable
                    key={r.role}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: role === r.role }}
                    onPress={() => setRole(r.role as Exclude<Role, "owner">)}
                    style={{
                      padding: 14,
                      minHeight: 56,
                      borderRadius: radius.card,
                      borderWidth: role === r.role ? 2 : 1,
                      borderColor:
                        role === r.role ? colors.ink : colors.hairline,
                    }}
                  >
                    <Txt variant="bodyStrong">{r.label}</Txt>
                    <Txt variant="caption" tone="body">
                      {r.note}
                    </Txt>
                  </Pressable>
                ))}
              </View>
              <TextField
                label={`Type ${firmName} to confirm`}
                value={confirmName}
                onChangeText={setConfirmName}
                autoCapitalize="none"
                placeholder={firmName}
                error={
                  showErrors && !nameMatches
                    ? "Type the firm name exactly to confirm."
                    : undefined
                }
              />
            </View>
          ) : (
            <Notice text="This team member was not found. Go back and pick someone from the team." />
          )
        }
      </QueryView>
    </Screen>
  );
}
