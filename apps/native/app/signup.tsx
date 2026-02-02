import { SignUpInput, check } from "@repo/contracts";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { Button, Notice, TextField, Txt } from "@/components";
import { AuthScreen } from "@/auth/AuthScreen";
import { useAuth } from "@/auth/AuthProvider";

export default function SignUpScreen() {
  const auth = useAuth();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phoneNumber: "",
    password: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const set = (key: keyof typeof form) => (value: string) =>
    setForm({ ...form, [key]: value });

  const submit = async () => {
    const found = check(SignUpInput, form);
    setErrors(found ?? {});
    if (found) return;
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setProblem(null);
    const email = form.email.trim().toLowerCase();
    try {
      await auth.signUp({ ...form, email });
      router.push({ pathname: "/verify-email", params: { email } });
    } catch (e) {
      setProblem(
        e instanceof Error
          ? e.message
          : "Couldn't create the account. Please try again.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <AuthScreen
      title="Create your account"
      note="We'll email you a 6-digit code to confirm your email."
    >
      <TextField
        label="Your name"
        value={form.name}
        onChangeText={set("name")}
        autoComplete="name"
        error={errors.name}
      />
      <TextField
        label="Email"
        value={form.email}
        onChangeText={set("email")}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        error={errors.email}
      />
      <TextField
        label="Mobile number"
        value={form.phoneNumber}
        onChangeText={set("phoneNumber")}
        keyboardType="phone-pad"
        autoComplete="tel"
        placeholder="98370 45120"
        error={errors.phoneNumber}
      />
      <TextField
        label="Password"
        value={form.password}
        onChangeText={set("password")}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        error={errors.password}
        onSubmitEditing={submit}
      />
      <Txt variant="caption" tone="body">
        Your mobile number is saved on your account. Checking it by WhatsApp
        will be added later; you can use everything in the app meanwhile.
      </Txt>
      {problem ? <Notice text={problem} /> : null}
      <Button
        label="Create account"
        variant="primary"
        loading={busy}
        onPress={submit}
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
          Already have an account?
        </Txt>
        <Button
          label="Log in"
          variant="ghost"
          size="sm"
          onPress={() => router.replace("/login")}
        />
      </View>
    </AuthScreen>
  );
}
