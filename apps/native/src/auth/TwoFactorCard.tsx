import type { FirmSecurityView, TwoFactorStatus } from "@repo/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Notice,
  TextField,
  Txt,
  showError,
  showToast,
} from "@/components";
import { useData } from "@/data/DataProvider";
import { colors, space } from "@/theme";
import { api } from "./api";
import { useAuth } from "./AuthProvider";
import { REQUIRE_LOGIN } from "./config";
import { qrPath, totpSecret } from "./twoFactor";

type Step =
  | { kind: "idle" }
  | { kind: "enable" }
  | { kind: "scan"; uri: string; codes: string[] }
  | { kind: "codes"; codes: string[]; fresh: boolean }
  | { kind: "view" }
  | { kind: "regenerate" }
  | { kind: "disable" };

/** A QR code drawn with SVG squares; white border so phone cameras can read it. */
function QrCode({ text, size = 200 }: { text: string; size?: number }) {
  const { size: cells, d } = qrPath(text);
  const pad = 4;
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`${-pad} ${-pad} ${cells + pad * 2} ${cells + pad * 2}`}
      accessibilityLabel="QR code for your authenticator app"
    >
      <Rect
        x={-pad}
        y={-pad}
        width={cells + pad * 2}
        height={cells + pad * 2}
        fill="#ffffff"
      />
      <Path d={d} fill="#000000" />
    </Svg>
  );
}

function CodeList({ codes }: { codes: string[] }) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: space.sm,
        padding: space.md,
        borderRadius: 8,
        backgroundColor: colors.surfaceSoft,
      }}
    >
      {codes.map((code) => (
        <Txt key={code} variant="mono" selectable style={{ minWidth: 110 }}>
          {code}
        </Txt>
      ))}
    </View>
  );
}

/**
 * Settings → Account: two-factor sign-in with an authenticator app (doc 37,
 * T58), recovery codes, and the owner's "require it for everyone" switch.
 */
