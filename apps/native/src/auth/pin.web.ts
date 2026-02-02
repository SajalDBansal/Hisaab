// The website has no PIN (the phone app has one). These stand-ins keep shared code simple.
export const pinSupported = false;
export const MAX_WRONG_TRIES = 5;
export const LOCK_AFTER_CHOICES = [0, 1, 5, 15] as const;

export interface PinSettings {
  lockAfterMinutes: number;
  useBiometrics: boolean;
}

export const isValidPin = (pin: string) => /^\d{4,6}$/.test(pin);
export const hasPin = async () => false;
export async function setPin(_pin: string): Promise<void> {}
export async function removePin(): Promise<void> {}
export type PinCheck =
  | { result: "ok" }
  | { result: "wrong"; triesLeft: number }
  | { result: "too-many" };
export const checkPin = async (_pin: string): Promise<PinCheck> => ({
  result: "ok",
});
export const getPinSettings = async (): Promise<PinSettings> => ({
  lockAfterMinutes: 1,
  useBiometrics: false,
});
export async function savePinSettings(_settings: PinSettings): Promise<void> {}
export const biometricsAvailable = async () => false;
export const unlockWithBiometrics = async () => false;
