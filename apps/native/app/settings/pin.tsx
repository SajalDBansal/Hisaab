import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
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
  showError,
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

  const load = async () => {
    setHas(await hasPin());
    setSettings(await getPinSettings());
    setCanBiometric(await biometricsAvailable());
  };
  useEffect(() => void load(), []);
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
    setProblem(null);
    if (has && (await checkPin(current)).result !== "ok")
      return setProblem("The current PIN isn't right.");
    if (!isValidPin(pin)) return setProblem("The PIN should be 4 to 6 digits.");
    if (pin !== again) return setProblem("The two PINs don't match.");
    try {
      await setPin(pin);
      setCurrent("");
      setNewPin("");
      setAgain("");
      await load();
      if (first) router.replace("/");
    } catch (e) {
      showError("Couldn't save the PIN", e);
    }
  };

  const remove = async () => {
    setProblem(null);
    if ((await checkPin(current)).result !== "ok")
      return setProblem("Enter the current PIN to remove it.");
    await removePin();
    setCurrent("");
    await load();
  };

  const change = async (next: PinSettings) => {
    setSettings(next);
    await savePinSettings(next);
  };

  return (
    <Screen header={<Header title="App lock" subtitle="PIN for this phone" />}>
      <Card style={{ gap: space.md }}>
        <Txt variant="heading">{has ? "Change your PIN" : "Set a PIN"}</Txt>
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
        <Button
          label={has ? "Change PIN" : "Save PIN"}
          variant="primary"
          onPress={save}
        />
        {first && !has ? (
          <Button
            label="Not now"
            variant="ghost"
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
            <Button label="Remove PIN" variant="danger" onPress={remove} />
          </View>
          <Txt variant="caption" tone="body">
            To remove the PIN, type the current PIN above first.
          </Txt>
        </Card>
      ) : null}
    </Screen>
  );
}
