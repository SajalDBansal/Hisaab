import { Email, Password } from "@repo/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Button, Notice, TextField } from "@/components";
import { api } from "@/auth/api";
import { AuthScreen } from "@/auth/AuthScreen";

/** Reset a forgotten password: a code goes to the email, then the person picks a new password. */
export default function ForgotPasswordScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? "");
  const [step, setStep] = useState<"email" | "code">("email");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const run = async (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (e) {
      setProblem(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const sendCode = () =>
    run(async () => {
      if (!Email.safeParse(email).success)
        throw new Error("Enter a valid email.");
      await api("/api/auth/email-otp/request-password-reset", {
        body: { email: email.trim().toLowerCase() },
      });
      setStep("code");
    });

  const reset = () =>
    run(async () => {
      if (!/^\d{6}$/.test(otp)) throw new Error("Enter the 6-digit code.");
      const parsed = Password.safeParse(password);
      if (!parsed.success)
        throw new Error(
          parsed.error.issues[0]?.message ?? "Choose a stronger password.",
        );
      await api("/api/auth/email-otp/reset-password", {
        body: { email: email.trim().toLowerCase(), otp, password },
      });
      setDone(true);
    });

  if (done)
    return (
      <AuthScreen
        title="Password changed"
        note="You've been logged out everywhere else. Log in with your new password."
      >
        <Button
          label="Go to log in"
          variant="primary"
          onPress={() => router.replace("/login")}
        />
      </AuthScreen>
    );

  return (
    <AuthScreen
      title="Reset your password"
      note={
        step === "email"
          ? "We'll email you a 6-digit code."
          : `Enter the code we sent to ${email} and choose a new password.`
      }
    >
      {step === "email" ? (
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          onSubmitEditing={sendCode}
        />
      ) : (
        <>
          <TextField
            label="6-digit code"
            value={otp}
            onChangeText={(t) => setOtp(t.replace(/\D/g, ""))}
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
          />
          <TextField
            label="New password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            onSubmitEditing={reset}
          />
        </>
      )}
      {problem ? <Notice text={problem} /> : null}
      <Button
        label={step === "email" ? "Send code" : "Change password"}
        variant="primary"
        loading={busy}
        onPress={step === "email" ? sendCode : reset}
      />
      <Button
        label="Back to log in"
        variant="ghost"
        onPress={() => router.replace("/login")}
      />
    </AuthScreen>
  );
}
