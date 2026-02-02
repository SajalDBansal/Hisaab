import { router } from "expo-router";
import { backOrReplace } from "@/navigation";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { ROLES, type Role } from "@repo/core";
import { InviteInput } from "@repo/contracts";
import {
  Button,
  FooterBar,
  Header,
  Screen,
  TextField,
  Txt,
  showError,
} from "@/components";
import { useInviteMember } from "@/data/queries";
import { colors, radius, space } from "@/theme";

/** Invite a colleague by the email used to sign in. */
export default function InviteScreen() {
  const invite = useInviteMember();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<Role, "owner">>("sales");
  const [showErrors, setShowErrors] = useState(false);
  const input = InviteInput.safeParse({
    email: email.trim().toLowerCase(),
    role,
  });

  const send = async () => {
    setShowErrors(true);
    if (!input.success) return;
    try {
      await invite.mutateAsync(input.data);
      backOrReplace(router, "/settings/team");
    } catch (e) {
      showError("Couldn't invite", e);
    }
  };

  return (
    <Screen
      header={
        <Header close title="Invite to team" subtitle="Email invitation" />
      }
      footer={
        <FooterBar>
          <Button
            label="Send invite"
            variant="primary"
            onPress={send}
            loading={invite.isPending}
            block
          />
        </FooterBar>
      }
    >
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        placeholder="colleague@example.com"
        error={
          showErrors && !input.success
            ? input.error.issues[0]?.message
            : undefined
        }
      />
      <View style={{ gap: space.sm }}>
        <Txt variant="label" tone="charcoal">
          Role
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
              borderColor: role === r.role ? colors.ink : colors.hairline,
            }}
          >
            <Txt variant="bodyStrong">{r.label}</Txt>
            <Txt variant="caption" tone="body">
              {r.note}
            </Txt>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
