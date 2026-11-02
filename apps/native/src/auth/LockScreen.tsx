import { useEffect, useState } from "react";
import { Button, Notice, TextField } from "@/components";
import { AuthScreen } from "@/auth/AuthScreen";
import { useAuth } from "@/auth/AuthProvider";
import { biometricsAvailable, getPinSettings } from "@/auth/pin";

/** Rendered over the current screen so unlocking restores its unsaved draft. */
export default function LockScreen() {
  const auth = useAuth();
  const [pin, setPin] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState(false);
  const [busy, setBusy] = useState(false);

  const biometric = async () => {
    setBusy(true);
    try {
      setProblem(await auth.unlockBiometric());
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const wanted =
          (await getPinSettings()).useBiometrics &&
          (await biometricsAvailable());
        setFingerprint(wanted);
      } catch {
        setProblem(
          "The lock settings could not be read. Restore secure storage access and retry, or log out.",
        );
      }
    })();
    // Runs once when the lock screen appears
  }, []);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setProblem(await auth.unlock(pin));
      setPin("");
    } finally {
      setBusy(false);
    }
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
      {auth.lockError ? <Notice text={auth.lockError} /> : null}
      {problem ? <Notice text={problem} /> : null}
      <Button
        label="Unlock"
        variant="primary"
        disabled={busy || pin.length < 4}
        onPress={submit}
      />
      {fingerprint ? (
        <Button
          label="Use fingerprint or face"
          icon="unlock"
          disabled={busy}
          onPress={biometric}
        />
      ) : null}
      {auth.lockError ? (
        <Button
          label="Retry login check"
          disabled={busy}
          onPress={() => auth.refresh()}
        />
      ) : null}
      <Button
        label={
          auth.lockError ? "Retry logout / reset PIN" : "Forgot PIN? Log out"
        }
        variant="ghost"
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await auth.signOut("PIN reset: please log in again.");
          } finally {
            setBusy(false);
          }
        }}
      />
    </AuthScreen>
  );
}
