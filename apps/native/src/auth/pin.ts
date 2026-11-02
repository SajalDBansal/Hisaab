/**
 * The app PIN. It protects this phone, not the account, so it never leaves the phone:
 * only a salted hash is kept, in the system's secure storage.
 * The web version (pin.web.ts) does nothing: the website logs out when idle instead.
 */
import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import { deleteSecret, getSecret, setSecret } from "./storage";

export const pinSupported = true;
export const MAX_WRONG_TRIES = 5;
export const LOCK_AFTER_CHOICES = [0, 1, 5, 15] as const;

const PIN_KEY = "hisaab.pin";
const TRIES_KEY = "hisaab.pin.tries";
const SETTINGS_KEY = "hisaab.pin.settings";

export interface PinSettings {
  /** Minutes in the background before the app locks again (0 = every time). */
  lockAfterMinutes: number;
  useBiometrics: boolean;
}
const DEFAULT_SETTINGS: PinSettings = {
  lockAfterMinutes: 1,
  useBiometrics: false,
};

const hash = (salt: string, pin: string) =>
  Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${salt}:${pin}`,
  );

export const isValidPin = (pin: string) => /^\d{4,6}$/.test(pin);

export async function hasPin(): Promise<boolean> {
  return (await readPin()) !== null;
}

async function readPin(): Promise<{ salt: string; hash: string } | null> {
  const saved = await getSecret(PIN_KEY);
  if (saved === null) return null;
  const value = JSON.parse(saved);
  if (
    !value ||
    typeof value.salt !== "string" ||
    !/^[a-f0-9]{32}$/.test(value.salt) ||
    typeof value.hash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.hash)
  )
    throw new Error(
      "The saved PIN cannot be read. Retry or log out to reset it.",
    );
  return value;
}

export async function setPin(pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error("The PIN should be 4 to 6 digits.");
  const configured = await hasPin();
  const salt = Array.from(await Crypto.getRandomBytesAsync(16), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const saved = JSON.stringify({ salt, hash: await hash(salt, pin) });
  // Commit the PIN last so a failed setup cannot silently install a new PIN.
  if (!configured) await savePinSettings(DEFAULT_SETTINGS);
  await setSecret(TRIES_KEY, "0");
  await setSecret(PIN_KEY, saved);
}

export async function removePin(): Promise<void> {
  // Keep attempts and policy intact if deletion fails. The next setup resets
  // this harmless supporting state before installing another PIN.
  await deleteSecret(PIN_KEY);
}

export type PinCheck =
  | { result: "ok" }
  | { result: "wrong"; triesLeft: number }
  | { result: "too-many" };

async function wrongTries(): Promise<number> {
  const saved = await getSecret(TRIES_KEY);
  const tries = saved === null ? 0 : Number(saved);
  if ((saved !== null && !/^\d+$/.test(saved)) || !Number.isSafeInteger(tries))
    throw new Error(
      "The PIN attempts cannot be read. Log out to reset the PIN.",
    );
  return tries;
}

/** Checks a PIN. After 5 wrong tries in a row the caller must log the device out. */
let checks = Promise.resolve();
export function checkPin(pin: string): Promise<PinCheck> {
  const next = checks.then(() => checkSavedPin(pin));
  checks = next.then(
    () => {},
    () => {},
  );
  return next;
}

async function checkSavedPin(pin: string): Promise<PinCheck> {
  const saved = await readPin();
  if (!saved)
    throw new Error(
      "The saved PIN is missing. Log out and sign in to reset it.",
    );
  const tries = await wrongTries();
  if (tries >= MAX_WRONG_TRIES) return { result: "too-many" };
  const { salt, hash: expected } = saved;
  if ((await hash(salt, pin)) === expected) {
    await setSecret(TRIES_KEY, "0");
    return { result: "ok" };
  }
  await setSecret(TRIES_KEY, String(tries + 1));
  return tries + 1 >= MAX_WRONG_TRIES
    ? { result: "too-many" }
    : { result: "wrong", triesLeft: MAX_WRONG_TRIES - tries - 1 };
}

export async function getPinSettings(): Promise<PinSettings> {
  const saved = await getSecret(SETTINGS_KEY);
  if (saved === null) return { ...DEFAULT_SETTINGS };
  return validateSettings(JSON.parse(saved));
}

function validateSettings(value: PinSettings): PinSettings {
  if (
    !value ||
    !LOCK_AFTER_CHOICES.some((minutes) => minutes === value.lockAfterMinutes) ||
    typeof value.useBiometrics !== "boolean"
  )
    throw new Error(
      "The PIN settings cannot be read. Retry or log out to reset them.",
    );
  return {
    lockAfterMinutes: value.lockAfterMinutes,
    useBiometrics: value.useBiometrics,
  };
}

export async function savePinSettings(settings: PinSettings): Promise<void> {
  await setSecret(SETTINGS_KEY, JSON.stringify(validateSettings(settings)));
}

/** Fingerprint or face unlock is offered only when the phone has it set up. */
export async function biometricsAvailable(): Promise<boolean> {
  try {
    return (
      (await LocalAuthentication.hasHardwareAsync()) &&
      (await LocalAuthentication.isEnrolledAsync())
    );
  } catch {
    return false;
  }
}

export async function unlockWithBiometrics(): Promise<boolean> {
  if (!(await biometricsEnabled())) return false;
  let success = false;
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock Hisaab",
      disableDeviceFallback: true,
    });
    success = result.success;
  } catch {
    return false;
  }
  return success && (await biometricsEnabled());
}

async function biometricsEnabled(): Promise<boolean> {
  return (
    (await hasPin()) &&
    (await getPinSettings()).useBiometrics &&
    (await wrongTries()) < MAX_WRONG_TRIES
  );
}
