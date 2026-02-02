/**
 * Small secrets kept on the phone (session cookie, PIN hash), in the system's secure storage.
 * The web version (storage.web.ts) keeps nothing: the browser looks after its own cookies.
 */
import * as SecureStore from "expo-secure-store";

export const secretsSupported = true;

export async function getSecret(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setSecret(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function deleteSecret(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Nothing stored under that name
  }
}
