import { EmailCodeInput, check } from "@repo/contracts";
import { router, useLocalSearchParams } from "expo-router";
import { backOrReplace } from "@/navigation";
import { useRef, useState } from "react";
import { Button, Notice, TextField } from "@/components";
import { AuthScreen } from "@/auth/AuthScreen";
import { useAuth } from "@/auth/AuthProvider";

/** Step 2 of sign-up: type the 6-digit code that was emailed. Once right, the person is logged in. */
export default function VerifyEmailScreen() {
  const { email = "" } = useLocalSearchParams<{ email: string }>();
  const auth = useAuth();
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  const submit = async () => {
    const found = check(EmailCodeInput, { email, otp });
    setError(found?.otp);
    if (found) return;
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await auth.verifyEmail(email, otp);
    } catch (e) {
      setProblem(
        e instanceof Error
          ? e.message
          : "Couldn't check the code. Please try again.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const resend = async () => {
    setProblem(null);
    try {
      await auth.sendEmailCode(email);
      setInfo("A new code is on its way.");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't send a new code.");
    }
  };

  return (
    <AuthScreen
      title="Check your email"
      note={`We sent a 6-digit code to ${email}. It works for 5 minutes.`}
    >
      <TextField
        label="6-digit code"
        value={otp}
        onChangeText={(t) => setOtp(t.replace(/\D/g, ""))}
        keyboardType="number-pad"
        maxLength={6}
        autoComplete="one-time-code"
        autoFocus
        error={error}
        onSubmitEditing={submit}
      />
      {problem ? <Notice text={problem} /> : null}
      {info ? <Notice tone="info" text={info} /> : null}
      <Button
        label="Verify and continue"
        variant="primary"
        loading={busy}
        onPress={submit}
      />
      <Button label="Send a new code" variant="ghost" onPress={resend} />
      <Button
        label="Back"
        variant="ghost"
        onPress={() => backOrReplace(router, "/login")}
      />
    </AuthScreen>
  );
}
