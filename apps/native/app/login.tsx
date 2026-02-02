import { SignInInput, check } from "@repo/contracts";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { Button, Card, Notice, TextField, Txt } from "@/components";
import { ApiFailure } from "@/auth/api";
import { AuthScreen } from "@/auth/AuthScreen";
import { useAuth } from "@/auth/AuthProvider";
import { space } from "@/theme";

interface Elsewhere {
  deviceName: string | null;
  lastActiveAt: string;
}

const ago = (iso: string) => {
  const minutes = Math.max(
    1,
    Math.round((Date.now() - new Date(iso).getTime()) / 60_000),
  );
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} hours ago`;
  return `${Math.round(minutes / 60 / 24)} days ago`;
};

export default function LoginScreen() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elsewhere, setElsewhere] = useState<Elsewhere | null>(null);
  const submitting = useRef(false);

  const submit = async (takeOver = false) => {
    const found = check(SignInInput, { email, password });
    setErrors(found ?? {});
    if (found) return;
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await auth.signIn(email.trim().toLowerCase(), password, takeOver);
      setElsewhere(null);
    } catch (e) {
      if (e instanceof ApiFailure && e.code === "ACTIVE_ELSEWHERE") {
        setElsewhere({
          deviceName: (e.details.deviceName as string | null) ?? null,
          lastActiveAt: String(e.details.lastActiveAt),
        });
      } else if (e instanceof ApiFailure && e.code === "EMAIL_NOT_VERIFIED") {
        // The account exists but the email was never confirmed: send a fresh code and ask for it
        await auth.sendEmailCode(email.trim().toLowerCase()).catch(() => {});
        router.push({
          pathname: "/verify-email",
          params: { email: email.trim().toLowerCase() },
        });
      } else
        setProblem(
          e instanceof Error ? e.message : "Couldn't log in. Please try again.",
        );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <AuthScreen
      title="Log in"
      note="Use the email and password you signed up with."
    >
      {auth.endedReason ? <Notice text={auth.endedReason} /> : null}
      {problem ? <Notice text={problem} /> : null}

      {elsewhere ? (
        <Card style={{ gap: space.md }}>
          <Txt variant="heading">Already logged in on another device</Txt>
          <Txt variant="body" tone="body">
            {`You're logged in on ${elsewhere.deviceName ?? "another device"} (active ${ago(elsewhere.lastActiveAt)}). Log in here and log out there?`}
          </Txt>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button label="Cancel" onPress={() => setElsewhere(null)} />
            <Button
              label="Log in here"
              variant="primary"
              loading={busy}
              onPress={() => submit(true)}
              style={{ flex: 1 }}
            />
          </View>
        </Card>
      ) : (
        <>
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            error={errors.email}
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            error={errors.password}
            onSubmitEditing={() => submit()}
          />
          <Button
            label="Log in"
            variant="primary"
            loading={busy}
            onPress={() => submit()}
          />
          <Button
            label="Forgot password?"
            variant="ghost"
            onPress={() =>
              router.push({ pathname: "/forgot-password", params: { email } })
            }
          />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
            }}
          >
            <Txt variant="small" tone="body">
              New to Hisaab?
            </Txt>
            <Button
              label="Create an account"
              variant="ghost"
              size="sm"
              onPress={() => router.push("/signup")}
            />
          </View>
        </>
      )}
    </AuthScreen>
  );
}
