import { SignInInput, check } from "@repo/contracts";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { Button, Card, Notice, TextField, Txt } from "@/components";
import { ApiFailure } from "@/auth/api";
import { AuthScreen } from "@/auth/AuthScreen";
import { useAuth } from "@/auth/AuthProvider";
import { timeAgo } from "@/data/format";
import { space } from "@/theme";

interface Elsewhere {
  deviceName: string | null;
  lastActiveAt: string;
}

export default function LoginScreen() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elsewhere, setElsewhere] = useState<Elsewhere | null>(null);
  // Two-factor sign-in (doc 37, T58): the password was right, now the code.
  const [challenge, setChallenge] = useState<{ takeOver: boolean } | null>(
    null,
  );
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
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
      const result = await auth.signIn(
        email.trim().toLowerCase(),
        password,
        takeOver,
      );
      setElsewhere(null);
      if (result === "twoFactor") {
        setCode("");
        setChallenge({ takeOver });
      }
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

  const submitCode = async () => {
    if (!challenge || submitting.current) return;
    const typed = code.trim();
    if (!(useRecovery ? typed.length >= 10 : /^\d{6}$/.test(typed))) {
      setErrors({
        code: useRecovery
          ? "Enter one of your recovery codes."
          : "Enter the 6-digit code from your authenticator app.",
      });
      return;
    }
    setErrors({});
    submitting.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await auth.verifyTwoFactor(typed, challenge.takeOver);
      setChallenge(null);
    } catch (e) {
      // These end the challenge: start again from the password.
      if (
        e instanceof ApiFailure &&
        [
          "ACTIVE_ELSEWHERE",
          "INVALID_TWO_FACTOR_COOKIE",
          "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
          "ACCOUNT_TEMPORARILY_LOCKED",
        ].includes(e.code)
      ) {
        setChallenge(null);
        setCode("");
        if (e.code === "ACTIVE_ELSEWHERE")
          setElsewhere({
            deviceName: (e.details.deviceName as string | null) ?? null,
            lastActiveAt: String(e.details.lastActiveAt),
          });
      }
      if (!(e instanceof ApiFailure && e.code === "ACTIVE_ELSEWHERE"))
        setProblem(
          e instanceof Error ? e.message : "Couldn't log in. Please try again.",
        );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  if (challenge)
    return (
      <AuthScreen
        title="Enter your code"
        note={
          useRecovery
            ? "Enter one of the recovery codes you saved when you turned on two-factor sign-in. Each code works once."
            : "Open your authenticator app and enter the 6-digit code for Hisaab."
        }
      >
        {problem ? <Notice text={problem} /> : null}
        <TextField
          label={useRecovery ? "Recovery code" : "6-digit code"}
          value={code}
          onChangeText={setCode}
          keyboardType={useRecovery ? "default" : "number-pad"}
          autoCapitalize="none"
          autoComplete="one-time-code"
          maxLength={useRecovery ? 11 : 6}
          autoFocus
          error={errors.code}
          onSubmitEditing={() => void submitCode()}
        />
        <Button
          label="Log in"
          variant="primary"
          loading={busy}
          onPress={() => void submitCode()}
        />
        <Button
          label={
            useRecovery ? "Use the authenticator app" : "Use a recovery code"
          }
          variant="ghost"
          onPress={() => {
            setUseRecovery((v) => !v);
            setCode("");
            setErrors({});
          }}
        />
        <Button
          label="Back"
          variant="ghost"
          onPress={() => {
            setChallenge(null);
            setCode("");
            setProblem(null);
          }}
        />
      </AuthScreen>
    );

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
            {`You're logged in on ${elsewhere.deviceName ?? "another device"} (active ${timeAgo(elsewhere.lastActiveAt)}). Log in here and log out there?`}
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
