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
  return (await getSecret(PIN_KEY)) !== null;
}

export async function setPin(pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error("The PIN should be 4 to 6 digits.");
  const salt = Array.from(await Crypto.getRandomBytesAsync(16), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  await setSecret(
    PIN_KEY,
    JSON.stringify({ salt, hash: await hash(salt, pin) }),
  );
  await setSecret(TRIES_KEY, "0");
}

export async function removePin(): Promise<void> {
  await Promise.all([
    deleteSecret(PIN_KEY),
    deleteSecret(TRIES_KEY),
    deleteSecret(SETTINGS_KEY),
  ]);
}

export type PinCheck =
  | { result: "ok" }
  | { result: "wrong"; triesLeft: number }
  | { result: "too-many" };

/** Checks a PIN. After 5 wrong tries in a row the caller must log the device out. */
export async function checkPin(pin: string): Promise<PinCheck> {
  const saved = await getSecret(PIN_KEY);
  if (!saved) return { result: "ok" };
  const { salt, hash: expected } = JSON.parse(saved) as {
    salt: string;
    hash: string;
  };
  if ((await hash(salt, pin)) === expected) {
    await setSecret(TRIES_KEY, "0");
    return { result: "ok" };
  }
  const tries = Number((await getSecret(TRIES_KEY)) ?? 0) + 1;
  await setSecret(TRIES_KEY, String(tries));
  return tries >= MAX_WRONG_TRIES
    ? { result: "too-many" }
    : { result: "wrong", triesLeft: MAX_WRONG_TRIES - tries };
}

export async function getPinSettings(): Promise<PinSettings> {
  try {
    return {
      ...DEFAULT_SETTINGS,
      ...JSON.parse((await getSecret(SETTINGS_KEY)) ?? "{}"),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function savePinSettings(settings: PinSettings): Promise<void> {
  await setSecret(SETTINGS_KEY, JSON.stringify(settings));
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
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock Hisaab",
      disableDeviceFallback: true,
    });
    return result.success;
  } catch {
    return false;
  }
}
