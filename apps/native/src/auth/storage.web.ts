// The browser stores the session cookie itself, and the website has no PIN (it logs out when idle).
export const secretsSupported = false;

export async function getSecret(_key: string): Promise<string | null> {
  return null;
}
export async function setSecret(_key: string, _value: string): Promise<void> {}
export async function deleteSecret(_key: string): Promise<void> {}
