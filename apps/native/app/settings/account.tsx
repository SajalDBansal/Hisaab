import type { FirmSummary, MyInvitation, SessionInfo } from "@repo/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ROLES, type Role } from "@repo/core";
import { router } from "expo-router";
import { View } from "react-native";
import {
  Badge,
  Button,
  Card,
  Header,
  KeyValue,
  Notice,
  QueryView,
  Screen,
  Txt,
  showError,
} from "@/components";
import { REQUIRE_LOGIN } from "@/auth/config";
import { api } from "@/auth/api";
import { useAuth } from "@/auth/AuthProvider";
import { confirmAction } from "@/data/confirm";
import { formatDateTime } from "@/data/format";
import { useData } from "@/data/DataProvider";
import { space } from "@/theme";

const ROLE_LABEL = Object.fromEntries(
  ROLES.map((r) => [r.role, r.label]),
) as Record<Role, string>;

/** Who is logged in, the state of the email and mobile checks, and the devices logged in. */
export default function AccountScreen() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const { userId, services } = useData();
  const devices = useQuery({
    queryKey: ["me", "sessions"],
    queryFn: () => api<SessionInfo[]>("/v1/me/sessions"),
    enabled: REQUIRE_LOGIN && auth.status === "signedIn",
  });
  const logOutDevice = useMutation({
    mutationFn: (id: string) =>
      api(`/v1/me/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["me", "sessions"] }),
    onError: (e) => showError("Couldn't log that device out", e),
  });

  const signedIn = REQUIRE_LOGIN && auth.status === "signedIn";
  const firms = useQuery({
    queryKey: ["me", "firms"],
    queryFn: () => api<FirmSummary[]>("/v1/firms"),
    enabled: signedIn,
  });
  const invitations = useQuery({
    queryKey: ["me", "invitations"],
    queryFn: () => api<MyInvitation[]>("/v1/me/invitations"),
    enabled: signedIn,
  });
  const answer = useMutation({
    mutationFn: async (v: { id: string; accept: boolean }) => {
      if (v.accept)
        return api<FirmSummary>(`/v1/me/invitations/${v.id}/accept`, {
          method: "POST",
        });
      await api(`/v1/me/invitations/${v.id}/decline`, { method: "POST" });
      return null;
    },
    onSuccess: async (firm) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me", "invitations"] }),
        queryClient.invalidateQueries({ queryKey: ["me", "firms"] }),
        queryClient.invalidateQueries({ queryKey: ["firm-selection", userId] }),
      ]);
      if (firm) {
        await services.firmService.switchTo(firm.id);
        router.replace("/");
      }
    },
    onError: (e) => {
      void queryClient.invalidateQueries({ queryKey: ["me", "invitations"] });
      showError("Couldn't answer the invitation", e);
    },
  });

  const me = auth.me;
  return (
    <Screen
      header={
        <Header title="Account" subtitle={me?.email ?? "Not logged in"} />
      }
    >
      {me ? (
        <Card style={{ gap: space.md }}>
          <Txt variant="heading">{me.name}</Txt>
          <KeyValue label="Email" value={me.email} />
          <View style={{ flexDirection: "row" }}>
            <Badge
              label={me.emailVerified ? "Email verified" : "Email not verified"}
              tone={me.emailVerified ? "neutral" : "warn"}
            />
          </View>
          <KeyValue label="Mobile" value={me.phoneNumber ?? "Not added"} />
          <View style={{ flexDirection: "row" }}>
            <Badge
              label={
                me.phoneVerified
                  ? "Mobile verified"
                  : "Mobile verification pending"
              }
              tone={me.phoneVerified ? "neutral" : "warn"}
            />
          </View>
          {!me.phoneVerified ? (
            <Txt variant="caption" tone="body">
              Checking your mobile number by WhatsApp will be added later. Until
              then everything in the app works, and you log in with your email.
            </Txt>
          ) : null}
        </Card>
      ) : (
        <Notice
          tone="info"
          text="Login is switched off in this build, so there is no account to show."
        />
      )}

      {signedIn && invitations.data && invitations.data.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Txt variant="heading">Invitations</Txt>
          {invitations.data.map((i) => (
            <Card key={i.id} style={{ gap: space.sm }}>
              <Txt variant="bodyStrong">{i.firmName}</Txt>
              <Txt variant="small" tone="body">
                {`${i.invitedBy} invited you as ${ROLE_LABEL[i.role]}.`}
              </Txt>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Button
                  label="Decline"
                  size="sm"
                  disabled={answer.isPending}
                  onPress={() => answer.mutate({ id: i.id, accept: false })}
                />
                <Button
                  label="Accept"
                  size="sm"
                  variant="primary"
                  disabled={answer.isPending}
                  onPress={() => answer.mutate({ id: i.id, accept: true })}
                />
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      {signedIn && firms.data && firms.data.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Txt variant="heading">Your firms</Txt>
          {firms.data.map((f) => (
            <Card key={f.id} style={{ gap: space.xs }}>
              <Txt variant="bodyStrong">{f.name}</Txt>
              <View style={{ flexDirection: "row" }}>
                <Badge label={ROLE_LABEL[f.role]} tone="neutral" />
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      {me ? (
        <View style={{ gap: space.sm }}>
          <Txt variant="heading">Devices logged in</Txt>
          <QueryView query={devices}>
            {(list) => (
              <View style={{ gap: space.sm }}>
                {list.map((d) => (
                  <Card key={d.id} style={{ gap: space.sm }}>
                    <Txt variant="bodyStrong">{`${d.deviceName ?? (d.platform === "app" ? "Phone" : "Browser")}${d.current ? " (this device)" : ""}`}</Txt>
                    <Txt
                      variant="small"
                      tone="body"
                    >{`${d.platform === "app" ? "App" : "Website"} · active ${formatDateTime(d.lastActiveAt)}`}</Txt>
                    {!d.current ? (
                      <View style={{ flexDirection: "row" }}>
                        <Button
                          label="Log out this device"
                          size="sm"
                          onPress={() => logOutDevice.mutate(d.id)}
                        />
                      </View>
                    ) : null}
                  </Card>
                ))}
                <Txt variant="caption" tone="body">
                  You can be logged in on one phone and one browser at a time.
                </Txt>
              </View>
            )}
          </QueryView>
        </View>
      ) : null}

      <Button
        label="App lock (PIN)"
        icon="lock"
        onPress={() => router.push("/settings/pin")}
      />
      {me ? (
        <Button
          label="Log out"
          variant="danger"
          onPress={() =>
            confirmAction(
              "Log out?",
              "You'll need your email and password to log in again. Entries not yet saved to the server stay on this device.",
              "Log out",
              () => void auth.signOut(),
            )
          }
        />
      ) : null}
    </Screen>
  );
}
