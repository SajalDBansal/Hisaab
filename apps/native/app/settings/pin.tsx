import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import {
  Button,
  Card,
  Checkbox,
  Chip,
  ChipRow,
  Header,
  Notice,
  Screen,
  TextField,
  Txt,
} from "@/components";
import { useAuth } from "@/auth/AuthProvider";
import {
  LOCK_AFTER_CHOICES,
  biometricsAvailable,
  checkPin,
  getPinSettings,
  hasPin,
  isValidPin,
  pinSupported,
  removePin,
  savePinSettings,
  setPin,
  type PinSettings,
} from "@/auth/pin";
import { space } from "@/theme";

/** Set, change or remove the app PIN, and choose when the app locks. Phone only. */
export default function PinScreen() {
  const { first } = useLocalSearchParams<{ first?: string }>();
  const auth = useAuth();
  const [has, setHas] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<PinSettings>({
    lockAfterMinutes: 1,
    useBiometrics: false,
  });
  const [canBiometric, setCanBiometric] = useState(false);
  const [current, setCurrent] = useState("");
  const [pin, setNewPin] = useState("");
  const [again, setAgain] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setHas(null);
    setProblem(null);
    try {
      const configured = await hasPin();
      const saved = configured
        ? await getPinSettings()
        : { lockAfterMinutes: 1, useBiometrics: false };
      const available = await biometricsAvailable();
      setSettings(saved);
      setCanBiometric(available);
      setHas(configured);
      return true;
    } catch {
      setProblem(
        "The PIN settings could not be read. Restore secure storage access and retry.",
      );
      return false;
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (first) auth.clearAskForPin();
  }, [auth, first]);

  if (!pinSupported)
    return (
      <Screen header={<Header title="App lock" />}>
        <Notice
          tone="info"
          text="The PIN lock is for the phone app. The website doesn't use one."
        />
      </Screen>
    );

  const digits = (setter: (v: string) => void) => (t: string) =>
    setter(t.replace(/\D/g, ""));

  const save = async () => {
    if (has === null || busy) return;
    setProblem(null);
    if (!isValidPin(pin)) return setProblem("The PIN should be 4 to 6 digits.");
    if (pin !== again) return setProblem("The two PINs don't match.");
    setBusy(true);
    try {
      if (!(await verifyCurrent())) return;
      await setPin(pin);
      setCurrent("");
      setNewPin("");
      setAgain("");
      if ((await load()) && first) router.replace("/");
    } catch {
      setHas(null);
      setProblem(
        "The PIN could not be saved. Retry loading its saved state before trying again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (has === null || busy) return;
    setProblem(null);
    setBusy(true);
    try {
      if (!(await verifyCurrent())) return;
      await removePin();
      setCurrent("");
      await load();
    } catch {
      setHas(null);
      setProblem(
        "The PIN could not be removed. Retry loading its saved state before trying again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const change = async (next: PinSettings) => {
    if (has === null || busy) return;
    setProblem(null);
    setBusy(true);
    try {
      await savePinSettings(next);
      setSettings(next);
    } catch {
      setHas(null);
      setProblem(
        "The lock settings could not be saved. Retry loading their saved state before trying again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const verifyCurrent = async () => {
    // Re-read before any change; an unavailable initial read must never mean no PIN.
    if (!(await hasPin())) {
      if (has)
        throw new Error("The saved PIN changed. Reload its saved state.");
      return true;
    }
    const result = await checkPin(current);
    if (result.result === "ok") return true;
    if (result.result === "too-many")
      await auth.endSession("Too many wrong PINs. Please log in again.");
    setProblem("The current PIN isn't right.");
    return false;
  };

  return (
    <Screen header={<Header title="App lock" subtitle="PIN for this phone" />}>
      <Card style={{ gap: space.md }}>
        <Txt variant="heading">
          {has === null
            ? "Checking app lock"
            : has
              ? "Change your PIN"
              : "Set a PIN"}
        </Txt>
        <Txt variant="small" tone="body">
          The PIN keeps other people out of the app on this phone. It stays on
          the phone and is never sent to our servers. Five wrong tries log you
          out.
        </Txt>
        {has ? (
          <TextField
            label="Current PIN"
            value={current}
            onChangeText={digits(setCurrent)}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={6}
          />
        ) : null}
        <TextField
          label={has ? "New PIN (4 to 6 digits)" : "PIN (4 to 6 digits)"}
          value={pin}
          onChangeText={digits(setNewPin)}
          secureTextEntry
          keyboardType="number-pad"
          maxLength={6}
        />
        <TextField
          label="Type it again"
          value={again}
          onChangeText={digits(setAgain)}
          secureTextEntry
          keyboardType="number-pad"
          maxLength={6}
          onSubmitEditing={save}
        />
        {problem ? <Notice text={problem} /> : null}
        {has === null && problem ? (
          <Button
            label="Retry loading PIN settings"
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              try {
                await load();
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : null}
        <Button
          label={has ? "Change PIN" : "Save PIN"}
          variant="primary"
          disabled={has === null || busy}
          onPress={save}
        />
        {first && has === false ? (
          <Button
            label="Not now"
            variant="ghost"
            disabled={busy}
            onPress={() => router.replace("/")}
          />
        ) : null}
      </Card>

      {has ? (
        <Card style={{ gap: space.md }}>
          <Txt variant="heading">When to lock</Txt>
          <ChipRow>
            {LOCK_AFTER_CHOICES.map((minutes) => (
              <Chip
                key={minutes}
                label={minutes === 0 ? "Every time" : `After ${minutes} min`}
                selected={settings.lockAfterMinutes === minutes}
                onPress={() =>
                  change({ ...settings, lockAfterMinutes: minutes })
                }
              />
            ))}
          </ChipRow>
          {canBiometric ? (
            <Checkbox
              label="Unlock with fingerprint or face"
              checked={settings.useBiometrics}
              onChange={(useBiometrics) =>
                change({ ...settings, useBiometrics })
              }
            />
          ) : null}
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button label="Lock now" onPress={auth.lockNow} />
            <Button
              label="Remove PIN"
              variant="danger"
              disabled={busy}
              onPress={remove}
            />
          </View>
          <Txt variant="caption" tone="body">
            To remove the PIN, type the current PIN above first.
          </Txt>
        </Card>
      ) : null}
    </Screen>
  );
}