export function TwoFactorCard() {
  const auth = useAuth();
  const data = useData();
  const queryClient = useQueryClient();
  const signedIn = REQUIRE_LOGIN && auth.status === "signedIn" && !!auth.me;
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const status = useQuery({
    queryKey: ["me", "two-factor"],
    queryFn: () => api<TwoFactorStatus>("/v1/me/two-factor"),
    enabled: signedIn,
  });
  const isOwner = data.role === "owner" && !!data.firmId;
  const security = useQuery({
    queryKey: ["firm-security", data.firmId],
    queryFn: () =>
      api<FirmSecurityView>("/v1/settings/security", {
        headers: { "x-firm-id": data.firmId ?? "" },
      }),
    enabled: signedIn && isOwner && !data.twoFactorBlocked,
  });

  const reset = () => {
    setStep({ kind: "idle" });
    setPassword("");
    setCode("");
  };
  // Turning it on or off gives this device a new session cookie and changes `me`.
  const refreshAll = async () => {
    await auth.refresh();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["me"] }),
      queryClient.invalidateQueries({
        queryKey: ["firm-selection", data.userId],
      }),
    ]);
  };

  const run = useMutation({
    mutationFn: async (action: Step["kind"]) => {
      switch (action) {
        case "enable": {
          const r = await api<{ totpURI: string; backupCodes: string[] }>(
            "/api/auth/two-factor/enable",
            { body: { password } },
          );
          setPassword("");
          setStep({ kind: "scan", uri: r.totpURI, codes: r.backupCodes });
          return;
        }
        case "scan": {
          if (step.kind !== "scan") return;
          await api("/api/auth/two-factor/verify-totp", {
            body: { code: code.replace(/\s/g, "") },
          });
          setCode("");
          await refreshAll();
          showToast("Two-factor sign-in is on", "ok");
          setStep({ kind: "codes", codes: step.codes, fresh: true });
          return;
        }
        case "view": {
          const r = await api<{ codes: string[] }>(
            "/v1/me/two-factor/recovery-codes",
            { body: { password } },
          );
          setPassword("");
          setStep({ kind: "codes", codes: r.codes, fresh: false });
          return;
        }
        case "regenerate": {
          const r = await api<{ backupCodes: string[] }>(
            "/api/auth/two-factor/generate-backup-codes",
            { body: { password } },
          );
          setPassword("");
          await queryClient.invalidateQueries({
            queryKey: ["me", "two-factor"],
          });
          setStep({ kind: "codes", codes: r.backupCodes, fresh: true });
          return;
        }
        case "disable": {
          await api("/api/auth/two-factor/disable", {
            body: { password, code: code.trim() },
          });
          reset();
          await refreshAll();
          showToast("Two-factor sign-in is off", "ok");
          return;
        }
      }
    },
    onError: (e) => showError("Couldn't finish", e),
  });

  const requirement = useMutation({
    mutationFn: (requireTwoFactor: boolean) =>
      api<FirmSecurityView>("/v1/settings/security", {
        method: "PUT",
        body: { requireTwoFactor },
        headers: {
          "x-firm-id": data.firmId ?? "",
          "if-match": String(security.data?.version ?? 0),
        },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["firm-security", data.firmId], saved);
      void queryClient.invalidateQueries({
        queryKey: ["firm-selection", data.userId],
      });
    },
    onError: (e) => {
      void security.refetch();
      showError("Couldn't change the firm's rule", e);
    },
  });

  if (!signedIn)
    return (
      <Card style={{ gap: space.sm }}>
        <Txt variant="heading">Two-factor sign-in</Txt>
        <Notice
          tone="info"
          text="Two-factor sign-in needs a connected account. In this demo build there is no login, so there is nothing to protect yet."
        />
      </Card>
    );

  const enabled = auth.me?.twoFactorEnabled === true;
  const passwordField = (onSubmit: () => void) => (
    <TextField
      label="Your password"
      value={password}
      onChangeText={setPassword}
      secureTextEntry
      autoCapitalize="none"
      autoComplete="current-password"
      onSubmitEditing={onSubmit}
    />
  );
  const codeField = (label: string) => (
    <TextField
      label={label}
      value={code}
      onChangeText={setCode}
      keyboardType={step.kind === "scan" ? "number-pad" : "default"}
      autoCapitalize="none"
      autoComplete="one-time-code"
      maxLength={11}
    />
  );
  const actions = (label: string, action: Step["kind"], ready: boolean) => (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      <Button label="Cancel" onPress={reset} disabled={run.isPending} />
      <Button
        label={label}
        variant={action === "disable" ? "danger" : "primary"}
        loading={run.isPending}
        disabled={!ready}
        onPress={() => run.mutate(action)}
        style={{ flex: 1 }}
      />
    </View>
  );

  return (
    <View style={{ gap: space.sm }}>
      {data.twoFactorBlocked ? (
        <Notice text="This firm requires two-factor sign-in. Turn it on below, then the firm opens again." />
      ) : null}
      <Card style={{ gap: space.md }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
          }}
        >
          <Txt variant="heading" style={{ flex: 1 }}>
            Two-factor sign-in
          </Txt>
          <Badge
            label={enabled ? "On" : "Off"}
            tone={enabled ? "neutral" : "warn"}
          />
        </View>
        <Txt variant="small" tone="body">
          {enabled
            ? `Logging in asks for your password and a code from your authenticator app. ${status.data ? `${status.data.recoveryCodesLeft} recovery ${status.data.recoveryCodesLeft === 1 ? "code" : "codes"} left.` : ""}`
            : "Protect your books if your password leaks: logging in will also ask for a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator and others)."}
        </Txt>

        {step.kind === "idle" && !enabled ? (
          <Button
            label="Turn on two-factor sign-in"
            variant="primary"
            icon="lock"
            onPress={() => setStep({ kind: "enable" })}
          />
        ) : null}
        {step.kind === "idle" && enabled ? (
          <View style={{ gap: space.sm }}>
            <Button
              label="Show recovery codes"
              onPress={() => setStep({ kind: "view" })}
            />
            <Button
              label="New recovery codes"
              onPress={() => setStep({ kind: "regenerate" })}
            />
            <Button
              label="Turn off two-factor sign-in"
              variant="danger"
              onPress={() => setStep({ kind: "disable" })}
            />
          </View>
        ) : null}

        {step.kind === "enable" ? (
          <View style={{ gap: space.sm }}>
            {passwordField(() => run.mutate("enable"))}
            {actions("Continue", "enable", password.length > 0)}
          </View>
        ) : null}

        {step.kind === "scan" ? (
          <View style={{ gap: space.md }}>
            <Txt variant="bodyStrong">
              1. Scan this QR code with your authenticator app
            </Txt>
            <View style={{ alignItems: "center" }}>
              <QrCode text={step.uri} />
            </View>
            <Txt variant="small" tone="body">
              Can't scan? Add an account in the app with this key:
            </Txt>
            <Txt variant="mono" selectable>
              {totpSecret(step.uri)}
            </Txt>
            <Txt variant="bodyStrong">
              2. Save these recovery codes somewhere safe
            </Txt>
            <Txt variant="small" tone="body">
              Each one logs you in once if you lose your phone.
            </Txt>
            <CodeList codes={step.codes} />
            <Txt variant="bodyStrong">
              3. Enter the 6-digit code the app shows
            </Txt>
            {codeField("Code from the app")}
            {actions(
              "Turn on",
              "scan",
              /^\d{6}$/.test(code.replace(/\s/g, "")),
            )}
          </View>
        ) : null}

        {step.kind === "codes" ? (
          <View style={{ gap: space.sm }}>
            <Txt variant="small" tone="body">
              {step.fresh
                ? "Your recovery codes. Older codes no longer work. Each one logs you in once."
                : "Your unused recovery codes. Each one logs you in once."}
            </Txt>
            <CodeList codes={step.codes} />
            <Button
              label="Done"
              variant="primary"
              onPress={() => {
                reset();
                if (data.twoFactorBlocked || step.fresh) router.replace("/");
              }}
            />
          </View>
        ) : null}

        {step.kind === "view" || step.kind === "regenerate" ? (
          <View style={{ gap: space.sm }}>
            {step.kind === "regenerate" ? (
              <Txt variant="small" tone="body">
                New codes replace all the old ones.
              </Txt>
            ) : null}
            {passwordField(() => run.mutate(step.kind))}
            {actions(
              step.kind === "view" ? "Show codes" : "Make new codes",
              step.kind,
              password.length > 0,
            )}
          </View>
        ) : null}

        {step.kind === "disable" ? (
          <View style={{ gap: space.sm }}>
            <Txt variant="small" tone="body">
              Enter your password and a code from the app (or a recovery code).
            </Txt>
            {passwordField(() => run.mutate("disable"))}
            {codeField("Code or recovery code")}
            {actions(
              "Turn off",
              "disable",
              password.length > 0 && code.trim().length >= 6,
            )}
          </View>
        ) : null}
      </Card>

      {isOwner && !data.twoFactorBlocked ? (
        <Card style={{ gap: space.sm }}>
          <Txt variant="heading">For everyone in this firm</Txt>
          <Checkbox
            label="Require two-factor sign-in"
            checked={security.data?.requireTwoFactor ?? false}
            onChange={(value) => {
              if (!security.data || requirement.isPending) return;
              // The server refuses too; no owner can lock themselves out.
              if (value && !enabled)
                return showToast(
                  "Turn on two-factor sign-in for yourself first.",
                  "error",
                );
              requirement.mutate(value);
            }}
            note={
              enabled
                ? "Members without it can't open this firm until they turn it on in Settings → Account."
                : "Turn on two-factor sign-in for yourself first."
            }
          />
        </Card>
      ) : null}
    </View>
  );
}
