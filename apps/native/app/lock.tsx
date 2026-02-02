import { useEffect, useState } from "react";
import { Button, Notice, TextField } from "@/components";
import { AuthScreen } from "@/auth/AuthScreen";
import { useAuth } from "@/auth/AuthProvider";
import {
  biometricsAvailable,
  getPinSettings,
  unlockWithBiometrics,
} from "@/auth/pin";

/** Shown when the app opens, or after it was away for the time the person chose. */
export default function LockScreen() {
  const auth = useAuth();
  const [pin, setPin] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState(false);

  const biometric = async () => {
    if (await unlockWithBiometrics()) auth.unlockedByBiometrics();
  };

  useEffect(() => {
    void (async () => {
      const wanted =
        (await getPinSettings()).useBiometrics && (await biometricsAvailable());
      setFingerprint(wanted);
      if (wanted) await biometric();
    })();
    // Runs once when the lock screen appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    const reply = await auth.unlock(pin);
    setPin("");
    setProblem(reply);
  };

  return (
    <AuthScreen
      title="Enter your PIN"
      note={
        auth.me ? `Hisaab is locked for ${auth.me.name}.` : "Hisaab is locked."
      }
    >
      <TextField
        label="PIN"
        value={pin}
        onChangeText={(t) => setPin(t.replace(/\D/g, ""))}
        secureTextEntry
        keyboardType="number-pad"
        maxLength={6}
        autoFocus
        onSubmitEditing={submit}
      />
      {problem ? <Notice text={problem} /> : null}
      <Button
        label="Unlock"
        variant="primary"
        disabled={pin.length < 4}
        onPress={submit}
      />
      {fingerprint ? (
        <Button
          label="Use fingerprint or face"
          icon="unlock"
          onPress={biometric}
        />
      ) : null}
      <Button
        label="Forgot PIN? Log out"
        variant="ghost"
        onPress={() => auth.signOut("PIN reset: please log in again.")}
      />
    </AuthScreen>
  );
}
